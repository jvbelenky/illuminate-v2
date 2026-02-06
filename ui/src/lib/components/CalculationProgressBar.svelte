<script lang="ts">
	import { calculationProgress } from '$lib/stores/calculationProgress';

	const { progressPercent, timeRemaining } = calculationProgress;

	let isCalculating = $state(false);
	let progress = $state(0);
	let remaining = $state('');

	$effect(() => {
		const unsubscribe = calculationProgress.subscribe((state) => {
			isCalculating = state.isCalculating;
		});
		return unsubscribe;
	});

	$effect(() => {
		const unsubscribe = progressPercent.subscribe((value) => {
			progress = value;
		});
		return unsubscribe;
	});

	$effect(() => {
		const unsubscribe = timeRemaining.subscribe((value) => {
			remaining = value;
		});
		return unsubscribe;
	});
</script>

<div class="progress-overlay" class:active={isCalculating}>
	<div class="progress-content">
		<div class="progress-bar-container">
			<div class="progress-bar" style="width: {isCalculating ? progress : 0}%"></div>
		</div>
		<div class="progress-info">
			{#if isCalculating}
				<span class="progress-label">
					<span class="spinner"></span>
					Calculating...
				</span>
				{#if remaining}
					<span class="time-remaining">{remaining}</span>
				{/if}
			{:else}
				<span class="progress-label idle">Ready</span>
			{/if}
		</div>
	</div>
</div>

<style>
	.progress-overlay {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		background: var(--color-bg-secondary);
		border-top: 1px solid var(--color-border);
		z-index: 1000;
		padding: var(--spacing-sm) var(--spacing-md);
	}

	.progress-content {
		max-width: 1400px;
		margin: 0 auto;
	}

	.progress-bar-container {
		height: 6px;
		background: var(--color-bg-tertiary);
		border-radius: var(--radius-sm);
		overflow: hidden;
		margin-bottom: var(--spacing-xs);
	}

	.progress-bar {
		height: 100%;
		background: linear-gradient(90deg, var(--color-accent) 0%, #f472b6 100%);
		border-radius: var(--radius-sm);
		transition: width 0.1s linear;
	}

	.progress-info {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: 0.8rem;
	}

	.progress-label {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		color: var(--color-text);
		font-weight: 500;
	}

	.spinner {
		width: 12px;
		height: 12px;
		border: 2px solid var(--color-accent);
		border-top-color: transparent;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.time-remaining {
		color: var(--color-text-muted);
	}

	.progress-label.idle {
		color: var(--color-text-muted);
	}

	.progress-overlay:not(.active) .progress-bar-container {
		opacity: 0.5;
	}
</style>
