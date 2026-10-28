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

<div class="mv-seg surface-switcher" role="group" aria-label="Surface">
	<button type="button" class="mv-btn" aria-pressed={surface === 'floor'} onclick={() => onSelect('floor')}>Floor</button>
	<button type="button" class="mv-btn" aria-pressed={surface === 'ceiling'} onclick={() => onSelect('ceiling')}>Ceiling</button>
	<!-- The wall list: a native select laid invisibly over the label -->
	<span class="mv-btn walls" class:on={onWall} title={onWall ? surfaceName(surface) : 'Walls'}>
		{onWall ? surfaceName(surface) : 'Walls'} ▾
		<select
			aria-label="Walls"
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
	</span>
</div>

<style>
	.walls {
		position: relative;
	}
	.walls select {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		padding: 0;
		border: 0;
		opacity: 0;
		cursor: pointer;
	}
	.walls:focus-within {
		z-index: 2;
		outline: 2px solid var(--color-accent);
		outline-offset: -2px;
	}
	.walls:hover {
		background: var(--color-bg-tertiary);
		color: var(--color-text);
	}
	.walls.on:hover {
		background: var(--color-highlight);
		color: #fff;
	}
</style>
