<script lang="ts">
	import { getEfficacyExploreData, type EfficacyExploreResponse } from '$lib/api/client';
	import Modal from './Modal.svelte';
	import {
		parseTableResponse,
		filterData,
		computeStats,
		sortData,
		getUniqueCategories,
		exportToCSV,
		getRowKey,
		type EfficacyRow,
		type EfficacyFilters
	} from '$lib/utils/efficacy-filters';
	import { logReductionTime, LOG_LABELS, eachUV, secondsToS } from '$lib/utils/survival-math';
	import EfficacyFiltersComponent from './EfficacyFilters.svelte';
	import EfficacySwarmPlot from './EfficacySwarmPlot.svelte';
	import EfficacyStatsBar from './EfficacyStatsBar.svelte';
	import EfficacyDataTable from './EfficacyDataTable.svelte';
	import EfficacySurvivalPlot from './EfficacySurvivalPlot.svelte';
	import EfficacyWavelengthPlot from './EfficacyWavelengthPlot.svelte';

	interface Props {
		fluence?: number;
		wavelength?: number;
		roomX: number;
		roomY: number;
		roomZ: number;
		roomUnits: 'meters' | 'feet';
		airChanges: number;
		onclose: () => void;
		prefetchedData?: EfficacyExploreResponse;
		zoneOptions?: Array<{ id: string; name: string; meanFluence: number }>;
	}

	let { fluence, wavelength = 222, roomX, roomY, roomZ, roomUnits, airChanges, onclose, prefetchedData, zoneOptions }: Props = $props();

	// Active fluence tracks the currently selected zone's fluence
	let activeFluence = $state<number | undefined>(fluence);

	// Compute room volume in m³
	const FEET_TO_METERS = 0.3048;
	const roomVolumeM3 = $derived.by(() => {
		if (roomUnits === 'feet') {
			return roomX * FEET_TO_METERS * roomY * FEET_TO_METERS * roomZ * FEET_TO_METERS;
		}
		return roomX * roomY * roomZ;
	});

	// Data state
	let allData = $state<EfficacyRow[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);

	// Filter options
	let mediums = $state<string[]>([]);
	let categories = $state<string[]>([]);
	let wavelengths = $state<number[]>([]);

	// Current filter values
	let selectedMedium = $state('Aerosol');
	let selectedCategory = $state('All');
	let selectedWavelength = $state<number | 'All'>(wavelength || 'All');
	let speciesSearch = $state('');
	let conditionSearch = $state('');
	let logLevel = $state(2); // default 99%

	// Table sort state
	let sortColumn = $state<keyof EfficacyRow>(fluence ? 'each_uv' : 'k1');
	let sortAscending = $state(false);

	// Row selection
	let selectedKeys = $state<Set<string>>(new Set());

	// Tab state
	type Tab = 'swarm' | 'survival' | 'wavelength';
	let activeTab = $state<Tab>('swarm');

	// Derived filter object
	const filters = $derived<EfficacyFilters>({
		medium: selectedMedium === 'All' ? undefined : selectedMedium,
		category: selectedCategory === 'All' ? undefined : selectedCategory,
		wavelength: selectedWavelength === 'All' ? undefined : selectedWavelength,
		speciesSearch: speciesSearch,
		conditionSearch: conditionSearch
	});

	// Faceted filter options: each dropdown shows only values that exist given the OTHER active filters
	const availableMediums = $derived.by(() => {
		const subset = filterData(allData, { ...filters, medium: undefined });
		return [...new Set(subset.map(r => r.medium))].filter(Boolean).sort();
	});
	const availableCategories = $derived.by(() => {
		const subset = filterData(allData, { ...filters, category: undefined });
		return [...new Set(subset.map(r => r.category))].filter(Boolean).sort();
	});
	const availableWavelengths = $derived.by(() => {
		const subset = filterData(allData, { ...filters, wavelength: undefined });
		return [...new Set(subset.map(r => r.wavelength))].filter(Boolean).sort((a, b) => a - b);
	});

	// Filtered and sorted data
	const filteredData = $derived(filterData(allData, filters));
	const sortedData = $derived(sortData(filteredData, sortColumn, sortAscending));
	const stats = $derived.by(() => {
		if (activeFluence !== undefined) return computeStats(filteredData);
		// k1 mode: compute stats on k1 values
		const values = filteredData.map(r => r.k1).filter(v => !isNaN(v) && isFinite(v));
		if (values.length === 0) return { median: 0, min: 0, max: 0, count: 0 };
		const sorted = [...values].sort((a, b) => a - b);
		const mid = Math.floor(sorted.length / 2);
		const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
		return { median, min: sorted[0], max: sorted[sorted.length - 1], count: sorted.length };
	});
	const dataCategories = $derived(getUniqueCategories(filteredData));

	// Unique wavelengths in filtered data (for wavelength tab availability)
	const filteredWavelengths = $derived(new Set(filteredData.map(r => r.wavelength)));
	const wavelengthTabDisabled = $derived(filteredWavelengths.size <= 1);

	// Selected rows that match current filters (for survival plot)
	const selectedRows = $derived(
		filteredData.filter(row => selectedKeys.has(getRowKey(row)))
	);

	// Unique species in filtered data (for species toggle chips on survival tab)
	const uniqueSpecies = $derived([...new Set(filteredData.map(r => r.species))]);

	// Check if all rows for a given species are selected
	function isSpeciesFullySelected(species: string): boolean {
		const speciesRows = filteredData.filter(r => r.species === species);
		return speciesRows.length > 0 && speciesRows.every(r => selectedKeys.has(getRowKey(r)));
	}

	// Toggle all rows for a species
	function toggleSpecies(species: string) {
		const speciesRows = filteredData.filter(r => r.species === species);
		const allSelected = isSpeciesFullySelected(species);
		const newKeys = new Set(selectedKeys);
		for (const row of speciesRows) {
			const key = getRowKey(row);
			if (allSelected) {
				newKeys.delete(key);
			} else {
				newKeys.add(key);
			}
		}
		selectedKeys = newKeys;
	}

	// Count of rows for a species
	function speciesRowCount(species: string): number {
		return filteredData.filter(r => r.species === species).length;
	}

	// Reset filter selections when they're no longer available in the faceted options
	$effect(() => {
		if (selectedMedium !== 'All' && availableMediums.length > 0 && !availableMediums.includes(selectedMedium)) {
			selectedMedium = 'All';
		}
	});
	$effect(() => {
		if (selectedCategory !== 'All' && availableCategories.length > 0 && !availableCategories.includes(selectedCategory)) {
			selectedCategory = 'All';
		}
	});
	$effect(() => {
		if (selectedWavelength !== 'All' && availableWavelengths.length > 0 && !availableWavelengths.includes(selectedWavelength as number)) {
			selectedWavelength = 'All';
		}
	});

	// Auto-switch away from wavelength tab if it becomes disabled
	$effect(() => {
		if (activeTab === 'wavelength' && wavelengthTabDisabled) {
			activeTab = 'swarm';
		}
	});

	// Load data on mount
	$effect(() => {
		loadData();
	});

	// Compute fluence-dependent columns in-place on a row array
	function computeFluenceOnRows(rows: EfficacyRow[], fl: number | undefined) {
		for (const row of rows) {
			if (fl !== undefined) {
				row.each_uv = eachUV(fl, row.k1, row.k2 ?? 0, row.resistant_fraction);
				row.seconds_to_99 = secondsToS(0.01, fl, row.k1, row.k2 ?? 0, row.resistant_fraction);
			} else {
				row.each_uv = 0;
				row.seconds_to_99 = 0;
			}
		}
	}

	// Recompute on existing allData and trigger reactivity (for event handlers only)
	function recomputeFluenceColumns(fl: number | undefined) {
		computeFluenceOnRows(allData, fl);
		allData = [...allData];
	}

	async function loadData() {
		loading = true;
		error = null;

		try {
			let res: EfficacyExploreResponse;
			if (prefetchedData) {
				res = prefetchedData;
			} else {
				res = await getEfficacyExploreData();
			}
			mediums = res.mediums;
			categories = res.categories;
			wavelengths = res.wavelengths;
			const parsed = parseTableResponse(res.table.columns, res.table.rows);
			computeFluenceOnRows(parsed, activeFluence);
			allData = parsed;
		} catch (e) {
			console.error('Failed to load efficacy data:', e);
			error = e instanceof Error ? e.message : 'Failed to load data';
		} finally {
			loading = false;
		}
	}

	// Handle zone change from dropdown
	function handleZoneChange(e: Event) {
		const select = e.target as HTMLSelectElement;
		const value = select.value;
		if (value === '__none__') {
			activeFluence = undefined;
		} else {
			const zone = zoneOptions?.find(z => z.id === value);
			if (zone) {
				activeFluence = zone.meanFluence;
			}
		}
		recomputeFluenceColumns(activeFluence);
	}

	// Handle column header click for sorting
	function handleSort(column: keyof EfficacyRow) {
		if (sortColumn === column) {
			sortAscending = !sortAscending;
		} else {
			sortColumn = column;
			sortAscending = true;
		}
	}

	// Handle CSV export
	function handleExport() {
		// Compute time for each row based on selected log level
		const exportData = sortedData.map(row => {
			if (logLevel !== 2 && activeFluence) {
				const time = logReductionTime(logLevel, activeFluence, row.k1, row.k2 ?? 0, row.resistant_fraction);
				return { ...row, seconds_to_99: time };
			}
			return row;
		});
		const csv = exportToCSV(exportData, LOG_LABELS[logLevel]);
		const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'efficacy_data.csv';
		a.click();
		URL.revokeObjectURL(url);
	}

