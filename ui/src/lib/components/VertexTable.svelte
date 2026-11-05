<script lang="ts">
	// The outline's corners as a table: index, X and Y in display units, a remove
	// button per row and Add vertex below. Used by the Floorplan part and the
	// floor plan import window. A focused row is selected (onselect).
	import ValidatedNumberInput from '$lib/components/ValidatedNumberInput.svelte';

	interface Props {
		vertices: [number, number][];
		unit: string;
		precision: number;
		selectedIndex: number;
		step?: number;
		min?: number;
		disabled?: boolean;
		addLabel?: string;
		/** Labels at 13 px (the import window's minimum) rather than 12. */
		roomy?: boolean;
		oncommit: (index: number, axis: 0 | 1, value: number) => void;
		onremove: (index: number) => void;
		onadd: () => void;
		onselect?: (index: number) => void;
	}

	let { vertices, unit, precision, selectedIndex, step, min, disabled = false, addLabel = 'Add vertex', roomy = false, oncommit, onremove, onadd, onselect }: Props = $props();
</script>

<div class="vertex-table" class:roomy>
	<div class="vertex-header">
		<span></span>
		<span>X ({unit})</span>
		<span>Y ({unit})</span>
		<span></span>
	</div>
	<div class="vertex-rows">
		{#each vertices as [vx, vy], i (i)}
			<div class="vertex-row" class:selected={selectedIndex === i} onfocusin={() => onselect?.(i)}>
				<span class="row-index" title="Vertex {i + 1}">{i + 1}</span>
				<ValidatedNumberInput value={vx} {precision} {min} {step} {disabled} oncommit={(v) => oncommit(i, 0, v)} />
				<ValidatedNumberInput value={vy} {precision} {min} {step} {disabled} oncommit={(v) => oncommit(i, 1, v)} />
				<button type="button" class="secondary remove-btn" title="Remove vertex {i + 1}" aria-label="Remove vertex {i + 1}" disabled={disabled || vertices.length <= 3} onclick={() => onremove(i)}>×</button>
			</div>
		{/each}
	</div>
	<button type="button" class="secondary add-vertex-btn" disabled={disabled || vertices.length < 2} onclick={onadd}>{addLabel}</button>
</div>

<style>
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
		color: var(--color-scene-selected);
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
	.roomy .vertex-header,
	.roomy .row-index {
		font-size: var(--font-size-sm);
	}
</style>
