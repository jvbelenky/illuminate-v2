<script lang="ts">
	import { autoFocus } from '$lib/actions/autoFocus';

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

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			onDismiss();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			onDismiss();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={handleBackdropClick}>
	<div class="modal-content" role="dialog" aria-modal="true" aria-label={title} use:autoFocus>
		<div class="modal-header">
			<h3 class={variant}>{title}</h3>
		</div>
		<div class="modal-body">
			<p>{message}</p>
		</div>
		<div class="modal-footer">
			<button class="dismiss-btn" onclick={onDismiss}>{buttonLabel}</button>
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

	.modal-header h3.error {
		color: var(--color-error);
	}

	.modal-header h3.warning {
		color: var(--color-warning);
	}

	.modal-header h3.info {
		color: var(--color-info);
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
