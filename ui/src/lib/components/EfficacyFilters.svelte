<script lang="ts">
	interface Props {
		mediums: string[];
		categories: string[];
		wavelengths: number[];
		selectedMedium: string;
		selectedCategory: string;
		selectedWavelength: number | 'All';
		speciesSearch: string;
		conditionSearch: string;
		logLevels: Set<number>;
		onMediumChange: (value: string) => void;
		onCategoryChange: (value: string) => void;
		onWavelengthChange: (value: number | 'All') => void;
		onSpeciesSearchChange: (value: string) => void;
		onConditionSearchChange: (value: string) => void;
		onLogLevelsChange: (value: Set<number>) => void;
	}

	let {
		mediums,
		categories,
		wavelengths,
		selectedMedium,
		selectedCategory,
		selectedWavelength,
		speciesSearch,
		conditionSearch,
		logLevels,
		onMediumChange,
		onCategoryChange,
		onWavelengthChange,
		onSpeciesSearchChange,
		onConditionSearchChange,
		onLogLevelsChange
	}: Props = $props();

	import { LOG_LABELS } from '$lib/utils/survival-math';

	function toggleLevel(level: number) {
		const next = new Set(logLevels);
		if (next.has(level)) {
			if (next.size > 1) next.delete(level);
		} else {
			next.add(level);
		}
		onLogLevelsChange(next);
	}
</script>

<div class="filters-section">
	<div class="filter-row">
		<div class="filter-group">
			<label for="medium-filter">Medium</label>
			<select id="medium-filter" value={selectedMedium} onchange={(e) => onMediumChange((e.target as HTMLSelectElement).value)}>
				<option value="All">All</option>
				{#each mediums as m}
					<option value={m}>{m}</option>
				{/each}
			</select>
		</div>

		<div class="filter-group">
			<label for="category-filter">Category</label>
			<select id="category-filter" value={selectedCategory} onchange={(e) => onCategoryChange((e.target as HTMLSelectElement).value)}>
				<option value="All">All</option>
				{#each categories as c}
					<option value={c}>{c}</option>
				{/each}
			</select>
		</div>

		<div class="filter-group">
			<label for="wavelength-filter">Wavelength</label>
			<select id="wavelength-filter" value={String(selectedWavelength)} onchange={(e) => {
				const val = (e.target as HTMLSelectElement).value;
				onWavelengthChange(val === 'All' ? 'All' : Number(val));
			}}>
				<option value="All">All</option>
				{#each wavelengths as w}
					<option value={String(w)}>{w} nm</option>
				{/each}
			</select>
		</div>

		<div class="filter-group species-search">
			<label for="species-search">Species</label>
			<input
				id="species-search"
				type="text"
				placeholder="Search species or strain..."
				value={speciesSearch}
				oninput={(e) => onSpeciesSearchChange((e.target as HTMLInputElement).value)}
			/>
		</div>

		<div class="filter-group condition-search">
			<label for="condition-search">Condition</label>
			<input
				id="condition-search"
				type="text"
				placeholder="Search condition..."
				value={conditionSearch}
				oninput={(e) => onConditionSearchChange((e.target as HTMLInputElement).value)}
			/>
		</div>

		<div class="filter-group">
			<label>Log Reduction</label>
			<div class="log-checkboxes">
				{#each Object.entries(LOG_LABELS) as [level, label]}
					<label class="log-checkbox">
						<input
							type="checkbox"
							checked={logLevels.has(Number(level))}
							onchange={() => toggleLevel(Number(level))}
						/>
						{label}
					</label>
				{/each}
			</div>
		</div>
	</div>
</div>

<style>
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
		min-width: 100px;
	}

	.filter-group.species-search,
	.filter-group.condition-search {
		flex: 1;
		min-width: 140px;
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

	.log-checkboxes {
		display: flex;
		flex-wrap: wrap;
		gap: 2px 8px;
	}

	.log-checkbox {
		display: flex;
		align-items: center;
		gap: 3px;
		font-size: 0.8rem;
		color: var(--color-text);
		cursor: pointer;
		text-transform: none;
		letter-spacing: normal;
		white-space: nowrap;
	}

	.log-checkbox input[type="checkbox"] {
		width: auto;
		margin: 0;
		cursor: pointer;
	}
</style>
