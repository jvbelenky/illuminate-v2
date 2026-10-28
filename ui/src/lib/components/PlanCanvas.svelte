<script module lang="ts">
	import type { Vertex } from '$lib/utils/roomGeometry';
	export type CanvasTool = 'edit' | 'draw' | 'custom';

	/** A host-owned polygon drawn as a filled shape (an obstacle on the plan). */
	export interface PlanShape {
		id: string;
		vertices: Vertex[];
		name?: string;
		selected?: boolean;
		/** The row under the pointer: outlined, lighter than selected. */
		highlighted?: boolean;
		dimmed?: boolean;
		/** Excluded from the calculation: dashed, no fill. */
		disabled?: boolean;
		/** Drawn faded (the wall view fades items by their distance from the wall). */
		opacity?: number;
		/** Passes pointer events through (too far from the wall to edit). */
		inert?: boolean;
	}
	/** What the host's snippets get: enough to draw in room coordinates. */
	export interface CanvasContext {
		/** Room units per screen pixel (sizes that must stay constant on screen). */
		px: number;
		/** Room units per pixel for pointer targets: never below the old fixed-560 scale, so targets never shrink in a big pane. */
		hitPx: number;
		handleR: number;
		toSvg: (x: number, y: number) => [number, number];
		toScreen: (x: number, y: number) => [number, number];
		gridLo: { x: number; y: number };
		gridHi: { x: number; y: number };
		spaceHeld: boolean;
	}
</script>

