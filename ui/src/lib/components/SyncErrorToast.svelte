<script lang="ts">
	import { syncErrors, type SyncError } from '$lib/stores/project';

	// Auto-dismiss after 5 seconds
	const AUTO_DISMISS_MS = 5000;

	// Set up auto-dismiss timers
	$effect(() => {
		const errors = $syncErrors;
		errors.forEach((error) => {
			const age = Date.now() - error.timestamp;
			if (age < AUTO_DISMISS_MS) {
				const remaining = AUTO_DISMISS_MS - age;
				setTimeout(() => syncErrors.dismiss(error.id), remaining);
			}
		});
	});
</script>

{#if $syncErrors.length > 0}
	<div class="toast-container">
		{#each $syncErrors as error (error.id)}
			<div class="toast {error.type}">
				<div class="toast-content">
					<span class="toast-icon">
						{#if error.type === 'error'}!{:else if error.type === 'warning'}!{:else}i{/if}
					</span>
					<div class="toast-text">
						<strong>
							{#if error.type === 'error'}Sync failed:{:else if error.type === 'warning'}Warning:{:else}Info:{/if}
						</strong> {error.operation}
						<div class="toast-message">{error.message}</div>
					</div>
				</div>
				<button class="toast-close" onclick={() => syncErrors.dismiss(error.id)}>
					&times;
				</button>
			</div>
		{/each}
	</div>
{/if}

<style>
	.toast-container {
		position: fixed;
		bottom: 20px;
		right: 20px;
		z-index: 9999;
		display: flex;
		flex-direction: column;
		gap: 8px;
		max-width: 400px;
	}

	.toast {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 12px 16px;
		border-radius: var(--radius-md);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
		animation: slideIn 0.2s ease-out;
	}

	.toast.error {
		background: var(--color-error-bg, #2d1f1f);
		border: 1px solid var(--color-error, #dc3545);
		color: var(--color-error-text, #f8d7da);
	}

	.toast.warning {
		background: var(--color-warning-bg, #2d2a1f);
		border: 1px solid var(--color-warning, #ffc107);
		color: var(--color-warning-text, #fff3cd);
	}

	.toast.info {
		background: var(--color-info-bg, #1f2a2d);
		border: 1px solid var(--color-info, #17a2b8);
		color: var(--color-info-text, #d1ecf1);
	}

	.toast-content {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		flex: 1;
	}

	.toast-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		color: white;
		font-weight: bold;
		font-size: 12px;
		flex-shrink: 0;
	}

	.toast.error .toast-icon {
		background: var(--color-error, #dc3545);
	}

	.toast.warning .toast-icon {
		background: var(--color-warning, #ffc107);
		color: #000;
	}

	.toast.info .toast-icon {
		background: var(--color-info, #17a2b8);
	}

	.toast-text {
		flex: 1;
		font-size: 0.875rem;
	}

	.toast.error .toast-text strong {
		color: var(--color-error, #dc3545);
	}

	.toast.warning .toast-text strong {
		color: var(--color-warning, #ffc107);
	}

	.toast.info .toast-text strong {
		color: var(--color-info, #17a2b8);
	}

	.toast-message {
		margin-top: 4px;
		font-size: 0.8rem;
		opacity: 0.8;
		word-break: break-word;
	}

	.toast-close {
		background: none;
		border: none;
		color: inherit;
		font-size: 1.25rem;
		cursor: pointer;
		padding: 0;
		line-height: 1;
		opacity: 0.6;
	}

	.toast-close:hover {
		opacity: 1;
	}

	@keyframes slideIn {
		from {
			transform: translateX(100%);
			opacity: 0;
		}
		to {
			transform: translateX(0);
			opacity: 1;
		}
	}
</style>
