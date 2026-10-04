<script lang="ts">
	import { hoursToLimit, describeHours, type TlvPair } from '$lib/utils/resultsSummary';

	interface Props {
		/** Maximum 8-hour skin dose (mJ/cm²) from the SkinLimits zone. */
		skinMax: number | null | undefined;
		/** Maximum 8-hour eye dose (mJ/cm²) from the EyeLimits zone. */
		eyeMax: number | null | undefined;
		/** Limiting TLVs under each standard (mJ/cm² per 8 h). */
		acgih: TlvPair | null;
		icnirp: TlvPair | null;
	}

	let { skinMax, eyeMax, acgih, icnirp }: Props = $props();

	// Both limits are always evaluated; the card does not depend on the standard
	// chosen for the safety zones.
	const acgihHours = $derived(hoursToLimit(acgih, skinMax, eyeMax));
	const icnirpHours = $derived(hoursToLimit(icnirp, skinMax, eyeMax));
	const acgihOk = $derived(acgihHours != null && acgihHours >= 8);
	const icnirpOk = $derived(icnirpHours != null && icnirpHours >= 8);
	const hasAny = $derived(acgihHours != null || icnirpHours != null);
	const allOk = $derived(acgihOk && icnirpOk);

	// Green whenever a full day is within the ACGIH limit; the ICNIRP column below
	// carries its own colour. Kept to one short line.
	const headlineOk = $derived(acgihOk || allOk);
	const headline = $derived.by(() => {
		if (allOk) return 'Within ACGIH and ICNIRP limits all day';
		if (acgihOk) return 'Within the ACGIH limit all day';
		if (icnirpOk) return 'Within the ICNIRP limit all day';
		const hours = [acgihHours, icnirpHours].filter((h): h is number => h != null);
		if (hours.length === 0) return '';
		return `Safe to occupy for ${describeHours(Math.min(...hours))} per day`;
	});
</script>

{#if hasAny}
	<div class="occupancy-card" class:ok={headlineOk} class:limited={!headlineOk} role="status" data-testid="occupancy-banner">
		<div class="headline">{headline}</div>
		<div class="limits">
			<div class="limit" class:ok={acgihOk} class:limited={acgihHours != null && !acgihOk} data-testid="hours-acgih">
				<span class="limit-label">Hours to ACGIH limit</span>
				<span class="limit-value">{describeHours(acgihHours)}</span>
			</div>
			<div class="limit" class:ok={icnirpOk} class:limited={icnirpHours != null && !icnirpOk} data-testid="hours-icnirp">
				<span class="limit-label">Hours to ICNIRP limit</span>
				<span class="limit-value">{describeHours(icnirpHours)}</span>
			</div>
		</div>
	</div>
{/if}

<style>
	.occupancy-card {
		margin: var(--spacing-md) 0 var(--spacing-xs);
		padding: var(--spacing-md) var(--spacing-sm);
		border-radius: var(--radius-md);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--spacing-sm);
		background: var(--color-bg-secondary);
	}

	.headline {
		font-size: var(--font-size-base);
		font-weight: 700;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 100%;
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
		gap: 3px;
		padding: 2px 0;
		font-variant-numeric: tabular-nums;
	}

	.limit + .limit {
		border-left: 1px solid var(--color-border);
	}

	.limit-label {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}

	.limit-value {
		font-size: var(--font-size-base);
		font-weight: 600;
		color: var(--color-text);
		white-space: nowrap;
	}

	.limit.ok .limit-value {
		color: var(--color-success);
	}

	.limit.limited .limit-value {
		color: var(--color-near-limit);
	}
</style>
