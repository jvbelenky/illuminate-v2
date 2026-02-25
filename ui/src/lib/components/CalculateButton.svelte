<script lang="ts">
	import { needsCalculation as needsCalcStore } from '$lib/stores/project';
	import { performCalculation } from '$lib/utils/calculate';
	import type { BudgetError } from '$lib/api/client';
	import BudgetExceededModal from './BudgetExceededModal.svelte';
	import { enterToggle } from '$lib/actions/enterToggle';
	import { userSettings } from '$lib/stores/settings';

	interface Props {
		onCalculated?: () => void;
	}

	let { onCalculated }: Props = $props();

	const DEBOUNCE_MS = 800;

	let isCalculating = $state(false);
	let error = $state<string | null>(null);
	let budgetError = $state<BudgetError | null>(null);
	let autorecalculate = $derived($userSettings.autoRecalculate);
	let lastAutoCalcFailed = $state(false);

	function toggleAutorecalculate(checked: boolean) {
		userSettings.update(s => ({ ...s, autoRecalculate: checked }));
	}

	// Use store-based staleness detection from backend state hashes
	const needsCalculation = $derived($needsCalcStore);

	// Reset failure guard when user makes a new change
	$effect(() => {
		if (needsCalculation) {
			lastAutoCalcFailed = false;
		}
	});

	// Auto-calculation scheduling
	$effect(() => {
		const shouldAutoCalc =
			autorecalculate && needsCalculation && !isCalculating && !lastAutoCalcFailed;

		if (!shouldAutoCalc) return;

		const timer = setTimeout(() => {
			if (isCalculating) return;
			autoCalculate();
		}, DEBOUNCE_MS);

		return () => clearTimeout(timer);
	});

	async function autoCalculate() {
		try {
			await calculate();
		} catch {
			// calculate() handles its own errors, but if something unexpected
			// happens, mark as failed to prevent infinite retries
		}
		if (budgetError) {
			// Budget exceeded — disable autorecalculate to stop repeated failures
			toggleAutorecalculate(false);
		} else if (error) {
			lastAutoCalcFailed = true;
		}
	}

	async function calculate() {
		isCalculating = true;
		error = null;
		budgetError = null;

		try {
			const result = await performCalculation();

			if (result.success) {
				onCalculated?.();
				error = null;
			} else if (result.budgetError) {
				budgetError = result.budgetError;
			} else {
				error = result.error || 'Simulation failed';
				console.error('Calculation error:', result.error);
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Unknown error occurred';
			console.error('Calculation error:', e);
		} finally {
			isCalculating = false;
		}
	}

	function closeBudgetModal() {
		budgetError = null;
	}
</script>

<div class="calculate-wrapper">
	<div class="calculate-row">
		{#if isCalculating}
			<span class="spinner"></span>
		{/if}
		<button
			class="calculate-btn"
			class:needs-calc={needsCalculation}
			class:up-to-date={!needsCalculation}
			class:has-error={!!error}
			class:calculating={isCalculating}
			onclick={calculate}
			disabled={isCalculating}
			title={error || ''}
		>
			Calculate
		</button>
		{#if error}
			<span class="error-indicator" title={error}>!</span>
		{/if}
	</div>
	<label class="autorecalc-label">
		<input
			type="checkbox"
			checked={autorecalculate}
			onchange={(e) => toggleAutorecalculate(e.currentTarget.checked)}
			use:enterToggle
		/>
		<span>Autorecalculate</span>
	</label>
</div>

{#if budgetError}
	<BudgetExceededModal {budgetError} onClose={closeBudgetModal} />
{/if}

<style>
	.calculate-wrapper {
		display: inline-flex;
		flex-direction: column;
		align-items: stretch;
		gap: var(--spacing-xs);
	}

	.calculate-row {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
	}

	.autorecalc-label {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		padding-left: 2px;
		font-size: 0.8rem;
		color: var(--color-text-muted);
		cursor: pointer;
		user-select: none;
	}

	.autorecalc-label input[type='checkbox'] {
		cursor: pointer;
		margin: 0;
		width: 12px;
		height: 12px;
	}

	.calculate-btn {
		padding: var(--spacing-sm) var(--spacing-lg);
		font-size: 1rem;
		font-weight: 600;
		background: var(--color-bg-tertiary);
		border: 2px solid var(--color-border);
		border-radius: var(--radius-md);
		transition: background 0.2s, border-color 0.2s, transform 0.1s;
		white-space: nowrap;
		min-width: 120px;
	}

	.spinner {
		width: 16px;
		height: 16px;
		border: 2px solid var(--color-accent);
		border-top-color: transparent;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
		flex-shrink: 0;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* Red when calculation is needed */
	.calculate-btn.needs-calc {
		background: var(--color-accent);
		border-color: var(--color-accent);
		color: #fff;
		box-shadow: 0 0 12px rgba(233, 69, 96, 0.4);
	}

	.calculate-btn.needs-calc:focus-visible {
		box-shadow: 0 0 12px rgba(233, 69, 96, 0.4), 0 0 0 2px rgba(255, 255, 255, 0.8);
	}

	.calculate-btn.needs-calc:hover:not(:disabled) {
		background: var(--color-accent-hover);
		transform: scale(1.02);
		box-shadow: 0 0 16px rgba(233, 69, 96, 0.5);
	}

	/* Neutral when up to date */
	.calculate-btn.up-to-date {
		background: var(--color-bg-tertiary);
		border-color: var(--color-border);
		color: var(--color-text-muted);
	}

	.calculate-btn.up-to-date:hover:not(:disabled) {
		background: var(--color-bg-secondary);
		border-color: var(--color-text-muted);
		color: var(--color-text);
	}

	/* Calculating state */
	.calculate-btn.calculating {
		background: var(--color-bg-secondary);
		border-color: var(--color-border);
		color: var(--color-text);
	}

	.calculate-btn:disabled {
		cursor: not-allowed;
		opacity: 0.9;
	}

	.calculate-btn.has-error {
		border-color: var(--color-error);
	}

	.error-indicator {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		background: var(--color-error);
		color: white;
		border-radius: 50%;
		font-size: 0.75rem;
		font-weight: bold;
		cursor: help;
	}
</style>
