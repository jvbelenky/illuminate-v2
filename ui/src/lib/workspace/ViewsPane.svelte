<script lang="ts">
	// The phone's Viewer tab: the 2D view above the 3D view, both always mounted.
	// (The desktop shows one main view and docks the other; see ViewHost.)
	import type { Snippet } from 'svelte';

	let {
		view2d,
		view3d
	}: {
		view2d: Snippet;
		view3d: Snippet;
	} = $props();

	const DIVIDER = 6;
	const half = DIVIDER / 2;
	const SLOT_STYLE = {
		'2d': `left:0;right:0;top:0;height:calc(50% - ${half}px);`,
		'3d': `left:0;right:0;bottom:0;height:calc(50% - ${half}px);`
	} as const;
</script>

<div class="views-pane" data-layout="stack">
	{#each ['2d', '3d'] as const as v (v)}
		<div class="view-slot" data-view={v} style={SLOT_STYLE[v]}>
			<div class="slot-body">
				{#if v === '2d'}{@render view2d()}{:else}{@render view3d()}{/if}
			</div>
		</div>
	{/each}
</div>

<style>
	.views-pane {
		position: relative;
		width: 100%;
		height: 100%;
		min-height: 0;
		overflow: hidden;
	}
	.view-slot {
		position: absolute;
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
	}
	.slot-body {
		position: relative;
		flex: 1;
		min-height: 0;
		min-width: 0;
	}
</style>
