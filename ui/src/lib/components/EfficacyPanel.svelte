<script lang="ts">
	import { formatValue } from '$lib/utils/formatting';
	import {
		getEfficacySummary,
		getEfficacyTable,
		getEfficacySwarmPlot,
		getEfficacyMediums,
		getEfficacyCategories,
		type PathogenSummary,
		type EfficacyTableResponse
	} from '$lib/api/client';

	interface Props {
		avgFluence: number;
		wavelength?: number | null;
		eachUvMedian: number;
		eachUvMin: number;
		eachUvMax: number;
		pathogenCount: number;
		airChanges?: number;
	}

	let {
		avgFluence,
		wavelength = 222,
		eachUvMedian,
		eachUvMin,
		eachUvMax,
		pathogenCount,
		airChanges = 1.0
	}: Props = $props();

	// UI state
	let showTable = $state(false);
	let showSwarmPlot = $state(false);
	let summaryLoading = $state(false);
	let tableLoading = $state(false);
	let plotLoading = $state(false);

	// Filter state
	let selectedMedium = $state('Aerosol');
	let selectedCategory = $state('');

	// Available filter options
	let mediums = $state<string[]>([]);
	let categories = $state<string[]>([]);

	// Loaded data
	let pathogenSummary = $state<PathogenSummary[]>([]);
	let tableData = $state<EfficacyTableResponse | null>(null);
	let swarmPlotImage = $state<string | null>(null);

	// Load filter options on mount
	$effect(() => {
		loadFilterOptions();
	});

	// Load pathogen summary when fluence changes
	$effect(() => {
		if (avgFluence > 0) {
			loadSummary();
		}
	});

	async function loadFilterOptions() {
		try {
			const [m, c] = await Promise.all([getEfficacyMediums(), getEfficacyCategories()]);
			mediums = m;
			categories = c;
		} catch (e) {
			console.warn('Failed to load efficacy filter options:', e);
			mediums = ['Aerosol', 'Surface', 'Liquid'];
			categories = [];
		}
	}

	async function loadSummary() {
		if (avgFluence <= 0) return;
		summaryLoading = true;
		try {
			const response = await getEfficacySummary(avgFluence, wavelength ?? 222);
			pathogenSummary = response.pathogens;
		} catch (e) {
			console.warn('Failed to load efficacy summary:', e);
			pathogenSummary = [];
		} finally {
			summaryLoading = false;
		}
	}

	async function loadTable() {
		if (avgFluence <= 0) return;
		tableLoading = true;
		try {
			tableData = await getEfficacyTable({
				fluence: avgFluence,
				wavelength: wavelength ?? undefined,
				medium: selectedMedium || undefined,
				category: selectedCategory || undefined
			});
		} catch (e) {
			console.warn('Failed to load efficacy table:', e);
			tableData = null;
		} finally {
			tableLoading = false;
		}
	}

	async function loadSwarmPlot() {
		if (avgFluence <= 0) return;
		plotLoading = true;
		try {
			const response = await getEfficacySwarmPlot({
				fluence: avgFluence,
				wavelength: wavelength ?? undefined,
				medium: selectedMedium || undefined,
				air_changes: airChanges
			});
			swarmPlotImage = response.image_base64;
		} catch (e) {
			console.warn('Failed to load swarm plot:', e);
			swarmPlotImage = null;
		} finally {
			plotLoading = false;
		}
	}

	function toggleTable() {
		showTable = !showTable;
		if (showTable && !tableData) {
			loadTable();
		}
	}

	function toggleSwarmPlot() {
		showSwarmPlot = !showSwarmPlot;
		if (showSwarmPlot && !swarmPlotImage) {
			loadSwarmPlot();
		}
	}

	function formatSeconds(seconds: number | null | undefined): string {
		if (seconds === null || seconds === undefined) return '—';
		if (seconds < 60) return `${formatValue(seconds, 0)} sec`;
		if (seconds < 3600) return `${formatValue(seconds / 60, 1)} min`;
		return `${formatValue(seconds / 3600, 1)} hr`;
	}

	// Reload table when filters change
	function onFilterChange() {
		if (showTable) {
			loadTable();
		}
		if (showSwarmPlot) {
			loadSwarmPlot();
		}
	}
</script>

