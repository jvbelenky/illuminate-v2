<script lang="ts">
	import {
		getCategoryColor,
		getRowKey,
		type EfficacyRow
	} from '$lib/utils/efficacy-filters';
	import { logReductionTime } from '$lib/utils/survival-math';
	import { formatValue } from '$lib/utils/formatting';
	import { LOG_LABELS } from '$lib/utils/survival-math';

	interface Props {
		sortedData: EfficacyRow[];
		totalCount: number;
		sortColumn: keyof EfficacyRow;
		sortAscending: boolean;
		selectedKeys: Set<string>;
		logLevel: number;
		fluence: number;
		onSort: (column: keyof EfficacyRow) => void;
		onSelectionChange: (keys: Set<string>) => void;
	}

	let {
		sortedData,
		totalCount,
		sortColumn,
		sortAscending,
		selectedKeys,
		logLevel,
		fluence,
		onSort,
		onSelectionChange
	}: Props = $props();

	const allSelected = $derived(
		sortedData.length > 0 && sortedData.every(row => selectedKeys.has(getRowKey(row)))
	);

	function toggleAll() {
		if (allSelected) {
			onSelectionChange(new Set());
		} else {
			const keys = new Set(sortedData.map(row => getRowKey(row)));
			onSelectionChange(keys);
		}
	}

	function toggleRow(row: EfficacyRow) {
		const key = getRowKey(row);
		const next = new Set(selectedKeys);
		if (next.has(key)) {
			next.delete(key);
		} else {
			next.add(key);
		}
		onSelectionChange(next);
	}

	function sortIndicator(col: keyof EfficacyRow): string {
		if (sortColumn !== col) return '';
		return sortAscending ? ' ↑' : ' ↓';
	}

	function formatTime(seconds: number): string {
		if (!isFinite(seconds) || seconds < 0) return '—';
		if (seconds < 60) return `${Math.round(seconds)}s`;
		if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
		return `${(seconds / 3600).toFixed(1)}h`;
	}

	function getTimeForRow(row: EfficacyRow): number {
		if (logLevel === 2) return row.seconds_to_99;
		return logReductionTime(logLevel, fluence, row.k1, row.k2 ?? 0, row.resistant_fraction);
	}

	const timeLabel = $derived(LOG_LABELS[logLevel] || '99%');
</script>

<div class="table-section">
	<div class="table-header-row">
		<h4>Data Table</h4>
		<span class="row-count">
			{#if selectedKeys.size > 0}
				{selectedKeys.size} selected &middot;
			{/if}
			Showing {sortedData.length} of {totalCount} pathogens
		</span>
	</div>

	<div class="table-container">
		<table>
			<thead>
				<tr>
					<th class="checkbox-col">
						<input type="checkbox" checked={allSelected} onchange={toggleAll} title="Select all" />
					</th>
					<th class="sortable" onclick={() => onSort('category')}>
						Category{sortIndicator('category')}
					</th>
					<th class="sortable" onclick={() => onSort('species')}>
						Species{sortIndicator('species')}
					</th>
					<th class="sortable" onclick={() => onSort('strain')}>
						Strain{sortIndicator('strain')}
					</th>
					<th class="sortable numeric" onclick={() => onSort('k1')}>
						k1 (cm²/mJ){sortIndicator('k1')}
					</th>
					<th class="sortable numeric" onclick={() => onSort('k2')}>
						k2{sortIndicator('k2')}
					</th>
					<th class="sortable numeric" onclick={() => onSort('resistant_fraction')}>
						% Res.{sortIndicator('resistant_fraction')}
					</th>
					<th class="sortable numeric" onclick={() => onSort('each_uv')}>
						eACH-UV{sortIndicator('each_uv')}
					</th>
					<th class="sortable numeric" onclick={() => onSort('seconds_to_99')}>
						{timeLabel} time{sortIndicator('seconds_to_99')}
					</th>
					<th class="sortable" onclick={() => onSort('condition')}>
						Condition{sortIndicator('condition')}
					</th>
					<th>Ref</th>
				</tr>
			</thead>
			<tbody>
				{#each sortedData as row}
					{@const key = getRowKey(row)}
					<tr class:selected={selectedKeys.has(key)}>
						<td class="checkbox-col">
							<input type="checkbox" checked={selectedKeys.has(key)} onchange={() => toggleRow(row)} />
						</td>
						<td>
							<span class="category-badge" style="background: {getCategoryColor(row.category)}20; color: {getCategoryColor(row.category)}; border: 1px solid {getCategoryColor(row.category)}40;">
								{row.category}
							</span>
						</td>
						<td class="species-cell">{row.species}</td>
						<td class="strain-cell">{row.strain || '—'}</td>
						<td class="numeric">{formatValue(row.k1, 4)}</td>
						<td class="numeric">{row.k2 !== null ? formatValue(row.k2, 4) : '—'}</td>
						<td class="numeric">{row.resistant_fraction > 0 ? (row.resistant_fraction * 100).toFixed(1) + '%' : '—'}</td>
						<td class="numeric highlight">{formatValue(row.each_uv, 2)}</td>
						<td class="numeric">{formatTime(getTimeForRow(row))}</td>
						<td class="condition-cell" title={row.condition}>{row.condition || '—'}</td>
						<td class="ref-cell">
							{#if row.link}
								<a href={row.link} target="_blank" rel="noopener noreferrer" title={row.reference || 'Reference'}>
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
										<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
										<polyline points="15 3 21 3 21 9"/>
										<line x1="10" y1="14" x2="21" y2="3"/>
									</svg>
								</a>
							{:else if row.reference}
								<span title={row.reference}>📄</span>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<style>
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

	th.checkbox-col,
	td.checkbox-col {
		width: 30px;
		text-align: center;
		padding: var(--spacing-xs);
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

	.condition-cell {
		max-width: 100px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--color-text-muted);
		font-size: 0.75rem;
	}

	.ref-cell {
		text-align: center;
	}

	.ref-cell a {
		color: var(--color-text-muted);
		transition: color 0.15s;
	}

	.ref-cell a:hover {
		color: var(--color-highlight);
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

	tbody tr.selected {
		background: var(--color-bg-tertiary);
	}
</style>
