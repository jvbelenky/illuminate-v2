<script lang="ts">
	// The controls over the main view, one row per corner, on an 8 px inset:
	// top-left the 2D | 3D switch; top-right (2D, also in the summary) the surface; bottom-left the edit strip, also while 3D is main. Units and
	// the view tools sit bottom-right inside each view (PlanCanvas, RoomViewer).
	// The two bottom corners never overlap: when the labelled edit strip does not
	// fit beside the view tools it shows glyphs only, and wraps if even that is too wide.
	// On a phone (`touch`): Fit and one surface dropdown top-right, the edit strip
	// (2D only) scrolling sideways on one row bottom-left, and ⤢ / ⤡ bottom-right.
	import { untrack } from 'svelte';
	import PlanEditStrip from '$lib/plan/PlanEditStrip.svelte';
	import SurfaceSwitcher from '$lib/plan/SurfaceSwitcher.svelte';
	import type { PlanController } from '$lib/plan/planController.svelte';
	import MainViewBar from './MainViewBar.svelte';
	import type { MainView } from './dockLayout';

	interface Props {
		main: MainView;
		onSelectMain: (v: MainView) => void;
		controller: PlanController;
		/** The editor is open (the summary is view-only: no edit strip). */
		editing: boolean;
		/** The phone's pinned view: gestures replace the view tools. */
		touch?: boolean;
		/** Fit the view showing (touch). */
		onFit?: () => void;
		/** The view fills the screen (touch). */
		fullScreen?: boolean;
		onToggleFullScreen?: () => void;
	}

	let { main, onSelectMain, controller, editing, touch = false, onFit, fullScreen = false, onToggleFullScreen }: Props = $props();
	const ctl = $derived(controller);

	/** Inset of each corner group, and the least gap between the two bottom groups (px). */
	const INSET = 8;
	const GAP = 8;

	let root = $state<HTMLDivElement | undefined>(undefined);
	/** Room left for the edit strip beside the view tools (px); null until measured. */
	let room = $state<number | null>(null);
	let compact = $state(false);

	$effect(() => {
		if (touch || !root || !editing || typeof ResizeObserver === 'undefined') return;
		const el = root;
		const view = main;
		// The labelled strip's width, measured while it shows labels, for the tools it had then
		let fullWidth = 0;
		let shownTools = '';
		const observed = new Set<Element>();
		const ro = new ResizeObserver(() => measure());
		const watch = (e: Element | null | undefined) => {
			if (e && !observed.has(e)) {
				observed.add(e);
				ro.observe(e);
			}
		};
		function measure() {
			const tools = document.querySelector(`.view-slot[data-view="${view}"]:not(.mini)`)?.querySelector('.view-controls, .viewer-actions');
			const strip = el.querySelector<HTMLElement>('.corner.bl .plan-toolbar');
			watch(tools);
			watch(strip);
			room = el.clientWidth - 2 * INSET - GAP - (tools ? (tools as HTMLElement).offsetWidth : 0);
			if (!strip) return;
			const names = strip.textContent ?? '';
			if (names !== shownTools) {
				shownTools = names;
				// Other tools: show the labels again to measure them
				if (compact) {
					compact = false;
					return;
				}
			}
			if (!compact) fullWidth = strip.offsetWidth;
			compact = fullWidth > room;
		}
		watch(el);
		// The strip and the view tools come and go with the context and the main view
		const mo = new MutationObserver(() => measure());
		mo.observe(el, { childList: true, subtree: true, characterData: true });
		untrack(measure);
		// The view's own tools may mount after this corner does
		const raf = requestAnimationFrame(() => measure());
		return () => {
			cancelAnimationFrame(raf);
			ro.disconnect();
			mo.disconnect();
		};
	});
</script>

<div class="main-view-controls" bind:this={root}>
	<div class="corner tl" data-plan-scope>
		<MainViewBar {main} onSelect={onSelectMain} />
	</div>
	<div class="corner tr" data-plan-scope>
		{#if touch}
			<button type="button" class="mv-btn view-fit" aria-label="Fit" onclick={() => onFit?.()}>Fit</button>
			{#if main === '2d'}
				<SurfaceSwitcher surface={ctl.surface} surfaces={ctl.surfaces} onSelect={ctl.setSurface} compact />
			{/if}
		{:else if main === '2d'}
			<SurfaceSwitcher surface={ctl.surface} surfaces={ctl.surfaces} onSelect={ctl.setSurface} />
		{/if}
	</div>
	{#if touch}
		{#if editing && main === '2d'}
			<div class="corner bl strip-scroll" data-plan-scope>
				<PlanEditStrip controller={ctl} />
			</div>
		{/if}
		<div class="corner br" data-plan-scope>
			<button
				type="button"
				class="mv-btn full-toggle"
				aria-label={fullScreen ? 'Exit full screen' : 'Full screen view'}
				title={fullScreen ? 'Exit full screen' : 'Full screen view'}
				onclick={() => onToggleFullScreen?.()}>{fullScreen ? '⤡' : '⤢'}</button
			>
		</div>
	{:else if editing}
		<div class="corner bl" data-plan-scope style:max-width={compact && room !== null ? `${Math.max(36, room)}px` : undefined}>
			<PlanEditStrip controller={ctl} {compact} />
		</div>
	{/if}
</div>

<style>
	.main-view-controls {
		position: absolute;
		inset: 0;
		z-index: 5;
		pointer-events: none;
	}
	.corner {
		position: absolute;
		display: flex;
		align-items: center;
		gap: 8px;
		pointer-events: auto;
	}
	.corner:empty {
		display: none;
	}
	.tl {
		top: 8px;
		left: 8px;
	}
	.tr {
		top: 8px;
		right: 8px;
	}
	.bl {
		bottom: 8px;
		left: 8px;
	}
	.br {
		bottom: 8px;
		right: 8px;
	}
	/* The phone's edit strip: one row, scrolling sideways, clear of ⤢ (36 px + 8 px gap) */
	.strip-scroll {
		max-width: calc(100% - 2 * 8px - 44px);
		overflow-x: auto;
		overscroll-behavior-x: contain;
		scrollbar-width: none;
		touch-action: pan-x;
	}
	.strip-scroll::-webkit-scrollbar {
		display: none;
	}
	.strip-scroll > :global(.plan-toolbar) {
		flex: none;
	}
	.full-toggle {
		font-size: 18px;
	}
</style>
