<script lang="ts">
	import { userSettings } from '$lib/stores/settings';
	import { formatValue } from '$lib/utils/formatting';
	import { averageKineticsBySpecies, eachUV, logReductionTime } from '$lib/utils/survival-math';
	import { speciesWithDataAt, cadrLps, cadrCfm, formatSeconds } from '$lib/utils/resultsSummary';
	import type { EfficacyRow } from '$lib/utils/efficacy-filters';

	interface Props {
		/** Parsed efficacy rows (all media); only Aerosol rows are used. */
		rows: EfficacyRow[];
		/** Wavelength (nm) → average fluence (µW/cm²) from the whole-room zone. */
		fluenceDict: Record<number, number> | null;
		/** Average whole-room fluence (µW/cm²). */
		avgFluence: number | null | undefined;
		/** Room volume in cubic metres (already unit-corrected). */
		volumeM3: number;
		/** Lamp wavelengths with no inactivation data at all. */
		missingWavelengths?: number[];
		/** Show Plot for the whole-room fluence zone. */
		onShowFluencePlot?: () => void;
	}

	let { rows, fluenceDict, avgFluence, volumeM3, missingWavelengths = [], onShowFluencePlot }: Props = $props();

	const DEFAULT_SPECIES = 'Human coronavirus';

	// Species with aerosol data at every lamp wavelength
	const speciesOptions = $derived(
		fluenceDict ? speciesWithDataAt(rows, Object.keys(fluenceDict).map(Number)) : []
	);

	// The chosen pathogen, falling back to the default and then the first available
	const species = $derived.by(() => {
		const wanted = $userSettings.summarySpecies || DEFAULT_SPECIES;
		if (speciesOptions.includes(wanted)) return wanted;
		if (speciesOptions.includes(DEFAULT_SPECIES)) return DEFAULT_SPECIES;
		return speciesOptions[0] ?? wanted;
	});

	function selectSpecies(name: string) {
		userSettings.update(s => ({ ...s, summarySpecies: name }));
	}

	const kinetics = $derived.by(() => {
		if (!fluenceDict || missingWavelengths.length > 0 || speciesOptions.length === 0) return null;
		const [k] = averageKineticsBySpecies(rows, [species], fluenceDict);
		return k ?? null;
	});

	// eACH-UV (1/h): the library's additive multi-wavelength form
	const eachValue = $derived(kinetics ? eachUV(kinetics.irradList, kinetics.k1List, kinetics.k2List, kinetics.fList) : null);
	const lps = $derived(eachValue != null ? cadrLps(eachValue, volumeM3) : null);
	const cfm = $derived(eachValue != null ? cadrCfm(eachValue, volumeM3) : null);

	function reductionTime(level: 1 | 2 | 3): number | null {
		if (!kinetics) return null;
		const s = logReductionTime(level, kinetics.irradList, kinetics.k1List, kinetics.k2List, kinetics.fList);
		return Number.isFinite(s) ? s : null;
	}
	const t90 = $derived(reductionTime(1));
	const t99 = $derived(reductionTime(2));
	const t999 = $derived(reductionTime(3));
</script>

<div class="pathogen-summary" data-testid="pathogen-summary">
	<div class="summary-row">
		<span class="summary-label">Average fluence</span>
		<span class="summary-value highlight" data-testid="avg-fluence">{avgFluence != null ? `${formatValue(avgFluence, 3)} µW/cm²` : '—'}</span>
		{#if onShowFluencePlot}
			<button class="export-btn small" onclick={onShowFluencePlot}>Show Plot</button>
		{/if}
	</div>

	<div class="summary-row species-row">
		<label class="summary-label" for="summary-species">Pathogen</label>
		{#if speciesOptions.length > 0}
			<select id="summary-species" value={species} onchange={(e) => selectSpecies((e.target as HTMLSelectElement).value)}>
				{#each speciesOptions as name (name)}
					<option value={name}>{name}</option>
				{/each}
			</select>
		{:else}
			<span class="summary-value muted">
				{#if missingWavelengths.length > 0}
					No data at {missingWavelengths.join(', ')} nm
				{:else}
					No pathogen data
				{/if}
			</span>
		{/if}
	</div>

	<div class="summary-row">
		<span class="summary-label">eACH‑UV</span>
		<span class="summary-value" data-testid="each">{eachValue != null ? `${formatValue(eachValue, 2)} /h` : '—'}</span>
	</div>
	<div class="summary-row">
		<span class="summary-label">CADR‑UV</span>
		<span class="summary-value" data-testid="cadr">
			{#if lps != null && cfm != null}
				{formatValue(lps, 1)} lps · {formatValue(cfm, 1)} cfm
			{:else}
				—
			{/if}
		</span>
	</div>
	<div class="summary-row">
		<span class="summary-label">Time to 90 / 99 / 99.9%</span>
		<span class="summary-value" data-testid="reduction-times">{formatSeconds(t90)} · {formatSeconds(t99)} · {formatSeconds(t999)}</span>
	</div>
</div>

<style>
	.pathogen-summary {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.summary-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--spacing-sm);
		padding: var(--spacing-xs) 0;
	}

	.summary-label {
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
	}

	.summary-value {
		font-weight: 600;
		font-size: var(--font-size-base);
		text-align: right;
	}

	.summary-value.highlight {
		color: var(--color-accent);
		font-size: var(--font-size-lg, 1.1rem);
	}

	.summary-value.muted {
		color: var(--color-text-muted);
		font-weight: 400;
		font-size: var(--font-size-sm);
	}

	.species-row select {
		flex: 1;
		min-width: 0;
		max-width: 60%;
	}

	.export-btn.small {
		padding: 2px var(--spacing-sm);
		font-size: var(--font-size-sm);
	}
</style>
