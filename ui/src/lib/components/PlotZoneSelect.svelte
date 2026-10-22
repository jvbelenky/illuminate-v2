<script lang="ts">
	export interface PlotZoneChoice {
		id: string;
		name: string;
	}

	interface Props {
		current: string;
		choices: PlotZoneChoice[];
		onSelect: (zoneId: string) => void;
	}

	let { current, choices, onSelect }: Props = $props();
</script>

<!-- The plot window's title: pick which zone it shows -->
<select
	class="zone-select"
	aria-label="Zone"
	value={current}
	onchange={(e) => { if (e.currentTarget.value !== current) onSelect(e.currentTarget.value); }}
>
	{#each choices as choice (choice.id)}
		<option value={choice.id}>{choice.name}</option>
	{/each}
</select>

<style>
	.zone-select {
		width: auto;
		max-width: 100%;
		padding: 5px 30px 5px 10px;
		background-color: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		color: var(--color-text);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}

	.zone-select:hover,
	.zone-select:focus {
		border-color: var(--color-border);
		background-color: var(--color-bg-tertiary);
	}

	.zone-select option {
		background: var(--color-bg-secondary);
		font-weight: normal;
	}
</style>
