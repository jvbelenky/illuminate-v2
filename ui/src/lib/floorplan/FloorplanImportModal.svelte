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
	// The floor plan import window: steps on the left (Align axes, Set origin,
	// Set scale, Trace outline) under a fixed instruction box, the image on the
	// right with its tools over its top-left corner, Back and Next below.
	// Points live in IMAGE pixels; the view shows the ALIGNED frame (the image
	// turned by `rotation` about its centre). See importFrame.ts.
	import { onMount, tick, untrack } from 'svelte';
	import Modal from '$lib/components/Modal.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import VertexTable from '$lib/components/VertexTable.svelte';
	import {
		alignedBounds, fromAligned, metersToPixel, normalizeDeg, pixelToMeters, pxPerMeter,
		snapRotation, straightenRotation, toAligned,
	} from './importFrame';
	import { guideMessage, moveNext, moveTo, NEED_TEXT, STEP_LABELS, type AlignTool, type ImportStep, type StepFacts } from './importSteps';
	import { detectPlanAsync } from './detectClient';
	import { LENGTH_UNITS, fromMeters, toMeters, unitAbbrev, unitDecimals, type LengthUnit } from '$lib/utils/unitConversion';
	import { validatePolygon } from '$lib/utils/roomGeometry';

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
		onApply: (result: FloorplanImportResult) => void;
		onClose: () => void;
	}

	let { src, widthPx, heightPx, units, precision, initial = null, currentOutline = null, onApply, onClose }: Props = $props();

	const STEPS: ImportStep[] = [1, 2, 3, 4];
	// The window starts from these; later prop changes do not restart it
	const start = untrack(() => ({ initial, units, centre: [widthPx / 2, heightPx / 2] as Pt }));

	// --- The work
	let step = $state<ImportStep>(1);
	let rotation = $state(start.initial?.rotation ?? 0);
	let aligned = $state(!!start.initial);
	let tool = $state<AlignTool>('straighten');
	let guides = $state(true);
	let wall = $state<Pt[]>([]);
	let origin = $state<Pt | null>(start.initial?.origin ?? null);
	let scaleA = $state<Pt | null>(null);
	let scaleB = $state<Pt | null>(null);
	let distance = $state<number | null>(null);
	let distUnit = $state<LengthUnit>(start.units);
	const keptScale = start.initial?.pxPerM ?? null;
	let how = $state<'trace' | 'auto' | 'keep' | null>(null);
	let autoMode = $state<'room' | 'floor'>('room');
	let outline = $state<Pt[]>([]);
	let tracing = $state(false);
	let detected = $state<'found' | 'none' | null>(null);
	let detecting = $state(false);
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

	const measuredScale = $derived(scaleA && scaleB && distance ? pxPerMeter(scaleA, scaleB, toMeters(distance, distUnit)) : null);
	const pxPerM = $derived(measuredScale ?? (scaleA || scaleB ? null : keptScale));
	const frame = $derived<ImportFrame>({ widthPx, heightPx, rotation, origin, pxPerM });
	const ready = $derived(!!origin && !!pxPerM);
	/** Kept outline (unedited) follows the frame; otherwise the points placed. */
	const shownOutline = $derived<Pt[]>(how === 'keep' && currentOutline && ready ? currentOutline.map((m) => metersToPixel(frame, m)) : outline);
	const outlineMeters = $derived<Pt[]>(ready ? shownOutline.map((p) => pixelToMeters(frame, p)) : []);
	const outlineValid = $derived.by(() => {
		if (tracing || outlineMeters.length < 3) return false;
		const minX = Math.min(...outlineMeters.map((p) => p[0]));
		const minY = Math.min(...outlineMeters.map((p) => p[1]));
		return validatePolygon(outlineMeters.map(([x, y]) => [x - minX, y - minY] as Pt)) === null;
	});
	const facts = $derived<StepFacts>({ aligned, origin: !!origin, scale: !!pxPerM, outline: outlineValid });
	const done = (n: ImportStep) => (n === 1 ? facts.aligned : n === 2 ? facts.origin : n === 3 ? facts.scale : facts.outline);
	const message = $derived(guideMessage({
		step, tool, wallPoints: wall.length, origin: !!origin, scaleA: !!scaleA, scaleB: !!scaleB,
		how, tracing, detected, detecting,
	}));
	const unitLabel = $derived(unitAbbrev(units));
	// The table shows the project's precision (at least the unit's own decimals)
	const tableDecimals = $derived(Math.max(precision, unitDecimals(units)));
	const roundShown = (v: number) => Math.round(v * 10 ** tableDecimals) / 10 ** tableDecimals;
	const tableRows = $derived(outlineMeters.map(([x, y]) => [roundShown(fromMeters(x, units)), roundShown(fromMeters(y, units))] as [number, number]));
	const allWallsOn = $derived(walls.length > 0 && walls.every((w) => w.on));
	const someWallsOn = $derived(walls.some((w) => w.on));
	/** "length × thickness unit" in the project's units. */
	function wallDims(w: IWall): string {
		if (!pxPerM) return '';
		const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) / pxPerM;
		return `${roundShown(fromMeters(len, units))} × ${roundShown(fromMeters(w.thickness / pxPerM, units))} ${unitLabel}`;
	}
	function toggleWall(i: number) {
		walls = walls.map((w, k) => (k === i ? { ...w, on: !w.on } : w));
		markWork();
	}
	function toggleAllWalls() {
		const on = !allWallsOn;
		walls = walls.map((w) => ({ ...w, on }));
		markWork();
	}
	function removeWall(i: number) {
		walls = walls.filter((_, k) => k !== i);
		hoverWall = -1;
		markWork();
	}
	/** A wall's rectangle in the aligned frame. */
	function wallRect(w: IWall): string {
		const a = al(w.a), b = al(w.b);
		const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
		const nx = (-(b[1] - a[1]) / len) * (w.thickness / 2), ny = ((b[0] - a[0]) / len) * (w.thickness / 2);
		return [[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]].map((p) => `${p[0]},${p[1]}`).join(' ');
	}

	function markWork() {
		worked = true;
	}

	// --- The view: screen = aligned * z + (tx, ty)
	let stageEl = $state<HTMLDivElement | undefined>(undefined);
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
		if (!sw || !sh) return;
		const b = alignedBounds(frame);
		const pad = 24;
		z = Math.max(0.02, Math.min((sw - 2 * pad) / b.width, (sh - 2 * pad) / b.height));
		tx = (sw - b.width * z) / 2 - b.x * z;
		ty = (sh - b.height * z) / 2 - b.y * z;
	}
	function fullSize() {
		zoomAbout([sw / 2, sh / 2], 1);
	}
	function zoomAbout(p: Pt, nz: number) {
		nz = Math.max(0.02, Math.min(16, nz));
		const q: Pt = [(p[0] - tx) / z, (p[1] - ty) / z];
		z = nz;
		tx = p[0] - q[0] * z;
		ty = p[1] - q[1] * z;
	}

	onMount(() => {
		if (!stageEl) return;
		const ro = new ResizeObserver(() => {
			if (!stageEl) return;
			const r = stageEl.getBoundingClientRect();
			sw = r.width;
			sh = r.height;
			if (!fitted && sw > 0 && sh > 0) {
				fitted = true;
				fit();
			}
		});
		ro.observe(stageEl);
		// Wheel zoom about the cursor (a non-passive listener, so the page does not scroll)
		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			const p = local(e);
			zoomAbout(p, z * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
		};
		stageEl.addEventListener('wheel', onWheel, { passive: false });
		return () => {
			ro.disconnect();
			stageEl?.removeEventListener('wheel', onWheel);
		};
	});

	function local(e: { clientX: number; clientY: number }): Pt {
		const r = stageEl!.getBoundingClientRect();
		return [e.clientX - r.left, e.clientY - r.top];
	}
	function toView(p: Pt): Pt {
		return [(p[0] - tx) / z, (p[1] - ty) / z];
	}
	function al(p: Pt): Pt {
		return toAligned(frame, p);
	}

	// --- Pointer work
	type Drag =
		| { kind: 'pan'; p0: Pt; t0: Pt }
		| { kind: 'rotate'; a0: number; r0: number }
		| { kind: 'handle'; which: 'origin' | 'scaleA' | 'scaleB' | 'wall0' | 'wall1' | number };
	let drag = $state<Drag | null>(null);
	let cursor = $state<Pt | null>(null);
	let angleLabel = $state<{ at: Pt; text: string } | null>(null);
	const pointers = new Map<number, Pt>();
	let pinch: { d0: number; q0: Pt; z0: number } | null = null;

	const placing = $derived(
		drag?.kind === 'handle' ||
		(tool !== 'pan' && ((step === 1 && tool === 'straighten') || step === 2 || step === 3 || (step === 4 && (tracing || (how === 'auto' && autoMode === 'room'))))),
	);
	// The lens shows the image at 100% wherever the view shows it smaller
	const lensOn = $derived(placing && !!cursor && z < 0.95 && !pinch);

	function handleOf(e: PointerEvent): string | null {
		const el = (e.target as Element | null)?.closest?.('[data-handle]');
		return el ? el.getAttribute('data-handle') : null;
	}

	function onDown(e: PointerEvent) {
		if (!stageEl || detecting) return;
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
		if (step === 4 && tracing) {
			const first = shownOutline[0];
			const near = first && Math.hypot(...sub(al(first), toView(p))) * z < (coarse ? 22 : 12);
			if (shownOutline.length >= 3 && (h === 'v0' || near)) {
				tracing = false;
				selV = -1;
			} else outline = [...outline, img];
			markWork();
			return;
		}
		if (h?.startsWith('w')) {
			toggleWall(Number(h.slice(1)));
			return;
		}
		if (h) {
			const which = h.startsWith('v') ? Number(h.slice(1)) : (h as 'origin' | 'scaleA' | 'scaleB' | 'wall0' | 'wall1');
			if (typeof which === 'number') {
				if (how === 'keep') materializeKept();
				selV = which;
			}
			drag = { kind: 'handle', which };
			return;
		}
		if (step === 1) {
			if (tool === 'rotate') {
				drag = { kind: 'rotate', a0: screenAngle(p), r0: rotation };
				return;
			}
			if (tool === 'straighten') {
				wall = [...wall, img];
				if (wall.length === 2) {
					rotation = straightenRotation(wall[0], wall[1], rotation);
					wall = [];
					aligned = true;
					tool = null;
					fit();
				}
				markWork();
				return;
			}
			drag = { kind: 'pan', p0: p, t0: [tx, ty] };
			return;
		}
		if (step === 2) {
			origin = img;
			markWork();
			drag = { kind: 'handle', which: 'origin' };
			return;
		}
		if (step === 3) {
			if (!scaleA || scaleB) {
				scaleA = img;
				scaleB = null;
				drag = null;
			} else {
				scaleB = img;
				drag = { kind: 'handle', which: 'scaleB' };
			}
			markWork();
			return;
		}
		if (step === 4 && how === 'auto' && autoMode === 'room') {
			void runDetect(img);
			return;
		}
		selV = -1;
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
		else if (d.which === 'scaleB') scaleB = img;
		else if (typeof d.which === 'number') outline = outline.map((q, i) => (i === d.which ? img : q));
	}

	function onUp(e: PointerEvent) {
		pointers.delete(e.pointerId);
		if (pinch) {
			if (pointers.size < 2) pinch = null;
			return;
		}
		drag = null;
		angleLabel = null;
		if (e.pointerType !== 'mouse') cursor = null;
	}

	function onLeave(e: PointerEvent) {
		if (e.pointerType === 'mouse' && !drag) cursor = null;
	}

	function sub(a: Pt, b: Pt): [number, number] {
		return [a[0] - b[0], a[1] - b[1]];
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

	// --- Steps
	function go(to: ImportStep) {
		step = to;
		tool = to === 1 ? 'straighten' : null;
		wall = [];
		drag = null;
		if (to !== 4 && tracing) tracing = false;
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
	function alreadyAligned() {
		aligned = true;
		markWork();
		go(2);
	}
	function needOk() {
		const s = need?.step;
		need = null;
		if (s) go(s);
	}

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
		if (confirmClose) {
			confirmClose = false;
			return true;
		}
		if (tracing && outline.length) {
			outline = [];
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

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Backspace' && step === 4 && tracing && outline.length && !(e.target as Element)?.closest?.('input, select, textarea')) {
			e.preventDefault();
			outline = outline.slice(0, -1);
		}
	}

	// --- Step 4
	function chooseTrace() {
		detectToken++;
		detecting = false;
		walls = [];
		how = 'trace';
		outline = [];
		tracing = true;
		detected = null;
		selV = -1;
		markWork();
	}
	function chooseAuto() {
		detectToken++;
		detecting = false;
		walls = [];
		how = 'auto';
		autoMode = 'room';
		outline = [];
		tracing = false;
		detected = null;
		selV = -1;
		markWork();
	}
	function chooseKeep() {
		detectToken++;
		detecting = false;
		walls = [];
		how = 'keep';
		outline = [];
		tracing = false;
		detected = null;
		selV = -1;
	}
	function wholeFloor() {
		autoMode = 'floor';
		void runDetect(null);
	}
	/** Kept outline edited: from here on it is ordinary points. */
	function materializeKept() {
		if (how !== 'keep') return;
		outline = shownOutline.map((p) => [p[0], p[1]] as Pt);
		how = 'trace';
		tracing = false;
		markWork();
	}
	function setVertex(i: number, axis: 0 | 1, value: number) {
		materializeKept();
		const m = pixelToMeters(frame, outline[i]);
		m[axis] = toMeters(value, units);
		outline = outline.map((q, k) => (k === i ? metersToPixel(frame, m) : q));
		selV = i;
		markWork();
	}
	function removeVertex(i: number) {
		materializeKept();
		if (outline.length <= 3) return;
		outline = outline.filter((_, k) => k !== i);
		selV = -1;
		markWork();
	}
	function addVertex() {
		materializeKept();
		const o = outline;
		if (o.length < 2) return;
		const i = selV >= 0 ? selV : o.length - 1;
		const a = o[i], b = o[(i + 1) % o.length];
		outline = [...o.slice(0, i + 1), [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], ...o.slice(i + 1)];
		selV = i + 1;
		markWork();
	}

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

	/** Auto-detect on the aligned image: a room around `seed` (image pixels), or the whole floor. */
	async function runDetect(seed: Pt | null) {
		if (!pxPerM) return;
		const token = ++detectToken;
		detecting = true;
		selV = -1;
		markWork();
		await tick();
		await new Promise((r) => requestAnimationFrame(() => r(null)));
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
			// Trace, Keep or a newer detection took over meanwhile
			if (token !== detectToken) return;
			const back = (p: Pt): Pt => fromAligned(frame, [p[0] / f + b.x, p[1] / f + b.y]);
			if (result.outline && result.outline.length >= 3) {
				outline = result.outline.map(back);
				walls = result.walls.map((s, i) => ({ id: i, a: back(s.a), b: back(s.b), thickness: s.thickness / f, on: true }));
				detected = 'found';
			} else {
				outline = [];
				walls = [];
				detected = 'none';
			}
		} catch {
			if (token !== detectToken) return;
			outline = [];
			walls = [];
			detected = 'none';
		} finally {
			if (token === detectToken) detecting = false;
		}
	}

	// --- Drawing helpers
	const pts = (list: Pt[]) => list.map((p) => { const q = al(p); return `${q[0]},${q[1]}`; }).join(' ');
	const LENS = 150;
	const lensPos = $derived.by(() => {
		if (!cursor) return { left: 0, top: 0 };
		let left = cursor[0] + 24;
		let top = cursor[1] - LENS - 24;
		if (top < 4) top = cursor[1] + 24;
		if (left + LENS > sw - 4) left = cursor[0] - 24 - LENS;
		return { left, top };
	});
	const lensView = $derived.by(() => {
		if (!cursor) return '0 0 1 1';
		const q = toView(cursor);
		return `${q[0] - LENS / 2} ${q[1] - LENS / 2} ${LENS} ${LENS}`;
	});
	const strongGuides = $derived(step === 1 && (tool === 'rotate' || tool === 'straighten' || drag?.kind === 'rotate'));
	const gridLines = $derived.by(() => {
		const step = 48;
		const xs: number[] = [], ys: number[] = [];
		for (let x = step / 2; x < sw; x += step) xs.push(x);
		for (let y = step / 2; y < sh; y += step) ys.push(y);
		return { xs, ys };
	});
	const scaleText = $derived(pxPerM ? `${Math.round(pxPerM)} px/m` : '');
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
	{#if scaleA && (step === 3 || scaleB)}
		{@const a = al(scaleA)}
		{@const b = scaleB ? al(scaleB) : step === 3 && cursor && !drag && !coarse ? toView(cursor) : a}
		<line class="fi-scale" class:dashed={step !== 3} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke-width={3 / s} stroke-dasharray={step !== 3 ? `${10 / s} ${6 / s}` : undefined} />
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
	{#if step === 4 && shownOutline.length}
		{#if tracing}
			<polyline class="fi-outline" points={pts(shownOutline)} stroke-width={3 / s} />
			{#if cursor && !coarse && !drag}
				{@const last = al(shownOutline[shownOutline.length - 1])}
				{@const c = toView(cursor)}
				<line class="fi-rubber" x1={last[0]} y1={last[1]} x2={c[0]} y2={c[1]} stroke-width={2 / s} stroke-dasharray="{6 / s} {4 / s}" />
			{/if}
		{:else}
			<polygon class="fi-outline closed" points={pts(shownOutline)} stroke-width={3 / s} />
		{/if}
		{#each walls as w, i (w.id)}
			<polygon class="fi-iwall" class:off={!w.on} class:hot={i === hoverWall} data-handle="w{i}" points={wallRect(w)} stroke-width={(i === hoverWall ? 3.5 : 2) / s} stroke-dasharray={w.on ? undefined : `${6 / s} ${4 / s}`} role="button" aria-label="Wall {i + 1}" aria-pressed={w.on} onpointerenter={() => (hoverWall = i)} onpointerleave={() => (hoverWall = -1)} />
		{/each}
		{#each shownOutline as v, i (i)}
			{@const q = al(v)}
			<circle class="fi-handle vertex" class:sel={i === selV} data-handle="v{i}" cx={q[0]} cy={q[1]} r={r} stroke-width={2 / s} role="button" aria-label="Vertex {i + 1}" />
			<text class="fi-vlabel" x={q[0] + 10 / s} y={q[1] - 8 / s} font-size={13 / s}>{i + 1}</text>
		{/each}
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
		{:else}
			<path d="M3 7h14M3 13h14M7 3v14M13 3v14" />
		{/if}
	</svg>
{/snippet}

<svelte:window onkeydown={onKey} />

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
	{#snippet body()}
		<div class="fi-body">
			<aside class="fi-side">
				<div class="fi-guide" role="status" aria-live="polite">
					<span class="fi-msg">{message}</span>
					{#if step === 1}
						<button type="button" class="fi-b" onclick={alreadyAligned}>Already aligned</button>
					{/if}
				</div>
				{#each STEPS as n (n)}
					{@const subText = n === 3 ? scaleText : n === 4 && outlineValid ? `${shownOutline.length} vertices` : ''}
					<button type="button" class="fi-step" class:on={step === n} class:done={done(n)} aria-current={step === n ? 'step' : undefined} onclick={() => cardClick(n)}>
						<span class="fi-n" aria-hidden="true">{done(n) ? '✓' : n}</span>
						<span class="fi-step-text">{STEP_LABELS[n]}{#if subText}<span class="fi-v">{subText}</span>{/if}</span>
					</button>
				{/each}
				{#if step === 3}
					<div class="fi-box">
						<label class="fi-label" for="fi-distance">Distance</label>
						<div class="fi-row">
							<input id="fi-distance" type="number" min="0" step="any" value={distance ?? ''} oninput={(e) => { const v = Number((e.currentTarget as HTMLInputElement).value); distance = (e.currentTarget as HTMLInputElement).value === '' || !(v > 0) ? null : v; markWork(); }} />
							<select aria-label="Distance units" value={distUnit} onchange={(e) => (distUnit = (e.currentTarget as HTMLSelectElement).value as LengthUnit)}>
								{#each LENGTH_UNITS as u (u)}<option value={u}>{unitAbbrev(u)}</option>{/each}
							</select>
						</div>
					</div>
				{:else if step === 4}
					<div class="fi-box">
						<div class="fi-choice">
							<button type="button" class="fi-b" class:on={how === 'trace'} aria-pressed={how === 'trace'} onclick={chooseTrace}>Trace</button>
							<button type="button" class="fi-b" class:on={how === 'auto'} aria-pressed={how === 'auto'} onclick={chooseAuto}>Auto-detect</button>
							{#if currentOutline && initial}
								<button type="button" class="fi-b keep" class:on={how === 'keep'} aria-pressed={how === 'keep'} onclick={chooseKeep}>Keep current outline</button>
							{/if}
						</div>
						{#if how === 'auto'}
							<div class="fi-seg" role="group" aria-label="Detect">
								<button type="button" class="fi-b" class:on={autoMode === 'room'} aria-pressed={autoMode === 'room'} onclick={() => (autoMode = 'room')}>Click a room</button>
								<button type="button" class="fi-b" class:on={autoMode === 'floor'} aria-pressed={autoMode === 'floor'} disabled={detecting} onclick={wholeFloor}>Whole floor</button>
							</div>
						{/if}
						{#if shownOutline.length && !tracing}
							<span class="fi-hdr">Vertices</span>
							<VertexTable vertices={tableRows} unit={unitLabel} precision={tableDecimals} selectedIndex={selV} addLabel="+ Add vertex" roomy oncommit={setVertex} onremove={removeVertex} onadd={addVertex} onselect={(i) => (selV = i)} />
						{/if}
						{#if walls.length && !tracing}
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
					</div>
				{/if}
			</aside>
			<div class="fi-stagewrap">
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="fi-stage"
					class:placing
					class:panning={tool === 'pan' || drag?.kind === 'pan'}
					class:rotating={step === 1 && tool === 'rotate'}
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
				<div class="fi-tools">
					{#if step === 1}
						<div class="fi-seg">
							<button type="button" class="fi-b icon" class:on={tool === 'pan'} aria-pressed={tool === 'pan'} title="Pan" aria-label="Pan" onclick={() => pickTool('pan')}>{@render icon('pan')}</button>
							<button type="button" class="fi-b icon" class:on={tool === 'rotate'} aria-pressed={tool === 'rotate'} title="Rotate" aria-label="Rotate" onclick={() => pickTool('rotate')}>{@render icon('rotate')}</button>
							<button type="button" class="fi-b icon" class:on={tool === 'straighten'} aria-pressed={tool === 'straighten'} title="Straighten" aria-label="Straighten" onclick={() => pickTool('straighten')}>{@render icon('straighten')}</button>
						</div>
						<div class="fi-seg">
							<button type="button" class="fi-b" title="Rotate 90° left" aria-label="Rotate 90° left" onclick={() => turn90(-1)}>{@render icon('left')}90°</button>
							<button type="button" class="fi-b" title="Rotate 90° right" aria-label="Rotate 90° right" onclick={() => turn90(1)}>{@render icon('right')}90°</button>
						</div>
					{:else}
						<div class="fi-seg">
							<button type="button" class="fi-b icon" class:on={tool === 'pan'} aria-pressed={tool === 'pan'} title="Pan" aria-label="Pan" onclick={() => pickTool('pan')}>{@render icon('pan')}</button>
						</div>
					{/if}
					<div class="fi-seg">
						<button type="button" class="fi-b icon" class:on={guides} aria-pressed={guides} title="Guidelines" aria-label="Guidelines" onclick={() => (guides = !guides)}>{@render icon('guides')}</button>
					</div>
				</div>
				<div class="fi-zoom fi-seg">
					<button type="button" class="fi-b" class:on={Math.abs(z - 1) < 1e-6} title="Full resolution" onclick={fullSize}>100%</button>
					<button type="button" class="fi-b" title="Fit to window" onclick={fit}>Fit</button>
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

<style>
	:global(.modal-content.floorplan-import) {
		height: min(840px, 95vh);
	}
	.fi-body {
		position: relative;
		display: grid;
		grid-template-columns: 270px minmax(0, 1fr);
		height: 100%;
		min-height: 0;
	}
	.fi-side {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 10px;
		background: var(--color-bg-secondary);
		border-right: 1px solid var(--color-border);
		overflow: auto;
		min-height: 0;
	}
	.fi-guide {
		flex: none;
		height: 122px;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		gap: 10px;
		margin-bottom: 8px;
		padding: 12px 14px;
		border: 2px solid var(--color-highlight);
		border-radius: var(--radius-md, 8px);
		background: var(--color-bg-input);
		overflow: hidden;
	}
	.fi-msg {
		font-size: 15px;
		font-weight: 700;
		line-height: 1.4;
		color: var(--color-text);
	}
	.fi-guide .fi-b {
		align-self: flex-start;
	}
	.fi-step {
		display: flex;
		gap: 12px;
		align-items: center;
		min-height: 46px;
		padding: 6px 12px;
		width: 100%;
		border: 0;
		border-radius: 6px;
		background: var(--color-btn-fill);
		color: var(--color-text);
		font-size: 15px;
		font-weight: 600;
		text-align: left;
		cursor: pointer;
	}
	.fi-step:hover {
		background: var(--color-btn-fill-hover);
	}
	.fi-step.on {
		background: var(--color-bg);
		box-shadow: inset 0 -2px 0 var(--color-highlight);
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
	.fi-step.done .fi-n {
		background: var(--color-success);
		border-color: var(--color-success);
		color: var(--color-bg);
		font-weight: 700;
	}
	.fi-step-text {
		display: flex;
		flex-direction: column;
	}
	.fi-v {
		color: var(--color-text-muted);
		font-size: 13px;
		font-weight: 400;
	}
	.fi-box {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-top: 6px;
		padding: 10px;
		border-radius: 6px;
		background: var(--color-bg-tertiary);
	}
	.fi-label,
	.fi-hdr {
		font-size: 13px;
		color: var(--color-text-muted);
	}
	.fi-hdr {
		text-transform: uppercase;
		letter-spacing: 0.04em;
		margin-top: 4px;
	}
	.fi-row {
		display: flex;
		gap: 6px;
	}
	.fi-row input {
		width: 96px;
	}
	.fi-choice {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px;
	}
	.fi-choice .keep {
		grid-column: 1 / -1;
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
	.fi-b.on,
	.fi-b.on:hover:not(:disabled) {
		background: var(--color-highlight);
		color: var(--color-on-highlight);
	}
	.fi-b.icon {
		width: 36px;
		padding: 0;
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
	.fi-box .fi-seg .fi-b {
		flex: 1;
	}
	.fi-stagewrap {
		position: relative;
		overflow: hidden;
		min-width: 0;
		min-height: 0;
	}
	.fi-stage {
		position: absolute;
		inset: 0;
		overflow: hidden;
		background: color-mix(in srgb, var(--color-bg) 55%, #000);
		touch-action: none;
		cursor: default;
	}
	.fi-stage.placing {
		cursor: crosshair;
	}
	.fi-stage.rotating {
		cursor: grab;
	}
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
	.fi-handle.sel {
		fill: var(--color-scene-selected);
	}
	.fi-handle.origin {
		stroke: #e5384f;
	}
	.fi-wall {
		stroke: var(--color-highlight);
	}
	.fi-scale {
		stroke: #f0a020;
	}
	.fi-scale-label {
		fill: #f0a020;
		font-weight: 700;
		paint-order: stroke;
		stroke: rgba(0, 0, 0, 0.6);
		stroke-width: 0.15em;
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
	.fi-outline.closed {
		fill: color-mix(in srgb, var(--color-scene-selected) 16%, transparent);
	}
	.fi-rubber {
		stroke: var(--color-scene-selected);
	}
	.fi-vlabel {
		fill: #0b5f8a;
		font-weight: 700;
		paint-order: stroke;
		stroke: #fff;
		stroke-width: 0.2em;
		pointer-events: none;
	}
	.fi-tools {
		position: absolute;
		left: 10px;
		top: 10px;
		display: flex;
		gap: 8px;
		z-index: 3;
	}
	.fi-zoom {
		position: absolute;
		right: 10px;
		top: 10px;
		z-index: 3;
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
		.fi-guide {
			height: 96px;
		}
		.fi-tools {
			flex-wrap: wrap;
			right: 10px;
		}
		.fi-zoom {
			top: auto;
			bottom: 10px;
		}
	}
</style>
