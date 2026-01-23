<script lang="ts">
	import { results } from '$lib/stores/project';
</script>

{#if $results}
	<div class="results-panel">
		<div class="panel-header">
			<h3 class="mb-0">Results</h3>
			<span class="timestamp">
				{new Date($results.calculatedAt).toLocaleTimeString()}
			</span>
		</div>

		{#each Object.values($results.zones) as zone}
			<div class="result-item">
				<div class="result-label">{zone.zone_name || zone.zone_id}</div>
				<div class="result-values">
					{#if zone.statistics.mean !== undefined}
						<div class="result-row">
							<span class="label">Mean:</span>
							<span class="value">{zone.statistics.mean.toFixed(2)} {zone.units}</span>
						</div>
					{/if}
					{#if zone.statistics.max !== undefined}
						<div class="result-row">
							<span class="label">Max:</span>
							<span class="value">{zone.statistics.max.toFixed(2)} {zone.units}</span>
						</div>
					{/if}
					{#if zone.statistics.min !== undefined}
						<div class="result-row">
							<span class="label">Min:</span>
							<span class="value">{zone.statistics.min.toFixed(2)} {zone.units}</span>
						</div>
					{/if}
				</div>
			</div>
		{/each}
	</div>
{/if}

<style>
	.results-panel {
		background: var(--color-bg);
		border: 1px solid var(--color-success);
		border-radius: var(--radius-md);
		padding: var(--spacing-md);
		margin-top: var(--spacing-md);
	}

	.panel-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--spacing-md);
		padding-bottom: var(--spacing-sm);
		border-bottom: 1px solid var(--color-border);
	}

	.timestamp {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.result-item {
		margin-bottom: var(--spacing-md);
	}

	.result-item:last-child {
		margin-bottom: 0;
	}

	.result-label {
		font-weight: 600;
		font-size: 0.875rem;
		margin-bottom: var(--spacing-xs);
		color: var(--color-success);
	}

	.result-values {
		background: var(--color-bg-secondary);
		border-radius: var(--radius-sm);
		padding: var(--spacing-sm);
	}

	.result-row {
		display: flex;
		justify-content: space-between;
		font-size: 0.875rem;
		font-family: var(--font-mono);
	}

	.result-row .label {
		color: var(--color-text-muted);
	}

	.result-row .value {
		color: var(--color-text);
	}
</style>
