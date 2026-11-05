<script lang="ts">
	// Room › Floorplan: the room's size and units, its area and volume, the
	// reference image to trace over; the vertex table is folded under Vertices, below the image card.
	import './parts.css';
	import VertexTable from '$lib/components/VertexTable.svelte';
	import FloorplanImportModal, { type FloorplanImportResult } from '$lib/floorplan/FloorplanImportModal.svelte';
	import { frameFromPlacement, type Pt } from '$lib/floorplan/importFrame';
	import { polygonArea } from '$lib/utils/roomGeometry';
	import { displayQuantity } from '$lib/utils/formatting';
	import { unitAbbrev, LENGTH_UNITS, roundToUnit } from '$lib/utils/unitConversion';
	import type { PlanController } from '$lib/plan/planController.svelte';

	let { controller }: { controller: PlanController } = $props();
	const ctl = $derived(controller);

	const scene = $derived(ctl.scene());
	const room = $derived(scene.room);
	const units = $derived(scene.units);
	const area = $derived(polygonArea(scene.vertices));
	const volume = $derived(area * scene.roomZ);

	function shown(key: 'x' | 'y' | 'z'): number {
		return roundToUnit(room[key], units);
	}

	function commit(key: 'x' | 'y' | 'z', event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const v = Number(input.value);
		if (!Number.isFinite(v) || v <= 0) {
			input.value = String(shown(key));
			return;
		}
		if (v === shown(key)) return;
		ctl.actions.updateRoom({ [key]: v });
		ctl.requestFit();
	}

	// --- Reference image
	let fileInput = $state<HTMLInputElement | undefined>(undefined);
	function onFileInput(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (file) ctl.openImport(file);
	}

	// The import window: reopened on the current image, its frame and outline come along
	const session = $derived(ctl.importSession);
	const importInitial = $derived.by(() => {
		if (!session?.initial) return null;
		const f = frameFromPlacement(session.initial);
		return f.origin && f.pxPerM ? { rotation: f.rotation, origin: f.origin, pxPerM: f.pxPerM } : null;
	});
	const importOutline = $derived<Pt[] | null>(session?.imageId && scene.vertices.length >= 3 ? scene.vertices.map(([x, y]) => [x / ctl.k, y / ctl.k] as Pt) : null);
	function applyImport(result: FloorplanImportResult) {
		void ctl.applyImport(result);
	}

	let geometryOpen = $state(false);
</script>

