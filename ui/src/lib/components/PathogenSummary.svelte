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
		/** Open the efficacy data explorer. */
		onExploreData?: () => void;
	}

	let { rows, fluenceDict, avgFluence, volumeM3, missingWavelengths = [], onShowFluencePlot, onExploreData }: Props = $props();

	const DEFAULT_SPECIES = 'Human coronavirus';
	const GROUP_PREFIX = 'group:';
	const ALL_GROUP = GROUP_PREFIX + 'all';

	// Species with aerosol data at every lamp wavelength
	const speciesOptions = $derived(
		fluenceDict ? speciesWithDataAt(rows, Object.keys(fluenceDict).map(Number)) : []
	);

	// Category of each species (Viruses, Bacteria, …) from the efficacy table
	const categoryOf = $derived.by(() => {
		const m = new Map<string, string>();
		for (const r of rows) if (r.medium === 'Aerosol' && !m.has(r.species)) m.set(r.species, r.category);
		return m;
	});

	// Groups: every category with at least one evaluable species, plus "all"
	const groupOptions = $derived.by((): { value: string; label: string; species: string[] }[] => {
		if (speciesOptions.length === 0) return [];
		const byCategory = new Map<string, string[]>();
		for (const sp of speciesOptions) {
			const cat = categoryOf.get(sp) ?? 'Other';
			if (!byCategory.has(cat)) byCategory.set(cat, []);
			byCategory.get(cat)!.push(sp);
		}
		const groups = [...byCategory.entries()]
			.sort((a, b) => a[0].localeCompare(b[0]))
			.map(([cat, list]) => ({ value: GROUP_PREFIX + cat, label: `All ${cat.toLowerCase()} (${list.length})`, species: list }));
		return [{ value: ALL_GROUP, label: `All airborne pathogens (${speciesOptions.length})`, species: speciesOptions }, ...groups];
	});

	// The chosen entry: a species name or a group value, falling back to the
	// default species and then the first available species
	const selection = $derived.by(() => {
		const wanted = $userSettings.summarySpecies || DEFAULT_SPECIES;
		if (speciesOptions.includes(wanted) || groupOptions.some(g => g.value === wanted)) return wanted;
		if (speciesOptions.includes(DEFAULT_SPECIES)) return DEFAULT_SPECIES;
		return speciesOptions[0] ?? wanted;
	});
	const selectedGroup = $derived(groupOptions.find(g => g.value === selection) ?? null);
	const selectedSpecies = $derived(selectedGroup ? selectedGroup.species : [selection]);

	function selectEntry(value: string) {
		userSettings.update(s => ({ ...s, summarySpecies: value }));
	}

	// Per-species kinetics from the same averaging the pathogen table uses
	const kineticsList = $derived.by(() => {
		if (!fluenceDict || missingWavelengths.length > 0 || speciesOptions.length === 0) return [];
		return averageKineticsBySpecies(rows, selectedSpecies, fluenceDict);
	});

	/** Median of the finite values, or null. */
	function median(values: number[]): number | null {
		const v = values.filter(Number.isFinite).sort((a, b) => a - b);
		if (v.length === 0) return null;
		const mid = Math.floor(v.length / 2);
		return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
	}

	// eACH-UV (1/h), the library's additive multi-wavelength form; a group shows the
	// median across its species
	const eachPerSpecies = $derived(kineticsList.map(k => eachUV(k.irradList, k.k1List, k.k2List, k.fList)));
	const eachValue = $derived(median(eachPerSpecies));
	const lps = $derived(eachValue != null ? cadrLps(eachValue, volumeM3) : null);
	const cfm = $derived(eachValue != null ? cadrCfm(eachValue, volumeM3) : null);

	function reductionTime(level: 1 | 2 | 3): number | null {
		return median(kineticsList.map(k => logReductionTime(level, k.irradList, k.k1List, k.k2List, k.fList)));
	}
	const t90 = $derived(reductionTime(1));
	const t99 = $derived(reductionTime(2));
	const t999 = $derived(reductionTime(3));


	const hasData = $derived(eachValue != null);
</script>

