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
		if (n === 0) return 'Choose pathogens…';
		if (n === 1) return selected.find(s => options.includes(s)) ?? '1 pathogen';
		if (n === options.length) return `All ${n} pathogens`;
		return `${n} pathogens`;
	});

	function toggle(species: string) {
		const next = selectedSet.has(species) ? selected.filter(s => s !== species) : [...selected, species];
		onChange(next);
	}

	function setGroup(species: string[], on: boolean) {
		const next = on
			? [...selected, ...species.filter(s => !selectedSet.has(s))]
			: selected.filter(s => !species.includes(s));
		onChange(next);
	}

	function onWindowPointerDown(e: PointerEvent) {
		if (open && root && !root.contains(e.target as Node)) open = false;
	}

	function onWindowKeyDown(e: KeyboardEvent) {
		if (open && e.key === 'Escape') open = false;
	}
</script>

<svelte:window onpointerdown={onWindowPointerDown} onkeydown={onWindowKeyDown} />

<div class="multi-select" bind:this={root}>
	<button type="button" class="trigger" aria-haspopup="listbox" aria-expanded={open} onclick={() => open = !open}>
		<span class="trigger-text">{summary}</span>
		<span class="chevron">{open ? '▴' : '▾'}</span>
	</button>
	{#if open}
		<div class="menu" role="listbox" aria-multiselectable="true">
			{#each groups as [category, species] (category)}
				{@const allOn = species.every(s => selectedSet.has(s))}
				<div class="group">
					<div class="group-header">
						<span class="group-name">{category}</span>
						<button type="button" class="group-btn" onclick={() => setGroup(species, !allOn)}>{allOn ? 'None' : 'All'}</button>
					</div>
					{#each species as sp (sp)}
						<label class="option" role="option" aria-selected={selectedSet.has(sp)}>
							<input type="checkbox" checked={selectedSet.has(sp)} onchange={() => toggle(sp)} />
							<span>{sp}</span>
						</label>
					{/each}
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.multi-select {
		position: relative;
	}

	.trigger {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--spacing-sm);
		padding: var(--spacing-xs) var(--spacing-sm);
		background: var(--color-bg);
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

	.chevron {
		color: var(--color-text-muted);
		flex-shrink: 0;
	}

	.menu {
		position: absolute;
		z-index: 20;
		left: 0;
		right: 0;
		margin-top: 4px;
		max-height: 320px;
		overflow-y: auto;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
		padding: var(--spacing-xs) 0;
	}

	.group + .group {
		border-top: 1px solid var(--color-border);
		margin-top: var(--spacing-xs);
		padding-top: var(--spacing-xs);
	}

	.group-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 2px var(--spacing-sm);
		font-size: var(--font-size-xs, 0.72rem);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
	}

	.group-btn {
		background: none;
		border: none;
		padding: 0;
		color: var(--color-text-muted);
		font-size: var(--font-size-xs, 0.72rem);
		text-decoration: underline;
		cursor: pointer;
	}

	.option {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		padding: 4px var(--spacing-sm);
		font-size: var(--font-size-base);
		cursor: pointer;
	}

	.option:hover {
		background: var(--color-bg-tertiary);
	}

	.option input {
		margin: 0;
	}
</style>
