<script lang="ts">
	// Hosts the 2D and 3D views once each, always mounted, so a swap never
	// remounts the 3D canvas. Each view sits in an absolutely positioned slot laid
	// over an anchor element: the main view's area, or the mini view panel. The host
	// is no stacking context, so a floating mini slot can sit above the floating window.
	import { untrack, type Snippet } from 'svelte';
	import type { MainView } from './dockLayout';

	interface Props {
		main: MainView;
		mainAnchor: HTMLElement | undefined;
		miniAnchor: HTMLElement | undefined;
		/** False while the mini panel is minimized: its view stays mounted, hidden. */
		miniVisible: boolean;
		/** True while the mini view floats: its slot then sits above the floating window. */
		miniFloating?: boolean;
		/** The floating mini window's stacking order (DockArea); its slot sits just above it. */
		miniZ?: number;
		view2d: Snippet<[boolean]>;
		view3d: Snippet<[boolean]>;
		/** Anything that can move an anchor without resizing it (the dock layout). */
		layoutKey?: unknown;
	}

	let { main, mainAnchor, miniAnchor, miniVisible, miniFloating = false, miniZ, view2d, view3d, layoutKey }: Props = $props();

	type Box = { left: number; top: number; width: number; height: number };
	const VIEWS: MainView[] = ['2d', '3d'];

	let hostEl: HTMLElement | undefined = $state();
	let mainBox = $state<Box | null>(null);
	let miniBox = $state<Box | null>(null);

	function boxOf(el: HTMLElement | undefined | null): Box | null {
		if (!el || !hostEl || !el.isConnected) return null;
		const r = el.getBoundingClientRect();
		const h = hostEl.getBoundingClientRect();
		return { left: r.left - h.left, top: r.top - h.top, width: r.width, height: r.height };
	}

	function same(a: Box | null, b: Box | null): boolean {
		return !!a && !!b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
	}

	function measure() {
		const m = boxOf(mainAnchor);
		const n = boxOf(miniAnchor);
		if (!same(m, mainBox)) mainBox = m;
		// A minimized mini keeps its last box, so the hidden view keeps its size
		if (n && !same(n, miniBox)) miniBox = n;
	}

	$effect(() => {
		// Re-measure whenever an anchor, the main view or the dock layout changes
		void main;
		void miniVisible;
		void layoutKey;
		const anchors = [mainAnchor, miniAnchor, hostEl].filter((e): e is HTMLElement => !!e);
		untrack(measure);
		const frame = requestAnimationFrame(measure);
		const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
		for (const a of anchors) ro?.observe(a);
		window.addEventListener('resize', measure);
		return () => {
			cancelAnimationFrame(frame);
			ro?.disconnect();
			window.removeEventListener('resize', measure);
		};
	});

	function styleOf(b: Box | null, hidden: boolean, z?: number): string {
		const pos = b
			? `left:${b.left}px;top:${b.top}px;width:${b.width}px;height:${b.height}px;`
			: 'left:0;top:0;width:0;height:0;';
		return pos + (hidden ? 'visibility:hidden;' : '') + (z !== undefined ? `z-index:${z};` : '');
	}
</script>

<div class="view-host" bind:this={hostEl}>
	{#each VIEWS as v (v)}
		{@const mini = v !== main}
		<div
			class="view-slot"
			class:mini
			class:floating={mini && miniFloating}
			data-view={v}
			style={styleOf(mini ? miniBox : mainBox, mini && (!miniVisible || !miniBox), mini && miniFloating && miniZ !== undefined ? miniZ + 1 : undefined)}
		>
			{#if v === '2d'}{@render view2d(mini)}{:else}{@render view3d(mini)}{/if}
		</div>
	{/each}
</div>

<style>
	.view-host {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}
	.view-slot {
		position: absolute;
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
		pointer-events: auto;
		z-index: 1;
	}
	/* Over the main view, above the floating window it fills (DockArea) */
	.view-slot.floating {
		z-index: 8;
	}
	.view-slot.mini {
		border-radius: 0 0 var(--radius-md) var(--radius-md);
	}
</style>
