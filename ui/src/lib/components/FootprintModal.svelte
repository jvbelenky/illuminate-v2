<script module lang="ts">
	import type { Vertex as FootprintVertex } from '$lib/utils/roomGeometry';
	/** What Apply hands back: the footprint in the object's local frame plus its base centre. */
	export interface FootprintApplyResult {
		/** Footprint corners relative to the centroid (CCW, room units). */
		vertices: FootprintVertex[];
		/** Base-centre position (the footprint's centroid, room units). */
		x: number;
		y: number;
		/** Bounding size of the footprint. */
		width: number;
		length: number;
		name: string;
		height: number;
		reflectance: number;
		transmittance: number;
	}
</script>

<script lang="ts">
	import Modal from './Modal.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import ValidatedNumberInput from './ValidatedNumberInput.svelte';
	import PlanCanvas, { type CanvasTool } from './PlanCanvas.svelte';
	import type { LampInstance, SceneObject, RoomConfig, FloorPlanPlacement } from '$lib/types/project';
	import type { FloorPlanImage } from '$lib/stores/floorplanImage';
	import { displayDimension } from '$lib/utils/formatting';
	import { unitAbbrev, FEET_PER_METER } from '$lib/utils/unitConversion';
	import { imageRect } from '$lib/utils/floorplanImage';
	import { objectFootprint, polygonCentroid } from '$lib/utils/objectGeometry';
	import {
		type Vertex,
		roomVertices,
		polygonArea,
		polygonBoundingBox,
		polygonEdgeLengths,
		edgeMidpoints,
		validatePolygon,
		normalizeCCW,
	} from '$lib/utils/roomGeometry';

	interface Props {
		/** `create` draws a new object; `edit` reshapes `object` (a box is converted to a polygon). */
		mode: 'create' | 'edit';
		object?: SceneObject;
		room: RoomConfig;
		units: 'meters' | 'feet';
		lamps?: LampInstance[];
		/** Other objects, drawn as faint footprints for context (the edited one is left out). */
		objects?: SceneObject[];
		floorplan?: FloorPlanPlacement | null;
		image?: FloorPlanImage | null;
		onApply: (result: FootprintApplyResult) => void;
		onClose: () => void;
	}

	let { mode, object, room, units, lamps = [], objects = [], floorplan = null, image = null, onApply, onClose }: Props = $props();

	const precision = $derived(room.precision);
	const unit = $derived(unitAbbrev(units));
	const k = $derived(units === 'feet' ? FEET_PER_METER : 1);
	const outline = $derived(roomVertices(room));
	const contextObjects = $derived(objects.filter((o) => o.id !== object?.id));

	// Transactional draft of the footprint in ROOM coordinates: an existing object
	// starts from its world-space footprint (yaw baked in); a new one starts empty
	// with the drawing tool armed, so the first click places a corner.
	// svelte-ignore state_referenced_locally
	let draft = $state<Vertex[]>(object ? objectFootprint(object).map((v) => [v[0], v[1]] as Vertex) : []);
	let tool = $state<CanvasTool>('edit');
	let drawing = $state(false);
	let selectedIndex = $state(-1);
	let canvas = $state<PlanCanvas | undefined>(undefined);

	// Properties edited alongside the footprint (a local copy: the modal is transactional)
	// svelte-ignore state_referenced_locally
	let name = $state(object?.name ?? '');
	// svelte-ignore state_referenced_locally
	let height = $state(object?.height ?? (units === 'feet' ? 3 : 1));
	// svelte-ignore state_referenced_locally
	let reflectance = $state(object?.reflectance ?? 0);
	// svelte-ignore state_referenced_locally
	let transmittance = $state(object?.transmittance ?? 0);

	const snapStep = $derived(units === 'feet' ? 0.25 : 0.1);
	const validationMessage = $derived(drawing ? null : validatePolygon(draft));
	const isValid = $derived(!drawing && validationMessage === null);
	const area = $derived(draft.length >= 3 ? polygonArea(draft) : 0);
	const edgeLengths = $derived(draft.length >= 2 ? polygonEdgeLengths(draft) : []);
	const midpoints = $derived(draft.length >= 2 ? edgeMidpoints(draft) : []);

	const planImage = $derived(floorplan && image && image.id === floorplan.imageId ? { ...imageRect(floorplan, k), href: image.src, opacity: floorplan.opacity } : null);

	let armed = false;
	$effect(() => {
		if (canvas && mode === 'create' && !armed) {
			armed = true;
			canvas.startDraw();
		}
	});

	let askRedraw = $state(false);
	function requestRedraw() {
		if (drawing) return;
		if (draft.length > 0) askRedraw = true;
		else startDraw();
	}
	function startDraw() {
		askRedraw = false;
		canvas?.startDraw();
	}

	function setVertexCoord(index: number, axis: 0 | 1, value: number) {
		const next = draft.map((v) => [v[0], v[1]] as Vertex);
		next[index][axis] = value;
		draft = next;
	}
	function removeVertex(index: number) {
		canvas?.removeVertex(index);
	}
	function addVertex() {
		if (draft.length < 2) return;
		let longest = 0;
		for (let i = 1; i < edgeLengths.length; i++) if (edgeLengths[i] > edgeLengths[longest]) longest = i;
		const [mx, my] = midpoints[longest];
		const next = draft.map((v) => [v[0], v[1]] as Vertex);
		next.splice(longest + 1, 0, [mx, my]);
		draft = next;
		selectedIndex = longest + 1;
	}

	function onEscapeKey(): boolean | void {
		if (drawing) {
			canvas?.cancelDraw();
			return true;
		}
	}

	function apply() {
		if (!isValid) return;
		const world = normalizeCCW(draft);
		const [cx, cy] = polygonCentroid(world);
		const local = world.map(([x, y]) => [Math.round((x - cx) * 1e6) / 1e6, Math.round((y - cy) * 1e6) / 1e6] as Vertex);
		const bb = polygonBoundingBox(local);
		onApply({
			vertices: local,
			x: Math.round(cx * 1e6) / 1e6,
			y: Math.round(cy * 1e6) / 1e6,
			width: bb.xMax - bb.xMin,
			length: bb.yMax - bb.yMin,
			name: name.trim(),
			height,
			reflectance,
			transmittance,
		});
	}

	function fmt(v: number): string {
		return displayDimension(v, precision);
	}

	const hint = $derived.by(() => {
		if (drawing) return draft.length < 3 ? 'Click the corners of the object where it stands in the room (Esc cancels, Enter completes)' : 'Click the first corner or press Enter to close (Esc cancels)';
		if (draft.length < 3) return 'Draw the footprint to continue';
		return 'Drag corners or walls; click a midpoint to add one';
	});

	const title = $derived(mode === 'create' ? 'Draw object' : object?.shape === 'box' ? 'Convert to polygon' : 'Edit footprint');
