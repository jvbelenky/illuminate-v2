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

	const hasData = $derived(eachValue != null);
</script>

<div class="pathogen-summary" data-testid="pathogen-summary">
	<div class="species-row">
		<label class="species-label" for="summary-species">Airborne pathogen</label>
		{#if speciesOptions.length > 0}
			<select id="summary-species" value={species} onchange={(e) => selectSpecies((e.target as HTMLSelectElement).value)}>
				{#each speciesOptions as name (name)}
					<option value={name}>{name}</option>
				{/each}
			</select>
		{:else}
			<span class="no-data">
				{#if missingWavelengths.length > 0}
					No inactivation data at {missingWavelengths.join(', ')} nm
				{:else}
					No pathogen data
				{/if}
			</span>
		{/if}
	</div>

	<div class="tiles" class:empty={!hasData}>
		<div class="tile">
			<span class="tile-value" data-testid="each">{eachValue != null ? formatValue(eachValue, 2) : '—'}</span>
			<span class="tile-label">eACH‑UV</span>
			<span class="tile-note">air changes / h</span>
		</div>
		<div class="tile">
			<span class="tile-value" data-testid="cadr">{lps != null ? formatValue(lps, 1) : '—'}<span class="tile-unit">lps</span></span>
			<span class="tile-label">CADR‑UV</span>
			<span class="tile-note" data-testid="cadr-cfm">{cfm != null ? `${formatValue(cfm, 1)} cfm` : ''}</span>
		</div>
		<div class="tile">
			<span class="tile-value" data-testid="t99">{formatSeconds(t99)}</span>
			<span class="tile-label">to 99% inactivation</span>
			<span class="tile-note" data-testid="reduction-times"><span class="nowrap">90% {formatSeconds(t90)}</span> <span class="nowrap">99.9% {formatSeconds(t999)}</span></span>
		</div>
	</div>

	<div class="fluence-row">
		<span class="fluence-text">Average fluence <span data-testid="avg-fluence">{avgFluence != null ? `${formatValue(avgFluence, 3)} µW/cm²` : '—'}</span></span>
		{#if onShowFluencePlot}
			<button class="link-btn" onclick={onShowFluencePlot}>Show plot</button>
		{/if}
	</div>
</div>

<style>
	.pathogen-summary {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}

	.species-row {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
	}

	.species-label {
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
		white-space: nowrap;
	}

	.species-row select {
		flex: 1;
		min-width: 0;
	}

	.no-data {
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
	}

	.tiles {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--spacing-xs);
	}

	.tiles.empty {
		opacity: 0.6;
	}

	.tile {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 2px;
		padding: var(--spacing-sm) var(--spacing-xs);
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		min-width: 0;
	}

	.tile-value {
		font-size: 1.35rem;
		font-weight: 700;
		line-height: 1.1;
		color: var(--color-text);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.tile-unit {
		font-size: var(--font-size-sm);
		font-weight: 500;
		color: var(--color-text-muted);
		margin-left: 3px;
	}

	.tile-label {
		font-size: var(--font-size-sm);
		font-weight: 600;
		color: var(--color-text);
	}

	.tile-note {
		font-size: var(--font-size-xs, 0.72rem);
		color: var(--color-text-muted);
		min-height: 1em;
		line-height: 1.25;
	}

	.nowrap {
		white-space: nowrap;
	}

	.fluence-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--spacing-sm);
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}

	.fluence-text span {
		color: var(--color-text);
		font-variant-numeric: tabular-nums;
	}

	.link-btn {
		background: none;
		border: none;
		padding: 0;
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
		text-decoration: underline;
		cursor: pointer;
	}

	.link-btn:hover {
		color: var(--color-text);
	}

	@media (max-width: 420px) {
		.tiles {
			grid-template-columns: 1fr;
		}
	}
</style>
