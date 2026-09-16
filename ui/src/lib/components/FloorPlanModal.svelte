<script lang="ts">
	import Modal from './Modal.svelte';
	import ValidatedNumberInput from './ValidatedNumberInput.svelte';
	import type { LampInstance } from '$lib/types/project';
	import { displayDimension } from '$lib/utils/formatting';
	import { unitAbbrev } from '$lib/utils/unitConversion';
	import {
		type Vertex,
		type OutlinePreset,
		OUTLINE_PRESETS,
		polygonArea,
		polygonBoundingBox,
		polygonEdgeLengths,
		edgeMidpoints,
		edgeInwardNormals,
		validatePolygon,
		normalizeCCW,
		presetOutline,
		snapTo,
	} from '$lib/utils/roomGeometry';

	interface Props {
		/** Outline to start from (CCW, display units). */
		vertices: Vertex[];
		units: 'meters' | 'feet';
		precision: number;
		/** Existing lamps, drawn as dots for context. */
		lamps?: LampInstance[];
		/** Called with the validated outline when the user applies. */
		onApply: (vertices: Vertex[]) => void;
		onClose: () => void;
	}

	let { vertices, units, precision, lamps = [], onApply, onClose }: Props = $props();

	// The modal is transactional: the outline is edited locally and only handed
	// back on Apply, so intermediate states may be invalid and Cancel discards.
	let draft = $state<Vertex[]>(vertices.map((v) => [v[0], v[1]] as Vertex));
	let tool = $state<'edit' | 'draw'>('edit');
	let drawing = $state(false);
	let beforeDraw: Vertex[] | null = null;
	let cursor = $state<Vertex | null>(null);
	let shiftHeld = $state(false);
	let selectedIndex = $state(-1);
	let drag = $state<{ kind: 'vertex' | 'edge'; index: number; startPointer: Vertex; startDraft: Vertex[] } | null>(null);
	let svgEl = $state<SVGSVGElement | undefined>(undefined);

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
	function fitView(points: Vertex[] = draft.length >= 2 ? draft : vertices) {
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
		const ctm = svgEl.getScreenCTM();
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
		const step = altKey ? 0 : snapStep;
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

	function drawPointFor(event: PointerEvent | MouseEvent): Vertex {
		let p = pointerToRoom(event);
		const last = draft[draft.length - 1];
		if (event.shiftKey && last) p = constrain(last, p);
		return snapPoint(p, event.altKey);
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
		(event.currentTarget as Element).setPointerCapture(event.pointerId);
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
		(event.currentTarget as Element).setPointerCapture(event.pointerId);
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
		shiftHeld = event.shiftKey;
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
	}

	function onPointerLeave() {
		if (tool === 'draw') cursor = null;
	}

	// --- Keyboard ---
	function onKeyDown(event: KeyboardEvent) {
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
		if (drawing) {
			cancelDraw();
			return true;
		}
	}

	// --- Table / presets ---
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
		const [mx, my] = midpoints[midpoints.length - 1];
		draft = [...draft, [mx, my]];
		selectedIndex = draft.length - 1;
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

	function apply() {
		if (!isValid) return;
		onApply(normalizeCCW(draft));
	}

	function fmt(v: number): string {
		return displayDimension(v, precision);
	}

	const hint = $derived.by(() => {
		if (drawing) {
			return draft.length < 3
				? 'Click to place corners. Shift constrains to 45°, Alt disables snapping, Backspace removes the last corner, Escape cancels.'
				: 'Click the first corner, press Enter, or double-click to close the outline.';
		}
		return 'Drag a corner or a wall to move it, click a + to add a corner, Delete removes the selected corner. Scroll to zoom, drag empty space to pan.';
	});

	// Rubber-band segment while drawing
	const rubberBand = $derived.by(() => {
		if (!drawing || !cursor || draft.length === 0) return null;
		const last = draft[draft.length - 1];
		const [x1, y1] = toSvg(last[0], last[1]);
		const [x2, y2] = toSvg(cursor[0], cursor[1]);
		return { x1, y1, x2, y2, length: Math.hypot(cursor[0] - last[0], cursor[1] - last[1]), mid: toSvg((last[0] + cursor[0]) / 2, (last[1] + cursor[1]) / 2) };
	});
</script>

<Modal title="Floor Plan" {onClose} {onEscapeKey} maxWidth="min(1000px, 96vw)" titleFontSize="1rem">
	{#snippet body()}
		<div class="floor-plan-modal">
			<div class="canvas-column">
				<div class="toolbar">
					<div class="tool-group" role="group" aria-label="Tool">
						<button type="button" class="tool" class:active={tool === 'draw'} onclick={startDraw} title="Draw a new outline">
							Draw outline
						</button>
						<button type="button" class="tool" class:active={tool === 'edit'} onclick={() => { if (drawing) finishDraw(); tool = 'edit'; }} title="Move corners and walls">
							Edit
						</button>
						<button type="button" class="tool" onclick={() => fitView()} title="Fit the outline in the view (scroll to zoom, drag empty space to pan)">
							Fit
						</button>
					</div>
					<div class="tool-group" role="group" aria-label="Presets">
						<span class="group-label">Presets</span>
						{#each OUTLINE_PRESETS as preset}
							<button type="button" class="tool preset" onclick={() => applyPreset(preset.id)}>{preset.label}</button>
						{/each}
					</div>
				</div>

				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<svg
					bind:this={svgEl}
					class="plan"
					class:invalid={!drawing && validationMessage !== null && draft.length >= 3}
					class:drawing
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
				<p class="hint">{hint}</p>
			</div>

			<div class="side-column">
				<div class="summary">
					<div><span class="summary-label">Corners</span><span>{draft.length}</span></div>
					<div><span class="summary-label">Floor area</span><span>{fmt(area)} {unit}²</span></div>
					{#if validationMessage && draft.length >= 3}
						<p class="plan-error" role="alert">{validationMessage}</p>
					{:else if drawing}
						<p class="plan-note">Drawing… {draft.length < 3 ? `${3 - draft.length} more corner${draft.length === 2 ? '' : 's'} needed` : 'close the outline to continue'}</p>
					{/if}
				</div>

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
								<button type="button" class="row-index" onclick={() => (selectedIndex = i)} title="Select corner {i + 1}">{i + 1}</button>
								<ValidatedNumberInput value={vx} {precision} min={0} step={snapStep} disabled={drawing} oncommit={(v) => setVertexCoord(i, 0, v)} />
								<ValidatedNumberInput value={vy} {precision} min={0} step={snapStep} disabled={drawing} oncommit={(v) => setVertexCoord(i, 1, v)} />
								<button
									type="button"
									class="remove-btn"
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
	.floor-plan-modal {
		display: flex;
		gap: var(--spacing-md);
		min-height: 0;
	}

	.canvas-column {
		flex: 1 1 560px;
		min-width: 320px;
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
	}

	.toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: var(--spacing-sm);
		align-items: center;
		justify-content: space-between;
	}

	.tool-group {
		display: flex;
		gap: 4px;
		align-items: center;
		flex-wrap: wrap;
	}

	.group-label {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		margin-right: 2px;
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
		width: 100%;
		aspect-ratio: 1;
		max-height: 68vh;
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

	.hint {
		margin: 0;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		min-height: 2.4em;
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
	}

	.vertex-rows {
		display: flex;
		flex-direction: column;
		gap: 2px;
		max-height: 46vh;
		overflow-y: auto;
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

	.vertex-row.selected .row-index {
		background: var(--color-accent);
		color: var(--color-bg, #fff);
		border-color: var(--color-accent);
	}

	.row-index,
	.remove-btn {
		width: 100%;
		padding: 0;
		height: 1.6rem;
		line-height: 1;
	}

	.row-index {
		font-size: var(--font-size-xs);
		font-family: var(--font-mono, monospace);
	}

	.add-vertex-btn {
		width: 100%;
	}

	.footer {
		display: flex;
		justify-content: flex-end;
		gap: var(--spacing-sm);
	}
</style>