</script>

<Modal {title} {onClose} {onEscapeKey} maxWidth="min(1280px, 96vw)" maxHeight="calc(100vh - 24px)" titleFontSize="1rem">
	{#snippet body()}
		<div class="footprint-modal">
			<div class="canvas-column">
				<div class="toolbar">
					<button type="button" class="tool" class:active={drawing} disabled={drawing} onclick={requestRedraw} title="Draw the footprint again: click out its corners (click the first corner or press Enter to close, Escape cancels)">
						Redraw
					</button>
					<span class="toolbar-note">{unit}</span>
				</div>
				<p class="plan-hint" aria-live="polite">{hint}</p>

				<PlanCanvas
					bind:this={canvas}
					bind:draft
					bind:drawing
					bind:selectedIndex
					bind:tool
					{units}
					{precision}
					fallbackFit={outline}
					{outline}
					{lamps}
					objects={contextObjects}
					invalid={!drawing && validationMessage !== null && draft.length >= 3}
					ariaLabel="Object footprint canvas"
				>
					{#snippet underlay()}
						{#if planImage}
							<image
								class="plan-image"
								href={planImage.href}
								x={planImage.x}
								y={-(planImage.y + planImage.height)}
								width={planImage.width}
								height={planImage.height}
								opacity={planImage.opacity}
								preserveAspectRatio="none"
								role="img"
								aria-label="Floor plan reference image"
							/>
						{/if}
					{/snippet}
				</PlanCanvas>
			</div>

			<div class="side-column">
				<div class="props">
					<label class="prop-row">
						<span>Name</span>
						<input type="text" value={name} placeholder="Object" oninput={(e) => name = (e.currentTarget as HTMLInputElement).value} />
					</label>
					<label class="prop-row">
						<span>Height ({unit})</span>
						<ValidatedNumberInput id="footprint-height" value={height} {precision} min={0.001} step={snapStep} oncommit={(v) => height = v} />
					</label>
					<label class="prop-row">
						<span>Reflectance</span>
						<ValidatedNumberInput id="footprint-reflectance" value={reflectance} precision={2} min={0} max={Math.max(0, 1 - transmittance)} step={0.05} oncommit={(v) => reflectance = v} />
					</label>
					<label class="prop-row">
						<span>Transmittance</span>
						<ValidatedNumberInput id="footprint-transmittance" value={transmittance} precision={2} min={0} max={Math.max(0, 1 - reflectance)} step={0.05} oncommit={(v) => transmittance = v} />
					</label>
				</div>

				<div class="summary">
					<div><span class="summary-label">Footprint area</span><span>{fmt(area)} {unit}²</span></div>
					{#if validationMessage && draft.length >= 3}
						<p class="plan-error" role="alert">{validationMessage}</p>
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
								<span class="row-index" title="Corner {i + 1}">{i + 1}</span>
								<ValidatedNumberInput value={vx} {precision} step={snapStep} disabled={drawing} oncommit={(v) => setVertexCoord(i, 0, v)} />
								<ValidatedNumberInput value={vy} {precision} step={snapStep} disabled={drawing} oncommit={(v) => setVertexCoord(i, 1, v)} />
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
			<button type="button" class="primary" disabled={!isValid} onclick={apply} title={isValid ? (mode === 'create' ? 'Add this object' : 'Apply this footprint') : (validationMessage ?? 'Finish the footprint first')}>Apply</button>
		</div>
	{/snippet}
</Modal>

{#if askRedraw}
	<ConfirmDialog
		title="Draw the footprint again?"
		message="This removes the {draft.length} corner{draft.length === 1 ? '' : 's'} so you can draw the footprint from scratch. Cancelling the drawing before three corners restores them."
		confirmLabel="Clear and draw"
		cancelLabel="Keep"
		variant="warning"
		onConfirm={startDraw}
		onCancel={() => askRedraw = false}
	/>
{/if}

<style>
	.footprint-modal {
		display: flex;
		gap: var(--spacing-md);
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
	.toolbar-note {
		margin-left: auto;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
	.plan-hint {
		margin: 0;
		min-height: 1.2em;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
	.tool {
		display: inline-flex;
		align-items: center;
		height: 1.9rem;
		padding: 0 10px;
		font-size: var(--font-size-sm, var(--font-size-base));
		background: var(--color-bg-tertiary);
		color: var(--color-text);
		border: 1px solid var(--color-border);
	}
	.tool:hover {
		background: var(--color-border);
		border-color: var(--color-text-muted);
	}
	.tool.active {
		background: var(--color-highlight);
		color: var(--color-bg, #fff);
		border-color: var(--color-highlight);
	}
	.plan-image {
		pointer-events: none;
		image-rendering: auto;
	}
	.props {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
		padding-bottom: var(--spacing-xs);
		border-bottom: 1px solid var(--color-border);
	}
	.prop-row {
		display: grid;
		grid-template-columns: 6.5rem 1fr;
		align-items: center;
		gap: var(--spacing-xs);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
	.prop-row :global(input) {
		min-width: 0;
		width: 100%;
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
	.vertex-table {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-height: 0;
		flex: 0 1 auto;
	}
	.vertex-rows {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-height: 0;
		overflow-y: auto;
		scrollbar-gutter: stable;
		padding-right: 2px;
	}
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
</style>
