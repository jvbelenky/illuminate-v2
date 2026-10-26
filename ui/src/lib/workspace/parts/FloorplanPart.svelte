<script lang="ts">
	// Room › Floorplan: the room's size and units, its area and volume, the
	// reference image to trace over; the corner table is folded under Geometry.
	import './parts.css';
	import ValidatedNumberInput from '$lib/components/ValidatedNumberInput.svelte';
	import { polygonArea } from '$lib/utils/roomGeometry';
	import { displayQuantity } from '$lib/utils/formatting';
	import { unitAbbrev, LENGTH_UNITS, roundToUnit } from '$lib/utils/unitConversion';
	import type { PlanController } from '$lib/plan/planController.svelte';

	let { controller }: { controller: PlanController } = $props();
	const ctl = $derived(controller);

	const scene = $derived(ctl.scene());
	const room = $derived(scene.room);
	const units = $derived(scene.units);
	const polygon = $derived(room.shape === 'polygon');
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
		if (file) ctl.onFileChosen(file);
	}

	let geometryOpen = $state(false);
</script>

<div class="ep-part floorplan-part">
	<div class="dims-block">
		<span class="dims-title">Dimensions</span>
		<div class="dims-row">
			<div class="dims">
				{#if !polygon}
					<label class="dim">
						<span>X</span>
						<input type="number" aria-label="Width" value={shown('x')} onchange={(e) => commit('x', e)} />
					</label>
					<label class="dim">
						<span>Y</span>
						<input type="number" aria-label="Length" value={shown('y')} onchange={(e) => commit('y', e)} />
					</label>
				{/if}
				<label class="dim">
					<span>Z</span>
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
		<button type="button" class="secondary plan-btn" disabled={ctl.drawing} onclick={ctl.requestNewOutline}>Draw outline</button>
		<button type="button" class="secondary plan-btn" disabled={ctl.decoding} onclick={() => fileInput?.click()}>{ctl.decoding ? 'Reading…' : 'Upload floor plan image'}</button>
		<input bind:this={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,application/pdf,.png,.jpg,.jpeg,.webp,.gif,.svg,.pdf" onchange={onFileInput} hidden />
	</div>

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
				<button type="button" class="secondary set-scale-btn" class:active={ctl.tool === 'custom'} aria-pressed={ctl.tool === 'custom'} disabled={ctl.drawing} onclick={ctl.startSetScale}>Set scale…</button>
				<button type="button" class="secondary remove-image-btn" onclick={ctl.removeImage}>Remove</button>
			{/if}
		</div>
	{/if}


	<button type="button" class="ep-disc" aria-expanded={geometryOpen} onclick={() => (geometryOpen = !geometryOpen)}>
		<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 1.5 6.5 5 3 8.5" /></svg>
		Geometry
	</button>
	{#if geometryOpen}
		<div class="vertex-table">
			<div class="vertex-header">
				<span></span>
				<span>X ({ctl.unit})</span>
				<span>Y ({ctl.unit})</span>
				<span></span>
			</div>
			<div class="vertex-rows">
				{#each ctl.draft as [vx, vy], i (i)}
					<div class="vertex-row" class:selected={ctl.selectedIndex === i}>
						<span class="row-index" title="Corner {i + 1}">{i + 1}</span>
						<ValidatedNumberInput value={vx} precision={scene.precision} min={0} step={ctl.snapStep} disabled={ctl.drawing} oncommit={(v) => ctl.setVertexCoord(i, 0, v)} />
						<ValidatedNumberInput value={vy} precision={scene.precision} min={0} step={ctl.snapStep} disabled={ctl.drawing} oncommit={(v) => ctl.setVertexCoord(i, 1, v)} />
						<button type="button" class="secondary remove-btn" title="Remove corner {i + 1}" aria-label="Remove corner {i + 1}" disabled={ctl.drawing || ctl.draft.length <= 3} onclick={() => ctl.removeVertex(i)}>×</button>
					</div>
				{/each}
			</div>
			<button type="button" class="secondary add-vertex-btn" disabled={ctl.drawing || ctl.draft.length < 2} onclick={ctl.addVertex}>Add corner</button>
		</div>
	{/if}
</div>

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
		gap: var(--spacing-xs);
		padding-top: var(--spacing-sm);
		border-top: 1px solid var(--color-border);
	}
	.plan-actions .plan-btn {
		width: 100%;
		padding: 6px 12px;
		font-size: var(--font-size-sm);
		font-weight: 500;
		background: color-mix(in srgb, var(--color-text) 14%, var(--color-bg-tertiary));
		border: 1px solid transparent;
		border-radius: var(--radius-md);
	}
	.plan-actions .plan-btn:hover:not(:disabled) {
		background: color-mix(in srgb, var(--color-text) 22%, var(--color-bg-tertiary));
		border-color: transparent;
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
	.reference-row input[type='range'] {
		width: 100%;
	}
	.set-scale-btn.active {
		border-color: var(--color-primary);
		color: var(--color-primary);
	}

	.remove-image-btn {
		width: 100%;
		margin-top: 2px;
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
		min-height: 0;
		max-height: 16rem;
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
</style>
