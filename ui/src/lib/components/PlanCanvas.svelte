<script module lang="ts">
	import type { Vertex } from '$lib/utils/roomGeometry';
	export type CanvasTool = 'edit' | 'draw' | 'custom';

	/** A host-owned polygon drawn as a filled shape (an obstacle on the plan). */
	export interface PlanShape {
		id: string;
		vertices: Vertex[];
		name?: string;
		selected?: boolean;
		dimmed?: boolean;
		/** Excluded from the calculation: dashed, no fill. */
		disabled?: boolean;
	}
	/** What the host's snippets get: enough to draw in room coordinates. */
	export interface CanvasContext {
		/** Room units per screen pixel (sizes that must stay constant on screen). */
		px: number;
		handleR: number;
		toSvg: (x: number, y: number) => [number, number];
		toScreen: (x: number, y: number) => [number, number];
		gridLo: { x: number; y: number };
		gridHi: { x: number; y: number };
		spaceHeld: boolean;
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { LampInstance, SceneObject } from '$lib/types/project';
	import { objectFootprint, polygonCentroid as polygonCentroidOf } from '$lib/utils/objectGeometry';
	import { displayDimension } from '$lib/utils/formatting';
	import { lampColor } from '$lib/utils/wavelengthColor';
	import { DISABLED_COLOR } from '$lib/utils/sceneColors';
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
	// `custom` tool (the floor-plan modal's Set scale, for example).

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
		objects?: SceneObject[];
		/** Host shapes (obstacle footprints) with a name label; click to select when provided. */
		shapes?: PlanShape[];
		onShapeClick?: (id: string) => void;
		/** A pointer-down inside the draft moves it whole (instead of panning). */
		draggableBody?: boolean;
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
		/** A pan started on the empty canvas (hosts deselect their own layers). */
		onBackgroundPointerDown?: () => void;
		/** Fired when the drawing finishes or is cancelled, after the draft is settled. */
		onDrawEnd?: (committed: boolean) => void;
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
		objects = [],
		shapes = [],
		onShapeClick,
		draggableBody = false,
		invalid = false,
		ariaLabel = 'Plan canvas',
		underlay,
		overlay,
		hud,
		onCustomClick,
		onCustomMove,
		onCustomLeave,
		onCustomEnter,
		onHostMove,
		onHostPointerUp,
		onBackgroundPointerDown,
		onDrawEnd,
	}: Props = $props();

	let beforeDraw: Vertex[] | null = null;
	let cursor = $state<Vertex | null>(null);
	let drag = $state<{ kind: 'vertex' | 'edge' | 'body'; index: number; startPointer: Vertex; startDraft: Vertex[] } | null>(null);
	let svgEl = $state<SVGSVGElement | undefined>(undefined);

	const unit = $derived(unitAbbrev(units));
	const edgeLengths = $derived(draft.length >= 2 ? polygonEdgeLengths(draft) : []);
	const midpoints = $derived(draft.length >= 2 ? edgeMidpoints(draft) : []);
	// Wall-length labels sit just inside each wall so they never collide with the axis ticks
	const inwardNormals = $derived(draft.length >= 3 ? edgeInwardNormals(draft) : []);

	// --- View: a square window onto the plan, in room units. (x, y) is the
	// bottom-left corner and `size` the side; zoom and pan move it, Fit resets it.
	interface View { x: number; y: number; size: number }
	const FIT_MARGIN = 1.14;
	function fittedView(points: Vertex[]): View {
		const pts = points.length >= 2 ? points : [[0, 0], [1, 1]] as Vertex[];
		const bb = polygonBoundingBox(pts);
		const w = bb.xMax - bb.xMin;
		const h = bb.yMax - bb.yMin;
		// Anchor the window at the outline's bottom-left with a small margin for the
		// rulers: coordinates can't go negative, so spare space belongs top and right.
		const pad = Math.max(w, h, 1) * (FIT_MARGIN - 1) / 2;
		return { x: bb.xMin - pad, y: bb.yMin - pad, size: Math.max(w, h, 1) + 2 * pad };
	}
	/** Draft corners (or the fallback) plus the host's extra points, so Fit shows everything. */
	function defaultFitPoints(): Vertex[] {
		const base = draft.length >= 2 ? draft : fallbackFit;
		return [...base.map((v) => [v[0], v[1]] as Vertex), ...extraFitPoints.map((v) => [v[0], v[1]] as Vertex)];
	}
	// svelte-ignore state_referenced_locally
	let view = $state<View>(fittedView(defaultFitPoints()));
	export function fitView(points: Vertex[] = defaultFitPoints()) {
		view = fittedView(points);
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
	const gridStep = $derived.by(() => {
		const raw = view.size / 8;
		const mag = Math.pow(10, Math.floor(Math.log10(raw)));
		const norm = raw / mag;
		const nice = norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10;
		return nice * mag;
	});
	function gridRange(from: number, to: number): number[] {
		const out: number[] = [];
		const start = Math.floor(from / gridStep) * gridStep;
		for (let v = start; v <= to + 1e-9; v += gridStep) out.push(Math.round(v * 1e6) / 1e6);
		return out;
	}
	// The SVG is letterboxed ("meet") and aligned bottom-left, so a wide or tall
	// canvas shows space beyond the square viewBox to the right or above; draw the
	// grid generously past the view so the axes never stop partway across.
	const gridX = $derived(gridRange(view.x - view.size, view.x + view.size * 4));
	const gridY = $derived(gridRange(view.y - view.size, view.y + view.size * 4));
	const gridLo = $derived({ x: view.x - view.size, y: view.y - view.size });
	const gridHi = $derived({ x: view.x + view.size * 4, y: view.y + view.size * 4 });
	const viewBox = $derived(`${view.x} ${-(view.y + view.size)} ${view.size} ${view.size}`);

	// Room (x, y) -> SVG (sx, sy): the SVG y axis is the room y axis flipped
	function toSvg(x: number, y: number): [number, number] {
		return [x, -y];
	}
	function fromSvg(sx: number, sy: number): Vertex {
		return [sx, -sy];
	}

	// Sizes in room units so they stay constant on screen (~1px at 560px)
	const px = $derived(view.size / 560);
	const handleR = $derived(px * 6);
	const midR = $derived(px * 5);

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
		return fromSvg(view.x + (event.clientX - rect.left) * scale, -(view.y + view.size) + (event.clientY - rect.top) * scale);
	}

	/** Room point -> CSS pixel offset within the canvas wrap (for HTML overlays). */
	export function toScreen(x: number, y: number): [number, number] {
		if (!svgEl) return [0, 0];
		const rect = svgEl.getBoundingClientRect();
		const scale = Math.min(rect.width, rect.height) / Math.max(view.size, 1e-9);
		// xMinYMax: the square view hugs the bottom-left of the canvas
		return [(x - view.x) * scale, rect.height - (y - view.y) * scale];
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
		if ((!allowNegative && g < 0) || Math.abs(v - g) > px * GRID_TOLERANCE_PX) return free;
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
		return altKey || Math.abs(v - g) > px * GRID_TOLERANCE_PX ? roundToUnit(v, units) : g;
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
		if (Math.hypot(raw[0] - from[0], raw[1] - from[1]) < px * MIN_ANGLE_SNAP_PX) return { point: raw, snapped: false };
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
		const tol = px * GUIDE_TOLERANCE_PX;
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
		return Math.hypot(p[0] - fx, p[1] - fy) <= handleR * 2;
	}

	// --- Pan (middle button, or Space + left button in any mode) and zoom ---
	let pan = $state<{ startClient: [number, number]; startView: View } | null>(null);
	const pannable = $derived(tool === 'edit' && !drawing);
	const editing = $derived(tool === 'edit');

	// Space+drag pans in every mode (trackpads have no middle button); a drag that
	// panned must not also count as a click that places a corner.
	let spaceHeld = $state(false);
	let justPanned = false;

	function onWindowKeyDown(event: KeyboardEvent) {
		if (event.key === ' ' && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
			spaceHeld = true;
			event.preventDefault();
		}
	}
	function onWindowKeyUp(event: KeyboardEvent) {
		if (event.key === ' ') spaceHeld = false;
	}

	function onCanvasPointerDown(event: PointerEvent) {
		justPanned = false;
		// Inside the draft with the edit tool: move it whole (hosts opt in for obstacles)
		if (draggableBody && event.button === 0 && !spaceHeld && editing && !drawing && draft.length >= 3) {
			const p = pointerToRoom(event);
			if (pointInPolygon(draft, p[0], p[1])) {
				event.preventDefault();
				(event.currentTarget as Element).setPointerCapture?.(event.pointerId);
				drag = { kind: 'body', index: -1, startPointer: p, startDraft: draft.map((v) => [v[0], v[1]] as Vertex) };
				selectedIndex = -1;
				svgEl?.focus();
				return;
			}
		}
		const panButton = event.button === 1 || (event.button === 0 && (pannable || spaceHeld));
		if (!panButton) return;
		event.preventDefault();
		(event.currentTarget as Element).setPointerCapture?.(event.pointerId);
		pan = { startClient: [event.clientX, event.clientY], startView: { ...view } };
		selectedIndex = -1;
		onBackgroundPointerDown?.();
	}

	$effect(() => {
		const el = svgEl;
		if (!el) return;
		const onWheel = (event: WheelEvent) => {
			event.preventDefault();
			// Plain scrolling (two-finger trackpad, mouse wheel) pans; pinch and
			// Ctrl/Cmd+scroll zoom about the cursor, as in most design tools.
			if (!event.ctrlKey && !event.metaKey) {
				const upp = unitsPerPixel();
				view = { x: view.x + event.deltaX * upp, y: view.y - event.deltaY * upp, size: view.size };
				return;
			}
			const factor = Math.exp(event.deltaY * 0.0015);
			const [ax, ay] = pointerToRoom(event);
			const newSize = clampViewSize(view.size * factor);
			const k = newSize / view.size;
			// Zoom about the cursor: the room point under it stays put
			view = { x: ax - (ax - view.x) * k, y: ay - (ay - view.y) * k, size: newSize };
		};
		el.addEventListener('wheel', onWheel, { passive: false });
		return () => el.removeEventListener('wheel', onWheel);
	});

	/** Zoom about the view centre (for the +/- buttons). */
	export function zoomBy(factor: number) {
		const cx = view.x + view.size / 2;
		const cy = view.y + view.size / 2;
		const newSize = clampViewSize(view.size * factor);
		view = { x: cx - newSize / 2, y: cy - newSize / 2, size: newSize };
	}

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
		if (tool !== 'draw' || !drawing) return;
		event.preventDefault();
		finishDraw();
	}

	// --- Edit tool: drag corners, slide edges, insert on midpoints ---
	function beginDrag(event: PointerEvent, kind: 'vertex' | 'edge', index: number) {
		if (!editing) return;
		event.preventDefault();
		event.stopPropagation();
		(event.currentTarget as Element).setPointerCapture?.(event.pointerId);
		drag = { kind, index, startPointer: pointerToRoom(event), startDraft: draft.map((v) => [v[0], v[1]] as Vertex) };
		selectedIndex = kind === 'vertex' ? index : -1;
		svgEl?.focus();
	}

	function onMidpointPointerDown(event: PointerEvent, edgeIndex: number) {
		if (!editing) return;
		const [mx, my] = midpoints[edgeIndex];
		const next = draft.map((v) => [v[0], v[1]] as Vertex);
		next.splice(edgeIndex + 1, 0, [mx, my]);
		draft = next;
		beginDrag(event, 'vertex', edgeIndex + 1);
	}

	function onPointerMove(event: PointerEvent) {
		if (tool === 'custom') onCustomMove?.(event);
		if (pan) {
			justPanned = true;
			const upp = unitsPerPixel();
			const dx = (event.clientX - pan.startClient[0]) * upp;
			const dy = (event.clientY - pan.startClient[1]) * upp;
			view = { x: pan.startView.x - dx, y: pan.startView.y + dy, size: pan.startView.size };
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

	function onPointerUp() {
		drag = null;
		pan = null;
		guides = [];
		onHostPointerUp?.();
	}

	function onPointerLeave() {
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
	}

	export function removeVertex(index: number) {
		if (draft.length <= 3) return;
		draft = draft.filter((_, i) => i !== index);
		if (selectedIndex >= draft.length) selectedIndex = -1;
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

	const ctx = $derived<CanvasContext>({ px, handleR, toSvg, toScreen, gridLo, gridHi, spaceHeld });
</script>

<svelte:window onkeydown={onWindowKeyDown} onkeyup={onWindowKeyUp} />

<div class="canvas-wrap">
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<svg
	bind:this={svgEl}
	class="plan"
	class:invalid
	class:drawing
	class:custom={tool === 'custom'}
	class:pannable
	class:panning={pan !== null}
	viewBox={viewBox}
	preserveAspectRatio="xMinYMax meet"
	role="application"
	aria-label={ariaLabel}
	tabindex="0"
	onpointerdown={onCanvasPointerDown}
	onclick={onCanvasClick}
	ondblclick={onCanvasDblClick}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerUp}
	onpointerleave={onPointerLeave}
	onkeydown={onKeyDown}
>
	<!-- Out-of-bounds shading (coordinates must be >= 0) -->
	{#if !allowNegative}
		{#if gridLo.x < 0}
			<rect x={gridLo.x} y={-gridHi.y} width={-gridLo.x} height={gridHi.y - gridLo.y} class="outside" />
		{/if}
		{#if gridLo.y < 0}
			<rect x={gridLo.x} y={-0} width={gridHi.x - gridLo.x} height={-gridLo.y} class="outside" />
		{/if}
	{/if}

	<!-- Grid (follows the viewport) with ruler labels along the bottom and left edges -->
	{#each gridX as g}
		{@const [gx] = toSvg(g, 0)}
		<line x1={gx} y1={-gridHi.y} x2={gx} y2={-gridLo.y} class="grid-line" class:axis={g === 0} stroke-width={px * (g === 0 ? 1.4 : 0.7)} />
		<text x={gx} y={-view.y - px * 5} class="tick" font-size={px * 11} text-anchor="middle">{fmt(g)}</text>
	{/each}
	{#each gridY as g}
		{@const [, gy] = toSvg(0, g)}
		<line x1={gridLo.x} y1={gy} x2={gridHi.x} y2={gy} class="grid-line" class:axis={g === 0} stroke-width={px * (g === 0 ? 1.4 : 0.7)} />
		{#if g !== 0}
			<text x={view.x + px * 5} y={gy - px * 3} class="tick" font-size={px * 11} text-anchor="start">{fmt(g)}</text>
		{/if}
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
		<polygon points={outlinePoints} class="outline" stroke-width={px * 2} />
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
			<line x1={x1} y1={y1} x2={x2} y2={y2} class="edge-hit" stroke-width={px * 10}
				role="button" tabindex="-1" aria-label="Wall {i + 1}"
				onpointerdown={(e) => beginDrag(e, 'edge', i)} />
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
			class:dimmed={shape.dimmed}
			class:disabled={shape.disabled}
			class:clickable={!!onShapeClick && editing && !drawing}
			stroke-width={px * (shape.selected ? 2 : 1.2)}
			role={onShapeClick ? 'button' : undefined}
			tabindex={onShapeClick ? -1 : undefined}
			aria-label={shape.name ?? shape.id}
			onpointerdown={(e) => { if (onShapeClick && editing && !drawing && !spaceHeld && e.button === 0) { e.stopPropagation(); e.preventDefault(); onShapeClick(shape.id); } }}
		/>
		{#if shape.name}
			<text x={cx} y={cy + px * 4} class="shape-label" class:dimmed={shape.dimmed} font-size={px * 10} text-anchor="middle">{shape.name}</text>
		{/if}
	{/each}

	<!-- Lamps for context: a dot (colored by wavelength) with the lamp's name beside it -->
	{#each lamps as lamp (lamp.id)}
		{@const [lx, ly] = toSvg(lamp.x, lamp.y)}
		<circle cx={lx} cy={ly} r={px * 4} stroke-width={px * 1.2} class="lamp" style:fill={lamp.enabled === false ? DISABLED_COLOR : lampColor(lamp)} />
		<text x={lx + px * 7} y={ly + px * 3.5} class="lamp-label" font-size={px * 10}>{lamp.name || lamp.id}</text>
	{/each}

	<!-- Midpoint handles: click to insert a corner -->
	{#if editing && !drag && draft.length >= 3}
		{#each midpoints as [mx, my], i}
			{@const [sx, sy] = toSvg(mx, my)}
			<g class="mid-handle" role="button" tabindex="-1" aria-label="Insert corner on wall {i + 1}"
				onpointerdown={(e) => onMidpointPointerDown(e, i)}>
				<circle cx={sx} cy={sy} r={midR} stroke-width={px} />
				<line x1={sx - midR * 0.5} y1={sy} x2={sx + midR * 0.5} y2={sy} stroke-width={px * 1.2} />
				<line x1={sx} y1={sy - midR * 0.5} x2={sx} y2={sy + midR * 0.5} stroke-width={px * 1.2} />
			</g>
		{/each}
	{/if}

	<!-- Corner handles -->
	{#each draft as [vx, vy], i}
		{@const [sx, sy] = toSvg(vx, vy)}
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
		/>
		<text x={sx + handleR * 1.6} y={sy - handleR * 1.2} class="vertex-label" font-size={px * 11}>{i + 1}</text>
	{/each}

	<!-- Cursor crosshair while drawing -->
	{#if drawing && cursor}
		{@const [cx, cy] = toSvg(cursor[0], cursor[1])}
		<circle {cx} {cy} r={handleR * 0.8} class="cursor-dot" stroke-width={px * 1.5} />
		<text x={cx + handleR * 1.6} y={cy + handleR * 2.6} class="cursor-label" font-size={px * 10}>{fmt(cursor[0])}, {fmt(cursor[1])}</text>
	{/if}
</svg>
<div class="view-controls" role="group" aria-label="View">
	<button type="button" onclick={() => zoomBy(1 / 1.3)} title="Zoom in (or pinch / Ctrl+scroll)" aria-label="Zoom in">+</button>
	<button type="button" onclick={() => zoomBy(1.3)} title="Zoom out (or pinch / Ctrl+scroll)" aria-label="Zoom out">−</button>
	<button type="button" onclick={() => fitView()} title="Fit the outline in the view (scroll to pan, pinch or Ctrl+scroll to zoom, Space+drag to pan while drawing)" aria-label="Fit">Fit</button>
</div>
{#if hud}{@render hud(ctx)}{/if}
</div>

<style>
	.canvas-wrap {
		position: relative;
		flex: 1 1 auto;
		min-height: 0;
		display: flex;
	}
	.view-controls {
		position: absolute;
		right: 8px;
		top: 8px;
		display: flex;
		gap: 2px;
	}
	.view-controls button {
		min-width: 1.9rem;
		height: 1.6rem;
		padding: 0 6px;
		font-size: var(--font-size-xs);
		line-height: 1;
		background: transparent;
		border: 1px solid transparent;
		color: var(--color-text-muted);
	}
	.view-controls button:hover {
		border-color: var(--color-border);
		color: var(--color-text);
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
		flex: 1 1 auto;
		width: 100%;
		height: 100%;
		min-height: 0;
		background: var(--color-bg-secondary, rgba(128, 128, 128, 0.08));
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm, 4px);
		touch-action: none;
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
	.plan.panning {
		cursor: grabbing;
	}
	.outside {
		fill: var(--color-text-muted);
		fill-opacity: 0.08;
	}
	.grid-line.axis {
		stroke: var(--color-text-muted);
		opacity: 0.9;
	}
	.plan:focus-visible {
		border-color: var(--color-accent);
	}
	.grid-line {
		stroke: var(--color-border);
		opacity: 0.7;
	}
	.tick,
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
		fill: color-mix(in srgb, var(--color-accent) 30%, transparent);
		stroke: var(--color-accent);
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
		fill: var(--color-accent);
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
