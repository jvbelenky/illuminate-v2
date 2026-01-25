<script lang="ts">
	import { getEfficacyTable, getEfficacyMediums, getEfficacyCategories, getEfficacyWavelengths } from '$lib/api/client';
	import {
		parseTableResponse,
		filterData,
		computeStats,
		sortData,
		getCategoryColor,
		getUniqueCategories,
		exportToCSV,
		type EfficacyRow,
		type EfficacyFilters
	} from '$lib/utils/efficacy-filters';
	import { formatValue } from '$lib/utils/formatting';

	interface Props {
		fluence: number;
		wavelength?: number;
		onclose: () => void;
	}

	let { fluence, wavelength = 222, onclose }: Props = $props();

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

	// Table sort state
	let sortColumn = $state<keyof EfficacyRow>('each_uv');
	let sortAscending = $state(false);

	// Derived filter object
	const filters = $derived<EfficacyFilters>({
		medium: selectedMedium === 'All' ? undefined : selectedMedium,
		category: selectedCategory === 'All' ? undefined : selectedCategory,
		wavelength: selectedWavelength === 'All' ? undefined : selectedWavelength,
		speciesSearch: speciesSearch
	});

	// Filtered and sorted data
	const filteredData = $derived(filterData(allData, filters));
	const sortedData = $derived(sortData(filteredData, sortColumn, sortAscending));
	const stats = $derived(computeStats(filteredData));
	const dataCategories = $derived(getUniqueCategories(filteredData));

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
		const csv = exportToCSV(sortedData);
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

	// Format time for display
	function formatTime(seconds: number): string {
		if (seconds < 60) return `${Math.round(seconds)}s`;
		if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
		return `${(seconds / 3600).toFixed(1)}h`;
	}

	// Swarm plot dimensions
	const plotWidth = 500;
	const plotHeight = 250;
	const plotPadding = { top: 20, right: 20, bottom: 40, left: 60 };
	const innerWidth = plotWidth - plotPadding.left - plotPadding.right;
	const innerHeight = plotHeight - plotPadding.top - plotPadding.bottom;

	// Calculate swarm plot data
	const swarmData = $derived.by(() => {
		if (filteredData.length === 0) return [];

		const cats = dataCategories;
		if (cats.length === 0) return [];

		// Calculate Y scale (eACH-UV)
		const yMin = Math.max(0, stats.min * 0.9);
		const yMax = stats.max * 1.1 || 1;
		const yScale = (val: number) => innerHeight - ((val - yMin) / (yMax - yMin)) * innerHeight;

		// Calculate X positions for each category
		const categoryWidth = innerWidth / cats.length;
		const categoryX = (cat: string) => {
			const idx = cats.indexOf(cat);
			return categoryWidth / 2 + idx * categoryWidth;
		};

		// Generate points with jitter
		return filteredData.map((row, i) => {
			const baseX = categoryX(row.category);
			// Use deterministic jitter based on index for stability
			const jitter = ((i * 7919) % 100 - 50) / 100 * (categoryWidth * 0.4);
			return {
				x: baseX + jitter,
				y: yScale(row.each_uv),
				color: getCategoryColor(row.category),
				row
			};
		});
	});

	// Y-axis ticks
	const yTicks = $derived.by(() => {
		if (stats.count === 0) return [];
		const yMin = Math.max(0, stats.min * 0.9);
		const yMax = stats.max * 1.1 || 1;
		const tickCount = 5;
		const step = (yMax - yMin) / (tickCount - 1);
		return Array.from({ length: tickCount }, (_, i) => ({
			value: yMin + i * step,
			y: innerHeight - (i / (tickCount - 1)) * innerHeight
		}));
	});

	// Tooltip state
	let hoveredPoint = $state<{ row: EfficacyRow; x: number; y: number } | null>(null);
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={handleBackdropClick}>
	<div class="modal-content" role="dialog" aria-modal="true">
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
				<!-- Filters Section -->
				<div class="filters-section">
					<div class="filter-row">
						<div class="filter-group">
							<label for="medium-filter">Medium</label>
							<select id="medium-filter" bind:value={selectedMedium}>
								<option value="All">All</option>
								{#each mediums as m}
									<option value={m}>{m}</option>
								{/each}
							</select>
						</div>

						<div class="filter-group">
							<label for="category-filter">Category</label>
							<select id="category-filter" bind:value={selectedCategory}>
								<option value="All">All</option>
								{#each categories as c}
									<option value={c}>{c}</option>
								{/each}
							</select>
						</div>

						<div class="filter-group">
							<label for="wavelength-filter">Wavelength</label>
							<select id="wavelength-filter" bind:value={selectedWavelength}>
								<option value="All">All</option>
								{#each wavelengths as w}
									<option value={w}>{w} nm</option>
								{/each}
							</select>
						</div>

						<div class="filter-group species-search">
							<label for="species-search">Species</label>
							<input
								id="species-search"
								type="text"
								placeholder="Search species or strain..."
								bind:value={speciesSearch}
							/>
						</div>
					</div>
				</div>

				<!-- Swarm Plot Section -->
				<div class="plot-section">
					<h4>eACH-UV by Category</h4>
					{#if filteredData.length > 0}
						<div class="plot-container">
							<svg width={plotWidth} height={plotHeight}>
								<g transform="translate({plotPadding.left}, {plotPadding.top})">
									<!-- Y-axis -->
									<line x1="0" y1="0" x2="0" y2={innerHeight} class="axis-line" />
									{#each yTicks as tick}
										<g transform="translate(0, {tick.y})">
											<line x1="-5" y1="0" x2="0" y2="0" class="tick-line" />
											<text x="-8" y="4" class="tick-label" text-anchor="end">{formatValue(tick.value, 1)}</text>
											<line x1="0" y1="0" x2={innerWidth} y2="0" class="grid-line" />
										</g>
									{/each}
									<text x="-45" y={innerHeight / 2} class="axis-label" text-anchor="middle" transform="rotate(-90, -45, {innerHeight / 2})">eACH-UV</text>

									<!-- X-axis -->
									<line x1="0" y1={innerHeight} x2={innerWidth} y2={innerHeight} class="axis-line" />
									{#each dataCategories as cat, i}
										{@const x = (innerWidth / dataCategories.length) * (i + 0.5)}
										<text x={x} y={innerHeight + 20} class="tick-label" text-anchor="middle">{cat}</text>
									{/each}

									<!-- Data points -->
									{#each swarmData as point}
										<!-- svelte-ignore a11y_no_static_element_interactions -->
										<circle
											cx={point.x}
											cy={point.y}
											r="4"
											fill={point.color}
											fill-opacity="0.7"
											stroke={point.color}
											stroke-width="1"
											class="data-point"
											onmouseenter={(e) => {
												const rect = (e.target as SVGElement).getBoundingClientRect();
												hoveredPoint = { row: point.row, x: rect.left, y: rect.top };
											}}
											onmouseleave={() => hoveredPoint = null}
										/>
									{/each}
								</g>
							</svg>

							<!-- Tooltip -->
							{#if hoveredPoint}
								<div class="tooltip" style="left: {hoveredPoint.x + 10}px; top: {hoveredPoint.y - 10}px;">
									<div class="tooltip-title">{hoveredPoint.row.species}</div>
									{#if hoveredPoint.row.strain}
										<div class="tooltip-row">Strain: {hoveredPoint.row.strain}</div>
									{/if}
									<div class="tooltip-row">eACH-UV: {formatValue(hoveredPoint.row.each_uv, 2)}</div>
									<div class="tooltip-row">k1: {formatValue(hoveredPoint.row.k1, 4)} cm²/mJ</div>
									<div class="tooltip-row">99% in: {formatTime(hoveredPoint.row.seconds_to_99)}</div>
								</div>
							{/if}
						</div>

						<!-- Stats bar -->
						<div class="stats-bar">
							<span>Median: <strong>{formatValue(stats.median, 2)}</strong></span>
							<span>Range: <strong>{formatValue(stats.min, 2)} - {formatValue(stats.max, 2)}</strong></span>
							<span>N = <strong>{stats.count}</strong> pathogens</span>
						</div>
					{:else}
						<div class="no-data">No data matches the current filters</div>
					{/if}
				</div>

				<!-- Data Table Section -->
				<div class="table-section">
					<div class="table-header-row">
						<h4>Data Table</h4>
						<span class="row-count">Showing {sortedData.length} of {allData.length} pathogens</span>
					</div>

					<div class="table-container">
						<table>
							<thead>
								<tr>
									<th class="sortable" onclick={() => handleSort('category')}>
										Category {sortColumn === 'category' ? (sortAscending ? '↑' : '↓') : ''}
									</th>
									<th class="sortable" onclick={() => handleSort('species')}>
										Species {sortColumn === 'species' ? (sortAscending ? '↑' : '↓') : ''}
									</th>
									<th class="sortable" onclick={() => handleSort('strain')}>
										Strain {sortColumn === 'strain' ? (sortAscending ? '↑' : '↓') : ''}
									</th>
									<th class="sortable numeric" onclick={() => handleSort('k1')}>
										k1 (cm²/mJ) {sortColumn === 'k1' ? (sortAscending ? '↑' : '↓') : ''}
									</th>
									<th class="sortable numeric" onclick={() => handleSort('each_uv')}>
										eACH-UV {sortColumn === 'each_uv' ? (sortAscending ? '↑' : '↓') : ''}
									</th>
									<th class="sortable numeric" onclick={() => handleSort('seconds_to_99')}>
										99% time {sortColumn === 'seconds_to_99' ? (sortAscending ? '↑' : '↓') : ''}
									</th>
								</tr>
							</thead>
							<tbody>
								{#each sortedData.slice(0, 100) as row}
									<tr>
										<td>
											<span class="category-badge" style="background: {getCategoryColor(row.category)}20; color: {getCategoryColor(row.category)}; border: 1px solid {getCategoryColor(row.category)}40;">
												{row.category}
											</span>
										</td>
										<td class="species-cell">{row.species}</td>
										<td class="strain-cell">{row.strain || '—'}</td>
										<td class="numeric">{formatValue(row.k1, 4)}</td>
										<td class="numeric highlight">{formatValue(row.each_uv, 2)}</td>
										<td class="numeric">{formatTime(row.seconds_to_99)}</td>
									</tr>
								{/each}
							</tbody>
						</table>
						{#if sortedData.length > 100}
							<div class="table-truncation">
								Showing first 100 rows. Export CSV for full dataset.
							</div>
						{/if}
					</div>
				</div>
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
		width: min(900px, 95vw);
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

	/* Filters */
	.filters-section {
		margin-bottom: var(--spacing-md);
		padding-bottom: var(--spacing-md);
		border-bottom: 1px solid var(--color-border);
	}

	.filter-row {
		display: flex;
		gap: var(--spacing-md);
		flex-wrap: wrap;
	}

	.filter-group {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
		min-width: 120px;
	}

	.filter-group.species-search {
		flex: 1;
		min-width: 200px;
	}

	.filter-group label {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin: 0;
	}

	.filter-group select,
	.filter-group input {
		padding: var(--spacing-xs) var(--spacing-sm);
		font-size: 0.85rem;
	}

	/* Plot Section */
	.plot-section {
		margin-bottom: var(--spacing-md);
	}

	.plot-section h4 {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin: 0 0 var(--spacing-sm) 0;
	}

	.plot-container {
		position: relative;
		display: flex;
		justify-content: center;
		background: var(--color-bg-secondary);
		border-radius: var(--radius-sm);
		padding: var(--spacing-sm);
	}

	.plot-container svg {
		display: block;
	}

	.axis-line, .tick-line {
		stroke: var(--color-text-muted);
		stroke-width: 1;
	}

	.grid-line {
		stroke: var(--color-border);
		stroke-width: 1;
		stroke-dasharray: 2,2;
		opacity: 0.5;
	}

	.tick-label {
		font-size: 0.7rem;
		fill: var(--color-text-muted);
		font-family: var(--font-mono);
	}

	.axis-label {
		font-size: 0.75rem;
		fill: var(--color-text);
	}

	.data-point {
		cursor: pointer;
		transition: r 0.15s, fill-opacity 0.15s;
	}

	.data-point:hover {
		r: 6;
		fill-opacity: 1;
	}

	.tooltip {
		position: fixed;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: var(--spacing-xs) var(--spacing-sm);
		font-size: 0.75rem;
		z-index: 1001;
		pointer-events: none;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
	}

	.tooltip-title {
		font-weight: 600;
		color: var(--color-text);
		margin-bottom: 2px;
	}

	.tooltip-row {
		color: var(--color-text-muted);
	}

	.stats-bar {
		display: flex;
		justify-content: center;
		gap: var(--spacing-lg);
		padding: var(--spacing-sm) 0;
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	.stats-bar strong {
		color: var(--color-text);
		font-family: var(--font-mono);
	}

	.no-data {
		text-align: center;
		padding: var(--spacing-lg);
		color: var(--color-text-muted);
		background: var(--color-bg-secondary);
		border-radius: var(--radius-sm);
	}

	/* Table Section */
	.table-section {
		/* Allow table section to fill remaining space */
	}

	.table-header-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--spacing-sm);
	}

	.table-header-row h4 {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin: 0;
	}

	.row-count {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.table-container {
		max-height: 300px;
		overflow-y: auto;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8rem;
	}

	thead {
		position: sticky;
		top: 0;
		background: var(--color-bg-tertiary);
		z-index: 1;
	}

	th {
		padding: var(--spacing-xs) var(--spacing-sm);
		text-align: left;
		font-weight: 600;
		color: var(--color-text);
		border-bottom: 1px solid var(--color-border);
		white-space: nowrap;
	}

	th.sortable {
		cursor: pointer;
		user-select: none;
	}

	th.sortable:hover {
		background: var(--color-bg-secondary);
	}

	th.numeric {
		text-align: right;
	}

	td {
		padding: var(--spacing-xs) var(--spacing-sm);
		border-bottom: 1px solid var(--color-border);
		color: var(--color-text);
	}

	td.numeric {
		text-align: right;
		font-family: var(--font-mono);
	}

	td.numeric.highlight {
		color: var(--color-highlight);
		font-weight: 600;
	}

	.species-cell {
		font-style: italic;
	}

	.strain-cell {
		color: var(--color-text-muted);
		font-size: 0.75rem;
	}

	.category-badge {
		display: inline-block;
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		font-size: 0.7rem;
		font-weight: 500;
	}

	tbody tr:hover {
		background: var(--color-bg-secondary);
	}

	.table-truncation {
		padding: var(--spacing-sm);
		text-align: center;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		background: var(--color-bg-tertiary);
		border-top: 1px solid var(--color-border);
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
