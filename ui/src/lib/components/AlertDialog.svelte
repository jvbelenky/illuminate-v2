<script lang="ts">
	import Modal from './Modal.svelte';

	interface Props {
		title: string;
		message: string;
		buttonLabel?: string;
		variant?: 'error' | 'warning' | 'info';
		onDismiss: () => void;
	}

	let {
		title,
		message,
		buttonLabel = 'OK',
		variant = 'error',
		onDismiss
	}: Props = $props();

	const variantColors: Record<string, string> = {
		error: 'var(--color-error)',
		warning: 'var(--color-warning)',
		info: 'var(--color-info)'
	};
</script>

<Modal
	{title}
	onClose={onDismiss}
	draggable={false}
	minimizable={false}
	showCloseButton={false}
	zIndex={2000}
	maxWidth="min(400px, 90vw)"
	titleStyle="color: {variantColors[variant] || variantColors.error}"
	titleFontSize="1rem"
>
	{#snippet body()}
		<div class="modal-body">
			<p>{message}</p>
		</div>
		<div class="modal-footer">
			<button class="dismiss-btn" onclick={onDismiss}>{buttonLabel}</button>
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
	}

	.dismiss-btn {
		background: var(--color-bg-tertiary);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: var(--spacing-sm) var(--spacing-md);
		font-size: 0.875rem;
		cursor: pointer;
	}

	.dismiss-btn:hover {
		background: var(--color-border);
	}
</style>
