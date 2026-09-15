<script lang="ts">
	import type { LampInstance } from '$lib/types/project';
	import ValidatedNumberInput from './ValidatedNumberInput.svelte';
	import { displayDimension } from '$lib/utils/formatting';
	import { unitAbbrev } from '$lib/utils/unitConversion';
	import {
		type Vertex,
		polygonArea,
		polygonBoundingBox,
		edgeMidpoints,
		validatePolygon,
		normalizeCCW,
	} from '$lib/utils/roomGeometry';

	interface Props {
		/** Current outline (CCW, display units). The store is the source of truth. */
		vertices: Vertex[];
		units: 'meters' | 'feet';
		precision: number;
		/** Existing lamps, drawn as dots for context. */
		lamps?: LampInstance[];
		/** Called with a validated outline whenever the user finishes an edit. */
		oncommit: (vertices: Vertex[]) => void;
	}

	let { vertices, units, precision, lamps = [], oncommit }: Props = $props();

	// Transient drag state only — the committed outline lives in the store and
	// arrives through the `vertices` prop, so a background store emit can't
	// clobber an edit in progress (the drag draft is held until pointer-up).
	let dragDraft = $state<Vertex[] | null>(null);
	let dragIndex = $state(-1);
	let selectedIndex = $state(-1);
	let error = $state<string | null>(null);
	let errorTimer: ReturnType<typeof setTimeout> | null = null;
	let svgEl = $state<SVGSVGElement | undefined>(undefined);

	const shown = $derived(dragDraft ?? vertices);
	const validationMessage = $derived(validatePolygon(shown));
	const isValid = $derived(validationMessage === null);
	const midpoints = $derived(edgeMidpoints(shown));
	const area = $derived(polygonArea(shown));
	const unit = $derived(unitAbbrev(units));

	// Snap step: 10 cm in meters, 3 inches in feet. Alt disables snapping.
	const snapStep = $derived(units === 'feet' ? 0.25 : 0.1);

	// --- View box: uniform scale, origin bottom-left, some padding ---
	const PAD_FRACTION = 0.12;
	const view = $derived.by(() => {
		const bb = polygonBoundingBox(shown);
		const extent = Math.max(bb.xMax, bb.yMax, 1);
		const pad = extent * PAD_FRACTION;
		const size = extent + pad * 2;
		return { extent, pad, size };
	});

	// Room (x, y) -> SVG (sx, sy); y points up in the room, down in SVG
	function toSvg(x: number, y: number): [number, number] {
		return [x + view.pad, view.size - (y + view.pad)];
	}

	function fromSvg(sx: number, sy: number): Vertex {
		return [sx - view.pad, view.size - sy - view.pad];
	}

	// "Nice" grid step so the grid has roughly 4–10 lines
	const gridStep = $derived.by(() => {
		const raw = view.extent / 6;
		const mag = Math.pow(10, Math.floor(Math.log10(raw)));
		const norm = raw / mag;
		const nice = norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10;
		return nice * mag;
	});
	const gridLines = $derived.by(() => {
		const lines: number[] = [];
		for (let v = 0; v <= view.extent + 1e-9; v += gridStep) lines.push(Math.round(v * 1e6) / 1e6);
		return lines;
	});

	// Stroke/handle sizes in room units so they stay constant on screen
	const px = $derived(view.size / 260); // ~1px at a 260px-wide canvas
	const handleR = $derived(px * 5);
	const midR = $derived(px * 4);

	const polygonPoints = $derived(shown.map(([x, y]) => toSvg(x, y).join(',')).join(' '));

	// --- Pointer interaction ---
	function pointerToRoom(event: PointerEvent): Vertex {
		if (!svgEl) return [0, 0];
		const pt = svgEl.createSVGPoint();
		pt.x = event.clientX;
		pt.y = event.clientY;
		const ctm = svgEl.getScreenCTM();
		if (!ctm) return [0, 0];
		const local = pt.matrixTransform(ctm.inverse());
		return fromSvg(local.x, local.y);
	}

	function snap(v: number, altKey: boolean): number {
		const clamped = Math.max(0, v);
		if (altKey) return Math.round(clamped * 1000) / 1000;
		return Math.round(clamped / snapStep) * snapStep;
	}

	function startDrag(event: PointerEvent, index: number, draft: Vertex[]) {
		event.preventDefault();
		(event.currentTarget as Element).setPointerCapture(event.pointerId);
		dragDraft = draft;
		dragIndex = index;
		selectedIndex = index;
	}

	function onVertexPointerDown(event: PointerEvent, index: number) {
		startDrag(event, index, shown.map((v) => [v[0], v[1]] as Vertex));
	}

	function onMidpointPointerDown(event: PointerEvent, edgeIndex: number) {
		// Insert a vertex at the midpoint and start dragging it right away
		const draft = shown.map((v) => [v[0], v[1]] as Vertex);
		const [mx, my] = midpoints[edgeIndex];
		draft.splice(edgeIndex + 1, 0, [mx, my]);
		startDrag(event, edgeIndex + 1, draft);
	}

	function onPointerMove(event: PointerEvent) {
		if (dragDraft === null || dragIndex < 0) return;
		const [x, y] = pointerToRoom(event);
		const next = dragDraft.map((v) => [v[0], v[1]] as Vertex);
		next[dragIndex] = [snap(x, event.altKey), snap(y, event.altKey)];
		dragDraft = next;
	}

	function onPointerUp() {
		if (dragDraft === null) return;
		const draft = dragDraft;
		dragDraft = null;
		dragIndex = -1;
		commit(draft);
	}

	function commit(next: Vertex[]) {
		const message = validatePolygon(next);
		if (message) {
			showError(message);
			return;
		}
		oncommit(normalizeCCW(next));
	}

	function showError(message: string) {
		error = message;
		if (errorTimer) clearTimeout(errorTimer);
		errorTimer = setTimeout(() => { error = null; }, 4000);
	}

	// --- Table / keyboard editing ---
	function setVertexCoord(index: number, axis: 0 | 1, value: number) {
		const next = vertices.map((v) => [v[0], v[1]] as Vertex);
		next[index][axis] = Math.max(0, value);
		commit(next);
	}

	function removeVertex(index: number) {
		if (vertices.length <= 3) {
			showError('A room needs at least 3 corners');
			return;
		}
		const next = vertices.filter((_, i) => i !== index);
		if (selectedIndex >= next.length) selectedIndex = -1;
		commit(next);
	}

	function addVertex() {
		// Split the closing edge (last -> first)
		const [mx, my] = midpoints[midpoints.length - 1];
		commit([...vertices, [mx, my]]);
		selectedIndex = vertices.length;
	}

	function onKeyDown(event: KeyboardEvent) {
		if ((event.key === 'Delete' || event.key === 'Backspace') && selectedIndex >= 0) {
			event.preventDefault();
			removeVertex(selectedIndex);
		}
	}

	function formatCoord(v: number): string {
		return displayDimension(v, precision);
	}
