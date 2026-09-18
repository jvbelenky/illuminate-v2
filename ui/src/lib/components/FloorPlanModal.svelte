<script module lang="ts">
	import type { Vertex as OutlineVertex } from '$lib/utils/roomGeometry';
	import type { FloorPlanPlacement } from '$lib/types/project';
	import type { FloorPlanImage } from '$lib/stores/floorplanImage';
	export interface FloorPlanApplyResult {
		vertices: OutlineVertex[];
		floorplan: FloorPlanPlacement | null;
		image: FloorPlanImage | null;
	}
</script>

<script lang="ts">
	import Modal from './Modal.svelte';
	import ValidatedNumberInput from './ValidatedNumberInput.svelte';
	import type { LampInstance } from '$lib/types/project';
	import { displayDimension } from '$lib/utils/formatting';
	import { unitAbbrev, METERS_PER_FOOT, FEET_PER_METER } from '$lib/utils/unitConversion';
	import {
		type Vertex,
		type OutlinePreset,
		OUTLINE_PRESETS,
		presetOutline,
		polygonArea,
		polygonBoundingBox,
		polygonEdgeLengths,
		edgeMidpoints,
		edgeInwardNormals,
		validatePolygon,
		normalizeCCW,
		snapTo,
		angleBetweenDeg,
		snapSegmentDirection,
	} from '$lib/utils/roomGeometry';
	import { initialPlacement, imageRect, rescaleAboutPoint, scaleFromMeasurement, pixelToRoom } from '$lib/utils/floorplanImage';
	import { decodeFloorPlanFile, isSupportedFloorPlanFile, FloorPlanDecodeError, type DecodedFloorPlan } from '$lib/utils/floorplanDecode';

	interface Props {
		/** Outline to start from (CCW, display units). */
		vertices: Vertex[];
		units: 'meters' | 'feet';
		precision: number;
		/** Existing lamps, drawn as dots for context. */
		lamps?: LampInstance[];
		/** Current reference-image placement (meters), if any. */
		floorplan?: FloorPlanPlacement | null;
		/** Current reference image; null with a placement means it could not be restored. */
		image?: FloorPlanImage | null;
		/** Called with the validated outline, placement and image when the user applies. */
		onApply: (result: FloorPlanApplyResult) => void;
		onClose: () => void;
		/** Switch the project's units; the draft is converted locally to match. */
		onUnitsChange?: (units: 'meters' | 'feet') => void;
	}

	let { vertices, units, precision, lamps = [], floorplan = null, image = null, onApply, onClose, onUnitsChange }: Props = $props();

	// The modal is transactional: the outline is edited locally and only handed
	// back on Apply, so intermediate states may be invalid and Cancel discards.
	let draft = $state<Vertex[]>(vertices.map((v) => [v[0], v[1]] as Vertex));
	type Tool = 'edit' | 'draw' | 'scale' | 'move';
	let tool = $state<Tool>('edit');
	let drawing = $state(false);
	let beforeDraw: Vertex[] | null = null;
	let cursor = $state<Vertex | null>(null);
	let selectedIndex = $state(-1);
	let drag = $state<{ kind: 'vertex' | 'edge'; index: number; startPointer: Vertex; startDraft: Vertex[] } | null>(null);
	let svgEl = $state<SVGSVGElement | undefined>(undefined);

	// Reference image draft (transactional like the outline). Placement is in
	// meters; `k` converts to display units at render.
	// svelte-ignore state_referenced_locally
	let draftPlacement = $state<FloorPlanPlacement | null>(floorplan ? { ...floorplan } : null);
	// svelte-ignore state_referenced_locally
	let draftImage = $state<FloorPlanImage | null>(image ? { ...image } : null);
	let imageFileName = $state<string | null>(null);
	let imageError = $state<string | null>(null);
	let decoding = $state(false);
	let pdfFile: File | null = null;
	let pdfPageCount = $state(0);
	let pdfPage = $state(1);
	let fileInput = $state<HTMLInputElement | undefined>(undefined);
	const k = $derived(units === 'feet' ? FEET_PER_METER : 1);
	const imageMissing = $derived(draftPlacement !== null && draftImage === null);
	const planImage = $derived(draftPlacement && draftImage ? { ...imageRect(draftPlacement, k), href: draftImage.src, opacity: draftPlacement.opacity } : null);

	const unit = $derived(unitAbbrev(units));
	// Snap step: 10 cm in meters, 3 inches in feet. Alt disables snapping.
	const snapStep = $derived(units === 'feet' ? 0.25 : 0.1);

	const validationMessage = $derived(drawing ? null : validatePolygon(draft));
	const isValid = $derived(!drawing && validationMessage === null);
	const area = $derived(draft.length >= 3 ? polygonArea(draft) : 0);
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
		const size = Math.max(w, h, 1) * FIT_MARGIN;
		return { x: bb.xMin - (size - w) / 2, y: bb.yMin - (size - h) / 2, size };
	}
	let view = $state<View>(fittedView(vertices));
	function fitView(points: Vertex[] = viewPointsWithImage()) {
		view = fittedView(points);
	}
	/** Grow the view (never shrink) so a point placed off-screen stays visible. */
	function ensureVisible([x, y]: Vertex) {
		const m = view.size * 0.04;
		const inside = x >= view.x + m && x <= view.x + view.size - m && y >= view.y + m && y <= view.y + view.size - m;
		if (inside) return;
		view = fittedView([[view.x, view.y], [view.x + view.size, view.y + view.size], [x, y]]);
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
	// The SVG is letterboxed ("meet"), so content beyond the square viewBox is
	// still visible; draw the grid half a view wider on every side to fill it.
	const gridX = $derived(gridRange(view.x - view.size * 0.5, view.x + view.size * 1.5));
	const gridY = $derived(gridRange(view.y - view.size * 0.5, view.y + view.size * 1.5));
	const gridLo = $derived({ x: view.x - view.size * 0.5, y: view.y - view.size * 0.5 });
	const gridHi = $derived({ x: view.x + view.size * 1.5, y: view.y + view.size * 1.5 });
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

	// --- Pointer helpers ---
	function pointerToRoom(event: PointerEvent | MouseEvent): Vertex {
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

	/** Room units per CSS pixel at the current zoom. */
	function unitsPerPixel(): number {
		if (!svgEl) return view.size / 560;
		const rect = svgEl.getBoundingClientRect();
		return view.size / Math.max(Math.min(rect.width, rect.height), 1e-9);
	}

	function snapPoint([x, y]: Vertex, altKey: boolean): Vertex {
		const step = altKey || !snapEnabled ? 0 : snapStep;
		return [snapTo(Math.max(0, x), step), snapTo(Math.max(0, y), step)];
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
	const ANGLE_TOLERANCE = 5;

	/** Direction of the wall the next segment is measured against. */
	function referenceDirection(): Vertex {
		const last = draft[draft.length - 1];
		const prev = draft[draft.length - 2];
		return prev ? [last[0] - prev[0], last[1] - prev[1]] : [1, 0];
	}

	function drawPointFor(event: PointerEvent | MouseEvent): Vertex {
		const raw = pointerToRoom(event);
		const last = draft[draft.length - 1];
		if (!last) return snapPoint(raw, event.altKey);
		if (event.altKey) return [Math.max(0, snapTo(raw[0], 0)), Math.max(0, snapTo(raw[1], 0))];

		// Snap the new wall's angle to 45° steps relative to the previous wall
		// (or to the axes for the first wall); Shift forces the nearest step.
		const { point, snapped } = snapSegmentDirection(last, raw, referenceDirection(), {
			stepDeg: ANGLE_STEP,
			toleranceDeg: event.shiftKey ? 180 : ANGLE_TOLERANCE,
			force: event.shiftKey,
		});
		const dx = point[0] - last[0];
		const dy = point[1] - last[1];
		// Axis-aligned: grid-snap the moving coordinate only, keeping the angle exact
		if (snapped && Math.abs(dy) < 1e-6) return [Math.max(0, snapTo(point[0], snapEnabled ? snapStep : 0)), last[1]];
		if (snapped && Math.abs(dx) < 1e-6) return [last[0], Math.max(0, snapTo(point[1], snapEnabled ? snapStep : 0))];
		if (snapped) return [Math.max(0, point[0]), Math.max(0, point[1])];
		return snapPoint(raw, false);
	}

	function nearFirst(p: Vertex): boolean {
		if (draft.length < 3) return false;
		const [fx, fy] = draft[0];
		return Math.hypot(p[0] - fx, p[1] - fy) <= handleR * 2;
	}

	// --- Pan (drag empty canvas; middle button always) and wheel zoom ---
	let pan = $state<{ startClient: [number, number]; startView: View } | null>(null);
	const pannable = $derived(tool === 'edit' && !drawing);

	function onCanvasPointerDown(event: PointerEvent) {
		const panButton = event.button === 1 || (event.button === 0 && pannable);
		if (!panButton) return;
		event.preventDefault();
		(event.currentTarget as Element).setPointerCapture?.(event.pointerId);
		pan = { startClient: [event.clientX, event.clientY], startView: { ...view } };
		selectedIndex = -1;
	}

	$effect(() => {
		const el = svgEl;
		if (!el) return;
		const onWheel = (event: WheelEvent) => {
			event.preventDefault();
			const factor = Math.exp(event.deltaY * 0.0015);
			const [ax, ay] = pointerToRoom(event);
			const newSize = Math.min(Math.max(view.size * factor, 0.5), 5000);
			const k = newSize / view.size;
			// Zoom about the cursor: the room point under it stays put
			view = { x: ax - (ax - view.x) * k, y: ay - (ay - view.y) * k, size: newSize };
		};
		el.addEventListener('wheel', onWheel, { passive: false });
		return () => el.removeEventListener('wheel', onWheel);
	});

	/** Zoom about the view centre (for the +/- buttons). */
	function zoomBy(factor: number) {
		const cx = view.x + view.size / 2;
		const cy = view.y + view.size / 2;
		const newSize = Math.min(Math.max(view.size * factor, 0.5), 5000);
		view = { x: cx - newSize / 2, y: cy - newSize / 2, size: newSize };
	}

	// --- Draw tool ---
	function startDraw() {
		beforeDraw = draft.map((v) => [v[0], v[1]] as Vertex);
		draft = [];
		drawing = true;
		tool = 'draw';
		selectedIndex = -1;
		drag = null;
		svgEl?.focus();
	}

	function finishDraw() {
		if (!drawing) return;
		if (draft.length >= 3) {
			draft = normalizeCCW(draft);
			drawing = false;
			tool = 'edit';
			cursor = null;
		} else {
			cancelDraw();
		}
	}

	function cancelDraw() {
		if (!drawing) return;
		draft = beforeDraw ?? [];
		beforeDraw = null;
		drawing = false;
		tool = 'edit';
		cursor = null;
	}

	function onCanvasClick(event: MouseEvent) {
		if (tool === 'scale') {
			onScaleClick(event);
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
		ensureVisible(p);
	}

	function onCanvasDblClick(event: MouseEvent) {
		if (tool !== 'draw' || !drawing) return;
		event.preventDefault();
		finishDraw();
	}

	// --- Edit tool: drag corners, slide edges, insert on midpoints ---
	function beginDrag(event: PointerEvent, kind: 'vertex' | 'edge', index: number) {
		if (tool !== 'edit') return;
		event.preventDefault();
		event.stopPropagation();
		(event.currentTarget as Element).setPointerCapture?.(event.pointerId);
		drag = { kind, index, startPointer: pointerToRoom(event), startDraft: draft.map((v) => [v[0], v[1]] as Vertex) };
		selectedIndex = kind === 'vertex' ? index : -1;
		svgEl?.focus();
	}

	function onMidpointPointerDown(event: PointerEvent, edgeIndex: number) {
		if (tool !== 'edit') return;
		const [mx, my] = midpoints[edgeIndex];
		const next = draft.map((v) => [v[0], v[1]] as Vertex);
		next.splice(edgeIndex + 1, 0, [mx, my]);
		draft = next;
		beginDrag(event, 'vertex', edgeIndex + 1);
	}

	function onPointerMove(event: PointerEvent) {
		if (tool === 'scale') cursorFree = pointerToRoom(event);
		if (pan) {
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
		if (imageDrag && draftPlacement) {
			const p = pointerToRoom(event);
			const dx = (p[0] - imageDrag.startPointer[0]) / k;
			const dy = (p[1] - imageDrag.startPointer[1]) / k;
			const stepM = event.altKey || !snapEnabled ? 0 : snapStep / k;
			draftPlacement = {
				...draftPlacement,
				offsetX: snapTo(imageDrag.startPlacement.offsetX + dx, stepM),
				offsetY: snapTo(imageDrag.startPlacement.offsetY + dy, stepM),
			};
			return;
		}
		if (!drag) return;
		const p = pointerToRoom(event);
		if (drag.kind === 'vertex') {
			const next = drag.startDraft.map((v) => [v[0], v[1]] as Vertex);
			const prev = next[(drag.index - 1 + next.length) % next.length];
			let target: Vertex = p;
			if (event.shiftKey && prev) target = constrain(prev, p);
			next[drag.index] = snapPoint(target, event.altKey);
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
		imageDrag = null;
	}

	function onPointerLeave() {
		if (tool === 'draw') cursor = null;
		if (tool === 'scale') cursorFree = null;
	}

	// --- Keyboard ---
	function onKeyDown(event: KeyboardEvent) {
		if (event.key === 'Enter' && tool === 'scale' && measure?.b) {
			event.preventDefault();
			confirmMeasure();
			return;
		}
		if (event.key === 'Enter' && drawing) {
			event.preventDefault();
			finishDraw();
		} else if ((event.key === 'Delete' || event.key === 'Backspace') && tool === 'edit' && selectedIndex >= 0) {
			event.preventDefault();
			removeVertex(selectedIndex);
		} else if (event.key === 'Backspace' && drawing && draft.length > 0) {
			event.preventDefault();
			draft = draft.slice(0, -1);
		}
	}

	// Escape: cancel an in-progress drawing before letting the modal close
	function onEscapeKey(): boolean | void {
		if (tool === 'scale' && measure) {
			cancelMeasure();
			return true;
		}
		if (tool === 'scale' || tool === 'move') {
			tool = 'edit';
			measure = null;
			return true;
		}
		if (drawing) {
			cancelDraw();
			return true;
		}
	}

	// --- Table ---
	function setVertexCoord(index: number, axis: 0 | 1, value: number) {
		const next = draft.map((v) => [v[0], v[1]] as Vertex);
		next[index][axis] = Math.max(0, value);
		draft = next;
	}

	function removeVertex(index: number) {
		if (draft.length <= 3) return;
		draft = draft.filter((_, i) => i !== index);
		if (selectedIndex >= draft.length) selectedIndex = -1;
	}

	function addVertex() {
		if (draft.length < 2) return;
		// Split the longest wall at its midpoint
		let longest = 0;
		for (let i = 1; i < edgeLengths.length; i++) if (edgeLengths[i] > edgeLengths[longest]) longest = i;
		const [mx, my] = midpoints[longest];
		const next = draft.map((v) => [v[0], v[1]] as Vertex);
		next.splice(longest + 1, 0, [mx, my]);
		draft = next;
		selectedIndex = longest + 1;
	}

	function applyPreset(kind: OutlinePreset) {
		const bb = polygonBoundingBox(draft.length >= 3 ? draft : vertices);
		const w = Math.max(bb.xMax, snapStep * 4);
		const h = Math.max(bb.yMax, snapStep * 4);
		if (drawing) cancelDraw();
		draft = presetOutline(kind, w, h, snapStep);
		tool = 'edit';
		selectedIndex = -1;
		fitView(draft);
	}

	// --- Reference image ---
	function chooseFile() {
		fileInput?.click();
	}

	async function onFileChosen(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		if (!isSupportedFloorPlanFile(file)) {
			imageError = 'Unsupported file type. Use PNG, JPEG, WebP, GIF, SVG or PDF.';
			return;
		}
		// Drawing and the image tools are mutually exclusive modes (as in
		// `applyPreset`/`handleUnitsChange`); an upload leaves draw mode.
		if (drawing) cancelDraw();
		pdfFile = file.type === 'application/pdf' || /\.pdf$/i.test(file.name) ? file : null;
		pdfPage = 1;
		await installDecoded(file, 1);
	}

	async function installDecoded(file: File, page: number) {
		decoding = true;
		imageError = null;
		try {
			const decoded: DecodedFloorPlan = await decodeFloorPlanFile(file, { page });
			pdfPageCount = decoded.pageCount ?? 0;
			const id = crypto.randomUUID();
			draftImage = { id, mime: decoded.mime, src: decoded.src };
			imageFileName = file.name;
			// Re-upload of the same-size image keeps a restored placement's calibration
			if (draftPlacement && draftPlacement.widthPx === decoded.widthPx && draftPlacement.heightPx === decoded.heightPx) {
				draftPlacement = { ...draftPlacement, imageId: id };
			} else {
				const bb = polygonBoundingBox(draft.length >= 3 ? draft : vertices);
				draftPlacement = initialPlacement(id, decoded.widthPx, decoded.heightPx, bb.xMax / k, bb.yMax / k);
				fitView(viewPointsWithImage());
				startSetScale();
			}
		} catch (e) {
			imageError = e instanceof FloorPlanDecodeError ? e.message : 'Could not read this file.';
		} finally {
			decoding = false;
		}
	}

	async function changePdfPage(page: number) {
		if (!pdfFile) return;
		pdfPage = page;
		await installDecoded(pdfFile, page);
	}

	function removeImage() {
		draftImage = null;
		draftPlacement = null;
		imageFileName = null;
		imageError = null;
		pdfFile = null;
		pdfPageCount = 0;
		if (tool === 'scale' || tool === 'move') tool = 'edit';
		measure = null;
	}

	function setOpacity(value: number) {
		if (draftPlacement) draftPlacement = { ...draftPlacement, opacity: Math.min(1, Math.max(0.1, value)) };
	}

	function setOffset(axis: 'offsetX' | 'offsetY', displayValue: number) {
		if (draftPlacement) draftPlacement = { ...draftPlacement, [axis]: displayValue / k };
	}

	/** Outline corners plus the image's corners, so Fit shows both. */
	function viewPointsWithImage(): Vertex[] {
		const pts: Vertex[] = (draft.length >= 2 ? draft : vertices).map((v) => [v[0], v[1]] as Vertex);
		if (draftPlacement) {
			const r = imageRect(draftPlacement, k);
			pts.push([r.x, r.y], [r.x + r.width, r.y + r.height]);
		}
		return pts;
	}

	// --- Set scale: click two points a known distance apart, type the distance.
	let measure = $state<{ a: Vertex; b: Vertex | null } | null>(null);
	let measuredDistance = $state<number | null>(null);
	let snapEnabled = $state(true);

	function startSetScale() {
		if (!draftPlacement) return;
		if (drawing) cancelDraw();
		tool = 'scale';
		measure = null;
		measuredDistance = null;
		selectedIndex = -1;
		drag = null;
		svgEl?.focus();
	}

	function skipSetScale() {
		measure = null;
		measuredDistance = null;
		tool = draftPlacement ? 'move' : 'edit';
	}

	function onScaleClick(event: MouseEvent) {
		if (tool !== 'scale' || !draftPlacement) return;
		const p = pointerToRoom(event); // no snapping: the user is pointing at pixels
		if (!measure) {
			measure = { a: p, b: null };
		} else if (!measure.b) {
			if (Math.hypot(p[0] - measure.a[0], p[1] - measure.a[1]) < 1e-9) return;
			measure = { a: measure.a, b: p };
		}
	}

	const measuredPixels = $derived.by(() => {
		if (!measure?.b || !draftPlacement) return 0;
		return Math.hypot(measure.b[0] - measure.a[0], measure.b[1] - measure.a[1]) / k / draftPlacement.scale;
	});

	function confirmMeasure() {
		if (!measure?.b || !draftPlacement || measuredDistance === null) return;
		const a: [number, number] = [measure.a[0] / k, measure.a[1] / k];
		const b: [number, number] = [measure.b[0] / k, measure.b[1] / k];
		const newScale = scaleFromMeasurement(draftPlacement, a, b, measuredDistance / k);
		if (newScale === null) return;
		const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
		draftPlacement = rescaleAboutPoint(draftPlacement, mid, newScale);
		measure = null;
		measuredDistance = null;
		tool = 'move';
		fitView();
	}

	function cancelMeasure() {
		measure = null;
		measuredDistance = null;
	}

	// Focus the distance field as soon as the popover appears, so the user can type
	// the measurement straight after the second click.
	$effect(() => {
		if (measure?.b) document.getElementById('measured-distance')?.focus();
	});

	let cursorFree = $state<Vertex | null>(null);
	const measureLine = $derived.by(() => {
		if (!measure) return null;
		const [x1, y1] = toSvg(measure.a[0], measure.a[1]);
		const end = measure.b ?? (tool === 'scale' && cursorFree ? cursorFree : null);
		if (!end) return { x1, y1, x2: x1, y2: y1, done: false };
		const [x2, y2] = toSvg(end[0], end[1]);
		return { x1, y1, x2, y2, done: measure.b !== null };
	});

	// --- Move plan: drag the image; offset snaps to the grid unless Alt.
	let imageDrag = $state<{ startPointer: Vertex; startPlacement: FloorPlanPlacement } | null>(null);

	function startMove() {
		if (!draftPlacement) return;
		if (drawing) cancelDraw();
		tool = 'move';
		measure = null;
		measuredDistance = null;
		selectedIndex = -1;
		drag = null;
	}

	function onImagePointerDown(event: PointerEvent) {
		if (tool !== 'move' || !draftPlacement || event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		(event.currentTarget as Element).setPointerCapture?.(event.pointerId);
		imageDrag = { startPointer: pointerToRoom(event), startPlacement: { ...draftPlacement } };
	}

	function handleUnitsChange(event: Event) {
		const next = (event.target as HTMLSelectElement).value as 'meters' | 'feet';
		if (next === units || !onUnitsChange) return;
		const factor = next === 'feet' ? FEET_PER_METER : METERS_PER_FOOT;
		if (drawing) cancelDraw();
		// `measure` is in display units, so it cannot survive a unit switch; the
		// placement is in meters and needs no conversion.
		cancelMeasure();
		if (tool === 'scale' || tool === 'move') tool = draftPlacement ? 'move' : 'edit';
		// Round converted coordinates to 0.01 (a hair under the snap step) so the table stays readable
		draft = draft.map(([x, y]) => [snapTo(x * factor, 0.01), snapTo(y * factor, 0.01)] as Vertex);
		onUnitsChange(next);
		fitView(draft);
	}

	function apply() {
		if (!isValid) return;
		onApply({
			vertices: normalizeCCW(draft),
			// A placement whose image could not be restored is kept, so the saved
			// calibration survives until the user re-uploads (or Removes) it.
			floorplan: draftPlacement,
			image: draftImage && draftPlacement ? draftImage : null,
		});
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
		const r = px * 26;
		const ua: Vertex = [a[0] / la, a[1] / la];
		const ub: Vertex = [b[0] / lb, b[1] / lb];
		const [sx, sy] = toSvg(last[0] + ua[0] * r, last[1] + ua[1] * r);
		const [ex, ey] = toSvg(last[0] + ub[0] * r, last[1] + ub[1] * r);
		// CCW in room coordinates is clockwise on screen (y is flipped)
		const cross = ua[0] * ub[1] - ua[1] * ub[0];
		const sweep = cross > 0 ? 1 : 0;
		let bx = ua[0] + ub[0];
		let by = ua[1] + ub[1];
		const lbis = Math.hypot(bx, by);
		if (lbis < 1e-6) { bx = -ua[1]; by = ua[0]; } else { bx /= lbis; by /= lbis; }
		const [lx, ly] = toSvg(last[0] + bx * r * 1.7, last[1] + by * r * 1.7);
		const path = `M ${sx} ${sy} A ${r} ${r} 0 0 ${sweep} ${ex} ${ey}`;
		return { degrees, path, label: [lx, ly] as [number, number], exact: Math.abs(degrees - Math.round(degrees / ANGLE_STEP) * ANGLE_STEP) < 1e-6 };
	});
</script>

<Modal title="Floor Plan" {onClose} {onEscapeKey} maxWidth="min(1280px, 96vw)" maxHeight="calc(100vh - 24px)" titleFontSize="1rem">
	{#snippet body()}
		<div class="floor-plan-modal">
			<div class="canvas-column">
				<div class="toolbar">
					{#each OUTLINE_PRESETS as preset}
						<button type="button" class="tool preset" onclick={() => applyPreset(preset.id)} title="Start from a {preset.label.toLowerCase()} the size of the current room">{preset.label}</button>
					{/each}
					<span class="toolbar-sep"></span>
					{#if drawing}
						<button type="button" class="tool active" disabled={draft.length < 3} onclick={finishDraw} title="Close the outline (Enter)">
							Finish outline
						</button>
						<button type="button" class="tool" onclick={cancelDraw} title="Discard the drawing and keep the previous outline (Escape)">
							Cancel drawing
						</button>
					{:else}
						<button type="button" class="tool" onclick={startDraw} title="Replace the outline by clicking out a new one (walls snap to 45° steps; Shift forces, Alt frees; Enter closes, Escape cancels)">
							Draw outline
						</button>
					{/if}
					<span class="toolbar-sep"></span>
					<button type="button" class="tool" onclick={chooseFile} disabled={decoding} title="Upload a floor plan image (PNG, JPEG, WebP, GIF, SVG or PDF) to trace over">
						{decoding ? 'Reading…' : 'Upload plan…'}
					</button>
					<input bind:this={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,application/pdf,.png,.jpg,.jpeg,.webp,.gif,.svg,.pdf" onchange={onFileChosen} hidden />
					{#if draftPlacement && draftImage}
						<button type="button" class="tool" class:active={tool === 'scale'} onclick={startSetScale} title="Click two points on the plan a known distance apart, then type that distance">Set scale</button>
						<button type="button" class="tool" class:active={tool === 'move'} onclick={startMove} title="Drag the plan into position (Alt frees it from the grid)">Move plan</button>
						{#if tool === 'scale'}
							<button type="button" class="tool" onclick={skipSetScale} title="Keep the current scale">Skip</button>
						{/if}
					{/if}
					<button type="button" class="tool" class:active={snapEnabled} aria-pressed={snapEnabled} onclick={() => (snapEnabled = !snapEnabled)} title="Snap corners and the plan to the grid (Alt inverts while dragging)">Snap</button>
					<select class="units-select" value={units} onchange={handleUnitsChange} title="Units" aria-label="Units">
						<option value="meters">m</option>
						<option value="feet">ft</option>
					</select>
				</div>

				<div class="canvas-wrap">
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<svg
					bind:this={svgEl}
					class="plan"
					class:invalid={!drawing && validationMessage !== null && draft.length >= 3}
					class:drawing
					class:scaling={tool === 'scale'}
					class:pannable
					class:panning={pan !== null}
					viewBox={viewBox}
					preserveAspectRatio="xMidYMid meet"
					role="application"
					aria-label="Floor plan canvas"
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
					{#if gridLo.x < 0}
						<rect x={gridLo.x} y={-gridHi.y} width={-gridLo.x} height={gridHi.y - gridLo.y} class="outside" />
					{/if}
					{#if gridLo.y < 0}
						<rect x={gridLo.x} y={-0} width={gridHi.x - gridLo.x} height={-gridLo.y} class="outside" />
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

					<!-- Reference image (bottom-left anchored; SVG y is flipped) -->
					{#if planImage}
						<image
							class="plan-image"
							class:movable={tool === 'move'}
							href={planImage.href}
							x={planImage.x}
							y={-(planImage.y + planImage.height)}
							width={planImage.width}
							height={planImage.height}
							opacity={planImage.opacity}
							preserveAspectRatio="none"
							role="img"
							aria-label="Floor plan reference image"
							onpointerdown={onImagePointerDown}
						/>
					{/if}

					<!-- Outline (closed polygon in edit mode, open polyline while drawing) -->
					{#if draft.length >= 3 && !drawing}
						<polygon points={outlinePoints} class="outline" stroke-width={px * 2} />
					{:else if draft.length >= 2}
						<polyline points={outlinePoints} class="outline open" stroke-width={px * 2} />
					{/if}
					{#if rubberBand}
						<line x1={rubberBand.x1} y1={rubberBand.y1} x2={rubberBand.x2} y2={rubberBand.y2} class="rubber-band" stroke-width={px * 1.5} />
						<text x={rubberBand.mid[0]} y={rubberBand.mid[1] - px * 8} class="edge-label" font-size={px * 11} text-anchor="middle">{fmt(rubberBand.length)} {unit}</text>
					{/if}
					{#if measureLine}
						<line x1={measureLine.x1} y1={measureLine.y1} x2={measureLine.x2} y2={measureLine.y2} class="measure-line" stroke-width={px * 2} />
						<circle cx={measureLine.x1} cy={measureLine.y1} r={handleR * 0.9} class="measure-dot" stroke-width={px * 2} />
						{#if measureLine.done}
							<circle cx={measureLine.x2} cy={measureLine.y2} r={handleR * 0.9} class="measure-dot" stroke-width={px * 2} />
						{/if}
					{/if}
					{#if drawAngle}
						<path d={drawAngle.path} class="angle-arc" class:exact={drawAngle.exact} stroke-width={px * 1.5} />
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

					<!-- Lamps for context -->
					{#each lamps as lamp (lamp.id)}
						{@const [lx, ly] = toSvg(lamp.x, lamp.y)}
						<circle cx={lx} cy={ly} r={px * 4} class="lamp" />
					{/each}

					<!-- Midpoint handles: click to insert a corner -->
					{#if tool === 'edit' && !drag && draft.length >= 3}
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
					<button type="button" onclick={() => zoomBy(1 / 1.3)} title="Zoom in (or scroll)" aria-label="Zoom in">+</button>
					<button type="button" onclick={() => zoomBy(1.3)} title="Zoom out (or scroll)" aria-label="Zoom out">−</button>
					<button type="button" onclick={() => fitView()} title="Fit the outline in the view (drag empty space to pan)" aria-label="Fit">Fit</button>
				</div>
				{#if tool === 'scale'}
					<div class="scale-hint">{measure?.b ? 'Enter the real distance between the two points' : measure ? 'Click the second point' : 'Click two points a known distance apart'}</div>
				{/if}
				{#if tool === 'move'}
					<div class="scale-hint">Drag the plan into position, then draw the outline</div>
				{/if}
				{#if measure?.b}
					<div class="measure-popover" role="dialog" aria-label="Set scale">
						<span>{Math.round(measuredPixels)} px =</span>
						<label class="visually-hidden" for="measured-distance">Measured distance</label>
						<input
							id="measured-distance"
							type="number"
							inputmode="decimal"
							min="0"
							step="any"
							placeholder="distance"
							value={measuredDistance ?? ''}
							oninput={(e) => { const v = parseFloat((e.currentTarget as HTMLInputElement).value); measuredDistance = Number.isFinite(v) ? v : null; }}
							onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmMeasure(); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelMeasure(); } }}
						/>
						<span>{unit}</span>
						<button type="button" class="primary" disabled={!(measuredDistance && measuredDistance > 0)} onclick={confirmMeasure}>OK</button>
						<button type="button" class="secondary" onclick={cancelMeasure}>Cancel</button>
					</div>
				{/if}
				</div>
			</div>

			<div class="side-column">
				<div class="summary">
					<div><span class="summary-label">Floor area</span><span>{fmt(area)} {unit}²</span></div>
					{#if validationMessage && draft.length >= 3}
						<p class="plan-error" role="alert">{validationMessage}</p>
					{:else if drawing}
						<p class="plan-note">Drawing… {draft.length < 3 ? `${3 - draft.length} more corner${draft.length === 2 ? '' : 's'} needed` : 'close the outline to continue'}</p>
					{/if}
				</div>

				{#if draftPlacement || imageError}
					<div class="reference-panel">
						<div class="reference-title">Reference image</div>
						{#if imageError}
							<p class="plan-error" role="alert">{imageError}</p>
						{/if}
						{#if imageMissing}
							<p class="plan-note">The reference image could not be restored — upload it again to restore it (same file keeps the calibration).</p>
						{:else if draftPlacement}
							<div class="reference-meta">{imageFileName ?? 'Saved image'} · {draftPlacement.widthPx}×{draftPlacement.heightPx} px</div>
							{#if pdfPageCount > 1}
								<label class="reference-row">
									<span>Page</span>
									<select value={pdfPage} onchange={(e) => changePdfPage(Number((e.currentTarget as HTMLSelectElement).value))} aria-label="PDF page">
										{#each Array.from({ length: pdfPageCount }, (_, i) => i + 1) as n}
											<option value={n}>{n} of {pdfPageCount}</option>
										{/each}
									</select>
								</label>
							{/if}
							<label class="reference-row">
								<span>Opacity</span>
								<input type="range" min="0.1" max="1" step="0.05" value={draftPlacement.opacity} oninput={(e) => setOpacity(Number((e.currentTarget as HTMLInputElement).value))} aria-label="Reference image opacity" />
							</label>
							<div class="reference-row">
								<span>X ({unit})</span>
								<ValidatedNumberInput value={draftPlacement.offsetX * k} {precision} step={snapStep} oncommit={(v) => setOffset('offsetX', v)} />
							</div>
							<div class="reference-row">
								<span>Y ({unit})</span>
								<ValidatedNumberInput value={draftPlacement.offsetY * k} {precision} step={snapStep} oncommit={(v) => setOffset('offsetY', v)} />
							</div>
						{/if}
						{#if draftPlacement}
							<button type="button" class="secondary remove-image-btn" onclick={removeImage}>Remove</button>
						{/if}
					</div>
				{/if}

				<div class="vertex-table">
					<div class="vertex-header">
						<span></span>
						<span>X ({unit})</span>
						<span>Y ({unit})</span>
						<span></span>
					</div>
					<div class="vertex-rows">
						{#each draft as [vx, vy], i (i)}
							<div class="vertex-row" class:selected={selectedIndex === i}>
								<span class="row-index" title="Corner {i + 1}">{i + 1}</span>
								<ValidatedNumberInput value={vx} {precision} min={0} step={snapStep} disabled={drawing} oncommit={(v) => setVertexCoord(i, 0, v)} />
								<ValidatedNumberInput value={vy} {precision} min={0} step={snapStep} disabled={drawing} oncommit={(v) => setVertexCoord(i, 1, v)} />
								<button
									type="button"
									class="secondary remove-btn"
									title="Remove corner {i + 1}"
									aria-label="Remove corner {i + 1}"
									disabled={drawing || draft.length <= 3}
									onclick={() => removeVertex(i)}
								>×</button>
							</div>
						{/each}
					</div>
					<button type="button" class="secondary add-vertex-btn" disabled={drawing || draft.length < 2} onclick={addVertex}>Add corner</button>
				</div>
			</div>
		</div>
	{/snippet}

	{#snippet footer()}
		<div class="footer">
			<button type="button" class="secondary" onclick={onClose}>Cancel</button>
			<button type="button" class="primary" disabled={!isValid} onclick={apply} title={isValid ? 'Apply this outline to the room' : (validationMessage ?? 'Finish the outline first')}>Apply</button>
		</div>
	{/snippet}
</Modal>

<style>
	/* Fixed-height body so the modal itself never scrolls: the canvas fills the
	   left column and the vertex list scrolls inside the right column. */
	.floor-plan-modal {
		display: flex;
		gap: var(--spacing-md);
		/* Fill the viewport: modal max-height (100vh - 24px) minus header + footer */
		height: calc(100vh - 24px - 118px);
		min-height: 360px;
		padding: var(--spacing-md);
	}

	.canvas-column {
		flex: 1 1 560px;
		min-width: 320px;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.side-column {
		flex: 0 0 260px;
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
		min-width: 0;
		min-height: 0;
	}

	.toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: var(--spacing-xs);
		align-items: center;
	}

	.toolbar .units-select {
		margin-left: auto;
		width: 60px;
	}

	.toolbar-sep {
		width: 1px;
		height: 1.4rem;
		background: var(--color-border);
		margin: 0 var(--spacing-xs);
	}

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
		fill: none;
		stroke: var(--color-text-muted);
		stroke-dasharray: 3 2;
	}

	.angle-arc.exact {
		stroke: var(--color-accent);
		stroke-dasharray: none;
	}

	.angle-label {
		fill: var(--color-text-muted);
		font-family: var(--font-mono, monospace);
		font-weight: 600;
		pointer-events: none;
	}

	.angle-label.exact {
		fill: var(--color-accent);
	}

	.tool {
		padding: 4px 10px;
		font-size: var(--font-size-sm, var(--font-size-base));
	}

	.tool.active {
		background: var(--color-accent);
		color: var(--color-bg, #fff);
		border-color: var(--color-accent);
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

	.plan.drawing {
		cursor: crosshair;
	}

	.plan.scaling {
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

	.outline {
		fill: var(--color-accent);
		fill-opacity: 0.12;
		stroke: var(--color-accent);
		stroke-linejoin: round;
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
		stroke-dasharray: 4 3;
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
		fill: var(--color-warning, #f5a524);
		pointer-events: none;
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

	.summary {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: var(--font-size-base);
	}

	.summary > div {
		display: flex;
		justify-content: space-between;
	}

	.summary-label {
		color: var(--color-text-muted);
	}

	.plan-error {
		margin: 4px 0 0;
		font-size: var(--font-size-xs);
		color: var(--color-error, #e5484d);
	}

	.plan-note {
		margin: 4px 0 0;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}

	.vertex-table {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-height: 0;
		flex: 0 1 auto;
	}

	/* Rows grow until the column is full (pushing "Add corner" down to the
	   canvas's bottom edge), then scroll while the button stays put. */
	.vertex-rows {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-height: 0;
		overflow-y: auto;
		/* Always reserve the scrollbar's width so it never overlays the × column */
		scrollbar-gutter: stable;
		padding-right: 2px;
	}

	/* Keep the header columns aligned with the (gutter-padded) rows */
	.vertex-header {
		scrollbar-gutter: stable;
		overflow-y: hidden;
		padding-right: 2px;
	}

	.vertex-header,
	.vertex-row {
		display: grid;
		grid-template-columns: 1.6rem 1fr 1fr 1.4rem;
		gap: var(--spacing-xs);
		align-items: center;
	}

	.vertex-header {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}

	.row-index {
		text-align: center;
		font-size: var(--font-size-xs);
		font-family: var(--font-mono, monospace);
		color: var(--color-text-muted);
	}

	.vertex-row.selected .row-index {
		color: var(--color-accent);
		font-weight: 600;
	}

	/* Same look as the Cancel button (secondary), just compact */
	.remove-btn {
		width: 100%;
		padding: 0;
		height: 1.6rem;
		line-height: 1;
	}

	.add-vertex-btn {
		width: 100%;
	}

	.footer {
		display: flex;
		justify-content: flex-end;
		gap: var(--spacing-sm);
		padding: var(--spacing-sm) var(--spacing-md);
	}

	.plan-image {
		pointer-events: none;
		image-rendering: auto;
	}

	.plan-image.movable {
		pointer-events: all;
		cursor: grab;
	}

	.measure-line {
		stroke: var(--color-accent);
		stroke-dasharray: 4 3;
	}

	.measure-dot {
		fill: var(--color-bg, #fff);
		stroke: var(--color-accent);
	}

	.scale-hint {
		position: absolute;
		left: 8px;
		top: 8px;
		padding: 2px 8px;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		background: var(--color-bg, #fff);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm, 4px);
		pointer-events: none;
	}

	.measure-popover {
		position: absolute;
		left: 50%;
		bottom: 12px;
		transform: translateX(-50%);
		display: flex;
		gap: var(--spacing-xs);
		align-items: center;
		padding: var(--spacing-xs) var(--spacing-sm);
		font-size: var(--font-size-sm, var(--font-size-base));
		background: var(--color-bg, #fff);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm, 4px);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
	}

	.measure-popover input {
		width: 5.5rem;
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}

	.reference-panel {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: var(--spacing-xs) 0;
		border-top: 1px solid var(--color-border);
		border-bottom: 1px solid var(--color-border);
		font-size: var(--font-size-xs);
	}

	.reference-title {
		color: var(--color-text-muted);
	}

	.reference-meta {
		color: var(--color-text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.reference-row {
		display: grid;
		grid-template-columns: 4.2rem 1fr;
		gap: var(--spacing-xs);
		align-items: center;
	}

	.reference-row input[type='range'] {
		width: 100%;
	}

	.remove-image-btn {
		width: 100%;
		margin-top: 2px;
	}
</style>