<div class="efficacy-panel">
	<!-- Summary Stats -->
	<div class="summary-row">
		<span class="summary-label">Average Fluence</span>
		<span class="summary-value highlight">{formatValue(avgFluence, 3)} µW/cm²</span>
	</div>

	{#if wavelength}
		<div class="summary-row">
			<span class="summary-label">Wavelength</span>
			<span class="summary-value">{wavelength} nm</span>
		</div>
	{/if}

	<!-- eACH-UV Range -->
	<div class="each-uv-section">
		<div class="summary-row">
			<span class="summary-label">eACH-UV (median)</span>
			<span class="summary-value highlight">{formatValue(eachUvMedian, 1)}</span>
		</div>
		<div class="range-row">
			<span class="range-label">Range ({pathogenCount} pathogens):</span>
			<span class="range-value">{formatValue(eachUvMin, 1)} – {formatValue(eachUvMax, 1)}</span>
		</div>
		<p class="help-text">Equivalent air changes from UV for respiratory pathogens</p>
	</div>

	<!-- Quick Inactivation Summary Table -->
	<div class="inactivation-summary">
		<h5 class="subsection-title">Time to Inactivation</h5>

		{#if summaryLoading}
			<div class="loading-indicator">Loading...</div>
		{:else if pathogenSummary.length > 0}
			<table class="summary-table">
				<thead>
					<tr>
						<th>Pathogen</th>
						<th>90% (1-log)</th>
						<th>99% (2-log)</th>
						<th>99.9% (3-log)</th>
					</tr>
				</thead>
				<tbody>
					{#each pathogenSummary as pathogen}
						<tr>
							<td class="pathogen-name">{pathogen.species}</td>
							<td>{formatSeconds(pathogen.log1_seconds)}</td>
							<td>{formatSeconds(pathogen.log2_seconds)}</td>
							<td>{formatSeconds(pathogen.log3_seconds)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{:else}
			<div class="no-data">No pathogen data available</div>
		{/if}
	</div>

	<!-- Filters -->
	<div class="filters">
		<div class="filter-row">
			<label for="medium-select">Medium:</label>
			<select id="medium-select" bind:value={selectedMedium} onchange={onFilterChange}>
				<option value="">All</option>
				{#each mediums as medium}
					<option value={medium}>{medium}</option>
				{/each}
			</select>
		</div>
		<div class="filter-row">
			<label for="category-select">Category:</label>
			<select id="category-select" bind:value={selectedCategory} onchange={onFilterChange}>
				<option value="">All</option>
				{#each categories as category}
					<option value={category}>{category}</option>
				{/each}
			</select>
		</div>
	</div>

	<!-- Expandable Sections -->
	<div class="expandable-sections">
		<!-- K-value Table -->
		<button class="expand-btn" onclick={toggleTable}>
			<span class="expand-icon">{showTable ? '−' : '+'}</span>
			Show K-value Table
			{#if tableData}
				<span class="badge">{tableData.count}</span>
			{/if}
		</button>

		{#if showTable}
			<div class="expanded-content">
				{#if tableLoading}
					<div class="loading-indicator">Loading table data...</div>
				{:else if tableData && tableData.rows.length > 0}
					<div class="table-wrapper">
						<table class="data-table">
							<thead>
								<tr>
									{#each tableData.columns.slice(0, 6) as col}
										<th>{col}</th>
									{/each}
								</tr>
							</thead>
							<tbody>
								{#each tableData.rows.slice(0, 20) as row}
									<tr>
										{#each row.slice(0, 6) as cell}
											<td>{cell ?? '—'}</td>
										{/each}
									</tr>
								{/each}
							</tbody>
						</table>
						{#if tableData.rows.length > 20}
							<p class="table-note">Showing first 20 of {tableData.count} rows</p>
						{/if}
					</div>
				{:else}
					<div class="no-data">No data matching filters</div>
				{/if}
			</div>
		{/if}

		<!-- Swarm Plot -->
		<button class="expand-btn" onclick={toggleSwarmPlot}>
			<span class="expand-icon">{showSwarmPlot ? '−' : '+'}</span>
			Show Swarm Plot
		</button>

		{#if showSwarmPlot}
			<div class="expanded-content">
				{#if plotLoading}
					<div class="loading-indicator">Generating plot...</div>
				{:else if swarmPlotImage}
					<div class="plot-wrapper">
						<img
							src="data:image/png;base64,{swarmPlotImage}"
							alt="K-value swarm plot"
							class="plot-image"
						/>
					</div>
				{:else}
					<div class="no-data">Failed to generate plot</div>
				{/if}
			</div>
		{/if}
	</div>
</div>

<style>
	.efficacy-panel {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}

	.summary-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--spacing-xs) 0;
	}

	.summary-label {
		font-size: 0.875rem;
		color: var(--color-text);
	}

	.summary-value {
		font-family: var(--font-mono);
		font-size: 0.875rem;
		font-weight: 600;
	}

	.summary-value.highlight {
		color: var(--color-success);
	}

	.each-uv-section {
		background: var(--color-bg-secondary);
		border-radius: var(--radius-sm);
		padding: var(--spacing-sm);
		margin: var(--spacing-xs) 0;
	}

	.range-row {
		display: flex;
		justify-content: space-between;
		font-size: 0.75rem;
		padding: 2px 0;
	}

	.range-label {
		color: var(--color-text-muted);
	}

	.range-value {
		font-family: var(--font-mono);
		color: var(--color-text-muted);
	}

	.help-text {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		margin: var(--spacing-xs) 0 0 0;
		font-style: italic;
	}

	/* Inactivation Summary Table */
	.inactivation-summary {
		margin: var(--spacing-sm) 0;
	}

	.subsection-title {
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin: 0 0 var(--spacing-xs) 0;
	}

	.summary-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.75rem;
	}

	.summary-table th,
	.summary-table td {
		padding: var(--spacing-xs);
		text-align: left;
		border-bottom: 1px solid var(--color-border);
	}

	.summary-table th {
		font-weight: 600;
		color: var(--color-text-muted);
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.summary-table td {
		font-family: var(--font-mono);
	}

	.pathogen-name {
		font-family: var(--font-sans);
		font-style: italic;
	}

	/* Filters */
	.filters {
		display: flex;
		gap: var(--spacing-md);
		padding: var(--spacing-sm) 0;
		border-top: 1px solid var(--color-border);
		border-bottom: 1px solid var(--color-border);
		margin: var(--spacing-xs) 0;
	}

	.filter-row {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
	}

	.filter-row label {
		font-size: 0.7rem;
		color: var(--color-text-muted);
	}

	.filter-row select {
		font-size: 0.75rem;
		padding: 2px 4px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg);
		color: var(--color-text);
	}

	/* Expandable Sections */
	.expandable-sections {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.expand-btn {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		width: 100%;
		padding: var(--spacing-xs) var(--spacing-sm);
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		font-size: 0.75rem;
		color: var(--color-text);
		cursor: pointer;
		text-align: left;
		transition: background 0.15s;
	}

	.expand-btn:hover {
		background: var(--color-bg-secondary);
		color: var(--color-text);
	}

	.expand-icon {
		font-family: var(--font-mono);
		font-weight: bold;
		width: 1em;
	}

	.badge {
		margin-left: auto;
		background: var(--color-success);
		color: #000;
		padding: 1px 6px;
		border-radius: var(--radius-sm);
		font-size: 0.65rem;
		font-weight: 600;
	}

	.expanded-content {
		padding: var(--spacing-sm);
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-top: none;
		border-radius: 0 0 var(--radius-sm) var(--radius-sm);
		margin-top: -1px;
	}

	/* Data Table */
	.table-wrapper {
		max-height: 300px;
		overflow: auto;
	}

	.data-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.65rem;
	}

	.data-table th,
	.data-table td {
		padding: 4px 6px;
		text-align: left;
		border: 1px solid var(--color-border);
		white-space: nowrap;
	}

	.data-table th {
		background: var(--color-bg-tertiary);
		font-weight: 600;
		position: sticky;
		top: 0;
	}

	.data-table td {
		font-family: var(--font-mono);
	}

	.table-note {
		font-size: 0.65rem;
		color: var(--color-text-muted);
		text-align: center;
		margin-top: var(--spacing-xs);
	}

	/* Plot */
	.plot-wrapper {
		text-align: center;
	}

	.plot-image {
		max-width: 100%;
		height: auto;
		border-radius: var(--radius-sm);
	}

	/* States */
	.loading-indicator {
		text-align: center;
		padding: var(--spacing-md);
		color: var(--color-text-muted);
		font-size: 0.75rem;
	}

	.no-data {
		text-align: center;
		padding: var(--spacing-md);
		color: var(--color-text-muted);
		font-size: 0.75rem;
		font-style: italic;
	}
</style>
