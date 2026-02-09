<script lang="ts">
	import { getEfficacyTable, getEfficacyMediums, getEfficacyCategories, getEfficacyWavelengths } from '$lib/api/client';
	import { autoFocus } from '$lib/actions/autoFocus';
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
	import { logReductionTime, LOG_LABELS } from '$lib/utils/survival-math';
	import EfficacyFiltersComponent from './EfficacyFilters.svelte';
	import EfficacySwarmPlot from './EfficacySwarmPlot.svelte';
	import EfficacyStatsBar from './EfficacyStatsBar.svelte';
	import EfficacyDataTable from './EfficacyDataTable.svelte';
	import EfficacySurvivalPlot from './EfficacySurvivalPlot.svelte';
	import EfficacyWavelengthPlot from './EfficacyWavelengthPlot.svelte';

	interface Props {
		fluence: number;
		wavelength?: number;
		roomX: number;
		roomY: number;
		roomZ: number;
		roomUnits: 'meters' | 'feet';
		airChanges: number;
		onclose: () => void;
	}

	let { fluence, wavelength = 222, roomX, roomY, roomZ, roomUnits, airChanges, onclose }: Props = $props();

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
	let sortColumn = $state<keyof EfficacyRow>('each_uv');
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

	// Filtered and sorted data
	const filteredData = $derived(filterData(allData, filters));
	const sortedData = $derived(sortData(filteredData, sortColumn, sortAscending));
	const stats = $derived(computeStats(filteredData));
	const dataCategories = $derived(getUniqueCategories(filteredData));

	// Unique wavelengths in filtered data (for wavelength tab availability)
	const filteredWavelengths = $derived(new Set(filteredData.map(r => r.wavelength)));
	const wavelengthTabDisabled = $derived(filteredWavelengths.size <= 1);

	// Selected rows that match current filters (for survival plot)
	const selectedRows = $derived(
		filteredData.filter(row => selectedKeys.has(getRowKey(row)))
	);

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

	async function loadData() {
		loading = true;
		error = null;

		try {
			// Fetch filter options and data in parallel
			const [mediumsRes, categoriesRes, wavelengthsRes, tableRes] = await Promise.all([
				getEfficacyMediums(),
				getEfficacyCategories(),
				getEfficacyWavelengths(),
				getEfficacyTable({ fluence })
			]);

			mediums = mediumsRes;
			categories = categoriesRes;
			wavelengths = wavelengthsRes;
			allData = parseTableResponse(tableRes.columns, tableRes.rows);
		} catch (e) {
			console.error('Failed to load efficacy data:', e);
			error = e instanceof Error ? e.message : 'Failed to load data';
		} finally {
			loading = false;
		}
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
			if (logLevel !== 2) {
				const time = logReductionTime(logLevel, fluence, row.k1, row.k2 ?? 0, row.resistant_fraction);
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

	// Handle backdrop click
	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			onclose();
		}
	}

	// Handle keyboard events
	$effect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				onclose();
			}
		};
		window.addEventListener('keydown', handler);
		return () => window.removeEventListener('keydown', handler);
	});
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={handleBackdropClick}>
	<div class="modal-content" role="dialog" aria-modal="true" use:autoFocus>
		<div class="modal-header">
			<h3>Explore Pathogen Efficacy Data</h3>
			<button type="button" class="close-btn" onclick={onclose} title="Close">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M18 6L6 18M6 6l12 12"/>
				</svg>
			</button>
		</div>

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
				<!-- Filters -->
				<EfficacyFiltersComponent
					{mediums}
					{categories}
					{wavelengths}
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
							<EfficacySwarmPlot {filteredData} {stats} {dataCategories} {selectedKeys} {roomVolumeM3} {roomUnits} {airChanges} onSelectionChange={(keys) => selectedKeys = keys} />
							<EfficacyStatsBar {stats} />
						{:else if activeTab === 'survival'}
							<EfficacySurvivalPlot
								{selectedRows}
								{fluence}
								{logLevel}
							/>
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
					{logLevel}
					{fluence}
					onSort={handleSort}
					onSelectionChange={(keys) => selectedKeys = keys}
				/>
			{/if}
		</div>

		<div class="modal-footer">
			<button class="export-btn" onclick={handleExport} disabled={loading || sortedData.length === 0}>
				Export CSV
			</button>
			<button class="close-btn-text" onclick={onclose}>
				Close
			</button>
		</div>
	</div>
</div>

<style>
	.modal-backdrop {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: var(--spacing-md);
	}

	.modal-content {
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		width: min(1000px, 95vw);
		max-height: 90vh;
		display: flex;
		flex-direction: column;
		box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--spacing-sm) var(--spacing-md);
		border-bottom: 1px solid var(--color-border);
		flex-shrink: 0;
	}

	.modal-header h3 {
		margin: 0;
		font-size: 1rem;
		color: var(--color-text);
	}

	.close-btn {
		background: transparent;
		border: none;
		padding: var(--spacing-xs);
		cursor: pointer;
		color: var(--color-text-muted);
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-sm);
		transition: all 0.15s;
	}

	.close-btn:hover {
		background: var(--color-bg-tertiary);
		color: var(--color-text);
	}

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
