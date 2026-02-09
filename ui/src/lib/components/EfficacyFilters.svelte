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
		logLevel: number;
		onMediumChange: (value: string) => void;
		onCategoryChange: (value: string) => void;
		onWavelengthChange: (value: number | 'All') => void;
		onSpeciesSearchChange: (value: string) => void;
		onConditionSearchChange: (value: string) => void;
		onLogLevelChange: (value: number) => void;
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
		logLevel,
		onMediumChange,
		onCategoryChange,
		onWavelengthChange,
		onSpeciesSearchChange,
		onConditionSearchChange,
		onLogLevelChange
	}: Props = $props();

	import { LOG_LABELS } from '$lib/utils/survival-math';
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
			<label for="log-level">Log Reduction</label>
			<select id="log-level" value={String(logLevel)} onchange={(e) => onLogLevelChange(Number((e.target as HTMLSelectElement).value))}>
				{#each Object.entries(LOG_LABELS) as [level, label]}
					<option value={level}>{label}</option>
				{/each}
			</select>
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
</style>
