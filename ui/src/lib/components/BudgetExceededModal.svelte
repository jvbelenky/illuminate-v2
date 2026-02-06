<script lang="ts">
	import type { BudgetError } from '$lib/api/client';

	interface Props {
		budgetError: BudgetError;
		onClose: () => void;
	}

	let { budgetError, onClose }: Props = $props();

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			onClose();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			onClose();
		}
	}

	function formatNumber(n: number): string {
		return n.toLocaleString();
	}

	// Calculate total zone cost for percentage calculations
	const totalZoneCost = $derived(
		budgetError.breakdown.zones.reduce((sum, z) => sum + z.cost, 0)
	);

	// Get zones sorted by cost (highest first), limited to top 5
	const topZones = $derived(
		[...budgetError.breakdown.zones]
			.sort((a, b) => b.cost - a.cost)
			.slice(0, 5)
	);

	// Check if there are more zones not shown
	const hiddenZoneCount = $derived(
		Math.max(0, budgetError.breakdown.zones.length - 5)
	);
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={handleBackdropClick}>
	<div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="budget-title">
		<div class="modal-header">
			<h2 id="budget-title">Calculation Too Large</h2>
			<button type="button" class="close-btn" onclick={onClose} title="Close">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M18 6L6 18M6 6l12 12"/>
				</svg>
			</button>
		</div>

		<div class="modal-body">
			<section class="summary">
				<p>
					Your session is using <strong>{budgetError.budget.percent}%</strong> of the
					maximum compute budget.
				</p>
				<div class="budget-bar-container">
					<div class="budget-bar" style="width: {Math.min(100, budgetError.budget.percent)}%"></div>
					<div class="budget-limit-marker"></div>
				</div>
				<p class="budget-numbers">
					{formatNumber(budgetError.budget.used)} / {formatNumber(budgetError.budget.max)} units
				</p>
			</section>

			<section class="breakdown">
				<h3>Calculation Zones</h3>

				{#each topZones as zone}
					<div class="breakdown-item">
						<div class="breakdown-header">
							<span class="label">
								<span class="zone-type" class:volume={zone.type === 'volume'}>{zone.type}</span>
								{zone.name}
							</span>
							<span class="value">{formatNumber(zone.grid_points)} pts</span>
						</div>
						<div class="bar-container">
							<div class="bar zone" style="width: {zone.percent}%"></div>
						</div>
						<span class="percent">{zone.percent}% of budget</span>
					</div>
				{/each}

				{#if hiddenZoneCount > 0}
					<p class="more-zones">+ {hiddenZoneCount} more zone{hiddenZoneCount > 1 ? 's' : ''}</p>
				{/if}
			</section>

			<section class="breakdown other-resources">
				<h3>Other Resources</h3>

				<div class="breakdown-item">
					<div class="breakdown-header">
						<span class="label">Lamps with IES data</span>
						<span class="value">{budgetError.breakdown.lamps.count}</span>
					</div>
					<div class="bar-container">
						<div class="bar lamps" style="width: {budgetError.breakdown.lamps.percent}%"></div>
					</div>
					<span class="percent">{budgetError.breakdown.lamps.percent}% of budget</span>
				</div>

				{#if budgetError.breakdown.reflectance}
					<div class="breakdown-item">
						<div class="breakdown-header">
							<span class="label">Reflectance ({budgetError.breakdown.reflectance.passes} passes)</span>
							<span class="value">{formatNumber(budgetError.breakdown.reflectance.grid_points)} pts</span>
						</div>
						<div class="bar-container">
							<div class="bar reflectance" style="width: {budgetError.breakdown.reflectance.percent}%"></div>
						</div>
						<span class="percent">{budgetError.breakdown.reflectance.percent}% of budget</span>
					</div>
				{/if}
			</section>

			{#if budgetError.suggestions.length > 0}
				<section class="suggestions">
					<h3>How to Reduce</h3>
					<ul>
						{#each budgetError.suggestions as suggestion}
							<li>{suggestion}</li>
						{/each}
					</ul>
				</section>
			{/if}

			<div class="actions">
				<button type="button" class="primary-btn" onclick={onClose}>
					Close
				</button>
			</div>
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
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: var(--spacing-md);
	}

	.modal-content {
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		max-width: 520px;
		width: 90%;
		max-height: 85vh;
		display: flex;
		flex-direction: column;
		box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
	}

	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--spacing-sm) var(--spacing-md);
		border-bottom: 1px solid var(--color-border);
		flex-shrink: 0;
	}

	.modal-header h2 {
		margin: 0;
		font-size: 1.25rem;
		color: var(--color-error);
	}

	.close-btn {
		background: transparent;
		border: none;
		padding: var(--spacing-xs);
		cursor: pointer;
		color: var(--color-text-muted);
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-sm);
		transition: all 0.15s;
	}

	.close-btn:hover {
		background: var(--color-bg-tertiary);
		color: var(--color-text);
	}

	.modal-body {
		padding: var(--spacing-md);
		overflow-y: auto;
		flex: 1;
	}

	.summary {
		margin-bottom: var(--spacing-md);
		text-align: center;
	}

	.summary p {
		margin: 0 0 var(--spacing-sm) 0;
		color: var(--color-text-muted);
	}

	.summary strong {
		color: var(--color-error);
		font-size: 1.1em;
	}

	.budget-bar-container {
		position: relative;
		height: 12px;
		background: var(--color-bg-tertiary);
		border-radius: var(--radius-sm);
		overflow: visible;
	}

	.budget-bar {
		height: 100%;
		background: var(--color-error);
		border-radius: var(--radius-sm);
		transition: width 0.3s ease;
	}

	.budget-limit-marker {
		position: absolute;
		right: 0;
		top: -2px;
		bottom: -2px;
		width: 2px;
		background: var(--color-text-muted);
	}

	.budget-numbers {
		font-size: 0.85rem;
		color: var(--color-text-muted);
		margin-top: var(--spacing-xs);
	}

	.breakdown {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--spacing-md);
		margin-bottom: var(--spacing-md);
	}

	.breakdown h3 {
		margin: 0 0 var(--spacing-sm) 0;
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.other-resources {
		background: var(--color-bg);
	}

	.breakdown-item {
		margin-bottom: var(--spacing-sm);
	}

	.breakdown-item:last-child {
		margin-bottom: 0;
	}

	.breakdown-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--spacing-xs);
		gap: var(--spacing-sm);
	}

	.label {
		font-size: 0.85rem;
		color: var(--color-text);
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.zone-type {
		font-size: 0.7rem;
		padding: 1px 4px;
		border-radius: 3px;
		background: var(--color-bg-tertiary);
		color: var(--color-text-muted);
		text-transform: uppercase;
		flex-shrink: 0;
	}

	.zone-type.volume {
		background: rgba(167, 139, 250, 0.2);
		color: #a78bfa;
	}

	.value {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--color-text-muted);
		font-family: var(--font-mono);
		flex-shrink: 0;
	}

	.bar-container {
		height: 6px;
		background: var(--color-bg-tertiary);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}

	.bar {
		height: 100%;
		border-radius: var(--radius-sm);
		transition: width 0.3s ease;
	}

	.bar.zone {
		background: #60a5fa; /* Blue */
	}

	.bar.lamps {
		background: #f472b6; /* Pink */
	}

	.bar.reflectance {
		background: #a78bfa; /* Purple */
	}

	.percent {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		opacity: 0.8;
	}

	.more-zones {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		margin: var(--spacing-xs) 0 0 0;
		font-style: italic;
	}

	.suggestions {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--spacing-md);
		margin-bottom: var(--spacing-md);
	}

	.suggestions h3 {
		margin: 0 0 var(--spacing-sm) 0;
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.suggestions ul {
		margin: 0;
		padding-left: var(--spacing-md);
	}

	.suggestions li {
		font-size: 0.85rem;
		color: var(--color-text-muted);
		line-height: 1.5;
		margin-bottom: var(--spacing-xs);
	}

	.suggestions li:last-child {
		margin-bottom: 0;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
	}

	.primary-btn {
		background: var(--color-accent);
		color: white;
		border: none;
		padding: var(--spacing-sm) var(--spacing-lg);
		border-radius: var(--radius-md);
		font-weight: 600;
		cursor: pointer;
		transition: background 0.15s;
	}

	.primary-btn:hover {
		background: var(--color-accent-hover);
	}
</style>