</script>

<Modal title="Explore Pathogen Efficacy Data" onClose={onclose} maxWidth="min(1000px, 95vw)" maxHeight="90vh" preserveOnMinimize={true} titleFontSize="1rem">
	{#snippet body()}
		<div class="modal-body">
			{#if loading}
				<div class="loading-state">
					<p>Loading efficacy data...</p>
				</div>
			{:else if error}
				<div class="error-state">
					<p>Error: {error}</p>
					<button onclick={loadData}>Retry</button>
				</div>
			{:else}
				<!-- Zone selector -->
				{#if zoneOptions && zoneOptions.length > 0}
					<div class="zone-selector">
						<label for="zone-select">Zone</label>
						<select id="zone-select" onchange={handleZoneChange}>
							{#each zoneOptions as zone (zone.id)}
								<option value={zone.id} selected={zone.meanFluence === activeFluence}>
									{zone.name} ({zone.meanFluence.toFixed(2)} µW/cm²)
								</option>
							{/each}
							<option value="__none__" selected={activeFluence === undefined}>None (k₁ only)</option>
						</select>
					</div>
				{/if}

				<!-- Filters -->
				<EfficacyFiltersComponent
					mediums={availableMediums}
					categories={availableCategories}
					wavelengths={availableWavelengths}
					{selectedMedium}
					{selectedCategory}
					{selectedWavelength}
					{speciesSearch}
					{conditionSearch}
					{logLevel}
					onMediumChange={(v) => selectedMedium = v}
					onCategoryChange={(v) => selectedCategory = v}
					onWavelengthChange={(v) => selectedWavelength = v}
					onSpeciesSearchChange={(v) => speciesSearch = v}
					onConditionSearchChange={(v) => conditionSearch = v}
					onLogLevelChange={(v) => logLevel = v}
				/>

				<!-- Tab bar -->
				<div class="tab-bar">
					<button
						class="tab"
						class:active={activeTab === 'swarm'}
						onclick={() => activeTab = 'swarm'}
					>
						Swarm Plot
					</button>
					<button
						class="tab"
						class:active={activeTab === 'survival'}
						onclick={() => activeTab = 'survival'}
					>
						Survival Curves
					</button>
					<button
						class="tab"
						class:active={activeTab === 'wavelength'}
						disabled={wavelengthTabDisabled}
						onclick={() => { if (!wavelengthTabDisabled) activeTab = 'wavelength'; }}
						title={wavelengthTabDisabled ? 'Only one wavelength in current data' : ''}
					>
						Wavelength
					</button>
				</div>

				<!-- Plot area -->
				<div class="plot-section">
					{#if filteredData.length > 0}
						{#if activeTab === 'swarm'}
							<EfficacySwarmPlot {filteredData} {stats} {dataCategories} {roomVolumeM3} {roomUnits} {airChanges} fluence={activeFluence} />
							<EfficacyStatsBar {stats} />
						{:else if activeTab === 'survival'}
							{#if activeFluence}
								<!-- Species toggle chips -->
								{#if uniqueSpecies.length > 0}
									<div class="species-chips">
										{#each uniqueSpecies as species (species)}
											<button
												class="species-chip"
												class:active={isSpeciesFullySelected(species)}
												onclick={() => toggleSpecies(species)}
											>
												{species} ({speciesRowCount(species)})
											</button>
										{/each}
									</div>
								{/if}
								<EfficacySurvivalPlot
									{selectedRows}
									{filteredData}
									fluence={activeFluence}
									{logLevel}
								/>
							{:else}
								<div class="no-fluence-message">Select a zone to see survival curves</div>
							{/if}
						{:else if activeTab === 'wavelength'}
							<EfficacyWavelengthPlot {filteredData} />
						{/if}
					{:else}
						<div class="no-data">No data matches the current filters</div>
					{/if}
				</div>

				<!-- Data Table -->
				<EfficacyDataTable
					{sortedData}
					totalCount={allData.length}
					{sortColumn}
					{sortAscending}
					{selectedKeys}
					showSelection={activeTab !== 'swarm'}
					{logLevel}
					fluence={activeFluence ?? 0}
					onSort={handleSort}
					onSelectionChange={(keys) => selectedKeys = keys}
				/>
			{/if}
		</div>
	{/snippet}
	{#snippet footer()}
		<div class="modal-footer">
			<button class="export-btn" onclick={handleExport} disabled={loading || sortedData.length === 0}>
				Export CSV
			</button>
			<button class="close-btn-text" onclick={onclose}>
				Close
			</button>
		</div>
	{/snippet}
</Modal>

<style>
	.modal-body {
		padding: var(--spacing-md);
		overflow-y: auto;
		flex: 1;
		min-height: 0;
	}

	.modal-footer {
		padding: var(--spacing-sm) var(--spacing-md);
		border-top: 1px solid var(--color-border);
		display: flex;
		justify-content: flex-end;
		gap: var(--spacing-sm);
		flex-shrink: 0;
	}

	/* Loading/Error states */
	.loading-state, .error-state {
		text-align: center;
		padding: var(--spacing-xl);
		color: var(--color-text-muted);
	}

	.error-state {
		color: var(--color-error);
	}

	/* Tab bar */
	.tab-bar {
		display: flex;
		gap: 2px;
		margin-bottom: var(--spacing-md);
		border-bottom: 1px solid var(--color-border);
	}

	.tab {
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		padding: var(--spacing-xs) var(--spacing-md);
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--color-text-muted);
		cursor: pointer;
		transition: all 0.15s;
	}

	.tab:hover:not(:disabled) {
		color: var(--color-text);
		background: var(--color-bg-secondary);
	}

	.tab.active {
		color: var(--color-text);
		border-bottom-color: var(--color-highlight);
	}

	.tab:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	/* Plot Section */
	.plot-section {
		margin-bottom: var(--spacing-md);
	}

	.no-data {
		text-align: center;
		padding: var(--spacing-lg);
		color: var(--color-text-muted);
		background: var(--color-bg-secondary);
		border-radius: var(--radius-sm);
	}

	.no-fluence-message {
		text-align: center;
		padding: var(--spacing-lg);
		color: var(--color-text-muted);
		background: var(--color-bg-secondary);
		border-radius: var(--radius-sm);
		font-style: italic;
	}

	/* Zone selector */
	.zone-selector {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		margin-bottom: var(--spacing-sm);
	}

	.zone-selector label {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	.zone-selector select {
		flex: 1;
		font-size: var(--font-size-sm);
		padding: var(--spacing-xs) var(--spacing-sm);
	}

	/* Species toggle chips */
	.species-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-bottom: var(--spacing-sm);
	}

	.species-chip {
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		border-radius: 12px;
		padding: 2px 10px;
		font-size: 0.7rem;
		color: var(--color-text-muted);
		cursor: pointer;
		transition: all 0.15s;
		white-space: nowrap;
	}

	.species-chip:hover {
		background: var(--color-bg-secondary);
		border-color: var(--color-text-muted);
		color: var(--color-text);
	}

	.species-chip.active {
		background: color-mix(in srgb, var(--color-highlight) 20%, transparent);
		border-color: var(--color-highlight);
		color: var(--color-highlight);
	}

	/* Buttons */
	.export-btn {
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: var(--spacing-xs) var(--spacing-md);
		font-size: 0.85rem;
		color: var(--color-text);
		cursor: pointer;
		transition: all 0.15s;
	}

	.export-btn:hover:not(:disabled) {
		background: var(--color-bg-secondary);
		border-color: var(--color-text-muted);
	}

	.export-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.close-btn-text {
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: var(--spacing-xs) var(--spacing-md);
		font-size: 0.85rem;
		color: var(--color-text-muted);
		cursor: pointer;
		transition: all 0.15s;
	}

	.close-btn-text:hover {
		background: var(--color-bg-tertiary);
		color: var(--color-text);
	}
</style>
