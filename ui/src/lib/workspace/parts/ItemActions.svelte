<script lang="ts">
	// Copy and Delete at the foot of an open item's editor (structures, lamps,
	// zones, ceiling items): the same actions as the edit strip and the keys.
	import Glyph from '$lib/workspace/Glyph.svelte';

	interface Props {
		onCopy: () => void;
		onDelete: () => void;
		disabled?: boolean;
		/** Copy alone is unavailable (a full ceiling layout). */
		copyDisabled?: boolean;
	}

	let { onCopy, onDelete, disabled = false, copyDisabled = false }: Props = $props();
</script>

<div class="item-actions" role="group" aria-label="Item actions">
	<button type="button" class="secondary plan-btn ia-btn" title="Copy (Ctrl+D)" disabled={disabled || copyDisabled} onclick={onCopy}>
		<Glyph name="copy" size={16} />
		<span>Copy</span>
	</button>
	<button type="button" class="secondary plan-btn ia-btn" title="Delete (Del)" {disabled} onclick={onDelete}>
		<Glyph name="trash" size={16} />
		<span>Delete</span>
	</button>
</div>

<style>
	.item-actions {
		display: flex;
		gap: var(--spacing-sm);
		padding-top: var(--spacing-sm);
		border-top: 1px solid var(--color-border);
	}
	/* Filled secondary, specific enough to beat the editor column's outlined .secondary */
	.item-actions button.ia-btn {
		flex: 1 1 0;
		min-width: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		margin: 0;
		padding: 6px 12px;
		font-size: var(--font-size-sm);
		font-weight: 500;
		color: var(--color-text);
		background: var(--color-btn-fill);
		border: 1px solid transparent;
		border-radius: var(--radius-md);
	}
	.item-actions button.ia-btn:hover:not(:disabled) {
		background: var(--color-btn-fill-hover);
		border-color: transparent;
	}
</style>
