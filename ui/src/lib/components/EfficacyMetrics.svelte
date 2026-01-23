<script lang="ts">
	import { formatValue } from '$lib/utils/formatting';

	interface Props {
		avgFluence: number | null | undefined;
		eachUV: number | null;
	}

	let { avgFluence, eachUV }: Props = $props();
</script>

<div class="summary-row">
	<span class="summary-label">Average Fluence</span>
	<span class="summary-value highlight">{formatValue(avgFluence, 3)} µW/cm²</span>
</div>

{#if eachUV !== null}
	<div class="summary-row">
		<span class="summary-label">eACH-UV</span>
		<span class="summary-value highlight">{formatValue(eachUV, 1)}</span>
	</div>
	<p class="help-text">
		Equivalent air changes from UV for typical respiratory pathogens
	</p>
{/if}

<style>
	.summary-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--spacing-xs) 0;
	}

	.summary-label {
		font-size: 0.875rem;
		color: var(--color-text);
	}

	.summary-value {
		font-family: var(--font-mono);
		font-size: 0.875rem;
		font-weight: 600;
	}

	.summary-value.highlight {
		color: var(--color-success);
	}

	.help-text {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		margin: var(--spacing-xs) 0 0 0;
		font-style: italic;
	}
</style>
