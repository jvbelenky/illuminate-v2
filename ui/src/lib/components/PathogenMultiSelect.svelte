<script lang="ts">
	interface Props {
		/** Species available (with data at the lamps' wavelengths). */
		options: string[];
		/** Category per species, for grouping. */
		categoryOf: Map<string, string>;
		/** Currently selected species. */
		selected: string[];
		onChange: (selected: string[]) => void;
	}

	let { options, categoryOf, selected, onChange }: Props = $props();

	let open = $state(false);
	let root = $state<HTMLDivElement | undefined>(undefined);

	const groups = $derived.by(() => {
		const byCategory = new Map<string, string[]>();
		for (const sp of options) {
			const cat = categoryOf.get(sp) ?? 'Other';
			if (!byCategory.has(cat)) byCategory.set(cat, []);
			byCategory.get(cat)!.push(sp);
		}
		return [...byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0]));
	});

	const selectedSet = $derived(new Set(selected));
	const summary = $derived.by(() => {
		const n = selected.filter(s => options.includes(s)).length;
		if (n === 0) return 'none selected';
		if (n === 1) return selected.find(s => options.includes(s)) ?? '1 pathogen';
		if (n === options.length) return `All ${n} pathogens`;
		return `${n} pathogens`;
	});

	function toggle(species: string) {
		const next = selectedSet.has(species) ? selected.filter(s => s !== species) : [...selected, species];
		onChange(next);
	}

</script>

<div class="multi-select" bind:this={root}>
	<button type="button" class="trigger" aria-expanded={open} onclick={() => open = !open}>
		<span class="trigger-text">Select pathogens… <span class="trigger-count">({summary})</span></span>
		<span class="chevron">{open ? '▴' : '▾'}</span>
	</button>
	{#if open}
		<div class="list" role="group" aria-label="Pathogens to compare">
			{#each groups as [category, species] (category)}
				<div class="group">
					<div class="group-header">
						<span class="group-name">{category}</span>
					</div>
					<div class="options">
						{#each species as sp (sp)}
							<label class="option" class:on={selectedSet.has(sp)}>
								<input type="checkbox" checked={selectedSet.has(sp)} onchange={() => toggle(sp)} />
								<span class="option-text">{sp}</span>
							</label>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.multi-select {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	/* Styled like the app's selects so it reads as a control, not a heading */
	.trigger {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--spacing-sm);
		padding: var(--spacing-sm);
		background: var(--color-bg-input);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text);
		font-size: var(--font-size-base);
		cursor: pointer;
		text-align: left;
	}

	.trigger-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.trigger-count {
		color: var(--color-text-muted);
	}

	.chevron {
		flex-shrink: 0;
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
	}

	/* Expands in place (the results panel scrolls, so a floating menu would be clipped) */
	.list {
		max-height: 280px;
		overflow-y: auto;
		padding: var(--spacing-xs) var(--spacing-sm) var(--spacing-sm);
		background: var(--color-bg-secondary);
		border-radius: var(--radius-md);
	}

	.group + .group {
		margin-top: var(--spacing-sm);
	}

	.group-header {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		padding: var(--spacing-xs) 0 2px;
		font-size: var(--font-size-sm);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
	}

	.options {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 2px var(--spacing-sm);
	}

	.option {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		padding: 3px 4px;
		border-radius: var(--radius-sm);
		font-size: var(--font-size-base);
		cursor: pointer;
		min-width: 0;
	}

	.option:hover {
		background: var(--color-bg-tertiary);
	}

	.option input {
		margin: 0;
		flex: 0 0 auto;
		width: 16px;
		height: 16px;
	}

	.option-text {
		display: inline-block;
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	@media (max-width: 420px) {
		.options {
			grid-template-columns: 1fr;
		}
	}
</style>
