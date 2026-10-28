<script lang="ts">
	// The 2D | 3D switch, top-left of the main view: which view fills it.
	import type { MainView } from './dockLayout';
	import Glyph, { type GlyphName } from './Glyph.svelte';

	interface Props {
		main: MainView;
		onSelect: (v: MainView) => void;
	}

	let { main, onSelect }: Props = $props();

	const OPTIONS: { value: MainView; label: string; glyph: GlyphName }[] = [
		{ value: '2d', label: '2D view', glyph: 'grid2' },
		{ value: '3d', label: '3D view', glyph: 'cube' }
	];
</script>

<div class="mv-seg main-view-bar" role="group" aria-label="Main view">
	{#each OPTIONS as o (o.value)}
		<button
			type="button"
			class="mv-btn"
			data-view={o.value}
			aria-label={o.label}
			title={o.label}
			aria-pressed={main === o.value}
			onclick={() => main !== o.value && onSelect(o.value)}
		>
			<Glyph name={o.glyph} />
		</button>
	{/each}
</div>
