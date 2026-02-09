<script lang="ts">
	import type { EfficacyStats } from '$lib/utils/efficacy-filters';
	import { formatValue } from '$lib/utils/formatting';

	interface Props {
		stats: EfficacyStats;
	}

	let { stats }: Props = $props();
</script>

<div class="stats-bar">
	<span>Median: <strong>{formatValue(stats.median, 2)}</strong></span>
	<span>Range: <strong>{formatValue(stats.min, 2)} - {formatValue(stats.max, 2)}</strong></span>
	<span>N = <strong>{stats.count}</strong> pathogens</span>
</div>

<style>
	.stats-bar {
		display: flex;
		justify-content: center;
		gap: var(--spacing-lg);
		padding: var(--spacing-sm) 0;
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	.stats-bar strong {
		color: var(--color-text);
		font-family: var(--font-mono);
	}
</style>
