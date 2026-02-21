<script lang="ts">
	import { project, stateHashes, needsCalculation as needsCalcStore } from '$lib/stores/project';
	import { calculationProgress } from '$lib/stores/calculationProgress';
	import {
		calculateSession,
		checkLampsSession,
		getCalculationEstimate,
		ApiError,
		parseBudgetError,
		type BudgetError
	} from '$lib/api/client';
	import type { ZoneResult, ZoneDimensionSnapshot, CalcZone } from '$lib/types/project';
	import BudgetExceededModal from './BudgetExceededModal.svelte';
	import { enterToggle } from '$lib/actions/enterToggle';
	import { get } from 'svelte/store';

	const STORAGE_KEY = 'illuminate_autorecalculate';
	const DEBOUNCE_MS = 800;

	let isCalculating = $state(false);
	let error = $state<string | null>(null);
	let budgetError = $state<BudgetError | null>(null);
	let autorecalculate = $state(
		typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) === 'true'
	);
	let lastAutoCalcFailed = $state(false);

	function toggleAutorecalculate(checked: boolean) {
		autorecalculate = checked;
		localStorage.setItem(STORAGE_KEY, String(checked));
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
		if (error || budgetError) {
			lastAutoCalcFailed = true;
		}
	}

	function snapshotDimensions(zone: CalcZone): ZoneDimensionSnapshot {
		if (zone.type === 'volume') {
			return {
				x_min: zone.x_min, x_max: zone.x_max,
				y_min: zone.y_min, y_max: zone.y_max,
				z_min: zone.z_min, z_max: zone.z_max,
				num_x: zone.num_x, num_y: zone.num_y, num_z: zone.num_z,
			};
		}
		return {
			x1: zone.x1, x2: zone.x2,
			y1: zone.y1, y2: zone.y2,
			height: zone.height,
			ref_surface: zone.ref_surface,
			num_x: zone.num_x, num_y: zone.num_y,
		};
	}

	async function calculate() {
		isCalculating = true;
		error = null;
		budgetError = null;

		try {
			// Ensure session is initialized
			if (!project.isSessionInitialized()) {
				await project.initSession();
			}

			// Get estimate first to show progress
			let estimatedSeconds = 5; // default
			try {
				const estimate = await getCalculationEstimate();
				// Add a minimum of 1 second and some buffer for network overhead
				estimatedSeconds = Math.max(1, estimate.estimated_seconds * 1.2 + 0.5);
			} catch {
				// If estimate fails, use default
			}

			// Start global progress tracking
			calculationProgress.startCalculation(estimatedSeconds);

			const result = await calculateSession();

			if (result.success && result.zones) {
				const zoneResults: Record<string, ZoneResult> = {};
				const currentZones = get(project).zones;

				for (const [zoneId, apiZone] of Object.entries(result.zones)) {
					const zone = currentZones.find(z => z.id === zoneId);
					zoneResults[zoneId] = {
						zone_id: apiZone.zone_id,
						zone_name: apiZone.zone_name,
						zone_type: apiZone.zone_type,
						statistics: apiZone.statistics,
						units: 'µW/cm²',
						num_points: apiZone.num_points,
						values: apiZone.values,
						dimensionSnapshot: zone ? snapshotDimensions(zone) : undefined,
						doseAtCalcTime: zone?.dose ?? false,
						hoursAtCalcTime: zone?.hours ?? 8
					};
				}

				// Save state hashes from the calculate response as "last calculated"
				if (result.state_hashes) {
					stateHashes.update(sh => ({
						...sh,
						lastCalculated: result.state_hashes!,
						current: result.state_hashes!,
					}));
				}
				// Backend returns UTC datetime without Z suffix (e.g. "2026-02-09 18:33:00"),
				// so append 'Z' to ensure it's parsed as UTC rather than local time.
				let calculatedAt = 'calculated_at' in result ? String(result.calculated_at) : new Date().toISOString();
				if (calculatedAt && !calculatedAt.endsWith('Z') && !calculatedAt.includes('+')) {
					calculatedAt = calculatedAt.replace(' ', 'T') + 'Z';
				}

				// Set results immediately (without check_lamps) so UI updates fast
				project.setResults({
					calculatedAt,
					lastStateHashes: result.state_hashes ?? undefined,
					zones: zoneResults,
				});

				// Fire check_lamps concurrently — update results when it arrives
				const currentProject = get(project);
				if (currentProject.room.useStandardZones) {
					checkLampsSession().then((checkLampsResult) => {
						const latest = get(project);
						if (latest.results) {
							project.setResults({
								...latest.results,
								checkLamps: checkLampsResult,
							});
						}
					}).catch((e) => {
						console.warn('check_lamps failed:', e);
					});
				}

				error = null;
			} else {
				error = 'Simulation failed';
			}
		} catch (e) {
			const parsedBudgetError = parseBudgetError(e);
			if (parsedBudgetError) {
				budgetError = parsedBudgetError;
			} else if (e instanceof ApiError) {
				if (e.status === 503) {
					error = 'Server busy. Please try again in a moment.';
				} else if (e.status === 408) {
					error = 'Calculation timed out. Try reducing grid resolution.';
				} else {
					error = `API Error (${e.status}): ${e.message}`;
				}
			} else if (e instanceof Error) {
				error = e.message;
			} else {
				error = 'Unknown error occurred';
			}
			console.error('Calculation error:', e);
		} finally {
			calculationProgress.stopCalculation();
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
