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
	<div class="occupancy-banner" class:ok={unlimited} class:limited={!unlimited} role="status" data-testid="occupancy-banner">
		{#if unlimited}
			Continuous occupancy is within the {headlineName}
		{:else}
			Safe to occupy for {formatValue(headlineHours, 1)} hours per day ({headlineName})
		{/if}
	</div>
	<div class="limit-rows">
		<div class="limit-row" class:ok={acgihHours != null && acgihHours >= 8} class:limited={acgihHours != null && acgihHours < 8} data-testid="hours-acgih">
			<span class="limit-label">Hours to ACGIH TLV</span>
			<span class="limit-value">{describeHours(acgihHours)}</span>
		</div>
		<div class="limit-row" class:ok={icnirpHours != null && icnirpHours >= 8} class:limited={icnirpHours != null && icnirpHours < 8} data-testid="hours-icnirp">
			<span class="limit-label">Hours to ICNIRP limit</span>
			<span class="limit-value">{describeHours(icnirpHours)}</span>
		</div>
	</div>
{/if}

<style>
	.occupancy-banner {
		margin: var(--spacing-sm) 0 var(--spacing-xs);
		padding: var(--spacing-sm);
		border-radius: var(--radius-sm);
		text-align: center;
		font-size: var(--font-size-base);
		font-weight: 600;
	}

	.occupancy-banner.ok {
		background: rgba(74, 222, 128, 0.1);
		color: var(--color-success);
		border: 1px solid rgba(74, 222, 128, 0.3);
	}

	.occupancy-banner.limited {
		background: color-mix(in srgb, var(--color-near-limit) 10%, transparent);
		color: var(--color-near-limit);
		border: 1px solid color-mix(in srgb, var(--color-near-limit) 30%, transparent);
	}

	.limit-rows {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-bottom: var(--spacing-sm);
	}

	.limit-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 2px 0;
		font-size: var(--font-size-sm);
	}

	.limit-label {
		color: var(--color-text-muted);
	}

	.limit-value {
		font-weight: 600;
	}

	.limit-row.ok .limit-value {
		color: var(--color-success);
	}

	.limit-row.limited .limit-value {
		color: var(--color-near-limit);
	}
</style>
