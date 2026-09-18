<script lang="ts">
	import type { NextStep, NextStepAction } from '$lib/stores/nextStep';
	import { calculationProgress } from '$lib/stores/calculationProgress';

	interface Props {
		step: NextStep;
		onAction: (action: NextStepAction) => void;
	}

	let { step, onAction }: Props = $props();

	const progressPercent = calculationProgress.progressPercent;
	const timeRemaining = calculationProgress.timeRemaining;
</script>

<div class="next-step tone-{step.tone}" data-next-step={step.id} role="status" aria-live="polite">
	<div class="next-step-body">
		<span class="next-step-kicker">Next step</span>
		<p class="next-step-title">{step.title}</p>
		{#if step.tone === 'progress' && step.id === 'calculating'}
			<div class="progress-track" aria-hidden="true">
				<div class="progress-fill" style="width: {$progressPercent}%"></div>
			</div>
			<p class="next-step-detail">{$timeRemaining || step.detail}</p>
		{:else}
			<p class="next-step-detail">{step.detail}</p>
		{/if}
	</div>
	{#if step.action && step.actionLabel}
		<button
			class="next-step-action"
			class:danger={step.tone === 'danger'}
			onclick={() => onAction(step.action!)}
		>
			{step.actionLabel}
		</button>
	{/if}
</div>

<style>
	.next-step {
		--tone: var(--color-primary);
		position: sticky;
		top: calc(-1 * var(--spacing-md));
		z-index: 2;
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
		padding: var(--spacing-sm) var(--spacing-md) var(--spacing-md) var(--spacing-md);
		margin-bottom: var(--spacing-sm);
		border-left: 3px solid var(--tone);
		border-radius: 0 var(--radius-md) var(--radius-md) 0;
		background: color-mix(in srgb, var(--tone) 9%, var(--color-bg-secondary));
		box-shadow: 0 var(--spacing-md) 0 var(--color-bg);
	}
	.next-step.tone-success { --tone: var(--color-success); }
	.next-step.tone-warning { --tone: var(--color-warning); }
	.next-step.tone-danger { --tone: var(--color-danger); }
	.next-step.tone-progress { --tone: var(--color-primary); }

	.next-step-body {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.next-step-kicker {
		font-size: var(--font-size-xs);
		color: var(--tone);
		font-weight: 600;
	}
	.next-step-title {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
		line-height: 1.25;
		color: var(--color-text);
	}
	.next-step-detail {
		margin: 2px 0 0 0;
		font-size: var(--font-size-base);
		line-height: 1.4;
		color: var(--color-text-muted);
	}

	.next-step-action {
		align-self: flex-start;
		background: var(--tone);
		color: #fff;
		font-weight: 600;
		padding: var(--spacing-sm) var(--spacing-md);
	}
	.next-step-action:hover {
		background: color-mix(in srgb, var(--tone) 85%, #000);
	}
	.next-step.tone-warning .next-step-action {
		color: #1f2328;
	}

	.progress-track {
		height: 4px;
		margin-top: var(--spacing-xs);
		border-radius: 2px;
		background: color-mix(in srgb, var(--tone) 25%, transparent);
		overflow: hidden;
	}
	.progress-fill {
		height: 100%;
		background: var(--tone);
		transition: width 0.2s linear;
	}
	@media (prefers-reduced-motion: reduce) {
		.progress-fill { transition: none; }
	}
</style>
