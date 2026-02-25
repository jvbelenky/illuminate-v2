<script lang="ts">
	import Modal from './Modal.svelte';

	interface Props {
		title: string;
		message: string;
		confirmLabel?: string;
		cancelLabel?: string;
		variant?: 'danger' | 'warning' | 'success';
		onConfirm: () => void;
		onCancel: () => void;
	}

	let {
		title,
		message,
		confirmLabel = 'Delete',
		cancelLabel = 'Cancel',
		variant = 'danger',
		onConfirm,
		onCancel
	}: Props = $props();

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			onConfirm();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<Modal
	{title}
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
			<p>{message}</p>
		</div>
		<div class="modal-footer">
			<button class="cancel-btn" onclick={onCancel}>{cancelLabel}</button>
			<button class="confirm-btn {variant}" onclick={onConfirm}>{confirmLabel}</button>
		</div>
	{/snippet}
</Modal>

<style>
	.modal-body {
		padding: var(--spacing-sm) var(--spacing-md);
	}

	.modal-body p {
		margin: 0;
		font-size: 0.875rem;
		color: var(--color-text-muted);
		line-height: 1.5;
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

	.confirm-btn {
		border: none;
		border-radius: var(--radius-sm);
		padding: var(--spacing-sm) var(--spacing-md);
		font-size: 0.875rem;
		cursor: pointer;
		font-weight: 600;
	}

	.confirm-btn.danger {
		background: var(--color-error);
		color: white;
	}

	.confirm-btn.danger:hover {
		background: color-mix(in srgb, var(--color-error) 85%, black);
	}

	.confirm-btn.warning {
		background: var(--color-warning);
		color: black;
	}

	.confirm-btn.warning:hover {
		background: color-mix(in srgb, var(--color-warning) 85%, black);
	}

	.confirm-btn.success {
		background: var(--color-success);
		color: white;
	}

	.confirm-btn.success:hover {
		background: color-mix(in srgb, var(--color-success) 85%, black);
	}
</style>