</script>

<div class="floor-plan-editor">
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<svg
		bind:this={svgEl}
		class="plan"
		class:invalid={!isValid}
		viewBox="0 0 {view.size} {view.size}"
		preserveAspectRatio="xMidYMid meet"
		role="application"
		aria-label="Floor plan editor: drag corners to reshape the room"
		tabindex="0"
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		onpointercancel={onPointerUp}
		onkeydown={onKeyDown}
	>
		<!-- Grid -->
		{#each gridLines as g}
			{@const [gx, gy0] = toSvg(g, 0)}
			{@const [, gyTop] = toSvg(g, view.extent)}
			{@const [gx0, gy] = toSvg(0, g)}
			{@const [gxRight] = toSvg(view.extent, g)}
			<line x1={gx} y1={gy0} x2={gx} y2={gyTop} class="grid-line" stroke-width={px * 0.6} />
			<line x1={gx0} y1={gy} x2={gxRight} y2={gy} class="grid-line" stroke-width={px * 0.6} />
			<text x={gx} y={gy0 + px * 12} class="tick" font-size={px * 9} text-anchor="middle">{formatCoord(g)}</text>
			{#if g > 0}
				<text x={gx0 - px * 4} y={gy + px * 3} class="tick" font-size={px * 9} text-anchor="end">{formatCoord(g)}</text>
			{/if}
		{/each}

		<!-- Outline -->
		<polygon points={polygonPoints} class="outline" stroke-width={px * 1.5} />

		<!-- Lamps for context -->
		{#each lamps as lamp (lamp.id)}
			{@const [lx, ly] = toSvg(lamp.x, lamp.y)}
			<circle cx={lx} cy={ly} r={px * 3} class="lamp" />
		{/each}

		<!-- Edge midpoint handles: click to insert a corner -->
		{#if dragDraft === null}
			{#each midpoints as [mx, my], i}
				{@const [sx, sy] = toSvg(mx, my)}
				<g class="mid-handle" onpointerdown={(e) => onMidpointPointerDown(e, i)} role="button" tabindex="-1" aria-label="Insert corner on wall {i + 1}">
					<circle cx={sx} cy={sy} r={midR} />
					<line x1={sx - midR * 0.5} y1={sy} x2={sx + midR * 0.5} y2={sy} stroke-width={px} />
					<line x1={sx} y1={sy - midR * 0.5} x2={sx} y2={sy + midR * 0.5} stroke-width={px} />
				</g>
			{/each}
		{/if}

		<!-- Vertex handles -->
		{#each shown as [vx, vy], i}
			{@const [sx, sy] = toSvg(vx, vy)}
			<circle
				cx={sx} cy={sy} r={handleR}
				class="vertex"
				class:selected={selectedIndex === i}
				class:dragging={dragIndex === i}
				stroke-width={px * 1.5}
				role="button"
				tabindex="-1"
				aria-label="Corner {i + 1}"
				onpointerdown={(e) => onVertexPointerDown(e, i)}
			/>
			<text x={sx + handleR * 1.6} y={sy - handleR * 1.2} class="vertex-label" font-size={px * 9}>{i + 1}</text>
		{/each}
	</svg>

	<div class="plan-info">
		<span>{shown.length} corners · {shown.length} walls</span>
		<span>Area {formatCoord(area)} {unit}²</span>
	</div>
	{#if error}
		<p class="plan-error" role="alert">{error}</p>
	{:else if !isValid}
		<p class="plan-error" role="alert">{validationMessage}</p>
	{/if}
	<p class="hint">Drag a corner to move it, click a + on a wall to add one. Hold Alt for free positioning.</p>

	<div class="vertex-table">
		<div class="vertex-header">
			<span></span>
			<span>X ({unit})</span>
			<span>Y ({unit})</span>
			<span></span>
		</div>
		{#each vertices as [vx, vy], i}
			<div class="vertex-row" class:selected={selectedIndex === i}>
				<button type="button" class="row-index" onclick={() => (selectedIndex = i)} title="Select corner {i + 1}">{i + 1}</button>
				<ValidatedNumberInput value={vx} {precision} min={0} step={snapStep} oncommit={(v) => setVertexCoord(i, 0, v)} />
				<ValidatedNumberInput value={vy} {precision} min={0} step={snapStep} oncommit={(v) => setVertexCoord(i, 1, v)} />
				<button
					type="button"
					class="remove-btn"
					title="Remove corner {i + 1}"
					aria-label="Remove corner {i + 1}"
					disabled={vertices.length <= 3}
					onclick={() => removeVertex(i)}
				>×</button>
			</div>
		{/each}
	</div>
	<button type="button" class="secondary add-vertex-btn" onclick={addVertex}>Add corner</button>
</div>

<style>
	.floor-plan-editor {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.plan {
		width: 100%;
		aspect-ratio: 1;
		background: var(--color-bg-secondary, rgba(128, 128, 128, 0.08));
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm, 4px);
		touch-action: none;
		user-select: none;
		outline: none;
	}

	.plan:focus-visible {
		border-color: var(--color-primary);
	}

	.grid-line {
		stroke: var(--color-border);
		opacity: 0.6;
	}

	.tick {
		fill: var(--color-text-muted);
		font-family: var(--font-mono, monospace);
	}

	.outline {
		fill: var(--color-primary);
		fill-opacity: 0.12;
		stroke: var(--color-primary);
		stroke-linejoin: round;
	}

	.plan.invalid .outline {
		fill: var(--color-error, #e5484d);
		stroke: var(--color-error, #e5484d);
	}

	.lamp {
		fill: var(--color-warning, #f5a524);
		stroke: none;
		pointer-events: none;
	}

	.vertex {
		fill: var(--color-bg, #fff);
		stroke: var(--color-primary);
		cursor: grab;
	}

	.vertex.selected {
		fill: var(--color-primary);
	}

	.vertex.dragging {
		cursor: grabbing;
	}

	.plan.invalid .vertex {
		stroke: var(--color-error, #e5484d);
	}

	.vertex-label {
		fill: var(--color-text-muted);
		font-family: var(--font-mono, monospace);
		pointer-events: none;
	}

	.mid-handle {
		cursor: copy;
	}

	.mid-handle circle {
		fill: var(--color-bg, #fff);
		stroke: var(--color-primary);
		stroke-width: 0.5%;
		opacity: 0.7;
	}

	.mid-handle line {
		stroke: var(--color-primary);
	}

	.mid-handle:hover circle {
		opacity: 1;
	}

	.plan-info {
		display: flex;
		justify-content: space-between;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}

	.plan-error {
		margin: 0;
		font-size: var(--font-size-xs);
		color: var(--color-error, #e5484d);
	}

	.hint {
		margin: 0;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}

	.vertex-table {
		display: flex;
		flex-direction: column;
		gap: 2px;
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
		background: var(--color-primary);
		color: var(--color-bg, #fff);
		border-color: var(--color-primary);
	}

	.row-index {
		width: 100%;
		padding: 0;
		height: 1.6rem;
		font-size: var(--font-size-xs);
		font-family: var(--font-mono, monospace);
	}

	.remove-btn {
		width: 100%;
		padding: 0;
		height: 1.6rem;
		line-height: 1;
		font-size: var(--font-size-base);
	}

	.add-vertex-btn {
		width: 100%;
	}
</style>
