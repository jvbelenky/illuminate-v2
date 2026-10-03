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
		<div class="headline">
			{#if unlimited}
				Continuous occupancy is within the {headlineName}
			{:else}
				Safe to occupy for {formatValue(headlineHours, 1)} hours per day ({headlineName})
			{/if}
		</div>
		<div class="limit-line">
			<span class="limit-item" class:ok={acgihHours != null && acgihHours >= 8} class:limited={acgihHours != null && acgihHours < 8} data-testid="hours-acgih">ACGIH TLV <b>{describeHours(acgihHours)}</b></span>
			<span class="limit-item" class:ok={icnirpHours != null && icnirpHours >= 8} class:limited={icnirpHours != null && icnirpHours < 8} data-testid="hours-icnirp">ICNIRP limit <b>{describeHours(icnirpHours)}</b></span>
		</div>
	</div>
{/if}

<style>
	.occupancy-banner {
		margin: var(--spacing-sm) 0;
		padding: var(--spacing-sm);
		border-radius: var(--radius-md);
		text-align: center;
	}

	.headline {
		font-size: var(--font-size-base);
		font-weight: 600;
	}

	.occupancy-banner.ok {
		background: rgba(74, 222, 128, 0.1);
		border: 1px solid rgba(74, 222, 128, 0.3);
	}

	.occupancy-banner.ok .headline {
		color: var(--color-success);
	}

	.occupancy-banner.limited {
		background: color-mix(in srgb, var(--color-near-limit) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-near-limit) 30%, transparent);
	}

	.occupancy-banner.limited .headline {
		color: var(--color-near-limit);
	}

	.limit-line {
		display: flex;
		justify-content: center;
		flex-wrap: wrap;
		gap: 2px var(--spacing-md);
		margin-top: 4px;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}

	.limit-item b {
		font-weight: 600;
	}

	.limit-item.ok b {
		color: var(--color-success);
	}

	.limit-item.limited b {
		color: var(--color-near-limit);
	}
</style>
