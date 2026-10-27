<script lang="ts">
	// Floor · Ceiling · Walls: which room surface the 2D view shows.
	import { wallIndex, surfaceName, type Surface } from '$lib/utils/surfaces';

	interface Props {
		surface: Surface;
		surfaces: Surface[];
		onSelect: (s: Surface) => void;
	}

	let { surface, surfaces, onSelect }: Props = $props();

	const walls = $derived(surfaces.filter((s) => wallIndex(s) !== null));
	const onWall = $derived(wallIndex(surface) !== null);
</script>

<div class="surface-switcher" role="group" aria-label="Surface">
	<button type="button" aria-pressed={surface === 'floor'} onclick={() => onSelect('floor')}>Floor</button>
	<button type="button" aria-pressed={surface === 'ceiling'} onclick={() => onSelect('ceiling')}>Ceiling</button>
	<select
		aria-label="Walls"
		class:on={onWall}
		value={onWall ? surface : ''}
		onchange={(e) => {
			const v = e.currentTarget.value as Surface;
			if (v) onSelect(v);
		}}
	>
		<option value="" disabled>Walls</option>
		{#each walls as w (w)}
			<option value={w}>{surfaceName(w)}</option>
		{/each}
	</select>
</div>

<style>
	.surface-switcher {
		display: inline-flex;
	}
	button,
	select {
		height: 1.9rem;
		padding: 0 10px;
		font-size: var(--font-size-sm, var(--font-size-base));
		font-weight: 600;
		background: var(--color-bg-tertiary);
		color: var(--color-text-muted);
		border: 1px solid var(--color-border);
		border-radius: 0;
		cursor: pointer;
	}
	button:first-child {
		border-radius: var(--radius-sm, 4px) 0 0 var(--radius-sm, 4px);
	}
	select {
		border-left: 0;
		border-radius: 0 var(--radius-sm, 4px) var(--radius-sm, 4px) 0;
	}
	button + button {
		border-left: 0;
	}
	button:hover,
	select:hover {
		color: var(--color-text);
	}
	button[aria-pressed='true'],
	select.on {
		background: var(--color-highlight);
		color: var(--color-bg, #fff);
		border-color: var(--color-highlight);
	}
</style>
