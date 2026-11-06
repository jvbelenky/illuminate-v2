<script lang="ts" module>
	import type { ImportFrame, Pt } from './importFrame';
	import type { WallMeters } from './wallStructures';

	/** What Create room hands back: the frame (rotation, origin, scale), the outline in room metres (null keeps the current outline) and the interior walls to build. */
	export interface FloorplanImportResult {
		frame: ImportFrame;
		outlineMeters: Pt[] | null;
		walls?: WallMeters[];
	}
</script>

<script lang="ts">
	// The floor plan import window: openable step cards on the left (Check axes,
	// Set origin, Set scale, Trace outline), each holding its own instructions
	// and controls; the image on the right with its tools over its top-left
	// corner and the units select bottom right; Back and Next below.
	// Points live in IMAGE pixels; steps 1-3 show the ALIGNED frame (the image
	// turned by `rotation` about its centre, see importFrame.ts). Trace outline
	// is the main 2D view's own canvas (PlanCanvas) in room units, the image
	// placed under it, so drawing, snapping and vertex editing are the same.
	import { tick, untrack } from 'svelte';
	import Modal from '$lib/components/Modal.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import VertexTable from '$lib/components/VertexTable.svelte';
	import PlanCanvas, { type CanvasContext, type CanvasTool } from '$lib/components/PlanCanvas.svelte';
	import UnitsSelect from '$lib/workspace/UnitsSelect.svelte';
	import {
		alignedBounds, fromAligned, metersToPixel, normalizeDeg, pixelToMeters, pxPerMeter,
		snapRotation, straightenRotation, toAligned,
	} from './importFrame';
	import { cardText, moveNext, moveTo, DETECT_FAILED, NEED_TEXT, STEP_LABELS, type AlignTool, type ImportStep, type StepFacts } from './importSteps';
	import { detectPlanAsync } from './detectClient';
	import { LENGTH_UNITS, toMeters, unitAbbrev, unitDecimals, unitsPerMeter, type LengthUnit } from '$lib/utils/unitConversion';
	import { validatePolygon, type Vertex } from '$lib/utils/roomGeometry';

	interface Props {
		src: string;
		widthPx: number;
		heightPx: number;
		units: LengthUnit;
		precision: number;
		/** Reopening an image: its rotation, origin and scale. */
		initial?: { rotation: number; origin: Pt; pxPerM: number } | null;
		/** The room's current outline (metres): offered as Keep current outline. */
		currentOutline?: Pt[] | null;
		/** The units select over the image (the project's setting, as in the main views). */
		onUnitsChange?: (event: Event) => void;
		/** Change image…: a new file; the host reopens the window on it. */
		onChangeImage?: (file: File) => void;
		/** A new image is being read. */
		decoding?: boolean;
		onApply: (result: FloorplanImportResult) => void;
		onClose: () => void;
	}

	let { src, widthPx, heightPx, units, precision, initial = null, currentOutline = null, onUnitsChange, onChangeImage, decoding = false, onApply, onClose }: Props = $props();

	const STEPS: ImportStep[] = [1, 2, 3, 4];
	// The window starts from these; later prop changes do not restart it
	const start = untrack(() => ({ initial, units, centre: [widthPx / 2, heightPx / 2] as Pt }));

	// --- The work
	let step = $state<ImportStep>(1);
	let rotation = $state(start.initial?.rotation ?? 0);
	let aligned = $state(!!start.initial);
	/** Check axes: the align tools are open. */
	let aligning = $state(false);
	/** The rotation when Align axes was opened: Redo goes back to it. */
	let alignFrom = $state(start.initial?.rotation ?? 0);
	let tool = $state<AlignTool>(null);
	let guides = $state(true);
	let wall = $state<Pt[]>([]);
	let origin = $state<Pt | null>(start.initial?.origin ?? null);
	let scaleA = $state<Pt | null>(null);
	let scaleB = $state<Pt | null>(null);
	let distance = $state<number | null>(null);
	let distUnit = $state<LengthUnit>(start.units);
	let keptScale = $state<number | null>(start.initial?.pxPerM ?? null);
	/** The yellow scale line is shown (visual only). */
	let scaleShown = $state(true);
	/** The distance popup beside the second scale point (stage pixels). */
	let popup = $state<Pt | null>(null);
	let popupAfterUp = false;
	let how = $state<'trace' | 'auto' | 'keep' | null>(null);
	/** The outline in image pixels while another step is open. */
	let outline = $state<Pt[]>([]);
	/** Trace outline: the outline in display units, as the plan canvas edits it. */
	let draft = $state<Vertex[]>([]);
	let drawing = $state(false);
	let canvasTool = $state<CanvasTool>('edit');
	let canvas = $state<PlanCanvas | undefined>(undefined);
	/** Auto-detect, One room: the next click picks the room. */
	let picking = $state(false);
	let detecting = $state(false);
	let detectAsk = $state(false);
	let notice = $state<string | null>(null);
	let noticeTimer: ReturnType<typeof setTimeout> | undefined;
	let selV = $state(-1);
	/** Interior walls found by auto-detect: centre line and thickness in image pixels. */
	type IWall = { id: number; a: Pt; b: Pt; thickness: number; on: boolean };
	let walls = $state<IWall[]>([]);
	let wallsOpen = $state(true);
	let hoverWall = $state(-1);
	let detectToken = 0;
	let worked = $state(false);
	let need = $state<{ step: 2 | 3 | 4; title: string; body: string } | null>(null);
	let confirmClose = $state(false);
	let confirmChange = $state(false);

	const k = $derived(unitsPerMeter(units));
	const measuredScale = $derived(scaleA && scaleB && distance ? pxPerMeter(scaleA, scaleB, toMeters(distance, distUnit)) : null);
	const pxPerM = $derived(measuredScale ?? (scaleA || scaleB ? null : keptScale));
	const frame = $derived<ImportFrame>({ widthPx, heightPx, rotation, origin, pxPerM });
	const ready = $derived(!!origin && !!pxPerM);
	/** Kept outline (unedited) follows the frame; otherwise the points placed. */
	const shownOutline = $derived<Pt[]>(how === 'keep' && currentOutline && ready ? currentOutline.map((m) => metersToPixel(frame, m)) : outline);
	const onCanvas = $derived(step === 4 && ready);
	const tracing = $derived(onCanvas && drawing);
	const outlineMeters = $derived<Pt[]>(onCanvas ? draft.map(([x, y]) => [x / k, y / k] as Pt) : ready ? shownOutline.map((p) => pixelToMeters(frame, p)) : []);
	const outlineValid = $derived.by(() => {
		if (tracing || outlineMeters.length < 3) return false;
		const minX = Math.min(...outlineMeters.map((p) => p[0]));
		const minY = Math.min(...outlineMeters.map((p) => p[1]));
		return validatePolygon(outlineMeters.map(([x, y]) => [x - minX, y - minY] as Pt)) === null;
	});
	const facts = $derived<StepFacts>({ aligned, origin: !!origin, scale: !!pxPerM, outline: outlineValid });
	const done = (n: ImportStep) => (n === 1 ? facts.aligned : n === 2 ? facts.origin : n === 3 ? facts.scale : facts.outline);
	const text = $derived(cardText({ step, aligning, tool, wallPoints: wall.length, scaleA: !!scaleA, scaleB: !!scaleB, picking, detecting, tracing }));
	const unitLabel = $derived(unitAbbrev(units));
	// The table shows the project's precision (at least the unit's own decimals)
	const tableDecimals = $derived(Math.max(precision, unitDecimals(units)));
	const roundShown = (v: number) => Math.round(v * 10 ** tableDecimals) / 10 ** tableDecimals;
	const tableRows = $derived(draft.map(([x, y]) => [roundShown(x), roundShown(y)] as [number, number]));
	const allWallsOn = $derived(walls.length > 0 && walls.every((w) => w.on));
	const someWallsOn = $derived(walls.some((w) => w.on));
	/** The short value a closed card shows. */
	function cardValue(n: ImportStep): string {
		if (n === 3 && measuredScale && distance) return `${distance} ${unitAbbrev(distUnit)}`;
		if (n === 3 && pxPerM) return `${Math.round(pxPerM)} px/m`;
		if (n === 4 && outlineValid) return `${outlineMeters.length} vertices`;
		return '';
	}
	/** "length × thickness unit" in the project's units. */
	function wallDims(w: IWall): string {
		if (!pxPerM) return '';
		const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) / pxPerM;
		return `${roundShown(len * k)} × ${roundShown((w.thickness / pxPerM) * k)} ${unitLabel}`;
	}
	function toggleWall(i: number) {
		walls = walls.map((w, j) => (j === i ? { ...w, on: !w.on } : w));
		markWork();
	}
	function toggleAllWalls() {
		const on = !allWallsOn;
		walls = walls.map((w) => ({ ...w, on }));
		markWork();
	}
	function removeWall(i: number) {
		walls = walls.filter((_, j) => j !== i);
		hoverWall = -1;
		markWork();
	}

	function markWork() {
		worked = true;
	}

	// --- Image pixels <-> the plan canvas (display units, y up)
	function pxToDisplay(p: Pt): Vertex {
		const m = pixelToMeters(frame, p);
		return [m[0] * k, m[1] * k];
	}
	function displayToPx(v: Vertex): Pt {
		return metersToPixel(frame, [v[0] / k, v[1] / k]);
	}
	/** Room units per image pixel on the plan canvas. */
	const imgUnit = $derived(pxPerM ? k / pxPerM : 1);
	/** The image on the plan canvas: image pixels -> SVG (room x, -y). */
	const imgTransform = $derived.by(() => {
		if (!ready) return '';
		const o = toAligned(frame, origin!);
		return `scale(${imgUnit}) translate(${-o[0]} ${-o[1]}) rotate(${rotation} ${centre[0]} ${centre[1]})`;
	});
	const imageCornersDisplay = $derived<Vertex[]>(ready ? ([[0, 0], [widthPx, 0], [widthPx, heightPx], [0, heightPx]] as Pt[]).map(pxToDisplay) : []);

	// --- The view of steps 1-3: screen = aligned * z + (tx, ty)
	let stageEl = $state<HTMLDivElement | undefined>(undefined);
	let wrapEl = $state<HTMLDivElement | undefined>(undefined);
	let sw = $state(0);
	let sh = $state(0);
	let z = $state(1);
	let tx = $state(0);
	let ty = $state(0);
	let fitted = false;
	const coarse = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
	const HANDLE = coarse ? 12 : 7;
	const centre = start.centre;

	function fit() {
		if (onCanvas) {
			canvas?.fitView();
			return;
		}
		if (!sw || !sh) return;
		const b = alignedBounds(frame);
		const pad = 24;
		z = Math.max(0.02, Math.min((sw - 2 * pad) / b.width, (sh - 2 * pad) / b.height));
		tx = (sw - b.width * z) / 2 - b.x * z;
		ty = (sh - b.height * z) / 2 - b.y * z;
	}
	function fullSize() {
		if (onCanvas) {
			canvas?.zoomToUnitsPerPixel(imgUnit);
			return;
		}
		zoomAbout([sw / 2, sh / 2], 1);
	}
	function zoomAbout(p: Pt, nz: number) {
		nz = Math.max(0.02, Math.min(16, nz));
		const q: Pt = [(p[0] - tx) / z, (p[1] - ty) / z];
		z = nz;
		tx = p[0] - q[0] * z;
		ty = p[1] - q[1] * z;
	}

	// The stage comes and goes with Trace outline: follow whichever element is there
	$effect(() => {
		const el = stageEl;
		if (!el) return;
		return untrack(() => {
			const ro = new ResizeObserver(() => {
				const r = el.getBoundingClientRect();
				sw = r.width;
				sh = r.height;
				if (!fitted && sw > 0 && sh > 0) {
					fitted = true;
					fit();
				}
			});
			ro.observe(el);
			// Wheel zoom about the cursor (a non-passive listener, so the page does not scroll)
			const onWheel = (e: WheelEvent) => {
				e.preventDefault();
				zoomAbout(local(e), z * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
			};
			el.addEventListener('wheel', onWheel, { passive: false });
			return () => {
				ro.disconnect();
				el.removeEventListener('wheel', onWheel);
			};
		});
	});

	function local(e: { clientX: number; clientY: number }): Pt {
		const r = (stageEl ?? wrapEl)!.getBoundingClientRect();
		return [e.clientX - r.left, e.clientY - r.top];
	}
	function toView(p: Pt): Pt {
		return [(p[0] - tx) / z, (p[1] - ty) / z];
	}
	function al(p: Pt): Pt {
		return toAligned(frame, p);
	}

	// --- Pointer work on steps 1-3
	type Drag =
		| { kind: 'pan'; p0: Pt; t0: Pt }
		| { kind: 'rotate'; a0: number; r0: number }
		| { kind: 'handle'; which: 'origin' | 'scaleA' | 'scaleB' };
	let drag = $state<Drag | null>(null);
	let cursor = $state<Pt | null>(null);
	let angleLabel = $state<{ at: Pt; text: string } | null>(null);
	const pointers = new Map<number, Pt>();
	let pinch: { d0: number; q0: Pt; z0: number } | null = null;

	const placing = $derived(
		drag?.kind === 'handle' ||
		(tool !== 'pan' && ((step === 1 && aligning && tool === 'straighten') || step === 2 || (step === 3 && !scaleB))),
	);
	// The lens shows the image at 100% wherever the view shows it smaller
	const lensOn = $derived(placing && !!cursor && z < 0.95 && !pinch);

	function handleOf(e: PointerEvent): string | null {
		const el = (e.target as Element | null)?.closest?.('[data-handle]');
		return el ? el.getAttribute('data-handle') : null;
	}

	function onDown(e: PointerEvent) {
		if (!stageEl) return;
		if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
		const p = local(e);
		pointers.set(e.pointerId, p);
		(e.currentTarget as Element).setPointerCapture?.(e.pointerId);
		if (pointers.size === 2) {
			const [a, b] = [...pointers.values()];
			const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
			pinch = { d0: Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, q0: toView(mid), z0: z };
			drag = null;
			return;
		}
		if (pointers.size > 2) return;
		cursor = p;
		const img = fromAligned(frame, toView(p));
		const h = handleOf(e);
		if (e.button === 1 || tool === 'pan') {
			drag = { kind: 'pan', p0: p, t0: [tx, ty] };
			return;
		}
		if (h === 'origin' || h === 'scaleA' || h === 'scaleB') {
			drag = { kind: 'handle', which: h };
			return;
		}
		if (step === 1 && aligning && tool === 'rotate') {
			drag = { kind: 'rotate', a0: screenAngle(p), r0: rotation };
			return;
		}
		if (step === 1 && aligning && tool === 'straighten') {
			wall = [...wall, img];
			if (wall.length === 2) {
				rotation = straightenRotation(wall[0], wall[1], rotation);
				wall = [];
				aligned = true;
				fit();
			}
			markWork();
			return;
		}
		if (step === 2) {
			origin = img;
			markWork();
			drag = { kind: 'handle', which: 'origin' };
			return;
		}
		if (step === 3 && !scaleB) {
			if (!scaleA) scaleA = img;
			else {
				scaleB = img;
				scaleShown = true;
				drag = { kind: 'handle', which: 'scaleB' };
				popupAfterUp = true;
			}
			markWork();
			return;
		}
		drag = { kind: 'pan', p0: p, t0: [tx, ty] };
	}

	function onMove(e: PointerEvent) {
		if (!stageEl) return;
		const p = local(e);
		if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
		if (pinch && pointers.size >= 2) {
			const [a, b] = [...pointers.values()];
			const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
			const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
			z = Math.max(0.02, Math.min(16, pinch.z0 * (d / pinch.d0)));
			tx = mid[0] - pinch.q0[0] * z;
			ty = mid[1] - pinch.q0[1] * z;
			return;
		}
		if (e.pointerType === 'mouse' || drag) cursor = p;
		const d = drag;
		if (!d) return;
		if (d.kind === 'pan') {
			tx = d.t0[0] + p[0] - d.p0[0];
			ty = d.t0[1] + p[1] - d.p0[1];
			return;
		}
		if (d.kind === 'rotate') {
			const raw = d.r0 + (screenAngle(p) - d.a0);
			rotation = e.altKey ? normalizeDeg(raw) : snapRotation(raw);
			aligned = true;
			markWork();
			angleLabel = { at: p, text: `${rotation.toFixed(1)}°` };
			return;
		}
		const img = fromAligned(frame, toView(p));
		markWork();
		if (d.which === 'origin') origin = img;
		else if (d.which === 'scaleA') scaleA = img;
		else scaleB = img;
	}

	async function onUp(e: PointerEvent) {
		pointers.delete(e.pointerId);
		if (pinch) {
			if (pointers.size < 2) pinch = null;
			return;
		}
		drag = null;
		angleLabel = null;
		if (e.pointerType !== 'mouse') cursor = null;
		if (popupAfterUp) {
			popupAfterUp = false;
			await openPopup(local(e));
		}
	}

	function onLeave(e: PointerEvent) {
		if (e.pointerType === 'mouse' && !drag) cursor = null;
	}

	/** Angle (degrees) of a stage point about the image centre on screen. */
	function screenAngle(p: Pt): number {
		const c: Pt = [centre[0] * z + tx, centre[1] * z + ty];
		return (Math.atan2(p[1] - c[1], p[0] - c[0]) * 180) / Math.PI;
	}

	function turn90(dir: 1 | -1) {
		rotation = normalizeDeg(rotation + 90 * dir);
		aligned = true;
		markWork();
		fit();
	}

	function pickTool(t: AlignTool) {
		tool = tool === t ? null : t;
		wall = [];
	}

	// --- Check axes
	function openAlign() {
		alignFrom = rotation;
		aligning = true;
		tool = 'straighten';
		wall = [];
	}
	function looksGood() {
		aligned = true;
		aligning = false;
		tool = null;
		markWork();
		go(2);
	}
	function alignDone() {
		aligned = true;
		aligning = false;
		tool = null;
		wall = [];
		markWork();
	}
	function redoAlign() {
		rotation = alignFrom;
		aligned = false;
		aligning = true;
		tool = 'straighten';
		wall = [];
		markWork();
		fit();
	}

	// --- Set scale: the popup beside the second point
	let popupInput = $state<HTMLInputElement | undefined>(undefined);
	let popupEl = $state<HTMLDivElement | undefined>(undefined);
	async function openPopup(at: Pt) {
		popup = [Math.max(4, Math.min(at[0] + 16, sw - 250)), Math.max(4, Math.min(at[1] + 12, sh - 50))];
		await tick();
		popupInput?.focus();
		popupInput?.select();
	}
	function closePopup() {
		popup = null;
	}
	// A press anywhere outside the popup confirms what is typed and closes it
	$effect(() => {
		if (!popup) return;
		const away = (e: PointerEvent) => {
			if (popupEl && e.target instanceof Node && popupEl.contains(e.target)) return;
			popup = null;
		};
		window.addEventListener('pointerdown', away, true);
		return () => window.removeEventListener('pointerdown', away, true);
	});
	function setDistance(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const v = Number(input.value);
		distance = input.value === '' || !(v > 0) ? null : v;
		markWork();
	}
	function popupKey(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			closePopup();
		}
	}
	function redoScale() {
		scaleA = null;
		scaleB = null;
		keptScale = null;
		scaleShown = true;
		popup = null;
		markWork();
	}

	// --- Steps
	function go(to: ImportStep) {
		if (step === 4 && to !== 4) leaveOutline();
		const entering = step !== 4 && to === 4;
		step = to;
		tool = null;
		aligning = false;
		wall = [];
		drag = null;
		popup = null;
		detectAsk = false;
		if (entering) enterOutline();
	}
	function apply(move: ReturnType<typeof moveNext>) {
		aligned = move.aligned;
		if (move.kind === 'need') {
			need = { step: move.step, ...NEED_TEXT[move.step] };
			return;
		}
		if (move.kind === 'go') go(move.step);
		else finish();
	}
	function next() {
		apply(moveNext(facts, step));
	}
	function back() {
		if (step > 1) go((step - 1) as ImportStep);
	}
	function cardClick(n: ImportStep) {
		if (n === step) return;
		apply(moveTo(facts, n));
	}
	function needOk() {
		const s = need?.step;
		need = null;
		if (s) go(s);
	}

	// --- Trace outline, on the plan canvas
	let draftK = untrack(() => k);
	function enterOutline() {
		draft = how === 'keep' && currentOutline ? currentOutline.map(([x, y]) => [x * k, y * k] as Vertex) : ready ? outline.map(pxToDisplay) : [];
		draftK = k;
		drawing = false;
		canvasTool = 'edit';
		picking = false;
		selV = -1;
	}
	function leaveOutline() {
		if (drawing) canvas?.cancelDraw();
		drawing = false;
		picking = false;
		detectToken++;
		detecting = false;
		if (how !== 'keep' && ready) outline = draft.map(displayToPx);
	}
	// A units change rescales the outline being edited, as the main view's does
	$effect(() => {
		const kk = k;
		untrack(() => {
			if (kk === draftK) return;
			const f = kk / draftK;
			draftK = kk;
			if (!onCanvas) return;
			if (drawing) canvas?.cancelDraw();
			draft = draft.map(([x, y]) => [x * f, y * f] as Vertex);
			canvas?.scaleView(f);
		});
	});

	function finish() {
		const keep = how === 'keep' && !!currentOutline;
		const scale = pxPerM;
		const built = keep || !scale ? [] : walls.filter((w) => w.on).map((w) => ({ a: pixelToMeters(frame, w.a), b: pixelToMeters(frame, w.b), thickness: w.thickness / scale }));
		onApply({ frame: { ...frame }, outlineMeters: keep ? null : outlineMeters.map((p) => [p[0], p[1]] as Pt), walls: built });
	}

	function requestClose() {
		if (worked) confirmClose = true;
		else onClose();
	}

	function onEscape(): boolean {
		if (need) {
			need = null;
			return true;
		}
		if (confirmClose || confirmChange) {
			confirmClose = false;
			confirmChange = false;
			return true;
		}
		if (detectAsk) {
			detectAsk = false;
			return true;
		}
		if (popup) {
			popup = null;
			return true;
		}
		if (onCanvas && drawing) {
			canvas?.cancelDraw();
			return true;
		}
		if (onCanvas && picking) {
			picking = false;
			canvasTool = 'edit';
			return true;
		}
		if (wall.length || drag) {
			wall = [];
			drag = null;
			return true;
		}
		requestClose();
		return true;
	}

	function showNotice(t: string) {
		notice = t;
		clearTimeout(noticeTimer);
		noticeTimer = setTimeout(() => (notice = null), 4000);
	}
	function stopDetect() {
		detectToken++;
		detecting = false;
		picking = false;
	}
	function chooseTrace() {
		stopDetect();
		walls = [];
		how = 'trace';
		notice = null;
		canvasTool = 'edit';
		selV = -1;
		canvas?.startDraw('polygon');
		markWork();
	}
	function chooseAuto() {
		if (drawing) canvas?.cancelDraw();
		detectAsk = true;
	}
	function startAuto() {
		if (drawing) canvas?.cancelDraw();
		stopDetect();
		detectAsk = false;
		notice = null;
		walls = [];
		how = 'auto';
		draft = [];
		selV = -1;
		markWork();
	}
	function detectOneRoom() {
		startAuto();
		picking = true;
		canvasTool = 'custom';
	}
	function detectWholeSpace() {
		startAuto();
		canvasTool = 'edit';
		void runDetect(null);
	}
	function onPickClick(e: MouseEvent) {
		if (!picking || detecting || !canvas || !ready) return;
		const m = canvas.pointerToRoom(e);
		picking = false;
		canvasTool = 'edit';
		void runDetect(metersToPixel(frame, [m[0] / k, m[1] / k]));
	}
	function chooseKeep() {
		if (drawing) canvas?.cancelDraw();
		stopDetect();
		walls = [];
		how = 'keep';
		canvasTool = 'edit';
		draft = currentOutline ? currentOutline.map(([x, y]) => [x * k, y * k] as Vertex) : [];
		selV = -1;
	}
	function redoOutline() {
		if (drawing) canvas?.cancelDraw();
		stopDetect();
		canvasTool = 'edit';
		walls = [];
		draft = [];
		outline = [];
		how = null;
		selV = -1;
		markWork();
	}
	/** The outline was edited: a kept one is ordinary points from here on. */
	function edited() {
		if (how === 'keep') how = 'trace';
		markWork();
	}
	function onDrawEnd(committed: boolean) {
		if (!committed) return;
		selV = -1;
		markWork();
	}
	function setVertex(i: number, axis: 0 | 1, value: number) {
		draft = draft.map((q, j) => (j === i ? (axis === 0 ? [value, q[1]] : [q[0], value]) as Vertex : q));
		selV = i;
		edited();
	}
	function removeVertex(i: number) {
		if (draft.length <= 3) return;
		draft = draft.filter((_, j) => j !== i);
		selV = -1;
		edited();
	}
	function addVertex() {
		const o = draft;
		if (o.length < 2) return;
		const i = selV >= 0 ? selV : o.length - 1;
		const a = o[i], b = o[(i + 1) % o.length];
		draft = [...o.slice(0, i + 1), [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as Vertex, ...o.slice(i + 1)];
		selV = i + 1;
		edited();
	}

	// Trace outline's Pan tool: a drag pans the plan canvas instead of reaching it
	let canvasPan: Pt | null = null;
	function onCanvasDownCapture(e: PointerEvent) {
		if (tool !== 'pan' || e.button !== 0) return;
		e.stopPropagation();
		e.preventDefault();
		(e.currentTarget as Element).setPointerCapture?.(e.pointerId);
		canvasPan = [e.clientX, e.clientY];
	}
	function onCanvasMove(e: PointerEvent) {
		if (canvasPan) {
			canvas?.panBy(e.clientX - canvasPan[0], e.clientY - canvasPan[1]);
			canvasPan = [e.clientX, e.clientY];
			return;
		}
		if (e.pointerType !== 'mouse' || !canvas) return;
		cursor = local(e);
		lensRoom = canvas.pointerToRoom(e);
	}
	function onCanvasUp() {
		canvasPan = null;
	}
	function onCanvasClickCapture(e: MouseEvent) {
		if (tool === 'pan') e.stopPropagation();
	}
	let lensRoom = $state<Vertex | null>(null);
	const canvasLens = $derived((drawing || picking) && !!cursor && !!lensRoom && tool !== 'pan');

	let imgEl: HTMLImageElement | null = null;
	function loadImage(): Promise<HTMLImageElement> {
		if (imgEl?.complete && imgEl.naturalWidth) return Promise.resolve(imgEl);
		return new Promise((resolve, reject) => {
			const im = new Image();
			im.onload = () => { imgEl = im; resolve(im); };
			im.onerror = () => reject(new Error('image'));
			im.src = src;
		});
	}

	/** Auto-detect on the aligned image: a room around `seed` (image pixels), or the whole space. */
	async function runDetect(seed: Pt | null) {
		if (!pxPerM) return;
		const token = ++detectToken;
		detecting = true;
		selV = -1;
		markWork();
		await tick();
		await new Promise((r) => requestAnimationFrame(() => r(null)));
		let found = false;
		try {
			const im = await loadImage();
			const b = alignedBounds(frame);
			const f = Math.min(1, 1000 / Math.max(b.width, b.height));
			const w = Math.max(1, Math.ceil(b.width * f)), h = Math.max(1, Math.ceil(b.height * f));
			const cv = document.createElement('canvas');
			cv.width = w;
			cv.height = h;
			const ctx = cv.getContext('2d', { willReadFrequently: true });
			if (!ctx) throw new Error('canvas');
			ctx.fillStyle = '#fff';
			ctx.fillRect(0, 0, w, h);
			ctx.setTransform(f, 0, 0, f, -b.x * f, -b.y * f);
			ctx.translate(centre[0], centre[1]);
			ctx.rotate((rotation * Math.PI) / 180);
			ctx.translate(-centre[0], -centre[1]);
			ctx.drawImage(im, 0, 0, widthPx, heightPx);
			const data = ctx.getImageData(0, 0, w, h);
			const toCanvas = (p: Pt): Pt => { const q = al(p); return [(q[0] - b.x) * f, (q[1] - b.y) * f]; };
			const result = await detectPlanAsync(
				{ width: w, height: h, data: data.data },
				seed ? { mode: 'room', seed: toCanvas(seed) } : { mode: 'floor' },
				{ pxPerM: pxPerM * f },
			);
			// Trace, Keep, another step or a newer detection took over meanwhile
			if (token !== detectToken) return;
			const backTo = (p: Pt): Pt => fromAligned(frame, [p[0] / f + b.x, p[1] / f + b.y]);
			if (result.outline && result.outline.length >= 3) {
				outline = result.outline.map(backTo);
				draft = outline.map(pxToDisplay);
				walls = result.walls.map((s, i) => ({ id: i, a: backTo(s.a), b: backTo(s.b), thickness: s.thickness / f, on: true }));
				found = true;
			}
		} catch {
			if (token !== detectToken) return;
		}
		if (token !== detectToken) return;
		detecting = false;
		if (!found) {
			// Back to the plain 2D editing, drawing
			chooseTrace();
			showNotice(DETECT_FAILED);
		}
	}

	// --- Change image…
	let fileEl = $state<HTMLInputElement | undefined>(undefined);
	function requestChange() {
		if (worked) confirmChange = true;
		else fileEl?.click();
	}
	function onFile(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (file) onChangeImage?.(file);
	}

	// --- Drawing helpers
	const LENS = 150;
	const lensPos = $derived.by(() => {
		if (!cursor) return { left: 0, top: 0 };
		let left = cursor[0] + 24;
		let top = cursor[1] - LENS - 24;
		if (top < 4) top = cursor[1] + 24;
		const w = sw || (wrapEl?.clientWidth ?? 0);
		if (left + LENS > w - 4) left = cursor[0] - 24 - LENS;
		return { left, top };
	});
	const lensView = $derived.by(() => {
		if (!cursor) return '0 0 1 1';
		const q = toView(cursor);
		return `${q[0] - LENS / 2} ${q[1] - LENS / 2} ${LENS} ${LENS}`;
	});
	const strongGuides = $derived(step === 1 && aligning);
	const gridLines = $derived.by(() => {
		const gap = 48;
		const xs: number[] = [], ys: number[] = [];
		for (let x = gap / 2; x < sw; x += gap) xs.push(x);
		for (let y = gap / 2; y < sh; y += gap) ys.push(y);
		return { xs, ys };
	});
	const svgPts = (list: Vertex[]) => list.map(([x, y]) => `${x},${-y}`).join(' ');
	/** A wall's rectangle on the plan canvas (SVG coordinates). */
	function wallRect(w: IWall): string {
		const a = pxToDisplay(w.a), b = pxToDisplay(w.b);
		const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
		const t = (w.thickness * imgUnit) / 2;
		const nx = (-(b[1] - a[1]) / len) * t, ny = ((b[0] - a[0]) / len) * t;
		return svgPts([[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]]);
	}
	function wallDown(e: PointerEvent, i: number) {
		if (drawing || picking || tool === 'pan' || e.button !== 0) return;
		e.stopPropagation();
		e.preventDefault();
		toggleWall(i);
	}
</script>

{#snippet imageLayer(lens: boolean)}
	<g transform="rotate({rotation} {centre[0]} {centre[1]})">
		<rect class="fi-paper" x="0" y="0" width={widthPx} height={heightPx} />
		<image class={lens ? 'fi-lens-image' : 'fi-image'} href={src} x="0" y="0" width={widthPx} height={heightPx} preserveAspectRatio="none" />
	</g>
{/snippet}

{#snippet overlays(s: number)}
	{@const r = HANDLE / s}
	{#if step === 1 && wall.length}
		{@const a = al(wall[0])}
		{#if cursor && !coarse && drag === null && wall.length === 1}
			{@const c = toView(cursor)}
			<line class="fi-wall" x1={a[0]} y1={a[1]} x2={c[0]} y2={c[1]} stroke-width={3 / s} />
		{/if}
		{#each wall as w, i (i)}
			{@const q = al(w)}
			<circle class="fi-handle" cx={q[0]} cy={q[1]} r={r} stroke-width={2 / s} />
		{/each}
	{/if}
	{#if scaleA && scaleShown && (step === 3 || scaleB)}
		{@const a = al(scaleA)}
		{@const b = scaleB ? al(scaleB) : step === 3 && cursor && !drag && !coarse ? toView(cursor) : a}
		<line class="fi-scale" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke-width={3 / s} stroke-dasharray={step !== 3 ? `${10 / s} ${6 / s}` : undefined} />
		{#if scaleB && distance}
			<text class="fi-scale-label" x={(a[0] + b[0]) / 2} y={(a[1] + b[1]) / 2 - 10 / s} font-size={15 / s} text-anchor="middle">{distance} {unitAbbrev(distUnit)}</text>
		{/if}
		{#if step === 3}
			<circle class="fi-handle" data-handle="scaleA" cx={a[0]} cy={a[1]} r={r} stroke-width={2 / s} />
			{#if scaleB}<circle class="fi-handle" data-handle="scaleB" cx={b[0]} cy={b[1]} r={r} stroke-width={2 / s} />{/if}
		{/if}
	{/if}
	{#if origin}
		{@const o = al(origin)}
		<g class="fi-origin">
			<line class="fi-x" x1={o[0]} y1={o[1]} x2={o[0] + 70 / s} y2={o[1]} stroke-width={3 / s} />
			<line class="fi-y" x1={o[0]} y1={o[1]} x2={o[0]} y2={o[1] - 70 / s} stroke-width={3 / s} />
			<text class="fi-x-label" x={o[0] + 76 / s} y={o[1] + 5 / s} font-size={15 / s}>x</text>
			<text class="fi-y-label" x={o[0] - 4 / s} y={o[1] - 78 / s} font-size={15 / s}>y</text>
			<circle class="fi-handle origin" data-handle={step === 2 ? 'origin' : undefined} cx={o[0]} cy={o[1]} r={r * 1.15} stroke-width={2 / s} />
		</g>
	{/if}
{/snippet}

{#snippet planImage(c: CanvasContext | null)}
	<g class="fi-plan-image" transform={imgTransform}>
		<rect class="fi-paper" x="0" y="0" width={widthPx} height={heightPx} />
		<image class={c ? 'fi-image' : 'fi-lens-image'} href={src} x="0" y="0" width={widthPx} height={heightPx} preserveAspectRatio="none" />
	</g>
	{#if c}
		{@const L = c.px * 60}
		<g class="fi-origin">
			<line class="fi-x" x1="0" y1="0" x2={L} y2="0" stroke-width={c.px * 2.5} />
			<line class="fi-y" x1="0" y1="0" x2="0" y2={-L} stroke-width={c.px * 2.5} />
		</g>
		{#if scaleShown && scaleA && scaleB}
			{@const a = pxToDisplay(scaleA)}
			{@const b = pxToDisplay(scaleB)}
			<line class="fi-scale" x1={a[0]} y1={-a[1]} x2={b[0]} y2={-b[1]} stroke-width={c.px * 2.5} stroke-dasharray="{c.px * 8} {c.px * 5}" />
		{/if}
	{/if}
{/snippet}

{#snippet icon(name: string)}
	<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
		{#if name === 'pan'}
			<path d="M7 9V4.5a1.2 1.2 0 012.4 0V9M9.4 8V3.5a1.2 1.2 0 012.4 0V8M11.8 8.5V5a1.2 1.2 0 012.4 0v6c0 3.5-2 6-5.5 6-2.4 0-3.6-1.4-4.6-3.2L3.6 10.6a1.2 1.2 0 012-1.2L7 11" />
		{:else if name === 'rotate'}
			<path d="M3 16h14" /><path d="M3 16L14 6" /><path d="M9 16a6 6 0 00-1.8-4.3" />
		{:else if name === 'straighten'}
			<path d="M3 15L17 5" /><circle cx="3" cy="15" r="1.6" fill="currentColor" /><circle cx="17" cy="5" r="1.6" fill="currentColor" />
		{:else if name === 'left'}
			<path d="M4 10a6 6 0 1 0 2-4.5" /><path d="M5 2v4h4" />
		{:else if name === 'right'}
			<path d="M16 10a6 6 0 1 1-2-4.5" /><path d="M15 2v4h-4" />
		{:else if name === 'eye'}
			<path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z" /><circle cx="10" cy="10" r="2.2" />
		{:else if name === 'eye-off'}
			<path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z" /><path d="M3 17L17 3" />
		{:else}
			<path d="M3 7h14M3 13h14M7 3v14M13 3v14" />
		{/if}
	</svg>
{/snippet}

{#snippet redoNext(redo: () => void, nextLabel: string, onNext: () => void, showRedo = true)}
	<div class="fi-row">
		{#if showRedo}<button type="button" class="fi-b" onclick={redo}>Redo</button>{/if}
		<button type="button" class="fi-b on" onclick={onNext}>{nextLabel}</button>
	</div>
{/snippet}

<Modal
	title="Floor plan from image"
	onClose={requestClose}
	width="min(1300px, 97vw)"
	maxWidth="97vw"
	maxHeight="95vh"
	contentClass="floorplan-import"
	titleFontSize="1rem"
	minimizable={false}
	dockId="floorplan-import"
	onEscapeKey={onEscape}
>
	{#snippet headerExtra()}
		{#if onChangeImage}
			<button type="button" class="fi-b fi-change" disabled={decoding} onclick={requestChange}>{decoding ? 'Reading…' : 'Change image…'}</button>
			<input bind:this={fileEl} class="fi-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,application/pdf,.png,.jpg,.jpeg,.webp,.gif,.svg,.pdf" onchange={onFile} hidden />
		{/if}
	{/snippet}
	{#snippet body()}
		<div class="fi-body">
			<aside class="fi-side">
				{#each STEPS as n (n)}
					{@const value = step === n ? '' : cardValue(n)}
					<div class="fi-card" class:open={step === n} class:done={done(n)}>
						<button type="button" class="fi-ch" aria-expanded={step === n} aria-current={step === n ? 'step' : undefined} onclick={() => cardClick(n)}>
							<span class="fi-n" aria-hidden="true">{done(n) ? '✓' : n}</span>
							<span class="fi-label">{STEP_LABELS[n]}</span>
							{#if value}<span class="fi-v">{value}</span>{/if}
						</button>
						{#if step === n}
							<div class="fi-cb">
								{#if text}<span class="fi-instr" role="status">{text}</span>{/if}
								{#if n === 1}
									{#if aligning}
										{@render redoNext(redoAlign, 'Done', alignDone, Math.abs(rotation - alignFrom) > 1e-9)}
									{:else if aligned}
										{@render redoNext(redoAlign, 'Next', next)}
									{:else}
										<div class="fi-row">
											<button type="button" class="fi-b" onclick={openAlign}>Align axes</button>
											<button type="button" class="fi-b on" onclick={looksGood}>Looks good</button>
										</div>
									{/if}
								{:else if n === 2}
									{#if origin}{@render redoNext(() => { origin = null; markWork(); }, 'Next', next)}{/if}
								{:else if n === 3}
									{#if scaleB}
										<div class="fi-row">
											<input id="fi-distance" class="fi-num" type="number" min="0" step="any" aria-label="Distance" value={distance ?? ''} oninput={setDistance} />
											<select aria-label="Distance units" value={distUnit} onchange={(e) => (distUnit = (e.currentTarget as HTMLSelectElement).value as LengthUnit)}>
												{#each LENGTH_UNITS as u (u)}<option value={u}>{unitAbbrev(u)}</option>{/each}
											</select>
											<button type="button" class="fi-b icon" aria-pressed={!scaleShown} aria-label={scaleShown ? 'Hide the scale line' : 'Show the scale line'} title={scaleShown ? 'Hide the scale line' : 'Show the scale line'} onclick={() => (scaleShown = !scaleShown)}>{@render icon(scaleShown ? 'eye' : 'eye-off')}</button>
										</div>
									{/if}
									{#if scaleA || pxPerM}{@render redoNext(redoScale, 'Next', next)}{/if}
								{:else}
									<div class="fi-choice">
										<button type="button" class="fi-b" class:on={how === 'trace'} aria-pressed={how === 'trace'} onclick={chooseTrace}><span class="fi-gl" aria-hidden="true">✎</span>Trace</button>
										<button type="button" class="fi-b" class:on={how === 'auto'} aria-pressed={how === 'auto'} disabled={detecting} onclick={chooseAuto}><span class="fi-gl" aria-hidden="true">⚡</span>Auto-detect</button>
										{#if currentOutline && initial}
											<button type="button" class="fi-b keep" class:on={how === 'keep'} aria-pressed={how === 'keep'} onclick={chooseKeep}>Keep current outline</button>
										{/if}
									</div>
									{#if draft.length || drawing || how === 'keep'}
										<div class="fi-row"><button type="button" class="fi-b" onclick={redoOutline}>Redo</button></div>
									{/if}
									{#if draft.length >= 3 && !drawing}
										<span class="fi-hdr">Vertices</span>
										<VertexTable vertices={tableRows} unit={unitLabel} precision={tableDecimals} selectedIndex={selV} addLabel="+ Add vertex" roomy oncommit={setVertex} onremove={removeVertex} onadd={addVertex} onselect={(i) => (selV = i)} />
									{/if}
									{#if walls.length && !drawing}
										<button type="button" class="fi-disc" class:open={wallsOpen} aria-expanded={wallsOpen} onclick={() => (wallsOpen = !wallsOpen)}>
											<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 1.5 6.5 5 3 8.5" /></svg>
											Interior walls ({walls.length})
										</button>
										{#if wallsOpen}
											<label class="fi-check"><input type="checkbox" checked={allWallsOn} indeterminate={someWallsOn && !allWallsOn} onchange={toggleAllWalls} />Include interior walls</label>
											<ul class="fi-walls" aria-label="Interior walls">
												{#each walls as w, i (w.id)}
													<li class="fi-wrow" class:hot={i === hoverWall} onpointerenter={() => (hoverWall = i)} onpointerleave={() => (hoverWall = -1)}>
														<label class="fi-check"><input type="checkbox" checked={w.on} onchange={() => toggleWall(i)} />Wall {i + 1}</label>
														<span class="fi-wdim">{wallDims(w)}</span>
														<button type="button" class="fi-del" title="Delete" aria-label="Delete wall {i + 1}" onclick={() => removeWall(i)}>✕</button>
													</li>
												{/each}
											</ul>
										{/if}
									{/if}
								{/if}
							</div>
						{/if}
					</div>
				{/each}
			</aside>
			<div class="fi-stagewrap" bind:this={wrapEl}>
				{#if onCanvas}
					<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
					<div
						class="fi-canvas"
						class:panning={tool === 'pan'}
						onpointerdowncapture={onCanvasDownCapture}
						onpointermove={onCanvasMove}
						onpointerup={onCanvasUp}
						onpointercancel={onCanvasUp}
						onpointerleave={() => { cursor = null; lensRoom = null; }}
						onclickcapture={onCanvasClickCapture}
					>
						<PlanCanvas
							bind:this={canvas}
							bind:draft
							bind:drawing
							bind:selectedIndex={selV}
							bind:tool={canvasTool}
							{units}
							{precision}
							allowNegative
							navControls={false}
							fitCentre
							showGrid={guides}
							fallbackFit={imageCornersDisplay}
							extraFitPoints={imageCornersDisplay}
							ariaLabel="Outline canvas"
							toolCursor={picking ? 'crosshair' : null}
							onCustomClick={onPickClick}
							{onDrawEnd}
							onEdit={edited}
						>
							{#snippet underlay(c)}{@render planImage(c)}{/snippet}
							{#snippet overlay(c)}
								{#each walls as w, i (w.id)}
									<polygon class="fi-iwall" class:off={!w.on} class:hot={i === hoverWall} class:inert={drawing || picking} points={wallRect(w)} stroke-width={c.px * (i === hoverWall ? 3.5 : 2)} stroke-dasharray={w.on ? undefined : `${c.px * 6} ${c.px * 4}`} role="button" tabindex="-1" aria-label="Wall {i + 1}" aria-pressed={w.on} onpointerdown={(e) => wallDown(e, i)} onpointerenter={() => (hoverWall = i)} onpointerleave={() => (hoverWall = -1)} />
								{/each}
							{/snippet}
							{#snippet hud(c)}
								{#if canvasLens && lensRoom && cursor && c.px > imgUnit / 0.95}
									{@const u = imgUnit}
									<div class="fi-lens" style="left: {lensPos.left}px; top: {lensPos.top}px; width: {LENS}px; height: {LENS}px" aria-hidden="true">
										<svg width={LENS} height={LENS} viewBox="{lensRoom[0] - (LENS / 2) * u} {-lensRoom[1] - (LENS / 2) * u} {LENS * u} {LENS * u}">
											{@render planImage(null)}
											{#if draft.length >= 2}<polyline class="fi-outline" points={svgPts(draft)} stroke-width={u * 2} />{/if}
										</svg>
										<span class="fi-cross h"></span><span class="fi-cross v"></span>
									</div>
								{/if}
							{/snippet}
						</PlanCanvas>
					</div>
				{:else}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="fi-stage"
						class:placing
						class:panning={tool === 'pan' || drag?.kind === 'pan'}
						class:rotating={step === 1 && aligning && tool === 'rotate'}
						bind:this={stageEl}
						onpointerdown={onDown}
						onpointermove={onMove}
						onpointerup={onUp}
						onpointercancel={onUp}
						onpointerleave={onLeave}
					>
						<svg class="fi-svg" width={sw} height={sh} data-rotation={rotation} aria-label="Floor plan image" role="img">
							<g transform="translate({tx} {ty}) scale({z})">{@render imageLayer(false)}</g>
							{#if guides}
								<g class="fi-grid" class:strong={strongGuides}>
									{#each gridLines.xs as x, i (i)}<line x1={x} y1="0" x2={x} y2={sh} class:major={i % 5 === 2} />{/each}
									{#each gridLines.ys as y, i (i)}<line x1="0" y1={y} x2={sw} y2={y} class:major={i % 5 === 2} />{/each}
								</g>
							{/if}
							<g transform="translate({tx} {ty}) scale({z})">{@render overlays(z)}</g>
						</svg>
					</div>
					{#if lensOn && cursor}
						<div class="fi-lens" style="left: {lensPos.left}px; top: {lensPos.top}px; width: {LENS}px; height: {LENS}px" aria-hidden="true">
							<svg width={LENS} height={LENS} viewBox={lensView}>
								{@render imageLayer(true)}
								{@render overlays(1)}
							</svg>
							<span class="fi-cross h"></span><span class="fi-cross v"></span>
						</div>
					{/if}
					{#if angleLabel}
						<span class="fi-angle" style="left: {angleLabel.at[0] + 14}px; top: {angleLabel.at[1] - 28}px">{angleLabel.text}</span>
					{/if}
				{/if}
				<div class="fi-tools">
					<div class="fi-seg">
						<button type="button" class="fi-b icon" class:on={tool === 'pan'} aria-pressed={tool === 'pan'} title="Pan" aria-label="Pan" onclick={() => pickTool('pan')}>{@render icon('pan')}</button>
						{#if step === 1 && aligning}
							<button type="button" class="fi-b icon" class:on={tool === 'rotate'} aria-pressed={tool === 'rotate'} title="Rotate" aria-label="Rotate" onclick={() => pickTool('rotate')}>{@render icon('rotate')}</button>
							<button type="button" class="fi-b icon" class:on={tool === 'straighten'} aria-pressed={tool === 'straighten'} title="Straighten" aria-label="Straighten" onclick={() => pickTool('straighten')}>{@render icon('straighten')}</button>
						{/if}
					</div>
					{#if step === 1 && aligning}
						<div class="fi-seg">
							<button type="button" class="fi-b" title="Rotate 90° left" aria-label="Rotate 90° left" onclick={() => turn90(-1)}>{@render icon('left')}90°</button>
							<button type="button" class="fi-b" title="Rotate 90° right" aria-label="Rotate 90° right" onclick={() => turn90(1)}>{@render icon('right')}90°</button>
						</div>
					{/if}
					<div class="fi-seg">
						<button type="button" class="fi-b icon" class:on={guides} aria-pressed={guides} title="Guidelines" aria-label="Guidelines" onclick={() => (guides = !guides)}>{@render icon('guides')}</button>
					</div>
				</div>
				<div class="fi-zoom fi-seg">
					<button type="button" class="fi-b" class:on={!onCanvas && Math.abs(z - 1) < 1e-6} title="Full resolution" onclick={fullSize}>100%</button>
					<button type="button" class="fi-b" title="Fit to window" onclick={fit}>Fit</button>
				</div>
				{#if onUnitsChange}
					<div class="fi-units"><UnitsSelect {units} onchange={onUnitsChange} /></div>
				{/if}
				{#if popup}
					<div class="fi-pop" bind:this={popupEl} style="left: {popup[0]}px; top: {popup[1]}px" role="group" aria-label="Scale distance">
						<input bind:this={popupInput} class="fi-num" type="number" min="0" step="any" aria-label="Distance between the points" value={distance ?? ''} oninput={setDistance} onkeydown={popupKey} />
						<select aria-label="Distance units" value={distUnit} onchange={(e) => (distUnit = (e.currentTarget as HTMLSelectElement).value as LengthUnit)} onkeydown={popupKey}>
							{#each LENGTH_UNITS as u (u)}<option value={u}>{unitAbbrev(u)}</option>{/each}
						</select>
						<button type="button" class="fi-b on" onclick={closePopup}>OK</button>
					</div>
				{/if}
				{#if notice}
					<div class="fi-notice" role="alert">{notice}</div>
				{/if}
			</div>
			{#if need}
				<div class="fi-need-back">
					<div class="fi-need" role="alertdialog" aria-modal="true" aria-labelledby="fi-need-title">
						<b id="fi-need-title">{need.title}</b>
						<span>{need.body}</span>
						<div class="fi-need-row"><button type="button" class="fi-b on" onclick={needOk}>OK</button></div>
					</div>
				</div>
			{/if}
			{#if detectAsk}
				<div class="fi-need-back">
					<div class="fi-need" role="alertdialog" aria-labelledby="fi-detect-title">
						<b id="fi-detect-title">Detect the outline of…</b>
						<div class="fi-choice">
							<button type="button" class="fi-b" onclick={detectOneRoom}><span class="fi-gl" aria-hidden="true">▢</span>One room</button>
							<button type="button" class="fi-b" onclick={detectWholeSpace}><span class="fi-gl" aria-hidden="true">▣</span>Whole space</button>
						</div>
						<div class="fi-need-row"><button type="button" class="fi-b" onclick={() => (detectAsk = false)}>Cancel</button></div>
					</div>
				</div>
			{/if}
		</div>
	{/snippet}
	{#snippet footer()}
		<div class="fi-foot">
			<button type="button" class="fi-back" disabled={step === 1} onclick={back}>← Back</button>
			<button type="button" class="fi-next" onclick={next}>{step === 4 ? 'Create room' : 'Next →'}</button>
		</div>
	{/snippet}
</Modal>

{#if confirmClose}
	<ConfirmDialog
		title="Discard this floor plan?"
		message="The alignment, origin, scale and outline set here will be lost."
		confirmLabel="Discard"
		cancelLabel="Keep editing"
		onConfirm={() => { confirmClose = false; onClose(); }}
		onCancel={() => (confirmClose = false)}
	/>
{/if}
{#if confirmChange}
	<ConfirmDialog
		title="Start over with a new image?"
		message="The alignment, origin, scale and outline set here will be lost."
		confirmLabel="Choose image"
		cancelLabel="Keep editing"
		variant="warning"
		onConfirm={() => { confirmChange = false; fileEl?.click(); }}
		onCancel={() => (confirmChange = false)}
	/>
{/if}

<style>
	:global(.modal-content.floorplan-import) {
		height: min(840px, 95vh);
	}
	.fi-body {
		position: relative;
		display: grid;
		grid-template-columns: 290px minmax(0, 1fr);
		height: 100%;
		min-height: 0;
	}
	.fi-side {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 10px;
		background: var(--color-bg-secondary);
		border-right: 1px solid var(--color-border);
		overflow: auto;
		min-height: 0;
	}
	.fi-card {
		flex: none;
		border-radius: 8px;
		background: var(--color-btn-fill);
		overflow: hidden;
	}
	/* The open card keeps the closed cards' fill; the blue ring marks it */
	.fi-card.open {
		box-shadow: inset 0 0 0 1.5px var(--color-highlight);
	}
	/* Secondary buttons in a card take the stronger fill, off the card's own */
	.fi-card .fi-b:not(.on),
	.fi-card .fi-del {
		background: var(--color-btn-fill-raised);
	}
	.fi-card .fi-b:not(.on):hover:not(:disabled),
	.fi-card .fi-del:hover {
		background: var(--color-btn-fill-raised-hover);
	}
	.fi-ch {
		display: flex;
		gap: 12px;
		align-items: center;
		min-height: 46px;
		width: 100%;
		padding: 6px 12px;
		border: 0;
		background: none;
		color: var(--color-text);
		font-size: 15px;
		font-weight: 400;
		text-align: left;
		cursor: pointer;
	}
	.fi-ch:hover {
		background: var(--color-btn-fill-hover);
	}
	.fi-card.open .fi-ch:hover {
		background: transparent;
	}
	.fi-n {
		flex: none;
		width: 24px;
		height: 24px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		border: 1.5px solid var(--color-text-muted);
		font-size: 13px;
	}
	.fi-card.done .fi-n {
		background: var(--color-success);
		border-color: var(--color-success);
		color: var(--color-bg);
		font-weight: 700;
	}
	.fi-v {
		margin-left: auto;
		color: var(--color-text-muted);
		font-size: 13px;
	}
	.fi-cb {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 4px 12px 14px;
	}
	.fi-instr {
		font-size: 14px;
		line-height: 1.4;
		color: var(--color-text);
	}
	.fi-hdr {
		font-size: 13px;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		margin-top: 4px;
	}
	.fi-row {
		display: flex;
		gap: 6px;
		align-items: center;
	}
	.fi-num {
		width: 84px;
	}
	.fi-row select,
	.fi-pop select {
		width: 64px;
	}
	.fi-choice {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px;
	}
	.fi-choice .fi-b {
		height: auto;
		padding: 10px 6px;
		flex-direction: column;
		gap: 4px;
	}
	.fi-gl {
		font-size: 22px;
		line-height: 1;
	}
	.fi-choice .keep {
		grid-column: 1 / -1;
		flex-direction: row;
	}
	.fi-b {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		height: 32px;
		padding: 0 12px;
		border: 0;
		border-radius: 6px;
		background: var(--color-btn-fill);
		color: var(--color-text);
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
	}
	.fi-b:hover:not(:disabled) {
		background: var(--color-btn-fill-hover);
	}
	.fi-b:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.fi-b.on,
	.fi-b.on:hover:not(:disabled) {
		background: var(--color-highlight);
		color: var(--color-on-highlight);
	}
	.fi-b.icon {
		width: 36px;
		padding: 0;
	}
	.fi-change {
		margin-right: 8px;
	}
	.fi-seg {
		display: inline-flex;
		border-radius: 6px;
		overflow: hidden;
	}
	.fi-seg .fi-b {
		border-radius: 0;
	}
	.fi-seg .fi-b + .fi-b {
		border-left: 1px solid var(--color-border);
	}
	.fi-stagewrap {
		position: relative;
		overflow: hidden;
		min-width: 0;
		min-height: 0;
	}
	.fi-stage,
	.fi-canvas {
		position: absolute;
		inset: 0;
		overflow: hidden;
	}
	.fi-canvas {
		display: flex;
	}
	.fi-canvas.panning {
		cursor: grab;
	}
	/* The plan canvas's labels read over the image */
	.fi-canvas :global(text.edge-label),
	.fi-canvas :global(text.vertex-label),
	.fi-canvas :global(text.cursor-label) {
		paint-order: stroke;
		stroke: var(--color-bg);
		stroke-width: 0.2em;
		stroke-linejoin: round;
	}
	.fi-stage {
		background: color-mix(in srgb, var(--color-bg) 55%, #000);
		touch-action: none;
		cursor: default;
	}
	.fi-stage.placing {
		cursor: crosshair;
	}
	.fi-stage.rotating,
	.fi-stage.panning {
		cursor: grab;
	}
	.fi-svg {
		display: block;
		user-select: none;
	}
	.fi-paper {
		fill: #fff;
	}
	.fi-plan-image {
		opacity: 0.8;
		pointer-events: none;
	}
	.fi-grid line {
		stroke: var(--color-highlight);
		stroke-opacity: 0.22;
		stroke-width: 1;
		pointer-events: none;
	}
	.fi-grid line.major {
		stroke-opacity: 0.4;
	}
	.fi-grid.strong line {
		stroke-opacity: 0.5;
	}
	.fi-grid.strong line.major {
		stroke-opacity: 0.75;
	}
	.fi-handle {
		fill: #fff;
		stroke: var(--color-scene-selected);
		cursor: grab;
	}
	.fi-handle.origin {
		stroke: #e5384f;
	}
	.fi-wall {
		stroke: var(--color-highlight);
	}
	.fi-scale {
		stroke: #f0a020;
		pointer-events: none;
	}
	.fi-scale-label {
		fill: #f0a020;
		font-weight: 700;
		paint-order: stroke;
		stroke: rgba(0, 0, 0, 0.6);
		stroke-width: 0.15em;
	}
	.fi-origin {
		pointer-events: none;
	}
	.fi-origin .fi-handle {
		pointer-events: auto;
	}
	.fi-x {
		stroke: #e5384f;
	}
	.fi-y {
		stroke: #3fbf6f;
	}
	.fi-x-label {
		fill: #e5384f;
		font-weight: 700;
	}
	.fi-y-label {
		fill: #3fbf6f;
		font-weight: 700;
	}
	.fi-outline {
		fill: none;
		stroke: var(--color-scene-selected);
		pointer-events: none;
	}
	.fi-iwall {
		fill: color-mix(in srgb, var(--color-scene-selected) 22%, transparent);
		stroke: var(--color-scene-selected);
		cursor: pointer;
	}
	.fi-iwall.off {
		fill: transparent;
		stroke: var(--color-text-muted);
	}
	.fi-iwall.hot {
		fill: color-mix(in srgb, var(--color-scene-selected) 50%, transparent);
	}
	.fi-iwall.inert {
		pointer-events: none;
	}
	.fi-disc {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 4px;
		padding: 4px 0;
		border: 0;
		background: none;
		color: var(--color-text);
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		text-align: left;
	}
	.fi-disc svg {
		transition: transform 0.15s;
	}
	.fi-disc.open svg {
		transform: rotate(90deg);
	}
	.fi-check {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		color: var(--color-text);
		cursor: pointer;
	}
	.fi-walls {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.fi-wrow {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 8px;
		padding: 2px 4px;
		border-radius: 4px;
	}
	.fi-wrow.hot {
		background: color-mix(in srgb, var(--color-scene-selected) 16%, transparent);
	}
	.fi-wdim {
		font-size: 13px;
		color: var(--color-text-muted);
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.fi-del {
		width: 24px;
		height: 24px;
		padding: 0;
		border: 0;
		border-radius: 4px;
		background: var(--color-btn-fill);
		color: var(--color-text);
		cursor: pointer;
	}
	.fi-del:hover {
		background: var(--color-btn-fill-hover);
	}
	.fi-tools {
		position: absolute;
		left: 10px;
		top: 10px;
		display: flex;
		gap: 8px;
		z-index: 5;
	}
	.fi-zoom {
		position: absolute;
		right: 10px;
		top: 10px;
		z-index: 5;
	}
	.fi-units {
		position: absolute;
		right: 10px;
		bottom: 10px;
		z-index: 5;
	}
	.fi-pop {
		position: absolute;
		z-index: 6;
		display: flex;
		gap: 6px;
		align-items: center;
		padding: 8px;
		border: 1.5px solid var(--color-highlight);
		border-radius: 8px;
		background: var(--color-bg-secondary);
		box-shadow: 0 8px 22px rgba(0, 0, 0, 0.45);
	}
	.fi-notice {
		position: absolute;
		left: 50%;
		bottom: 56px;
		transform: translateX(-50%);
		z-index: 6;
		padding: 8px 14px;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: var(--color-bg);
		color: var(--color-text);
		font-size: 14px;
		box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
		pointer-events: none;
	}
	.fi-lens {
		position: absolute;
		z-index: 4;
		border-radius: 50%;
		overflow: hidden;
		border: 2px solid var(--color-highlight);
		box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
		background: #fff;
		pointer-events: none;
	}
	.fi-lens svg {
		display: block;
	}
	.fi-lens .fi-plan-image {
		opacity: 1;
	}
	.fi-cross {
		position: absolute;
		background: #e5384f;
	}
	.fi-cross.h {
		left: 0;
		right: 0;
		top: 50%;
		height: 1px;
	}
	.fi-cross.v {
		top: 0;
		bottom: 0;
		left: 50%;
		width: 1px;
	}
	.fi-angle {
		position: absolute;
		z-index: 4;
		padding: 2px 6px;
		border-radius: 4px;
		background: var(--color-bg);
		color: var(--color-text);
		font-weight: 700;
		font-size: 13px;
		pointer-events: none;
	}
	.fi-need-back {
		position: absolute;
		inset: 0;
		z-index: 10;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(3, 6, 16, 0.55);
	}
	.fi-need {
		display: flex;
		flex-direction: column;
		gap: 12px;
		min-width: 320px;
		max-width: 380px;
		padding: 18px 20px;
		border: 2px solid var(--color-highlight);
		border-radius: 10px;
		background: var(--color-bg-secondary);
		color: var(--color-text);
		font-size: 14px;
	}
	.fi-need b {
		font-size: 16px;
	}
	.fi-need .fi-choice .fi-b {
		padding: 14px 8px;
	}
	.fi-need-row {
		display: flex;
		justify-content: flex-end;
	}
	.fi-foot {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 10px 16px;
		background: var(--color-bg-secondary);
		border-top: 1px solid var(--color-border);
	}
	.fi-back,
	.fi-next {
		height: 40px;
		padding: 0 22px;
		font-size: 15px;
		font-weight: 600;
		border-radius: 6px;
		cursor: pointer;
	}
	.fi-back {
		background: transparent;
		border: 2px solid var(--color-text-muted);
		color: var(--color-text);
	}
	.fi-back:hover:not(:disabled) {
		background: var(--color-btn-fill);
	}
	.fi-back:disabled {
		opacity: 0.3;
		cursor: default;
	}
	.fi-next {
		height: 44px;
		padding: 0 28px;
		background: var(--color-primary);
		color: #fff;
		border: 0;
	}
	.fi-next:hover {
		background: var(--color-primary-hover);
	}

	/* Phone: the image on top, the steps below it; bigger handles come from the coarse pointer */
	@media (max-width: 767px) {
		:global(.modal-content.floorplan-import) {
			height: 100dvh;
		}
		.fi-body {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: minmax(0, 1.3fr) minmax(0, 1fr);
		}
		.fi-side {
			order: 2;
			border-right: 0;
			border-top: 1px solid var(--color-border);
		}
		.fi-tools {
			flex-wrap: wrap;
			right: 10px;
		}
		.fi-zoom {
			top: auto;
			bottom: 10px;
			right: auto;
			left: 10px;
		}
	}
</style>
