<script lang="ts">
	import { formatValue } from '$lib/utils/formatting';
	import { hoursToLimit, describeHours, type TlvPair } from '$lib/utils/resultsSummary';
	import type { GuvStandard } from '$lib/api/contract';

	interface Props {
		/** Maximum 8-hour skin dose (mJ/cm²) from the SkinLimits zone. */
		skinMax: number | null | undefined;
		/** Maximum 8-hour eye dose (mJ/cm²) from the EyeLimits zone. */
		eyeMax: number | null | undefined;
		/** Limiting TLVs under each standard (mJ/cm² per 8 h). */
		acgih: TlvPair | null;
		icnirp: TlvPair | null;
		/** The room's selected standard: decides which limit the headline uses. */
		standard: GuvStandard;
	}

	let { skinMax, eyeMax, acgih, icnirp, standard }: Props = $props();

	const acgihHours = $derived(hoursToLimit(acgih, skinMax, eyeMax));
	const icnirpHours = $derived(hoursToLimit(icnirp, skinMax, eyeMax));
	const usesIcnirp = $derived(standard.includes('ICNIRP'));
	const headlineHours = $derived(usesIcnirp ? icnirpHours : acgihHours);
	const headlineName = $derived(usesIcnirp ? 'ICNIRP limit' : 'ACGIH TLV');
	const unlimited = $derived(headlineHours != null && headlineHours >= 8);
</script>

{#if headlineHours != null}
	<div class="occupancy-card" class:ok={unlimited} class:limited={!unlimited} role="status" data-testid="occupancy-banner">
		<div class="headline">
			{#if unlimited}
				Safe for continuous occupancy
			{:else}
				Safe for {formatValue(headlineHours, 1)} hours per day
			{/if}
		</div>
		<div class="limits">
			<div class="limit" class:ok={acgihHours != null && acgihHours >= 8} class:limited={acgihHours != null && acgihHours < 8} data-testid="hours-acgih">
				<span class="limit-label">ACGIH TLV</span>
				<span class="limit-value">{describeHours(acgihHours)}</span>
			</div>
			<div class="limit" class:ok={icnirpHours != null && icnirpHours >= 8} class:limited={icnirpHours != null && icnirpHours < 8} data-testid="hours-icnirp">
				<span class="limit-label">ICNIRP limit</span>
				<span class="limit-value">{describeHours(icnirpHours)}</span>
			</div>
		</div>
	</div>
{/if}

<style>
	.occupancy-card {
		margin: var(--spacing-xs) 0 0;
		padding: var(--spacing-sm) var(--spacing-xs);
		border-radius: var(--radius-md);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--spacing-xs);
		background: var(--color-bg-secondary);
	}

	.headline {
		font-size: var(--font-size-base);
		font-weight: 700;
	}

	.occupancy-card.ok {
		background: rgba(74, 222, 128, 0.1);
	}

	.occupancy-card.ok .headline {
		color: var(--color-success);
	}

	.occupancy-card.limited {
		background: color-mix(in srgb, var(--color-near-limit) 10%, transparent);
	}

	.occupancy-card.limited .headline {
		color: var(--color-near-limit);
	}

	.limits {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		width: 100%;
	}

	.limit {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1px;
		font-variant-numeric: tabular-nums;
	}

	.limit + .limit {
		border-left: 1px solid var(--color-border);
	}

	.limit-label {
		font-size: var(--font-size-xs, 0.72rem);
		color: var(--color-text-muted);
	}

	.limit-value {
		font-size: var(--font-size-base);
		font-weight: 600;
		color: var(--color-text);
		white-space: nowrap;
	}
</style>