<div class="ep-part floorplan-part">
	<div class="dims-block">
		<span class="dims-title">Dimensions</span>
		<div class="dims-row">
			<div class="dims">
				<label class="dim">
					<span>W</span>
					<input type="number" aria-label="Width" value={shown('x')} onchange={(e) => commit('x', e)} />
				</label>
				<label class="dim">
					<span>L</span>
					<input type="number" aria-label="Length" value={shown('y')} onchange={(e) => commit('y', e)} />
				</label>
				<label class="dim">
					<span>H</span>
					<input type="number" aria-label="Height" value={shown('z')} onchange={(e) => commit('z', e)} />
				</label>
			</div>
			<select class="units-select" aria-label="Units" value={units} onchange={ctl.handleUnitsChange}>
				{#each LENGTH_UNITS as u (u)}
					<option value={u}>{unitAbbrev(u)}</option>
				{/each}
			</select>
		</div>
	</div>

	<span class="plan-summary" aria-label="Floor area and volume">{displayQuantity(area, scene.precision)} {ctl.unit}² · {displayQuantity(volume, scene.precision)} {ctl.unit}³</span>
	{#if ctl.validationMessage && ctl.draft.length >= 3}
		<p class="ep-error" role="alert">Not saved: {ctl.validationMessage}</p>
	{:else if ctl.dirty && !ctl.drawing}
		<span class="ep-chip" role="alert">Not saved</span>
	{/if}

	<div class="plan-actions">
		<button type="button" class="secondary plan-btn" disabled={ctl.drawing} onclick={ctl.requestNewOutline}>Draw new outline</button>
	</div>

	<section class="ep-addcard image-card" aria-label="Floor plan image">
		<button type="button" class="secondary plan-btn" disabled={ctl.decoding} onclick={() => fileInput?.click()}>{ctl.decoding ? 'Reading…' : 'Upload floor plan image'}</button>
		<input bind:this={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,application/pdf,.png,.jpg,.jpeg,.webp,.gif,.svg,.pdf" onchange={onFileInput} hidden />
		{#if ctl.placement || ctl.imageError}
			<div class="reference-panel">
				{#if ctl.imageError}
					<p class="ep-error" role="alert">{ctl.imageError}</p>
				{/if}
				{#if ctl.imageMissing}
					<span class="ep-chip">Image missing</span>
				{:else if ctl.placement}
					<div class="reference-meta">{ctl.imageFileName ?? 'Saved image'} · {ctl.placement.widthPx}×{ctl.placement.heightPx} px</div>
					{#if ctl.pdfPageCount > 1}
						<label class="reference-row">
							<span>Page</span>
							<select value={ctl.pdfPage} onchange={(e) => ctl.changePdfPage(Number((e.currentTarget as HTMLSelectElement).value))} aria-label="PDF page">
								{#each Array.from({ length: ctl.pdfPageCount }, (_, i) => i + 1) as n}
									<option value={n}>{n} of {ctl.pdfPageCount}</option>
								{/each}
							</select>
						</label>
					{/if}
					<label class="reference-row">
						<span>Opacity</span>
						<input type="range" min="0.1" max="1" step="0.05" value={ctl.placement.opacity} oninput={(e) => ctl.setOpacity(Number((e.currentTarget as HTMLInputElement).value))} onchange={ctl.commitOpacity} aria-label="Reference image opacity" />
					</label>
				{/if}
				{#if ctl.placement}
					<div class="image-tools">
						{#if ctl.hasImage}
							<button type="button" class="secondary adjust-image-btn" disabled={ctl.drawing} onclick={ctl.adjustImage}>Adjust image…</button>
						{/if}
						<button type="button" class="secondary remove-image-btn" onclick={ctl.removeImage}>Remove</button>
					</div>
				{/if}
			</div>
		{/if}
	</section>

	<button type="button" class="ep-disc" aria-expanded={geometryOpen} onclick={() => (geometryOpen = !geometryOpen)}>
		<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 1.5 6.5 5 3 8.5" /></svg>
		Vertices
	</button>
	{#if geometryOpen}
		<VertexTable
			vertices={ctl.draft}
			unit={ctl.unit}
			precision={scene.precision}
			selectedIndex={ctl.selectedIndex}
			min={0}
			step={ctl.snapStep}
			disabled={ctl.drawing}
			oncommit={(i, axis, v) => ctl.setVertexCoord(i, axis, v)}
			onremove={(i) => ctl.removeVertex(i)}
			onadd={ctl.addVertex}
		/>
	{/if}
</div>

{#if session}
	<FloorplanImportModal
		src={session.src}
		widthPx={session.widthPx}
		heightPx={session.heightPx}
		{units}
		precision={scene.precision}
		initial={importInitial}
		currentOutline={importOutline}
		onApply={applyImport}
		onClose={ctl.closeImport}
	/>
{/if}

<style>
	.dims-block {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}
	.dims-title {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}
	.dims-row {
		display: flex;
		gap: var(--spacing-sm);
		align-items: flex-end;
	}
	.dims {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--spacing-xs);
		flex: 1;
		min-width: 0;
	}
	.dim {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin: 0;
		min-width: 0;
	}
	.dim {
		gap: 4px;
	}
	.dim > span {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		font-weight: 500;
	}
	.dim input {
		width: 100%;
		min-width: 0;
		padding: 6px 8px;
	}
	.units-select {
		padding-top: 6px;
		padding-bottom: 6px;
	}
	.units-select {
		width: 60px;
		flex-shrink: 0;
	}
	.plan-summary {
		margin-top: var(--spacing-xs);
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.plan-actions {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
		padding-top: var(--spacing-sm);
		border-top: 1px solid var(--color-border);
	}
	.plan-actions .plan-btn {
		width: 100%;
		padding: 6px 12px;
		font-size: var(--font-size-sm);
		font-weight: 500;
		background: var(--color-btn-fill);
		border: 1px solid transparent;
		border-radius: var(--radius-md);
	}
	.plan-actions .plan-btn:hover:not(:disabled) {
		background: var(--color-btn-fill-hover);
		border-color: transparent;
	}
	/* The floor plan image card: below the outline, on its own fill */
	.image-card {
		margin-top: var(--spacing-sm);
	}
	.image-card button.secondary {
		padding: 6px 12px;
		font-size: var(--font-size-sm);
		font-weight: 500;
		color: var(--color-text);
		background: var(--color-btn-fill);
		border: 1px solid transparent;
		border-radius: var(--radius-md);
	}
	.image-card button.secondary:hover:not(:disabled) {
		background: var(--color-btn-fill-hover);
		border-color: transparent;
	}
	.image-card .plan-btn {
		width: 100%;
	}
	.reference-panel {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: var(--font-size-sm);
	}
	/* Adjust image and Remove side by side; a lone button the full width */
	.image-tools {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--spacing-sm);
	}
	.image-tools > button {
		min-width: 0;
		margin: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.image-tools > button:last-child:nth-child(odd) {
		grid-column: 1 / -1;
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
		align-items: center;
		gap: var(--spacing-xs);
		margin: 0;
	}
	.reference-row > span {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}
	.reference-row input[type='range'] {
		width: 100%;
	}
</style>
