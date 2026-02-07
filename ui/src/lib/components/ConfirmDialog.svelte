<script lang="ts">
	import { autoFocus } from '$lib/actions/autoFocus';

	interface Props {
		title: string;
		message: string;
		confirmLabel?: string;
		cancelLabel?: string;
		variant?: 'danger' | 'warning';
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

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			onCancel();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			onCancel();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={handleBackdropClick}>
	<div class="modal-content" role="dialog" aria-modal="true" aria-label={title} use:autoFocus>
		<div class="modal-header">
			<h3>{title}</h3>
		</div>
		<div class="modal-body">
			<p>{message}</p>
		</div>
		<div class="modal-footer">
			<button class="cancel-btn" onclick={onCancel}>{cancelLabel}</button>
			<button class="confirm-btn {variant}" onclick={onConfirm}>{confirmLabel}</button>
		</div>
	</div>
</div>

<style>
	.modal-backdrop {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 2000;
		padding: var(--spacing-md);
	}

	.modal-content {
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		width: min(400px, 90vw);
		box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
	}

	.modal-header {
		padding: var(--spacing-md) var(--spacing-md) 0;
	}

	.modal-header h3 {
		margin: 0;
		font-size: 1rem;
	}

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
</style>
