<script lang="ts">
	import { untrack } from 'svelte';
	import Modal from './Modal.svelte';

	interface Props {
		suggested: string;
		onSave: (name: string) => void;
		onCancel: () => void;
	}

	let { suggested, onSave, onCancel }: Props = $props();

	// Seeded once from the suggestion, then the user's to edit
	let name = $state(untrack(() => suggested));
	let input: HTMLInputElement | undefined = $state();
	const trimmed = $derived(name.trim());

	$effect(() => {
		input?.focus();
		input?.select();
	});

	function submit() {
		if (trimmed) onSave(trimmed);
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			submit();
		}
	}
</script>

<Modal
	title="Save As"
	onClose={onCancel}
	draggable={false}
	minimizable={false}
	showCloseButton={false}
	zIndex={2000}
	maxWidth="min(400px, 90vw)"
	titleFontSize="1rem"
>
	{#snippet body()}
		<div class="modal-body">
			<div class="name-row">
				<input bind:this={input} bind:value={name} onkeydown={handleKeydown} type="text" spellcheck="false" aria-label="File name" />
				<span class="extension">.guv</span>
			</div>
		</div>
		<div class="modal-footer">
			<button class="cancel-btn" onclick={onCancel}>Cancel</button>
			<button class="save-btn" onclick={submit} disabled={!trimmed}>Save</button>
		</div>
	{/snippet}
</Modal>

<style>
	.modal-body {
		padding: var(--spacing-sm) var(--spacing-md);
	}

	.name-row {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
	}

	.name-row input {
		flex: 1;
		min-width: 0;
		background: var(--color-bg-tertiary);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: var(--spacing-sm);
		font-size: 0.875rem;
	}

	.extension {
		font-size: 0.875rem;
		color: var(--color-text-muted);
	}

	.modal-footer {
		padding: var(--spacing-sm) var(--spacing-md) var(--spacing-md);
		display: flex;
		justify-content: flex-end;
		gap: var(--spacing-sm);
	}

	.cancel-btn {
		background: var(--color-bg-tertiary);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: var(--spacing-sm) var(--spacing-md);
		font-size: 0.875rem;
		cursor: pointer;
	}

	.cancel-btn:hover {
		background: var(--color-border);
	}

	.save-btn {
		background: var(--color-accent);
		color: white;
		border: none;
		border-radius: var(--radius-sm);
		padding: var(--spacing-sm) var(--spacing-md);
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
	}

	.save-btn:hover:not(:disabled) {
		background: var(--color-accent-hover);
	}

	.save-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