<script lang="ts">
	import { tick, untrack, type Snippet } from 'svelte';
	import { planShouldHandleKey } from '$lib/plan/planKeys';
	import { userSettings, type PlanNavMode } from '$lib/stores/settings';
	import type { LampInstance, SceneObject } from '$lib/types/project';
	import { objectFootprint, polygonCentroid as polygonCentroidOf } from '$lib/utils/objectGeometry';
	import { displayDimension } from '$lib/utils/formatting';
	import { lampColor } from '$lib/utils/wavelengthColor';
	import { DISABLED_COLOR } from '$lib/utils/sceneColors';
	import Glyph from '$lib/workspace/Glyph.svelte';
	import UnitsSelect from '$lib/workspace/UnitsSelect.svelte';
	import { unitAbbrev, gridCellSize, roundToUnit, fromMeters, type LengthUnit } from '$lib/utils/unitConversion';
	import {
		polygonBoundingBox,
		polygonEdgeLengths,
		edgeMidpoints,
		edgeInwardNormals,
		normalizeCCW,
		snapTo,
		angleBetweenDeg,
		snapSegmentDirection, pointInPolygon } from '$lib/utils/roomGeometry';

	// A plan-view canvas for drawing and editing a polygon in room coordinates:
	// viewport (fit / pan / zoom), grid with rulers, light grid and corner
	// snapping with guidelines, draw-by-clicking with a gentle right-angle snap,
	// corner and wall dragging, midpoint insertion, keyboard, and context layers
	// (room outline, lamps, object footprints). Hosts add their own layers through
	// the `underlay` / `overlay` / `hud` snippets and take over clicks with the
	// `custom` tool (the Floorplan part's Set scale, for example).

	interface Props {
		/** The polygon being edited (room units). */
		draft: Vertex[];
		drawing?: boolean;
		selectedIndex?: number;
		tool?: CanvasTool;
		units: LengthUnit;
		precision: number;
		/** Points to fit when the draft is too short to fit on its own. */
		fallbackFit?: Vertex[];
		/** Extra points `fitView()` always includes (e.g. a reference image's corners). */
		extraFitPoints?: Vertex[];
		/** Coordinates may go below zero (object footprints); the room outline cannot. */
		allowNegative?: boolean;
		/** A faint context polygon (the room outline, when editing something inside it). */
		outline?: Vertex[];
		lamps?: LampInstance[];
		/** Per-lamp opacity by id (the wall view fades lamps by their distance from the wall). */
		lampOpacity?: Record<string, number>;
		/** Context lamps drawn as selected, or highlighted (their row is hovered). */
		selectedLampIds?: string[];
		highlightedLampIds?: string[];
		objects?: SceneObject[];
		/** Host shapes (obstacle footprints) with a name label; click to select when provided. */
		shapes?: PlanShape[];
		onShapeClick?: (id: string, event: PointerEvent) => void;
		/** A pointer-down inside the draft moves it whole (instead of panning). */
		draggableBody?: boolean;
		/** Double-click a corner to remove it, or a wall to add a corner there. */
		dblClickCorners?: boolean;
		/** Draw the draft as a selected area (cyan tint, dashed), as for a ceiling keep-out area. */
		selectedDraft?: boolean;
		/** Mark the outline as invalid (red). */
		invalid?: boolean;
		ariaLabel?: string;
		/** Host layers: under the outline (after the grid), over it, and HTML overlays. */
		underlay?: Snippet<[CanvasContext]>;
		overlay?: Snippet<[CanvasContext]>;
		hud?: Snippet<[CanvasContext]>;
		/** With the `custom` tool: the host owns clicks, pointer moves, leave and Enter. */
		onCustomClick?: (event: MouseEvent) => void;
		onCustomMove?: (event: PointerEvent) => void;
		onCustomLeave?: () => void;
		/** Return true to consume Enter. */
		onCustomEnter?: () => boolean;
		/** A pointer move the host may consume (return true), checked before corner dragging. */
		onHostMove?: (event: PointerEvent) => boolean;
		onHostPointerUp?: () => void;
		/** Drop the host's drag in flight without applying it (a second finger landed mid-edit). */
		onHostCancel?: () => void;
		/** A pan started on the empty canvas (hosts deselect their own layers). */
		onBackgroundPointerDown?: () => void;
		/** A left-button press on the empty canvas the host may claim instead of panning (return true); it then tracks the drag with onHostMove / onHostPointerUp. */
		onBackgroundDragStart?: (event: PointerEvent) => boolean;
		/** Fired when the drawing finishes or is cancelled, after the draft is settled. */
		onDrawEnd?: (committed: boolean) => void;
		/** Fired once an edit of the draft settles: a drag ends, a corner is removed, a nudge lands. */
		onEdit?: () => void;
		/** Show the view tools (Pan | Zoom | Fit), bottom right. Without them the canvas navigates as in Pan mode, and the wheel zooms. */
		navControls?: boolean;
		/** Pixels Fit keeps clear at the top and bottom, for controls drawn over the canvas (the main view's corner controls). */
		fitInset?: number;
		/** Show the units select before the view tools; called when it changes. */
		onUnitsChange?: (event: Event) => void;
		/** The host's armed tool's cursor, over the Pan or Zoom one ('default' keeps the handles' own). */
		toolCursor?: 'move' | 'crosshair' | 'default' | null;
	}

	let {
		draft = $bindable(),
		drawing = $bindable(false),
		selectedIndex = $bindable(-1),
		tool = $bindable<CanvasTool>('edit'),
		units,
		precision,
		fallbackFit = [],
		extraFitPoints = [],
		allowNegative = false,
		outline,
		lamps = [],
		lampOpacity = {},
		selectedLampIds = [],
		highlightedLampIds = [],
		objects = [],
		shapes = [],
		onShapeClick,
		draggableBody = false,
		dblClickCorners = false,
		selectedDraft = false,
		invalid = false,
		ariaLabel = 'Plan canvas',
		navControls = true,
		fitInset = 0,
		underlay,
		overlay,
		hud,
		onCustomClick,
		onCustomMove,
		onCustomLeave,
		onCustomEnter,
		onHostMove,
		onHostPointerUp,
		onHostCancel,
		onBackgroundPointerDown,
		onBackgroundDragStart,
		onDrawEnd,
		onEdit,
		onUnitsChange,
		toolCursor = null,
	}: Props = $props();

	let beforeDraw: Vertex[] | null = null;
	let cursor = $state<Vertex | null>(null);
	/** A corner, wall or body drag; `restore` is the draft to put back if it is cancelled (before a midpoint insert). */
	let drag = $state<{ kind: 'vertex' | 'edge' | 'body'; index: number; startPointer: Vertex; startDraft: Vertex[]; restore: Vertex[] } | null>(null);
	let svgEl = $state<SVGSVGElement | undefined>(undefined);

	const unit = $derived(unitAbbrev(units));
	const edgeLengths = $derived(draft.length >= 2 ? polygonEdgeLengths(draft) : []);
	const midpoints = $derived(draft.length >= 2 ? edgeMidpoints(draft) : []);
	// Wall-length labels sit just inside each wall so they never collide with the axis ticks
	const inwardNormals = $derived(draft.length >= 3 ? edgeInwardNormals(draft) : []);

	// --- View: a window onto the plan, in room units, with the canvas's own
	// aspect ratio. (x, y) is the bottom-left corner and `size` the shorter side;
	// zoom and pan move it, Fit resets it.
	interface View { x: number; y: number; size: number }
	const FIT_MARGIN = 1.14;
	/** Canvas width / height, measured; 1 until the canvas has a size. */
	let aspect = $state(1);
	/** Canvas height in CSS pixels, measured; 560 until the canvas has a size. */
	let canvasH = $state(560);
	function fittedView(points: Vertex[]): View {
		const pts = points.length >= 2 ? points : [[0, 0], [1, 1]] as Vertex[];
		const bb = polygonBoundingBox(pts);
		const w = bb.xMax - bb.xMin;
		const h = bb.yMax - bb.yMin;
		// Anchor the window at the outline's bottom-left with a small margin for the
		// rulers: coordinates can't go negative, so spare space belongs top and right.
		// The window takes the canvas's shape, so only the difference between the
		// outline's shape and the canvas's is spare.
		const pad = Math.max(w, h, 1) * (FIT_MARGIN - 1) / 2;
		const wp = w + 2 * pad;
		const hp = h + 2 * pad;
		// `fitInset` px stay clear at the top and bottom, so the outline height gets the rest of the canvas
		const inset = Math.min(Math.max(fitInset, 0), canvasH * 0.4);
		const hNeeded = hp * canvasH / (canvasH - 2 * inset);
		const short = aspect >= 1 ? Math.max(hNeeded, wp / aspect) : Math.max(wp, hNeeded * aspect);
		const size = Math.max(short, 1 + 2 * pad);
		const viewHeight = aspect >= 1 ? size : size / aspect;
		return { x: bb.xMin - pad, y: bb.yMin - pad - inset * viewHeight / canvasH, size };
	}
	/** Draft corners (or the fallback) plus the host's extra points, so Fit shows everything. */
	function defaultFitPoints(): Vertex[] {
		const base = draft.length >= 2 ? draft : fallbackFit;
		return [...base.map((v) => [v[0], v[1]] as Vertex), ...extraFitPoints.map((v) => [v[0], v[1]] as Vertex)];
	}
	// svelte-ignore state_referenced_locally
	let view = $state<View>(fittedView(defaultFitPoints()));
	// The window's width and height in room units
	const viewW = $derived(aspect >= 1 ? view.size * aspect : view.size);
	const viewH = $derived(aspect >= 1 ? view.size : view.size / aspect);
	// Panned or zoomed by the user since the last fit: a resize then keeps the view
	let userMoved = false;
	// The canvas's short side in CSS pixels (560 until it is measured)
	let shortSide = $state(560);
	export function fitView(points: Vertex[] = defaultFitPoints()) {
		view = fittedView(points);
		userMoved = false;
	}
	/** Re-express the view after a unit switch (factor = new units per old unit), keeping the same area on screen. */
	export function scaleView(factor: number) {
		view = { x: view.x * factor, y: view.y * factor, size: view.size * factor };
	}
	// Zoom limits are physical sizes, so millimeters zoom out as far as meters do
	const minViewSize = $derived(fromMeters(0.15, units));
	const maxViewSize = $derived(fromMeters(1500, units));
	function clampViewSize(size: number): number {
		return Math.min(Math.max(size, minViewSize), maxViewSize);
	}
	/** Zoom by `factor` about the room point (ax, ay), which stays where it is on screen. */
	function zoomAbout(ax: number, ay: number, factor: number) {
		const newSize = clampViewSize(view.size * factor);
		const k = newSize / view.size;
		view = { x: ax - (ax - view.x) * k, y: ay - (ay - view.y) * k, size: newSize };
		userMoved = true;
	}
	/** One-click zoom step about the view centre: dir 1 zooms in, -1 out. */
	export function zoomStep(dir: 1 | -1) {
		zoomAbout(view.x + viewW / 2, view.y + viewH / 2, dir > 0 ? 1 / 1.25 : 1.25);
	}
	/** Fit the view to the room-space box from `a` to `b`, centred on it. */
	function zoomToBox(a: Vertex, b: Vertex) {
		const w = Math.abs(a[0] - b[0]);
		const h = Math.abs(a[1] - b[1]);
		const size = clampViewSize(aspect >= 1 ? Math.max(h, w / aspect) : Math.max(w, h * aspect));
		const nw = aspect >= 1 ? size * aspect : size;
		const nh = aspect >= 1 ? size : size / aspect;
		view = { x: (a[0] + b[0]) / 2 - nw / 2, y: (a[1] + b[1]) / 2 - nh / 2, size };
		userMoved = true;
	}
	const gridStep = $derived.by(() => {
		const raw = view.size / 8;
		const mag = Math.pow(10, Math.floor(Math.log10(raw)));
		const norm = raw / mag;
		const nice = norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10;
		return nice * mag;
	});
	const isMajor = (v: number) => Math.round(v / gridStep) % 5 === 0;
	function gridRange(from: number, to: number): number[] {
		const out: number[] = [];
		const start = Math.floor(from / gridStep) * gridStep;
		for (let v = start; v <= to + 1e-9; v += gridStep) out.push(Math.round(v * 1e6) / 1e6);
		return out;
	}
	// Draw the grid generously past the view (a resize before the aspect is
	// measured, or one mid-gesture, can show a little more) so the axes never
	// stop partway across.
	const span = $derived(Math.max(viewW, viewH));
	const gridX = $derived(gridRange(view.x - span, view.x + span * 4));
	const gridY = $derived(gridRange(view.y - span, view.y + span * 4));
	const gridLo = $derived({ x: view.x - span, y: view.y - span });
	const gridHi = $derived({ x: view.x + span * 4, y: view.y + span * 4 });
	const viewBox = $derived(`${view.x} ${-(view.y + viewH)} ${viewW} ${viewH}`);

	// Follow the canvas's shape. Until the user pans or zooms, a resize refits;
	// after that it keeps the view's centre and zoom. A hidden canvas (0 x 0)
	// keeps its last view.
	$effect(() => {
		const el = svgEl;
		if (!el || typeof ResizeObserver === 'undefined') return;
		const measure = () => {
			const w = el.clientWidth;
			const h = el.clientHeight;
			if (w < 1 || h < 1) return;
			shortSide = Math.min(w, h);
			canvasH = h;
			const next = w / h;
			if (Math.abs(next - aspect) < 1e-3) return;
			const cx = view.x + viewW / 2;
			const cy = view.y + viewH / 2;
			aspect = next;
			if (!userMoved && !drawing && !drag) {
				fitView();
				return;
			}
			const nw = next >= 1 ? view.size * next : view.size;
			const nh = next >= 1 ? view.size : view.size / next;
			view = { x: cx - nw / 2, y: cy - nh / 2, size: view.size };
		};
		const ro = new ResizeObserver(() => untrack(measure));
		ro.observe(el);
		untrack(measure);
		return () => ro.disconnect();
	});

	// The stored outline grew or shrank (a typed size, an undo): refit, unless the
	// user has panned or zoomed since the last fit. After a tick, so the draft has
	// followed the new outline.
	let lastFitBox: string | null = null;
	$effect(() => {
		const pts = fallbackFit;
		if (pts.length < 2) return;
		const xs = pts.map((p) => p[0]);
		const ys = pts.map((p) => p[1]);
		const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((v) => Math.round(v * 1e6)).join(',');
		const prev = lastFitBox;
		lastFitBox = box;
		if (prev === null || prev === box) return;
		untrack(() => {
			tick().then(() => {
				if (!userMoved && !drawing && !drag) fitView([...fallbackFit, ...extraFitPoints].map((v) => [v[0], v[1]] as Vertex));
			});
		});
	});

	// Room (x, y) -> SVG (sx, sy): the SVG y axis is the room y axis flipped
	function toSvg(x: number, y: number): [number, number] {
		return [x, -y];
	}
	function fromSvg(sx: number, sy: number): Vertex {
		return [sx, -sy];
	}

	// Sizes in room units so they stay constant on screen: px is one CSS pixel at
	// the canvas's current size and zoom (the short side shows view.size units).
	const px = $derived(view.size / shortSide);
	// The snapping and guide tolerances keep their original reference scale
	const snapPx = $derived(view.size / 560);
	// Minimums on screen: text 11 px, lamp dots 13 px across, corner handles 12 px, "+" handles 10 px
	const handleR = $derived(px * 6);
	const midR = $derived(px * 5);
	const lampR = $derived(px * 6.5);
	// Pointer targets: the larger of the drawn scale and the old reference scale
	const hitPx = $derived(Math.max(px, snapPx));
	const showHit = $derived(hitPx > px * 1.001);

	const outlinePoints = $derived(draft.map(([x, y]) => toSvg(x, y).join(',')).join(' '));
	const contextPoints = $derived(outline && outline.length >= 3 ? outline.map(([x, y]) => toSvg(x, y).join(',')).join(' ') : null);

	// --- Pointer helpers ---
	export function pointerToRoom(event: PointerEvent | MouseEvent): Vertex {
		if (!svgEl) return [0, 0];
		// jsdom implements neither of these; the rect fallback below covers it.
		const ctm = typeof svgEl.getScreenCTM === 'function' ? svgEl.getScreenCTM() : null;
		if (ctm && typeof svgEl.createSVGPoint === 'function') {
			const pt = svgEl.createSVGPoint();
			pt.x = event.clientX;
			pt.y = event.clientY;
			const local = pt.matrixTransform(ctm.inverse());
			return fromSvg(local.x, local.y);
		}
		// Fallback (no CTM, e.g. jsdom): assume a square viewport with "meet" scaling
		const rect = svgEl.getBoundingClientRect();
		const scale = view.size / Math.max(Math.min(rect.width, rect.height), 1e-9);
		return fromSvg(view.x + (event.clientX - rect.left) * scale, -(view.y + viewH) + (event.clientY - rect.top) * scale);
	}

	/** Room point -> CSS pixel offset within the canvas wrap (for HTML overlays). */
	export function toScreen(x: number, y: number): [number, number] {
		if (!svgEl) return [0, 0];
		const rect = svgEl.getBoundingClientRect();
		const scale = Math.min(rect.width, rect.height) / Math.max(view.size, 1e-9);
		// The view's bottom-left is the canvas's bottom-left
		return [(x - view.x) * scale, rect.height - (y - view.y) * scale];
	}

	/** The room point under a client position, for a given view (bottom-left anchored, like the canvas). */
	function clientToRoom(v: View, cx: number, cy: number): Vertex {
		if (!svgEl) return [0, 0];
		const rect = svgEl.getBoundingClientRect();
		const upp = v.size / Math.max(Math.min(rect.width, rect.height), 1e-9);
		return [v.x + (cx - rect.left) * upp, v.y + (rect.top + rect.height - cy) * upp];
	}

	/** Room units per CSS pixel at the current zoom. */
	function unitsPerPixel(): number {
		if (!svgEl) return view.size / 560;
		const rect = svgEl.getBoundingClientRect();
		return view.size / Math.max(Math.min(rect.width, rect.height), 1e-9);
	}

	export function focus() {
		svgEl?.focus();
	}

	export function isSpaceHeld(): boolean {
		return spaceHeld;
	}

	// Grid snapping is light, like the angle snap: a coordinate within
	// GRID_TOLERANCE_PX of a snap line is pulled onto it, anything else stays
	// where the pointer is (rounded to the unit's display precision so the table
	// stays readable). Snap lines are every 1 m / 1 ft (100 cm, 1000 mm, 12 in),
	// or the finer grid when zoomed in.
	const GRID_TOLERANCE_PX = 12;
	const snapUnit = $derived(Math.min(gridStep, gridCellSize(units)));
	// Grid lines a coordinate just snapped to, shown as guidelines by the caller
	let pendingGuides: Guide[] = [];
	function clampCoord(v: number): number {
		return allowNegative ? v : Math.max(0, v);
	}
	function snapCoord(v: number, axis: 'x' | 'y', altKey: boolean): number {
		const free = roundToUnit(clampCoord(v), units);
		if (altKey) return free;
		const g = Math.round(v / snapUnit) * snapUnit;
		if ((!allowNegative && g < 0) || Math.abs(v - g) > snapPx * GRID_TOLERANCE_PX) return free;
		const snapped = Math.round(g * 1e6) / 1e6;
		pendingGuides.push({ axis, value: snapped });
		return snapped;
	}

	function snapPoint([x, y]: Vertex, altKey: boolean): Vertex {
		pendingGuides = [];
		return [snapCoord(x, 'x', altKey), snapCoord(y, 'y', altKey)];
	}

	/** Grid-snap a single value without clamping (hosts use it for their own layers). */
	export function snapValue(v: number, altKey: boolean): number {
		const g = Math.round(v / snapUnit) * snapUnit;
		return altKey || Math.abs(v - g) > snapPx * GRID_TOLERANCE_PX ? roundToUnit(v, units) : g;
	}

	/** With Shift, constrain the segment from `from` to a multiple of 45°. */
	function constrain(from: Vertex, to: Vertex): Vertex {
		const dx = to[0] - from[0];
		const dy = to[1] - from[1];
		const len = Math.hypot(dx, dy);
		if (len < 1e-9) return to;
		const angle = Math.atan2(dy, dx);
		const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
		return [from[0] + len * Math.cos(snapped), from[1] + len * Math.sin(snapped)];
	}

	const ANGLE_STEP = 45;
	/** Pointer angles this close to a right angle snap to it; the rest are freehand. */
	const RIGHT_ANGLE_TOLERANCE = 4;
	/** Below this screen length a segment is never angle-snapped: a few pixels of
	 *  hand wobble would otherwise swing a short wall through tens of degrees. */
	const MIN_ANGLE_SNAP_PX = 32;

	/** Direction of the wall the next segment is measured against. */
	function referenceDirection(): Vertex {
		const last = draft[draft.length - 1];
		const prev = draft[draft.length - 2];
		return prev ? [last[0] - prev[0], last[1] - prev[1]] : [1, 0];
	}

	/**
	 * Opinionated angle snapping for a segment from `from` towards `raw`, relative
	 * to `ref`: a slightly wobbly right angle (within RIGHT_ANGLE_TOLERANCE) is pulled
	 * straight; anything else is freehand. Shift forces the nearest 45° step; Alt frees.
	 */
	export function snapAngle(from: Vertex, raw: Vertex, ref: Vertex, event: PointerEvent | MouseEvent): { point: Vertex; snapped: boolean } {
		if (event.altKey) return { point: raw, snapped: false };
		if (event.shiftKey) return snapSegmentDirection(from, raw, ref, { stepDeg: ANGLE_STEP, toleranceDeg: 180, force: true });
		if (Math.hypot(raw[0] - from[0], raw[1] - from[1]) < snapPx * MIN_ANGLE_SNAP_PX) return { point: raw, snapped: false };
		return snapSegmentDirection(from, raw, ref, { stepDeg: 90, toleranceDeg: RIGHT_ANGLE_TOLERANCE, force: false });
	}

	// --- Guidelines: a point near an existing corner's x or y is pulled onto it,
	// and a faint line through that corner shows why. This is what lets a traced
	// outline close square without an extra corner to tidy up afterwards.
	interface Guide { axis: 'x' | 'y'; value: number }
	let guides = $state<Guide[]>([]);
	const GUIDE_TOLERANCE_PX = 8;

	/**
	 * Pull `p` onto any other corner's x and/or y that the RAW pointer position is
	 * within tolerance of (so a corner wins over a nearby grid line); `lock` keeps an
	 * axis-snapped coordinate fixed.
	 */
	function alignToCorners(p: Vertex, raw: Vertex, exclude: number[], lock: 'x' | 'y' | null, altKey: boolean): Vertex {
		guides = [...pendingGuides];
		if (altKey) return p;
		const tol = snapPx * GUIDE_TOLERANCE_PX;
		let [x, y] = p;
		let bestX: Vertex | null = null;
		let bestY: Vertex | null = null;
		draft.forEach((v, i) => {
			if (exclude.includes(i)) return;
			if (lock !== 'x' && Math.abs(v[0] - raw[0]) <= tol && (!bestX || Math.abs(v[0] - raw[0]) < Math.abs(bestX[0] - raw[0]))) bestX = v;
			if (lock !== 'y' && Math.abs(v[1] - raw[1]) <= tol && (!bestY || Math.abs(v[1] - raw[1]) < Math.abs(bestY[1] - raw[1]))) bestY = v;
		});
		// A corner alignment replaces a grid snap on the same axis
		const next: Guide[] = guides.filter((g) => !(bestX && g.axis === 'x') && !(bestY && g.axis === 'y'));
		if (bestX) { x = (bestX as Vertex)[0]; next.push({ axis: 'x', value: x }); }
		if (bestY) { y = (bestY as Vertex)[1]; next.push({ axis: 'y', value: y }); }
		guides = next;
		return [x, y];
	}

	function drawPointFor(event: PointerEvent | MouseEvent): Vertex {
		const raw = pointerToRoom(event);
		const last = draft[draft.length - 1];
		const exclude = [draft.length - 1];
		if (!last) {
			// The first corner snaps quietly: a guideline means nothing until there is
			// something to line up with.
			const p = snapPoint(raw, event.altKey);
			guides = [];
			return p;
		}
		const { point, snapped } = snapAngle(last, raw, referenceDirection(), event);
		if (!snapped) return alignToCorners(snapPoint(raw, event.altKey), raw, exclude, null, event.altKey);
		const dx = point[0] - last[0];
		const dy = point[1] - last[1];
		// Axis-aligned: grid-snap the moving coordinate only, keeping the angle exact
		pendingGuides = [];
		if (Math.abs(dy) < 1e-6) return alignToCorners([snapCoord(point[0], 'x', event.altKey), last[1]], point, exclude, 'y', event.altKey);
		if (Math.abs(dx) < 1e-6) return alignToCorners([last[0], snapCoord(point[1], 'y', event.altKey)], point, exclude, 'x', event.altKey);
		return alignToCorners([clampCoord(point[0]), clampCoord(point[1])], point, exclude, null, event.altKey);
	}

	function nearFirst(p: Vertex): boolean {
		if (draft.length < 3) return false;
		const [fx, fy] = draft[0];
		return Math.hypot(p[0] - fx, p[1] - fy) <= Math.max(handleR * 2, 12 * snapPx);
	}

	// --- Navigation. The Hand / Zoom mode (a user setting) decides what plain
	// scrolling and a drag on empty space do: Hand pans, Zoom zooms (a drag
	// draws a box to zoom to). Ctrl/Cmd+scroll and pinch always zoom; middle
	// button and Space + drag always pan. Double-click on empty space fits.
	const navMode = $derived<PlanNavMode>(navControls ? $userSettings.planNavMode : 'hand');
	function setNavMode(mode: PlanNavMode) {
		userSettings.update((s) => ({ ...s, planNavMode: mode }));
	}
	let pan = $state<{ startClient: [number, number]; startView: View } | null>(null);
	/** Zoom mode's box, from the press to the pointer (room units), with the press and pointer in client pixels. */
	let zoomBox = $state<{ a: Vertex; b: Vertex; startClient: [number, number]; endClient: [number, number] } | null>(null);
	/** Below this many screen pixels a zoom box is a click and does nothing. */
	const ZOOM_BOX_MIN_PX = 4;
	const pannable = $derived(tool === 'edit' && !drawing);
	const editing = $derived(tool === 'edit');
	// The host took the press as its own background drag (the Lamps box select, Move grid)
	let hostDragging = false;

	// Touch: every active finger, a two-finger pinch (zoom about the midpoint,
	// pan with it), and the last tap for double-tap-to-fit.
	const touches = new Map<number, [number, number]>();
	let pinch: { anchor: Vertex; dist0: number; size0: number } | null = null;
	/** The first finger's press reached the canvas (not an item that kept it). */
	let firstTouchOnCanvas = false;
	/** A second finger cancelled an edit: every touch event is ignored until all fingers lift. */
	let touchCancelled = false;
	/** The pointer that owns the current gesture: moves and releases from any other pointer are ignored. */
	let activePointer: { id: number; type: string } | null = null;
	let tapStart: { id: number; x: number; y: number; empty: boolean } | null = null;
	let lastTap: { t: number; x: number; y: number } | null = null;
	const DOUBLE_TAP_MS = 350;
	const TAP_SLOP_PX = 10;
	const DOUBLE_TAP_PX = 30;

	// Space+drag pans in every mode (trackpads have no middle button); a drag that
	// panned must not also count as a click that places a corner. Space is only
	// taken while the pointer is over this canvas or it has focus, so everywhere
	// else it still presses buttons and scrolls.
	let spaceHeld = $state(false);
	let justPanned = false;
	let pointerOver = false;

	function onWindowKeyDown(event: KeyboardEvent) {
		if (navControls && (event.key === '+' || event.key === '=' || event.key === '-') && !event.ctrlKey && !event.metaKey && !event.altKey) {
			if (!planShouldHandleKey(event)) return;
			event.preventDefault();
			zoomStep(event.key === '-' ? -1 : 1);
			return;
		}
		if (event.key !== ' ') return;
		const armed = pointerOver || (!!svgEl && document.activeElement === svgEl);
		if (!armed || !planShouldHandleKey(event)) return;
		spaceHeld = true;
		event.preventDefault();
	}
	function onWindowKeyUp(event: KeyboardEvent) {
		if (event.key === ' ') spaceHeld = false;
	}

	function touchMidAndDistance(): { mid: [number, number]; dist: number } {
		const [p, q] = [...touches.values()];
		return { mid: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], dist: Math.hypot(q[0] - p[0], q[1] - p[1]) };
	}

	/** Drop the gesture in flight without applying anything: the draft goes back, the host's drag is dropped. */
	function cancelGesture() {
		if (drag) draft = drag.restore;
		drag = null;
		pan = null;
		zoomBox = null;
		guides = [];
		onHostCancel?.();
		hostDragging = false;
	}

	/**
	 * Capture phase, so every pointer is seen even when an item keeps its press:
	 * it records which pointer owns the gesture, and tracks every finger.
	 */
	function onCanvasPointerDownCapture(event: PointerEvent) {
		const touch = event.pointerType === 'touch';
		// A primary touch starts a new sequence: anything left from an earlier one is stale
		if (touch && event.isPrimary) {
			touches.clear();
			pinch = null;
			touchCancelled = false;
			tapStart = null;
		}
		// The first pointer down owns the gesture; a primary press of the same kind replaces a stale owner
		if (!activePointer || (event.isPrimary && activePointer.type === event.pointerType)) {
			activePointer = { id: event.pointerId, type: event.pointerType };
		}
		// Another kind of pointer pressing mid-gesture (a finger during a mouse drag) is ignored
		if (activePointer.id !== event.pointerId && !(touch && activePointer.type === 'touch')) {
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		if (!touch) return;
		touches.set(event.pointerId, [event.clientX, event.clientY]);
		if (touches.size === 1) {
			firstTouchOnCanvas = false;
			tapStart = { id: event.pointerId, x: event.clientX, y: event.clientY, empty: event.target === svgEl };
			return;
		}
		// Further fingers never reach an item
		event.preventDefault();
		event.stopPropagation();
		tapStart = null;
		lastTap = null;
		if (touches.size !== 2 || touchCancelled || pinch) return;
		if (firstTouchOnCanvas && !drag && !hostDragging) {
			// A second finger pinches
			svgEl?.setPointerCapture?.(event.pointerId);
			pan = null;
			zoomBox = null;
			const { mid, dist } = touchMidAndDistance();
			pinch = { anchor: clientToRoom(view, mid[0], mid[1]), dist0: Math.max(dist, 1), size0: view.size };
		} else {
			// ... but while the first is editing something, it cancels that edit
			cancelGesture();
			touchCancelled = true;
		}
	}

	/**
	 * The canvas lost a pointer it had captured (after its release, or when the
	 * browser took it without one): forget the finger. Only the canvas's own
	 * capture counts; an item taking capture from a child element is not an end.
	 */
	function onLostPointerCapture(event: PointerEvent) {
		if (event.target !== svgEl || event.pointerType !== 'touch') return;
		if (activePointer?.id === event.pointerId) activePointer = null;
		if (!touches.has(event.pointerId)) return;
		touches.delete(event.pointerId);
		if (touches.size < 2) pinch = null;
		if (touches.size === 0) touchCancelled = false;
	}

	function onCanvasPointerDown(event: PointerEvent) {
		if (event.pointerType === 'touch') {
			// Fingers after the first never start a gesture of their own
			if (touches.size > 1) return;
			firstTouchOnCanvas = true;
		}
		justPanned = false;
		// Inside the draft with the edit tool: move it whole (hosts opt in for obstacles)
		if (draggableBody && event.button === 0 && !spaceHeld && editing && !drawing && draft.length >= 3) {
			const p = pointerToRoom(event);
			if (pointInPolygon(draft, p[0], p[1])) {
				event.preventDefault();
				(event.currentTarget as Element).setPointerCapture?.(event.pointerId);
				const start = draft.map((v) => [v[0], v[1]] as Vertex);
				drag = { kind: 'body', index: -1, startPointer: p, startDraft: start, restore: start };
				selectedIndex = -1;
				svgEl?.focus();
				return;
			}
		}
		if (event.button === 0 && !spaceHeld && pannable && onBackgroundDragStart?.(event)) {
			event.preventDefault();
			(event.currentTarget as Element).setPointerCapture?.(event.pointerId);
			hostDragging = true;
			return;
		}
		// Empty space with the edit tool follows the mode; middle button and Space + drag always pan
		const background = event.button === 0 && pannable && !spaceHeld;
		const panButton = event.button === 1 || (event.button === 0 && spaceHeld);
		if (!background && !panButton) return;
		event.preventDefault();
		(event.currentTarget as Element).setPointerCapture?.(event.pointerId);
		if (background && navMode === 'zoom') {
			const p = pointerToRoom(event);
			zoomBox = { a: p, b: p, startClient: [event.clientX, event.clientY], endClient: [event.clientX, event.clientY] };
		} else {
			pan = { startClient: [event.clientX, event.clientY], startView: { ...view } };
		}
		selectedIndex = -1;
		onBackgroundPointerDown?.();
	}

	$effect(() => {
		const el = svgEl;
		if (!el) return;
		const onWheel = (event: WheelEvent) => {
			event.preventDefault();
			// Pinch and Ctrl/Cmd+scroll always zoom about the cursor; plain scrolling
			// (two-finger trackpad, mouse wheel) pans in Hand mode and zooms in Zoom mode.
			if (navControls && !event.ctrlKey && !event.metaKey && navMode === 'hand') {
				const upp = unitsPerPixel();
				view = { x: view.x + event.deltaX * upp, y: view.y - event.deltaY * upp, size: view.size };
				userMoved = true;
				return;
			}
			if (event.deltaY === 0) return;
			const [ax, ay] = pointerToRoom(event);
			zoomAbout(ax, ay, Math.exp(event.deltaY * 0.0015));
		};
		el.addEventListener('wheel', onWheel, { passive: false });
		return () => el.removeEventListener('wheel', onWheel);
	});

	// --- Draw tool ---
	export function startDraw() {
		beforeDraw = draft.map((v) => [v[0], v[1]] as Vertex);
		draft = [];
		drawing = true;
		tool = 'draw';
		selectedIndex = -1;
		drag = null;
		svgEl?.focus();
	}

	export function finishDraw() {
		if (!drawing) return;
		if (draft.length >= 3) {
			draft = normalizeCCW(draft);
			drawing = false;
			tool = 'edit';
			cursor = null;
			guides = [];
			onDrawEnd?.(true);
		} else {
			cancelDraw();
		}
	}

	export function cancelDraw() {
		if (!drawing) return;
		draft = beforeDraw ?? [];
		beforeDraw = null;
		drawing = false;
		tool = 'edit';
		cursor = null;
		guides = [];
		onDrawEnd?.(false);
	}

	function onCanvasClick(event: MouseEvent) {
		if (spaceHeld || justPanned) return;
		if (tool === 'custom') {
			onCustomClick?.(event);
			return;
		}
		if (tool !== 'draw' || !drawing) return;
		const p = drawPointFor(event);
		if (nearFirst(p)) {
			finishDraw();
			return;
		}
		const last = draft[draft.length - 1];
		if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 1e-9) return; // ignore repeat clicks
		draft = [...draft, p];
	}

	function onCanvasDblClick(event: MouseEvent) {
		if (tool === 'draw' && drawing) {
			event.preventDefault();
			finishDraw();
			return;
		}
		// Only empty space fits: a double-click on a corner, wall or item keeps its own meaning
		if (pannable && event.target === svgEl) fitView();
	}

	// --- Edit tool: drag corners, slide edges, insert on midpoints ---
	function beginDrag(event: PointerEvent, kind: 'vertex' | 'edge', index: number, restore?: Vertex[]) {
		if (!editing) return;
		event.preventDefault();
		event.stopPropagation();
		(event.currentTarget as Element).setPointerCapture?.(event.pointerId);
		const start = draft.map((v) => [v[0], v[1]] as Vertex);
		drag = { kind, index, startPointer: pointerToRoom(event), startDraft: start, restore: restore ?? start };
		selectedIndex = kind === 'vertex' ? index : -1;
		svgEl?.focus();
	}

	function onMidpointPointerDown(event: PointerEvent, edgeIndex: number) {
		if (!editing) return;
		const [mx, my] = midpoints[edgeIndex];
		const before = draft.map((v) => [v[0], v[1]] as Vertex);
		const next = draft.map((v) => [v[0], v[1]] as Vertex);
		next.splice(edgeIndex + 1, 0, [mx, my]);
		draft = next;
		beginDrag(event, 'vertex', edgeIndex + 1, before);
	}

	function onPointerMove(event: PointerEvent) {
		if (event.pointerType === 'touch' && touches.has(event.pointerId)) touches.set(event.pointerId, [event.clientX, event.clientY]);
		if (touchCancelled) return;
		if (pinch) {
			if (touches.size < 2) return;
			const { mid, dist } = touchMidAndDistance();
			const size = clampViewSize((pinch.size0 * pinch.dist0) / Math.max(dist, 1));
			// The room point first under the midpoint stays under it: zoom and pan in one
			const v = clientToRoom({ x: 0, y: 0, size }, mid[0], mid[1]);
			view = { x: pinch.anchor[0] - v[0], y: pinch.anchor[1] - v[1], size };
			userMoved = true;
			justPanned = true;
			return;
		}
		// Only the pointer that started the gesture drives it
		if (activePointer && event.pointerId !== activePointer.id) return;
		if (tool === 'custom') onCustomMove?.(event);
		if (zoomBox) {
			justPanned = true;
			zoomBox = { ...zoomBox, b: pointerToRoom(event), endClient: [event.clientX, event.clientY] };
			return;
		}
		if (pan) {
			justPanned = true;
			const upp = unitsPerPixel();
			const dx = (event.clientX - pan.startClient[0]) * upp;
			const dy = (event.clientY - pan.startClient[1]) * upp;
			view = { x: pan.startView.x - dx, y: pan.startView.y + dy, size: pan.startView.size };
			userMoved = true;
			return;
		}
		if (tool === 'draw' && drawing) {
			cursor = drawPointFor(event);
			return;
		}
		if (onHostMove?.(event)) return;
		if (!drag) return;
		const p = pointerToRoom(event);
		if (drag.kind === 'body') {
			// Move every corner by the pointer delta, snapped so the first corner lands on the grid
			const dx = p[0] - drag.startPointer[0];
			const dy = p[1] - drag.startPointer[1];
			const first = drag.startDraft[0];
			const snapped = snapPoint([first[0] + dx, first[1] + dy], event.altKey);
			const ddx = snapped[0] - first[0];
			const ddy = snapped[1] - first[1];
			guides = [...pendingGuides];
			draft = drag.startDraft.map(([x, y]) => [Math.round((x + ddx) * 1e6) / 1e6, Math.round((y + ddy) * 1e6) / 1e6] as Vertex);
			return;
		}
		if (drag.kind === 'vertex') {
			const next = drag.startDraft.map((v) => [v[0], v[1]] as Vertex);
			const prev = next[(drag.index - 1 + next.length) % next.length];
			let target: Vertex = p;
			if (event.shiftKey && prev) target = constrain(prev, p);
			next[drag.index] = alignToCorners(snapPoint(target, event.altKey), target, [drag.index], null, event.altKey);
			draft = next;
		} else {
			// Slide the whole edge by the pointer delta (both endpoints move together)
			const dx = p[0] - drag.startPointer[0];
			const dy = p[1] - drag.startPointer[1];
			const next = drag.startDraft.map((v) => [v[0], v[1]] as Vertex);
			const i = drag.index;
			const j = (i + 1) % next.length;
			const a = snapPoint([next[i][0] + dx, next[i][1] + dy], event.altKey);
			const b = snapPoint([next[j][0] + dx, next[j][1] + dy], event.altKey);
			next[i] = a;
			next[j] = b;
			draft = next;
		}
	}

	function onTouchUp(event: PointerEvent) {
		const start = tapStart;
		const wasOnly = touches.size === 1;
		touches.delete(event.pointerId);
		if (!start || start.id !== event.pointerId) return;
		tapStart = null;
		const tap = wasOnly && start.empty && event.type === 'pointerup' && Math.hypot(event.clientX - start.x, event.clientY - start.y) <= TAP_SLOP_PX;
		if (!tap) {
			lastTap = null;
			return;
		}
		const now = Date.now();
		if (lastTap && now - lastTap.t <= DOUBLE_TAP_MS && Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) <= DOUBLE_TAP_PX) {
			lastTap = null;
			if (pannable) fitView();
			return;
		}
		lastTap = { t: now, x: event.clientX, y: event.clientY };
	}

	function onPointerUp(event: PointerEvent) {
		const pinching = pinch !== null;
		const cancelled = touchCancelled;
		if (event.pointerType === 'touch') {
			onTouchUp(event);
			if (touches.size === 0) touchCancelled = false;
		}
		const owner = !activePointer || event.pointerId === activePointer.id;
		// Once every finger is up, a touch owner is done
		if (owner || (activePointer?.type === 'touch' && touches.size === 0)) activePointer = null;
		if (cancelled) return;
		if (pinching) {
			// The pinch ends with its first finger; the one left does nothing until lifted
			if (touches.size < 2) pinch = null;
			return;
		}
		if (!owner) return;
		const box = zoomBox;
		zoomBox = null;
		if (box && event.type !== 'pointercancel') {
			const moved = Math.max(Math.abs(box.endClient[0] - box.startClient[0]), Math.abs(box.endClient[1] - box.startClient[1]));
			if (moved >= ZOOM_BOX_MIN_PX) zoomToBox(box.a, box.b);
		}
		const ended = drag;
		drag = null;
		if (ended && !sameDraft(ended.startDraft, draft)) onEdit?.();
		pan = null;
		hostDragging = false;
		guides = [];
		onHostPointerUp?.();
	}

	function onPointerLeave() {
		pointerOver = false;
		if (tool === 'draw') cursor = null;
		if (tool === 'custom') onCustomLeave?.();
		guides = [];
	}

	// --- Keyboard ---
	function onKeyDown(event: KeyboardEvent) {
		if (event.key === 'Enter' && tool === 'custom' && onCustomEnter?.()) {
			event.preventDefault();
			return;
		}
		if (event.key === 'Enter' && drawing) {
			event.preventDefault();
			finishDraw();
		} else if ((event.key === 'Delete' || event.key === 'Backspace') && editing && selectedIndex >= 0) {
			event.preventDefault();
			removeVertex(selectedIndex);
		} else if (event.key === 'Backspace' && drawing && draft.length > 0) {
			event.preventDefault();
			draft = draft.slice(0, -1);
		}
	}

	/** Translate the whole draft (arrow-key nudging by the host). */
	export function nudge(dx: number, dy: number) {
		if (draft.length === 0) return;
		draft = draft.map(([x, y]) => [Math.round((clampCoord(x + dx)) * 1e6) / 1e6, Math.round((clampCoord(y + dy)) * 1e6) / 1e6] as Vertex);
		onEdit?.();
	}

	/** Double-click on a corner: remove it (a polygon keeps at least three). */
	function onVertexDblClick(event: MouseEvent, index: number) {
		if (!dblClickCorners || !editing || drawing) return;
		event.preventDefault();
		event.stopPropagation();
		removeVertex(index);
	}

	/** Double-click on a wall: add a corner there, on the wall under the pointer. */
	function onEdgeDblClick(event: MouseEvent, edgeIndex: number) {
		if (!dblClickCorners || !editing || drawing || draft.length < 3) return;
		event.preventDefault();
		event.stopPropagation();
		const a = draft[edgeIndex];
		const b = draft[(edgeIndex + 1) % draft.length];
		const p = pointerToRoom(event);
		const dx = b[0] - a[0], dy = b[1] - a[1];
		const len2 = dx * dx + dy * dy;
		const t = len2 > 0 ? Math.min(0.95, Math.max(0.05, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0.5;
		const next = draft.map((v) => [v[0], v[1]] as Vertex);
		next.splice(edgeIndex + 1, 0, [roundToUnit(a[0] + dx * t, units), roundToUnit(a[1] + dy * t, units)]);
		draft = next;
		selectedIndex = edgeIndex + 1;
		onEdit?.();
	}

	export function removeVertex(index: number) {
		if (draft.length <= 3) return;
		draft = draft.filter((_, i) => i !== index);
		if (selectedIndex >= draft.length) selectedIndex = -1;
		onEdit?.();
	}

	/** True while a corner, wall or body drag is in progress. */
	export function isDragging(): boolean {
		return drag !== null;
	}

	/** While drawing, drop the last corner (Ctrl+Z). Returns true when a drawing consumed the key. */
	export function undoLastPoint(): boolean {
		if (!drawing) return false;
		if (draft.length > 0) draft = draft.slice(0, -1);
		return true;
	}

	function sameDraft(a: Vertex[], b: Vertex[]): boolean {
		return a.length === b.length && a.every(([x, y], i) => Math.abs(x - b[i][0]) < 1e-9 && Math.abs(y - b[i][1]) < 1e-9);
	}

	function fmt(v: number): string {
		return displayDimension(v, precision);
	}

	// Rubber-band segment while drawing
	const rubberBand = $derived.by(() => {
		if (!drawing || !cursor || draft.length === 0) return null;
		const last = draft[draft.length - 1];
		const [x1, y1] = toSvg(last[0], last[1]);
		const [x2, y2] = toSvg(cursor[0], cursor[1]);
		return { x1, y1, x2, y2, length: Math.hypot(cursor[0] - last[0], cursor[1] - last[1]), mid: toSvg((last[0] + cursor[0]) / 2, (last[1] + cursor[1]) / 2) };
	});

	// Angle at the last corner between the previous wall and the wall being
	// drawn (for the first wall: the angle from the +x axis), with an arc.
	const drawAngle = $derived.by(() => {
		if (!drawing || !cursor || draft.length === 0) return null;
		const last = draft[draft.length - 1];
		const prev = draft[draft.length - 2];
		const a: Vertex = prev ? [prev[0] - last[0], prev[1] - last[1]] : [1, 0];
		const b: Vertex = [cursor[0] - last[0], cursor[1] - last[1]];
		const la = Math.hypot(a[0], a[1]);
		const lb = Math.hypot(b[0], b[1]);
		if (la < 1e-9 || lb < 1e-9) return null;
		const degrees = angleBetweenDeg(a, b);
		const r = px * 22;
		const ua: Vertex = [a[0] / la, a[1] / la];
		const ub: Vertex = [b[0] / lb, b[1] / lb];
		// A pie wedge centred on the joint, sampled along the shorter arc
		const a0 = Math.atan2(ua[1], ua[0]);
		let sweepRad = Math.atan2(ub[1], ub[0]) - a0;
		if (sweepRad > Math.PI) sweepRad -= 2 * Math.PI;
		if (sweepRad < -Math.PI) sweepRad += 2 * Math.PI;
		const steps = 12;
		const arc: string[] = [];
		for (let i = 0; i <= steps; i++) {
			const ang = a0 + (sweepRad * i) / steps;
			const [x, y] = toSvg(last[0] + Math.cos(ang) * r, last[1] + Math.sin(ang) * r);
			arc.push(`${x} ${y}`);
		}
		const [cx, cy] = toSvg(last[0], last[1]);
		let bx = ua[0] + ub[0];
		let by = ua[1] + ub[1];
		const lbis = Math.hypot(bx, by);
		if (lbis < 1e-6) { bx = -ua[1]; by = ua[0]; } else { bx /= lbis; by /= lbis; }
		const [lx, ly] = toSvg(last[0] + bx * r * 1.8, last[1] + by * r * 1.8);
		const path = `M ${cx} ${cy} L ${arc.join(' L ')} Z`;
		return { degrees, path, label: [lx, ly] as [number, number], exact: Math.abs(degrees - Math.round(degrees / ANGLE_STEP) * ANGLE_STEP) < 1e-6 };
	});

	const ctx = $derived<CanvasContext>({ px, hitPx, handleR, toSvg, toScreen, gridLo, gridHi, spaceHeld });
</script>

<svelte:window onkeydown={onWindowKeyDown} onkeyup={onWindowKeyUp} />

<div class="canvas-wrap">
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<svg
	bind:this={svgEl}
	class="plan"
	class:invalid
	class:drawing
	class:custom={tool === 'custom'}
	class:pannable
	class:zoom-mode={navMode === 'zoom'}
	class:panning={pan !== null}
	data-tool-cursor={toolCursor ?? undefined}
	viewBox={viewBox}
	preserveAspectRatio="xMinYMax meet"
	role="application"
	aria-label={ariaLabel}
	tabindex="0"
	style="touch-action: none"
	onpointerdowncapture={onCanvasPointerDownCapture}
	onlostpointercapture={onLostPointerCapture}
	onpointerdown={onCanvasPointerDown}
	onclick={onCanvasClick}
	ondblclick={onCanvasDblClick}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerUp}
	onpointerenter={() => (pointerOver = true)}
	onpointerleave={onPointerLeave}
	onkeydown={onKeyDown}
>
	<!-- Plain grid (follows the viewport): minor lines, a stronger line every 5 steps -->
	{#each gridX as g}
		{@const [gx] = toSvg(g, 0)}
		<line x1={gx} y1={-gridHi.y} x2={gx} y2={-gridLo.y} class="grid-line" class:major={isMajor(g)} stroke-width={px} />
	{/each}
	{#each gridY as g}
		{@const [, gy] = toSvg(0, g)}
		<line x1={gridLo.x} y1={gy} x2={gridHi.x} y2={gy} class="grid-line" class:major={isMajor(g)} stroke-width={px} />
	{/each}

	{#if underlay}{@render underlay(ctx)}{/if}

	<!-- Context outline (the room, when editing something inside it) -->
	{#if contextPoints}
		<polygon points={contextPoints} class="context-outline" stroke-width={px * 1.5} />
	{/if}

	<!-- Guidelines through the corner the cursor is aligned with -->
	{#each guides as g}
		{#if g.axis === 'x'}
			<line x1={g.value} y1={-gridHi.y} x2={g.value} y2={-gridLo.y} class="guide" stroke-width={px} stroke-dasharray="{px * 4} {px * 3}" />
		{:else}
			<line x1={gridLo.x} y1={-g.value} x2={gridHi.x} y2={-g.value} class="guide" stroke-width={px} stroke-dasharray="{px * 4} {px * 3}" />
		{/if}
	{/each}

	<!-- Outline (closed polygon in edit mode, open polyline while drawing) -->
	{#if draft.length >= 3 && !drawing}
		<polygon points={outlinePoints} class="outline" class:selected-area={selectedDraft} stroke-width={px * 2} stroke-dasharray={selectedDraft ? `${px * 6} ${px * 4}` : undefined} />
	{:else if draft.length >= 2}
		<polyline points={outlinePoints} class="outline open" stroke-width={px * 2} />
	{/if}
	{#if rubberBand}
		<line x1={rubberBand.x1} y1={rubberBand.y1} x2={rubberBand.x2} y2={rubberBand.y2} class="rubber-band" stroke-width={px * 1.5} stroke-dasharray="{px * 3} {px * 2}" />
		<text x={rubberBand.mid[0]} y={rubberBand.mid[1] - px * 8} class="edge-label" font-size={px * 11} text-anchor="middle">{fmt(rubberBand.length)} {unit}</text>
	{/if}

	{#if overlay}{@render overlay(ctx)}{/if}

	{#if drawAngle}
		<path d={drawAngle.path} class="angle-arc" class:exact={drawAngle.exact} stroke-width={px} />
		<text x={drawAngle.label[0]} y={drawAngle.label[1] + px * 4} class="angle-label" class:exact={drawAngle.exact} font-size={px * 12} text-anchor="middle">{drawAngle.degrees.toFixed(drawAngle.exact ? 0 : 1)}°</text>
	{/if}

	<!-- Edge hit areas (drag to slide) and length labels -->
	{#if !drawing && draft.length >= 3}
		{#each draft as [vx, vy], i}
			{@const [x1, y1] = toSvg(vx, vy)}
			{@const next = draft[(i + 1) % draft.length]}
			{@const [x2, y2] = toSvg(next[0], next[1])}
			{@const [mx, my] = midpoints[i]}
			{@const [nx, ny] = inwardNormals[i]}
			{@const [lx, ly] = toSvg(mx + nx * px * 20, my + ny * px * 20)}
			<line x1={x1} y1={y1} x2={x2} y2={y2} class="edge-hit" stroke-width={hitPx * 10}
				role="button" tabindex="-1" aria-label="Wall {i + 1}"
				onpointerdown={(e) => beginDrag(e, 'edge', i)} ondblclick={(e) => onEdgeDblClick(e, i)} />
			<text x={lx} y={ly + px * 4} class="edge-label" font-size={px * 11} text-anchor="middle">{fmt(edgeLengths[i])}</text>
		{/each}
	{/if}

	<!-- Object footprints for context -->
	{#each objects as obj (obj.id)}
		{@const corners = objectFootprint(obj).map(([ox, oy]) => toSvg(ox, oy))}
		<polygon points={corners.map(([cx, cy]) => `${cx},${cy}`).join(' ')} class="object-footprint" class:disabled={obj.enabled === false} stroke-width={px} />
	{/each}

	<!-- Host shapes (obstacles): filled, labelled, clickable with the edit tool -->
	{#each shapes as shape (shape.id)}
		{@const pts = shape.vertices.map(([ox, oy]) => toSvg(ox, oy))}
		{@const [cx, cy] = shape.vertices.length ? toSvg(...polygonCentroidOf(shape.vertices)) : [0, 0]}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<polygon
			points={pts.map(([sx, sy]) => `${sx},${sy}`).join(' ')}
			class="shape"
			class:selected={shape.selected}
			class:highlighted={shape.highlighted && !shape.selected}
			class:dimmed={shape.dimmed}
			class:disabled={shape.disabled}
			class:clickable={!!onShapeClick && editing && !drawing}
			style:opacity={shape.opacity}
			style:pointer-events={shape.inert ? 'none' : undefined}
			stroke-width={px * (shape.selected || shape.highlighted ? 2 : 1.2)}
			role={onShapeClick ? 'button' : undefined}
			tabindex={onShapeClick ? -1 : undefined}
			aria-label={shape.name ?? shape.id}
			onpointerdown={(e) => { if (onShapeClick && editing && !drawing && !spaceHeld && e.button === 0) { e.stopPropagation(); e.preventDefault(); onShapeClick(shape.id, e); } }}
		/>
		{#if shape.name}
			<text x={cx} y={cy + px * 4} class="shape-label" class:dimmed={shape.dimmed} style:opacity={shape.opacity} font-size={px * 11} text-anchor="middle">{shape.name}</text>
		{/if}
	{/each}

	<!-- Lamps for context: a dot (colored by wavelength) with the lamp's name beside it -->
	{#each lamps as lamp (lamp.id)}
		{@const [lx, ly] = toSvg(lamp.x, lamp.y)}
		{@const sel = selectedLampIds.includes(lamp.id)}
		{@const lit = !sel && highlightedLampIds.includes(lamp.id)}
		<circle cx={lx} cy={ly} r={lampR} stroke-width={px * (sel || lit ? 3 : 1.5)} class="lamp" class:selected={sel} class:highlighted={lit} style:fill={lamp.enabled === false ? DISABLED_COLOR : lampColor(lamp)} style:opacity={lampOpacity[lamp.id]} />
		<text x={lx + lampR + px * 4} y={ly + px * 4} class="lamp-label" style:opacity={lampOpacity[lamp.id]} font-size={px * 11}>{lamp.name || lamp.id}</text>
	{/each}

	<!-- Midpoint handles: click to insert a corner -->
	{#if editing && !drag && draft.length >= 3}
		{#each midpoints as [mx, my], i}
			{@const [sx, sy] = toSvg(mx, my)}
			<g class="mid-handle" role="button" tabindex="-1" aria-label="Insert corner on wall {i + 1}"
				onpointerdown={(e) => onMidpointPointerDown(e, i)}>
				{#if showHit}<circle cx={sx} cy={sy} r={5 * hitPx} class="mid-hit" />{/if}
				<circle cx={sx} cy={sy} r={midR} stroke-width={px} />
				<line x1={sx - midR * 0.5} y1={sy} x2={sx + midR * 0.5} y2={sy} stroke-width={px * 1.2} />
				<line x1={sx} y1={sy - midR * 0.5} x2={sx} y2={sy + midR * 0.5} stroke-width={px * 1.2} />
			</g>
		{/each}
	{/if}

	<!-- Corner handles -->
	{#each draft as [vx, vy], i}
		{@const [sx, sy] = toSvg(vx, vy)}
		{#if showHit}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<circle cx={sx} cy={sy} r={6 * hitPx} class="vertex-hit" onpointerdown={(e) => beginDrag(e, 'vertex', i)} ondblclick={(e) => onVertexDblClick(e, i)} />
		{/if}
		<circle
			cx={sx} cy={sy} r={handleR}
			class="vertex"
			class:selected={selectedIndex === i}
			class:closable={drawing && i === 0 && draft.length >= 3}
			stroke-width={drawing && i === 0 && draft.length >= 3 ? px * 3 : px * 2}
			role="button"
			tabindex="-1"
			aria-label="Corner {i + 1}"
			onpointerdown={(e) => beginDrag(e, 'vertex', i)}
			ondblclick={(e) => onVertexDblClick(e, i)}
		/>
		<text x={sx + handleR * 1.6} y={sy - handleR * 1.2} class="vertex-label" font-size={px * 11}>{i + 1}</text>
	{/each}

	<!-- Cursor crosshair while drawing -->
	{#if drawing && cursor}
		{@const [cx, cy] = toSvg(cursor[0], cursor[1])}
		<circle {cx} {cy} r={handleR * 0.8} class="cursor-dot" stroke-width={px * 1.5} />
		<text x={cx + handleR * 1.6} y={cy + handleR * 2.6} class="cursor-label" font-size={px * 11}>{fmt(cursor[0])}, {fmt(cursor[1])}</text>
	{/if}

	<!-- Zoom mode's box -->
	{#if zoomBox}
		{@const [zx, zy] = toSvg(Math.min(zoomBox.a[0], zoomBox.b[0]), Math.max(zoomBox.a[1], zoomBox.b[1]))}
		<rect x={zx} y={zy} width={Math.abs(zoomBox.b[0] - zoomBox.a[0])} height={Math.abs(zoomBox.b[1] - zoomBox.a[1])} class="zoom-box" stroke-width={px * 1.5} stroke-dasharray="{px * 5} {px * 3}" />
	{/if}
</svg>
{#if navControls}
<div class="view-controls">
	{#if onUnitsChange}<UnitsSelect {units} onchange={onUnitsChange} />{/if}
	<div class="mv-seg" role="group" aria-label="View">
		<button type="button" class="mv-btn nav-mode" data-mode="hand" aria-pressed={navMode === 'hand'} aria-label="Pan" title="Pan (H)" onclick={() => setNavMode('hand')}>
			<Glyph name="hand" />
		</button>
		<button type="button" class="mv-btn nav-mode" data-mode="zoom" aria-pressed={navMode === 'zoom'} aria-label="Zoom" title="Zoom (Z)" onclick={() => setNavMode('zoom')}>
			<Glyph name="zoom" />
		</button>
	</div>
	<div class="mv-seg" role="group" aria-label="Zoom steps">
		<button type="button" class="mv-btn nav-out" aria-label="Zoom out" title="Zoom out (−)" onclick={() => zoomStep(-1)}>−</button>
		<button type="button" class="mv-btn nav-in" aria-label="Zoom in" title="Zoom in (+)" onclick={() => zoomStep(1)}>+</button>
	</div>
	<div class="mv-seg" role="group" aria-label="Fit">
		<button type="button" class="mv-btn nav-fit" aria-label="Fit" title="Fit (F)" onclick={() => fitView()}>
			<Glyph name="fit" />
		</button>
	</div>
</div>
{/if}
{#if hud}{@render hud(ctx)}{/if}
</div>

<style>
	.canvas-wrap {
		position: relative;
		flex: 1 1 auto;
		min-height: 0;
		display: flex;
	}
	/* Units and the view tools: bottom right, on the main view's 8 px inset */
	.view-controls {
		position: absolute;
		right: 8px;
		bottom: 8px;
		z-index: 4;
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.zoom-box {
		fill: color-mix(in srgb, var(--color-highlight) 8%, transparent);
		stroke: var(--color-highlight);
		pointer-events: none;
	}
	.angle-arc {
		fill: var(--color-text-muted);
		fill-opacity: 0.12;
		stroke: var(--color-text-muted);
		stroke-opacity: 0.4;
		pointer-events: none;
	}
	.angle-arc.exact {
		fill: var(--color-accent);
		fill-opacity: 0.14;
		stroke: var(--color-accent);
		stroke-opacity: 0.5;
	}
	.angle-label {
		fill: var(--color-text-muted);
		opacity: 0.8;
		font-family: var(--font-mono, monospace);
		font-weight: 600;
		pointer-events: none;
	}
	.angle-label.exact {
		fill: var(--color-accent);
	}
	.plan {
		/* Plan geometry is drawn in the neutral scene color, not the violet app
		   accent, so it never reads as a 222 nm lamp. Host layers inherit it. */
		--color-accent: var(--color-scene-wire);
		flex: 1 1 auto;
		width: 100%;
		height: 100%;
		min-height: 0;
		background: var(--color-bg-secondary, rgba(128, 128, 128, 0.08));
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm, 4px);
		user-select: none;
		outline: none;
	}
	.plan.drawing,
	.plan.custom {
		cursor: crosshair;
	}
	.plan.pannable {
		cursor: grab;
	}
	.plan.pannable.zoom-mode {
		cursor: zoom-in;
	}
	.plan.panning {
		cursor: grabbing;
	}
	/* The host's armed tool's cursor, over Pan and Zoom; move and crosshair show over items too */
	.plan[data-tool-cursor='move']:not(.panning),
	.plan[data-tool-cursor='move']:not(.panning) :global(*) {
		cursor: move !important;
	}
	.plan[data-tool-cursor='crosshair']:not(.panning),
	.plan[data-tool-cursor='crosshair']:not(.panning) :global(*) {
		cursor: crosshair !important;
	}
	.plan[data-tool-cursor='default']:not(.panning) {
		cursor: default;
	}
	.plan:focus-visible {
		border-color: var(--color-primary);
	}
	.grid-line {
		stroke: var(--color-text-muted);
		opacity: 0.14;
		/* Presses on the grid are presses on empty space */
		pointer-events: none;
	}
	.grid-line.major {
		opacity: 0.3;
	}
	.vertex-label,
	.edge-label,
	.cursor-label {
		fill: var(--color-text-muted);
		font-family: var(--font-mono, monospace);
		pointer-events: none;
	}
	.edge-label {
		fill: var(--color-text);
	}
	.context-outline {
		fill: var(--color-text-muted);
		fill-opacity: 0.05;
		stroke: var(--color-text-muted);
		stroke-opacity: 0.6;
		stroke-linejoin: round;
		pointer-events: none;
	}
	.outline {
		fill: var(--color-accent);
		fill-opacity: 0.12;
		stroke: var(--color-accent);
		stroke-linejoin: round;
		/* The tint must not swallow clicks meant for a host layer beneath it */
		pointer-events: none;
	}
	.outline.open {
		fill: none;
	}
	.outline.selected-area {
		fill: var(--color-scene-selected);
		fill-opacity: 0.18;
		stroke: var(--color-scene-selected);
	}
	.plan.invalid .outline {
		fill: var(--color-error, #e5484d);
		stroke: var(--color-error, #e5484d);
	}
	.rubber-band {
		stroke: var(--color-accent);
	}
	.edge-hit {
		stroke: transparent;
		cursor: move;
	}
	.edge-hit:hover {
		stroke: var(--color-accent);
		stroke-opacity: 0.25;
	}
	.lamp {
		stroke: var(--color-bg, #fff);
		pointer-events: none;
	}
	.lamp.selected {
		stroke: var(--color-scene-selected);
	}
	.lamp.highlighted {
		stroke: color-mix(in srgb, var(--color-scene-selected) 55%, transparent);
	}
	.lamp-label {
		fill: var(--color-text, #1f2328);
		paint-order: stroke;
		stroke: var(--color-bg, #fff);
		stroke-width: 0.25em;
		stroke-linejoin: round;
		pointer-events: none;
		user-select: none;
		font-weight: 500;
	}
	.object-footprint {
		fill: color-mix(in srgb, var(--color-text-muted, #6b7280) 25%, transparent);
		stroke: var(--color-text-muted, #6b7280);
		pointer-events: none;
	}
	.object-footprint.disabled {
		fill: none;
		stroke-dasharray: 4 3;
	}
	.shape {
		fill: color-mix(in srgb, var(--color-text, #1f2328) 22%, transparent);
		stroke: var(--color-text-muted, #6b7280);
		stroke-linejoin: round;
		pointer-events: none;
	}
	.shape.clickable {
		pointer-events: auto;
		cursor: pointer;
	}
	.shape.clickable:hover {
		fill: color-mix(in srgb, var(--color-accent) 25%, transparent);
	}
	.shape.selected {
		fill: color-mix(in srgb, var(--color-scene-selected) 30%, transparent);
		stroke: var(--color-scene-selected);
	}
	.shape.highlighted {
		fill: color-mix(in srgb, var(--color-scene-selected) 14%, transparent);
		stroke: color-mix(in srgb, var(--color-scene-selected) 60%, transparent);
		stroke-dasharray: none;
	}
	.shape.dimmed {
		fill: color-mix(in srgb, var(--color-text-muted, #6b7280) 14%, transparent);
		stroke-dasharray: 4 3;
	}
	.shape.disabled {
		fill: none;
		stroke-dasharray: 4 3;
	}
	.shape-label {
		fill: var(--color-text, #1f2328);
		pointer-events: none;
		user-select: none;
		font-weight: 600;
	}
	.shape-label.dimmed {
		fill: var(--color-text-muted, #6b7280);
		font-weight: 500;
	}
	.vertex {
		fill: var(--color-bg, #fff);
		stroke: var(--color-accent);
		cursor: grab;
	}
	.vertex.selected {
		fill: var(--color-scene-selected);
	}
	.vertex.closable {
		fill: var(--color-accent);
		fill-opacity: 0.4;
		cursor: pointer;
	}
	.plan.invalid .vertex {
		stroke: var(--color-error, #e5484d);
	}
	.cursor-dot {
		fill: none;
		stroke: var(--color-accent);
		pointer-events: none;
	}
	.mid-handle {
		cursor: copy;
	}
	.mid-handle circle {
		fill: var(--color-bg, #fff);
		stroke: var(--color-accent);
		opacity: 0.75;
	}
	.mid-handle circle.mid-hit {
		fill: transparent;
		stroke: none;
		opacity: 1;
	}
	.vertex-hit {
		fill: transparent;
		stroke: none;
		cursor: grab;
	}
	.mid-handle line {
		stroke: var(--color-accent);
	}
	.mid-handle:hover circle {
		opacity: 1;
	}
	.guide {
		stroke: var(--color-highlight);
		stroke-opacity: 0.55;
		pointer-events: none;
	}
</style>
