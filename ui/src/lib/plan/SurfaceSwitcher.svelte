<script lang="ts">
	// Floor · Ceiling · Walls: which room surface the 2D view shows.
	import { wallIndex, surfaceName, type Surface } from '$lib/utils/surfaces';
	import Glyph from '$lib/workspace/Glyph.svelte';

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
	<button type="button" class="mv-btn" aria-label="Floor" title="Floor" aria-pressed={surface === 'floor'} onclick={() => onSelect('floor')}>
		<Glyph name="floor" />
	</button>
	<button type="button" class="mv-btn" aria-label="Ceiling" title="Ceiling" aria-pressed={surface === 'ceiling'} onclick={() => onSelect('ceiling')}>
		<Glyph name="ceiling" />
	</button>
	<!-- The wall list: a native select laid invisibly over the wall glyph -->
	<span class="mv-btn walls" class:on={onWall} title={onWall ? surfaceName(surface) : 'Walls'}>
		<Glyph name="wall" />
		<Glyph name="chevron" size={12} />
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
		gap: 1px;
		padding-right: 5px;
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