<div class="pathogen-summary" data-testid="pathogen-summary">
	<div class="tiles" class:empty={!hasData}>
		<div class="tile">
			<span class="tile-value" data-testid="each">{eachValue != null ? formatValue(eachValue, 1) : '—'}</span>
			<span class="tile-label">Air changes per hour</span>
		</div>
		<div class="tile">
			<span class="tile-value pair" data-testid="cadr">
				<span class="measure">{cfm != null ? Math.round(cfm).toLocaleString() : '—'}<span class="tile-unit">CFM</span></span>
				{#if lps != null}<span class="measure" data-testid="cadr-lps">{Math.round(lps).toLocaleString()}<span class="tile-unit">LPS</span></span>{/if}
			</span>
			<span class="tile-label">Clean air delivery rate</span>
		</div>
		<div class="tile ladder-tile">
			<span class="tile-label">Time to inactivation</span>
			<div class="ladder" data-testid="reduction-times">
				<div class="step">
					<span class="step-pct">90%</span>
					<span class="step-time" data-testid="t90">{formatSeconds(t90)}</span>
				</div>
				<div class="step">
					<span class="step-pct">99%</span>
					<span class="step-time" data-testid="t99">{formatSeconds(t99)}</span>
				</div>
				<div class="step">
					<span class="step-pct">99.9%</span>
					<span class="step-time" data-testid="t999">{formatSeconds(t999)}</span>
				</div>
			</div>
		</div>
	</div>

	<div class="row species-row">
		<label class="row-label" for="summary-species">For</label>
		{#if speciesOptions.length > 0}
			<select id="summary-species" value={selection} onchange={(e) => selectEntry((e.target as HTMLSelectElement).value)}>
				<optgroup label="Groups">
					{#each groupOptions as g (g.value)}
						<option value={g.value}>{g.label}</option>
					{/each}
				</optgroup>
				<optgroup label="Species">
					{#each speciesOptions as name (name)}
						<option value={name}>{name}</option>
					{/each}
				</optgroup>
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

	<div class="row fluence-row">
		<span class="row-label">Average fluence</span>
		<span class="row-value" data-testid="avg-fluence">{avgFluence != null ? `${formatValue(avgFluence, 3)} µW/cm²` : '—'}</span>
		{#if onShowFluencePlot}
			<button type="button" class="secondary small plot-btn" onclick={onShowFluencePlot}>Show plot</button>
		{/if}
	</div>
</div>

<style>
	.pathogen-summary {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	/* Cards: tinted, no outline, so only the occupancy banner carries a border */
	.tiles {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--spacing-xs);
	}

	.tiles.empty {
		opacity: 0.6;
	}

	.tile {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: flex-start;
		text-align: center;
		gap: 2px;
		padding: var(--spacing-sm) var(--spacing-xs);
		background: var(--color-bg-secondary);
		border-radius: var(--radius-md);
		min-width: 0;
	}

	.tile-value {
		font-size: 1.25rem;
		font-weight: 700;
		line-height: 1.2;
		min-height: 1.5rem;
		color: var(--color-text);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.tile-unit {
		font-size: var(--font-size-sm);
		font-weight: 600;
		color: var(--color-text-muted);
		margin-left: 4px;
	}

	/* Two measures of one quantity in the same style; they wrap onto two lines
	   only when the numbers get long (thousands of CFM) */
	.tile-value.pair {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		column-gap: var(--spacing-sm);
		row-gap: 0;
		white-space: normal;
	}

	.measure {
		white-space: nowrap;
	}

	/* Same look as the 90/99/99.9% captions on the inactivation card */
	.tile-label {
		font-size: var(--font-size-base);
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.tile-note {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		min-height: 1em;
		line-height: 1.25;
	}

	.ladder-tile {
		grid-column: 1 / -1;
		gap: var(--spacing-xs);
	}

	.ladder {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		width: 100%;
		align-items: end;
	}

	.step {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1px;
		padding: 2px 0;
		font-variant-numeric: tabular-nums;
	}

	.step-time {
		font-size: 1rem;
		font-weight: 500;
		color: var(--color-text);
		white-space: nowrap;
	}

	.step-pct {
		font-size: var(--font-size-base);
		font-weight: 600;
		color: var(--color-text-muted);
	}

	/* Plain rows: no boxes */
	.row {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		padding: 5px 0;
	}

	.row-label {
		color: var(--color-text-muted);
		font-size: var(--font-size-base);
		flex-shrink: 0;
		margin: 0; /* the global label rule adds a bottom margin that lifts it off centre */
		line-height: 1;
	}

	.row-value {
		flex: 1;
		text-align: right;
		font-size: var(--font-size-base);
		font-weight: 600;
		color: var(--color-text);
		font-variant-numeric: tabular-nums;
		line-height: 1;
	}

	/* label | centred value | button, all on one centre line */
	.fluence-row {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
	}

	.fluence-row .row-value {
		text-align: center;
	}

	.species-row select {
		flex: 1;
		min-width: 0;
	}

	.no-data {
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
	}

	.plot-btn {
		padding: 3px var(--spacing-sm);
		font-size: var(--font-size-sm);
		line-height: 1.2;
		flex-shrink: 0;
	}
</style>
