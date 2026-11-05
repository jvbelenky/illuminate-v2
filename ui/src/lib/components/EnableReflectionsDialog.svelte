<script lang="ts">
	import Modal from './Modal.svelte';

	interface Props {
		/** Enable was chosen; dontShowAgain is the checkbox state. */
		onEnable: (dontShowAgain: boolean) => void;
		onCancel: () => void;
	}

	let { onEnable, onCancel }: Props = $props();

	let dontShowAgain = $state(false);

	function focusOnMount(node: HTMLElement) {
		node.focus();
	}
</script>

<Modal
	title="Enable reflections?"
	onClose={onCancel}
	draggable={false}
	minimizable={false}
	showCloseButton={false}
	zIndex={2000}
	maxWidth="min(400px, 90vw)"
	titleFontSize="1rem"
>
	{#snippet body()}
		<div class="dialog-body">
			<p>Reflections make calculations significantly slower and usually change the results by about 5–10%.</p>
			<label class="dont-show">
				<input type="checkbox" bind:checked={dontShowAgain} />
				<span>Don't show this again</span>
			</label>
		</div>
		<div class="dialog-footer">
			<button type="button" class="cancel-btn" onclick={onCancel}>Cancel</button>
			<button type="button" class="enable-btn" use:focusOnMount onclick={() => onEnable(dontShowAgain)}>Enable</button>
		</div>
	{/snippet}
</Modal>

<style>
	.dialog-body {
		padding: var(--spacing-sm) var(--spacing-md);
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
	}
	.dialog-body p {
		margin: 0;
		font-size: 0.9375rem;
		color: var(--color-text-muted);
		line-height: 1.5;
	}
	.dont-show {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		font-size: 0.8125rem;
		color: var(--color-text);
		cursor: pointer;
		margin: 0;
	}
	.dont-show input {
		width: auto;
		margin: 0;
	}
	.dialog-footer {
		padding: var(--spacing-sm) var(--spacing-md) var(--spacing-md);
		display: flex;
		justify-content: flex-end;
		gap: var(--spacing-sm);
	}
	.cancel-btn,
	.enable-btn {
		border-radius: var(--radius-sm);
		padding: var(--spacing-sm) var(--spacing-md);
		font-size: 0.875rem;
		cursor: pointer;
	}
	.cancel-btn {
		background: var(--color-bg-tertiary);
		color: var(--color-text);
		border: 1px solid var(--color-border);
	}
	.cancel-btn:hover {
		background: var(--color-border);
	}
	.enable-btn {
		background: var(--color-accent);
		color: white;
		border: 1px solid var(--color-accent);
		font-weight: 600;
	}
	.enable-btn:hover {
		background: var(--color-accent-hover);
	}
</style>
