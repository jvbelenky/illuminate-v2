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
	import { userSettings } from '$lib/stores/settings';
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
		airChanges: number;
		onclose: () => void;
		prefetchedData?: EfficacyExploreResponse;
		zoneOptions?: Array<{ id: string; name: string; meanFluence: number; zoneType: 'plane' | 'volume' }>;
	}

	let { fluence, wavelength, roomX, roomY, roomZ, airChanges, onclose, prefetchedData, zoneOptions }: Props = $props();

	// Active fluence tracks the currently selected zone's fluence
	let activeFluence = $state<number | undefined>(fluence);

	// Compute room volume in m³ (all values always in meters)
	const roomVolumeM3 = $derived(roomX * roomY * roomZ);

	// Data state
	let allData = $state<EfficacyRow[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);

	// Filter options
	let mediums = $state<string[]>([]);
	let categories = $state<string[]>([]);
	let wavelengths = $state<number[]>([]);

	// Determine initial mediums based on zone type
	function getInitialMediums(): string[] {
		if (fluence !== undefined && zoneOptions) {
			const zone = zoneOptions.find(z => z.meanFluence === fluence);
			if (zone?.zoneType === 'plane') return ['Surface'];
		}
		return ['Aerosol'];
	}

	// Current filter values
	let selectedMediums = $state<string[]>(getInitialMediums());
	let selectedCategories = $state<string[]>([]);
	let selectedWavelengths = $state<number[]>(wavelength ? [wavelength] : []);
	let speciesSearch = $state('');
	let conditionSearch = $state('');
	let logLevels = $state<number[]>([2]); // default 99%

	// CADR unit state (shared between swarm plot and data table)
	let cadrUnit = $state<'lps' | 'cfm'>($userSettings.units === 'feet' ? 'cfm' : 'lps');

	// Table sort state
	let sortColumn = $state<keyof EfficacyRow>(fluence ? 'each_uv' : 'k1');
	let sortAscending = $state(false);

	// Row selection
	let selectedKeys = $state<Set<string>>(new Set());

	// Species selection order tracking (for survival plot color assignment)
	let speciesSelectionOrder = $state<string[]>([]);

	// Tab state
	type Tab = 'swarm' | 'survival' | 'wavelength';
	let activeTab = $state<Tab>('swarm');

	// Species dropdown state
	let speciesDropdownOpen = $state(false);

	// Track whether we've auto-selected species for survival tab
	let survivalAutoSelected = $state(false);

	// Derived filter object
	const filters = $derived<EfficacyFilters>({
		mediums: selectedMediums.length > 0 ? selectedMediums : undefined,
		categories: selectedCategories.length > 0 ? selectedCategories : undefined,
		wavelengths: selectedWavelengths.length > 0 ? selectedWavelengths : undefined,
		speciesSearch: speciesSearch,
		conditionSearch: conditionSearch
	});

	// Faceted filter options: each dropdown shows only values that exist given the OTHER active filters
	const availableMediums = $derived.by(() => {
		const subset = filterData(allData, { ...filters, mediums: undefined });
		return [...new Set(subset.map(r => r.medium))].filter(Boolean).sort();
	});
	const availableCategories = $derived.by(() => {
		const subset = filterData(allData, { ...filters, categories: undefined });
		return [...new Set(subset.map(r => r.category))].filter(Boolean).sort();
	});
	const availableWavelengths = $derived.by(() => {
		const subset = filterData(allData, { ...filters, wavelengths: undefined });
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
	// Selected rows that match current filters (for survival plot)
	const selectedRows = $derived(
		filteredData.filter(row => selectedKeys.has(getRowKey(row)))
	);

	// Unique species in filtered data (for species toggle chips on survival tab)
	const uniqueSpecies = $derived([...new Set(filteredData.map(r => r.species))]);

	// Count of selected species
	const selectedSpeciesCount = $derived(
		uniqueSpecies.filter(s => isSpeciesFullySelected(s)).length
	);

	// Whether fluence-dependent columns should show
	const showFluenceColumns = $derived(activeFluence !== undefined);

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

		// Update selection order
		if (allSelected) {
			speciesSelectionOrder = speciesSelectionOrder.filter(s => s !== species);
		} else {
			if (!speciesSelectionOrder.includes(species)) {
				speciesSelectionOrder = [...speciesSelectionOrder, species];
			}
		}
	}

	// Count of rows for a species
	function speciesRowCount(species: string): number {
		return filteredData.filter(r => r.species === species).length;
	}

	// Reset filter selections when they're no longer available in the faceted options
	$effect(() => {
		if (selectedMediums.length > 0 && availableMediums.length > 0) {
			const valid = selectedMediums.filter(m => availableMediums.includes(m));
			if (valid.length !== selectedMediums.length) {
				selectedMediums = valid;
			}
		}
	});
	$effect(() => {
		if (selectedCategories.length > 0 && availableCategories.length > 0) {
			const valid = selectedCategories.filter(c => availableCategories.includes(c));
			if (valid.length !== selectedCategories.length) {
				selectedCategories = valid;
			}
		}
	});
	$effect(() => {
		if (selectedWavelengths.length > 0 && availableWavelengths.length > 0) {
			const valid = selectedWavelengths.filter(w => availableWavelengths.includes(w));
			if (valid.length !== selectedWavelengths.length) {
				selectedWavelengths = valid;
			}
		}
	});

	// When filters change (e.g. medium switch), reconcile species selection:
	// keep species that are still available, deselect those that aren't
	$effect(() => {
		const available = new Set(uniqueSpecies);
		// Remove species from selection order that are no longer available
		const validOrder = speciesSelectionOrder.filter(s => available.has(s));
		if (validOrder.length !== speciesSelectionOrder.length) {
			speciesSelectionOrder = validOrder;
		}
		// Rebuild selectedKeys: keep only keys for rows in filteredData whose species are still in the order
		const validSpecies = new Set(validOrder);
		const newKeys = new Set<string>();
		for (const row of filteredData) {
			const key = getRowKey(row);
			if (validSpecies.has(row.species) && selectedKeys.has(key)) {
				newKeys.add(key);
			}
		}
		// Also add keys for species that were selected but have new rows (re-select all rows for that species)
		for (const species of validOrder) {
			const speciesRows = filteredData.filter(r => r.species === species);
			for (const row of speciesRows) {
				newKeys.add(getRowKey(row));
			}
		}
		if (newKeys.size !== selectedKeys.size || ![...newKeys].every(k => selectedKeys.has(k))) {
			selectedKeys = newKeys;
		}
	});

	// Auto-select species matching userSettings.resultSpecies when switching to survival tab
	$effect(() => {
		if (activeTab === 'survival' && !survivalAutoSelected && filteredData.length > 0) {
			survivalAutoSelected = true;
			const targetSpecies = $userSettings.resultSpecies;
			for (const species of targetSpecies) {
				if (uniqueSpecies.includes(species) && !isSpeciesFullySelected(species)) {
					toggleSpecies(species);
				}
			}
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
				selectedMediums = zone.zoneType === 'plane' ? ['Surface'] : ['Aerosol'];
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

	// Max log level for CSV export
	const maxLogLevel = $derived(logLevels.length > 0 ? Math.max(...logLevels) : 2);

	// Handle CSV export
	function handleExport() {
		const exportData = sortedData.map(row => {
			if (maxLogLevel !== 2 && activeFluence) {
				const time = logReductionTime(maxLogLevel, activeFluence, row.k1, row.k2 ?? 0, row.resistant_fraction);
				return { ...row, seconds_to_99: time };
			}
			return row;
		});
		const csv = exportToCSV(exportData, LOG_LABELS[maxLogLevel]);
		const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'efficacy_data.csv';
		a.click();
		URL.revokeObjectURL(url);
	}

	// Close species dropdown when clicking outside
	function handleSpeciesDropdownBlur(e: FocusEvent) {
		const related = e.relatedTarget as HTMLElement | null;
		if (!related?.closest('.species-dropdown')) {
			speciesDropdownOpen = false;
		}
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
				<div class="zone-selector">
					<label for="zone-select">Zone</label>
					<select id="zone-select" onchange={handleZoneChange}>
						{#if zoneOptions && zoneOptions.length > 0}
							{#each zoneOptions as zone (zone.id)}
								<option value={zone.id} selected={zone.meanFluence === activeFluence}>
									{zone.name} ({zone.meanFluence.toFixed(2)} µW/cm²)
								</option>
							{/each}
						{/if}
						<option value="__none__" selected={activeFluence === undefined}>None (k₁ only)</option>
					</select>
				</div>

				<!-- Filters -->
				<EfficacyFiltersComponent
					mediums={availableMediums}
					categories={availableCategories}
					wavelengths={availableWavelengths}
					{selectedMediums}
					{selectedCategories}
					{selectedWavelengths}
					{speciesSearch}
					{conditionSearch}
					onMediumsChange={(v) => selectedMediums = v}
					onCategoriesChange={(v) => selectedCategories = v}
					onWavelengthsChange={(v) => selectedWavelengths = v}
					onSpeciesSearchChange={(v) => speciesSearch = v}
					onConditionSearchChange={(v) => conditionSearch = v}
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
						onclick={() => activeTab = 'wavelength'}
					>
						Wavelength
					</button>
				</div>

				<!-- Plot area -->
				<div class="plot-section">
					{#if filteredData.length > 0}
						{#if activeTab === 'swarm'}
							<EfficacySwarmPlot {filteredData} {stats} {dataCategories} {roomVolumeM3} {airChanges} fluence={activeFluence} mediums={selectedMediums} {cadrUnit} onCadrUnitChange={(u) => cadrUnit = u} />
							<EfficacyStatsBar {stats} />
						{:else if activeTab === 'survival'}
							{#if activeFluence}
								<!-- Species dropdown with checkboxes -->
								{#if uniqueSpecies.length > 0}
									<!-- svelte-ignore a11y_no_static_element_interactions -->
									<div class="species-dropdown" onfocusout={handleSpeciesDropdownBlur}>
										<button
											class="species-dropdown-btn"
											onclick={() => speciesDropdownOpen = !speciesDropdownOpen}
										>
											Species ({selectedSpeciesCount} selected)
											<svg class="dropdown-chevron" class:open={speciesDropdownOpen} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
												<polyline points="6 9 12 15 18 9"/>
											</svg>
										</button>
										{#if speciesDropdownOpen}
											<div class="species-dropdown-list">
												{#each uniqueSpecies as species (species)}
													<label class="species-dropdown-item">
														<input
															type="checkbox"
															checked={isSpeciesFullySelected(species)}
															onchange={() => toggleSpecies(species)}
														/>
														<span class="species-name">{species}</span>
														<span class="species-count">({speciesRowCount(species)})</span>
													</label>
												{/each}
											</div>
										{/if}
									</div>
								{/if}
								<EfficacySurvivalPlot
									{selectedRows}
									{filteredData}
									fluence={activeFluence}
									{logLevels}
									{speciesSelectionOrder}
								/>
							{:else}
								<div class="no-fluence-message">Select a zone to see survival curves</div>
							{/if}
						{:else if activeTab === 'wavelength'}
							{#if filteredWavelengths.size <= 1}
								<div class="no-fluence-message">Select additional wavelengths in the filter above to compare wavelength-dependent efficacy</div>
							{:else}
								<EfficacyWavelengthPlot {filteredData} />
							{/if}
						{/if}
					{:else}
						<div class="no-data">No data matches the current filters</div>
					{/if}
				</div>

				<!-- Log Reduction selector (muted when no zone selected) -->
				<div class="log-reduction-row" class:inactive={activeFluence === undefined}>
					<span class="log-reduction-label">Log Reduction:</span>
					{#each Object.entries(LOG_LABELS) as [level, label]}
						<label class="log-checkbox">
							<input
								type="checkbox"
								checked={logLevels.includes(Number(level))}
								onchange={() => {
									const n = Number(level);
									if (logLevels.includes(n)) {
										logLevels = logLevels.filter(l => l !== n);
									} else {
										logLevels = [...logLevels, n];
									}
								}}
							/>
							{label}
						</label>
					{/each}
				</div>

				<!-- Data Table -->
				<EfficacyDataTable
					{sortedData}
					totalCount={allData.length}
					{sortColumn}
					{sortAscending}
					{selectedKeys}
					showSelection={activeTab !== 'swarm'}
					{logLevels}
					fluence={activeFluence ?? 0}
					{showFluenceColumns}
					{roomVolumeM3}
					{cadrUnit}
					onSort={handleSort}
					onSelectionChange={(keys) => selectedKeys = keys}
				/>
			{/if}
		</div>
	{/snippet}
	{#snippet footer()}
		<div class="modal-footer">
			<a class="db-link" href="https://docs.google.com/spreadsheets/d/16eAuATxHYOdPo6B4yerZqxMh843lb1iCXrTGBMrtbEE/edit?usp=sharing" target="_blank" rel="noopener noreferrer">
				Full Database
				<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
					<polyline points="15 3 21 3 21 9"/>
					<line x1="10" y1="14" x2="21" y2="3"/>
				</svg>
			</a>
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
		align-items: center;
		gap: var(--spacing-sm);
		flex-shrink: 0;
	}

	.db-link {
		margin-right: auto;
		font-size: 0.8rem;
		color: var(--color-text-muted);
		text-decoration: none;
		display: flex;
		align-items: center;
		gap: 4px;
		transition: color 0.15s;
	}

	.db-link:hover {
		color: var(--color-highlight);
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

	/* Log Reduction row */
	.log-reduction-row {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		margin-bottom: var(--spacing-sm);
		flex-wrap: wrap;
	}

	.log-reduction-row.inactive {
		opacity: 0.4;
	}

	.log-reduction-label {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.log-checkbox {
		display: flex;
		align-items: center;
		gap: 3px;
		font-size: 0.8rem;
		color: var(--color-text);
		cursor: pointer;
		white-space: nowrap;
	}

	.log-checkbox input[type="checkbox"] {
		width: auto;
		margin: 0;
		cursor: pointer;
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

	/* Species dropdown */
	.species-dropdown {
		position: relative;
		margin-bottom: var(--spacing-sm);
	}

	.species-dropdown-btn {
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: 4px 10px;
		font-size: 0.8rem;
		color: var(--color-text);
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 6px;
		transition: all 0.15s;
	}

	.species-dropdown-btn:hover {
		background: var(--color-bg-secondary);
		border-color: var(--color-text-muted);
	}

	.dropdown-chevron {
		transition: transform 0.15s;
	}

	.dropdown-chevron.open {
		transform: rotate(180deg);
	}

	.species-dropdown-list {
		position: absolute;
		top: 100%;
		left: 0;
		z-index: 10;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
		max-height: 200px;
		overflow-y: auto;
		min-width: 220px;
		margin-top: 2px;
	}

	.species-dropdown-item {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 10px;
		font-size: 0.8rem;
		color: var(--color-text);
		cursor: pointer;
		transition: background 0.1s;
		margin: 0;
		text-transform: none;
		letter-spacing: normal;
	}

	.species-dropdown-item:hover {
		background: var(--color-bg-secondary);
	}

	.species-dropdown-item input[type="checkbox"] {
		width: auto;
		margin: 0;
		cursor: pointer;
	}

	.species-name {
		flex: 1;
		font-style: italic;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.species-count {
		color: var(--color-text-muted);
		font-size: 0.75rem;
		flex-shrink: 0;
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
