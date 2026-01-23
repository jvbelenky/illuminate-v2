<script lang="ts">
	import { project, lamps, results, getRequestState } from '$lib/stores/project';
	import { calculateSession, ApiError } from '$lib/api/client';
	import type { Project, ZoneResult } from '$lib/types/project';

	let isCalculating = $state(false);
	let error = $state<string | null>(null);

	// Subscribe to full project for request state tracking
	let currentProject = $state<Project | null>(null);
	project.subscribe(p => currentProject = p);

	// Determine if recalculation is needed by comparing current request state to last request
	const needsCalculation = $derived.by(() => {
		if (!currentProject) return false;

		const currentResults = $results;

		// No results yet = needs calculation
		if (!currentResults) return true;

		// Compare current request state with last request state
		// This catches: lamp added/removed/modified, lamp enabled/disabled, zone changes, room changes
		const currentRequestState = getRequestState(currentProject);
		if (currentResults.lastRequestState !== currentRequestState) {
			return true;
		}

		return false;
	});

	async function calculate() {
		isCalculating = true;
		error = null;

		try {
			// Re-initialize session to ensure backend matches frontend state
			// This handles race conditions where lamps were added before session init completed
			await project.initSession();

			const result = await calculateSession();

			if (result.success && result.zones) {
				// Convert API zone results to our ZoneResult format
				const zoneResults: Record<string, ZoneResult> = {};

				for (const [zoneId, apiZone] of Object.entries(result.zones)) {
					zoneResults[zoneId] = {
						zone_id: apiZone.zone_id,
						zone_name: apiZone.zone_name,
						zone_type: apiZone.zone_type,
						statistics: apiZone.statistics,
						units: 'µW/cm²',
						num_points: apiZone.num_points,
						values: apiZone.values
					};
				}

				project.setResults({
					calculatedAt: 'calculated_at' in result ? result.calculated_at : new Date().toISOString(),
					lastRequestState: currentProject ? getRequestState(currentProject) : undefined,
					zones: zoneResults
				});
				error = null;
			} else {
				error = 'Simulation failed';
			}
		} catch (e) {
			if (e instanceof ApiError) {
				error = `API Error (${e.status}): ${e.message}`;
			} else if (e instanceof Error) {
				error = e.message;
			} else {
				error = 'Unknown error occurred';
			}
			console.error('Calculation error:', e);
		} finally {
			isCalculating = false;
		}
	}
</script>

<div class="calculate-wrapper">
	<button
		class="calculate-btn"
		class:needs-calc={needsCalculation}
		class:up-to-date={!needsCalculation}
		class:has-error={!!error}
		onclick={calculate}
		disabled={isCalculating}
		title={error || ''}
	>
		{isCalculating ? 'Calculating...' : 'Calculate'}
	</button>
	{#if error}
		<span class="error-indicator" title={error}>!</span>
	{/if}
</div>

<style>
	.calculate-wrapper {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
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

	/* Green when calculation is needed */
	.calculate-btn.needs-calc {
		background: var(--color-success);
		border-color: var(--color-success);
		color: #000;
		box-shadow: 0 0 12px rgba(74, 222, 128, 0.4);
	}

	.calculate-btn.needs-calc:hover:not(:disabled) {
		background: #22d37e;
		transform: scale(1.02);
		box-shadow: 0 0 16px rgba(74, 222, 128, 0.5);
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

	.calculate-btn:disabled {
		background: var(--color-bg-tertiary);
		border-color: var(--color-border);
		color: var(--color-text-muted);
		cursor: not-allowed;
		opacity: 0.6;
	}

	.calculate-btn.has-error {
		border-color: #dc2626;
	}

	.error-indicator {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		background: #dc2626;
		color: white;
		border-radius: 50%;
		font-size: 0.75rem;
		font-weight: bold;
		cursor: help;
	}
</style>
