<script lang="ts">
	interface Props {
		mediums: string[];
		categories: string[];
		wavelengths: number[];
		selectedMediums: string[];
		selectedCategories: string[];
		selectedWavelengths: number[];
		speciesSearch: string;
		conditionSearch: string;
		onMediumsChange: (value: string[]) => void;
		onCategoriesChange: (value: string[]) => void;
		onWavelengthsChange: (value: number[]) => void;
		onSpeciesSearchChange: (value: string) => void;
		onConditionSearchChange: (value: string) => void;
	}

	let {
		mediums,
		categories,
		wavelengths,
		selectedMediums,
		selectedCategories,
		selectedWavelengths,
		speciesSearch,
		conditionSearch,
		onMediumsChange,
		onCategoriesChange,
		onWavelengthsChange,
		onSpeciesSearchChange,
		onConditionSearchChange
	}: Props = $props();

	let mediumDropdownOpen = $state(false);
	let categoryDropdownOpen = $state(false);
	let wavelengthDropdownOpen = $state(false);

	let mediumDropdownEl = $state<HTMLElement | null>(null);
	let categoryDropdownEl = $state<HTMLElement | null>(null);
	let wavelengthDropdownEl = $state<HTMLElement | null>(null);

	// Close dropdowns when clicking outside
	function handleDocumentClick(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (mediumDropdownOpen && mediumDropdownEl && !mediumDropdownEl.contains(target)) {
			mediumDropdownOpen = false;
		}
		if (categoryDropdownOpen && categoryDropdownEl && !categoryDropdownEl.contains(target)) {
			categoryDropdownOpen = false;
		}
		if (wavelengthDropdownOpen && wavelengthDropdownEl && !wavelengthDropdownEl.contains(target)) {
			wavelengthDropdownOpen = false;
		}
	}

	$effect(() => {
		document.addEventListener('mousedown', handleDocumentClick);
		return () => document.removeEventListener('mousedown', handleDocumentClick);
	});

	const mediumLabel = $derived(
		selectedMediums.length === 0
			? 'All'
			: selectedMediums.length === 1
				? selectedMediums[0]
				: `${selectedMediums.length} selected`
	);

	const categoryLabel = $derived(
		selectedCategories.length === 0
			? 'All'
			: selectedCategories.length === 1
				? selectedCategories[0]
				: `${selectedCategories.length} selected`
	);

	const wavelengthLabel = $derived(
		selectedWavelengths.length === 0
			? 'All'
			: selectedWavelengths.length === 1
				? `${selectedWavelengths[0]} nm`
				: `${selectedWavelengths.length} selected`
	);

	function toggleMedium(m: string) {
		if (selectedMediums.includes(m)) {
			onMediumsChange(selectedMediums.filter(v => v !== m));
		} else {
			onMediumsChange([...selectedMediums, m].sort());
		}
	}

	function selectAllMediums() {
		onMediumsChange([]);
	}

	function toggleCategory(c: string) {
		if (selectedCategories.includes(c)) {
			onCategoriesChange(selectedCategories.filter(v => v !== c));
		} else {
			onCategoriesChange([...selectedCategories, c].sort());
		}
	}

	function selectAllCategories() {
		onCategoriesChange([]);
	}

	function toggleWavelength(w: number) {
		if (selectedWavelengths.includes(w)) {
			onWavelengthsChange(selectedWavelengths.filter(v => v !== w));
		} else {
			onWavelengthsChange([...selectedWavelengths, w].sort((a, b) => a - b));
		}
	}

	function selectAllWavelengths() {
		onWavelengthsChange([]);
	}
</script>

<div class="filters-section">
	<div class="filter-row">
		<div class="filter-group medium-dropdown" bind:this={mediumDropdownEl}>
			<label>Medium</label>
			<button
				class="dropdown-btn"
				onclick={() => mediumDropdownOpen = !mediumDropdownOpen}
			>
				{mediumLabel}
				<svg class="dropdown-chevron" class:open={mediumDropdownOpen} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<polyline points="6 9 12 15 18 9"/>
				</svg>
			</button>
			{#if mediumDropdownOpen}
				<div class="dropdown-list">
					<label class="dropdown-item">
						<input type="checkbox" checked={selectedMediums.length === 0} onchange={selectAllMediums} />
						<span>All</span>
					</label>
					{#each mediums as m (m)}
						<label class="dropdown-item">
							<input type="checkbox" checked={selectedMediums.includes(m)} onchange={() => toggleMedium(m)} />
							<span>{m}</span>
						</label>
					{/each}
				</div>
			{/if}
		</div>

		<div class="filter-group category-dropdown" bind:this={categoryDropdownEl}>
			<label>Category</label>
			<button
				class="dropdown-btn"
				onclick={() => categoryDropdownOpen = !categoryDropdownOpen}
			>
				{categoryLabel}
				<svg class="dropdown-chevron" class:open={categoryDropdownOpen} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<polyline points="6 9 12 15 18 9"/>
				</svg>
			</button>
			{#if categoryDropdownOpen}
				<div class="dropdown-list">
					<label class="dropdown-item">
						<input type="checkbox" checked={selectedCategories.length === 0} onchange={selectAllCategories} />
						<span>All</span>
					</label>
					{#each categories as c (c)}
						<label class="dropdown-item">
							<input type="checkbox" checked={selectedCategories.includes(c)} onchange={() => toggleCategory(c)} />
							<span>{c}</span>
						</label>
					{/each}
				</div>
			{/if}
		</div>

		<div class="filter-group wavelength-dropdown" bind:this={wavelengthDropdownEl}>
			<label>Wavelength</label>
			<button
				class="dropdown-btn"
				onclick={() => wavelengthDropdownOpen = !wavelengthDropdownOpen}
			>
				{wavelengthLabel}
				<svg class="dropdown-chevron" class:open={wavelengthDropdownOpen} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<polyline points="6 9 12 15 18 9"/>
				</svg>
			</button>
			{#if wavelengthDropdownOpen}
				<div class="dropdown-list">
					<label class="dropdown-item">
						<input type="checkbox" checked={selectedWavelengths.length === 0} onchange={selectAllWavelengths} />
						<span>All</span>
					</label>
					{#each wavelengths as w (w)}
						<label class="dropdown-item">
							<input type="checkbox" checked={selectedWavelengths.includes(w)} onchange={() => toggleWavelength(w)} />
							<span>{w} nm</span>
						</label>
					{/each}
				</div>
			{/if}
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

	/* Checkbox dropdown (medium, category, wavelength) */
	.medium-dropdown,
	.category-dropdown,
	.wavelength-dropdown {
		position: relative;
	}

	.dropdown-btn {
		width: 100%;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: var(--spacing-xs) var(--spacing-sm);
		font-size: 0.85rem;
		color: var(--color-text);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
		transition: all 0.15s;
	}

	.dropdown-btn:hover {
		border-color: var(--color-text-muted);
	}

	.dropdown-chevron {
		flex-shrink: 0;
		transition: transform 0.15s;
	}

	.dropdown-chevron.open {
		transform: rotate(180deg);
	}

	.dropdown-list {
		position: absolute;
		top: 100%;
		left: 0;
		right: 0;
		z-index: 10;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
		max-height: 200px;
		overflow-y: auto;
		margin-top: 2px;
		min-width: 120px;
	}

	.dropdown-item {
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
		white-space: nowrap;
	}

	.dropdown-item:hover {
		background: var(--color-bg-secondary);
	}

	.dropdown-item input[type="checkbox"] {
		width: auto;
		margin: 0;
		cursor: pointer;
	}

</style>
