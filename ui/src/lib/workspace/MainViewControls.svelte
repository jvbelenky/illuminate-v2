<script lang="ts">
	// The controls over the main view, one group per corner, on an 8 px inset (the
	// same in 2D and 3D):
	// - top-left: Undo | Redo, then while editing (in either view) a thin divider
	//   and the edit strip (Undo | Redo alone there in the summary);
	// - top-right: Calculate, Autorecalculate under it;
	// - bottom-left (2D): the view picker, Plan view or a wall; in 3D the view's
	//   own arrow grid and projection toggle sit there (RoomViewer);
	// - bottom-middle: the 2D | 3D switch;
	// - bottom-right: units, Open in new tab and Save as image, inside each view
	//   (PlanCanvas, RoomViewer).
	// When the labelled strip would reach the Calculate block it shows glyphs only
	// (names stay as tooltips and aria-labels), wrapping if even that is too wide.
	// On a phone (`touch`): 2D | 3D top-left; Undo | Redo, Fit and the view picker
	// top-right; the edit strip (2D only) scrolling sideways on one row
	// bottom-left; ⤢ / ⤡ bottom-right. Calculate sits in the phone's top bar.
	import { untrack } from 'svelte';
	import PlanEditStrip from '$lib/plan/PlanEditStrip.svelte';
	import SurfaceSwitcher from '$lib/plan/SurfaceSwitcher.svelte';
	import CalculateButton from '$lib/components/CalculateButton.svelte';
	import type { PlanController } from '$lib/plan/planController.svelte';
	import MainViewBar from './MainViewBar.svelte';
	import UndoRedo from './UndoRedo.svelte';
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

	/** Inset of each corner group, and the least gap between the two top groups (px). */
	const INSET = 8;
	const GAP = 12;

	let root = $state<HTMLDivElement | undefined>(undefined);
	/** Room for the top-left group beside the Calculate block (px); null until measured. */
	let room = $state<number | null>(null);
	let compact = $state(false);

	$effect(() => {
		if (touch || !root || !editing || typeof ResizeObserver === 'undefined') return;
		const el = root;
		// The labelled top-left group's width, measured while it shows labels, for the tools it had then
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
			const tl = el.querySelector<HTMLElement>('.corner.tl');
			const tr = el.querySelector<HTMLElement>('.corner.tr');
			const strip = tl?.querySelector<HTMLElement>('.plan-toolbar');
			watch(tl);
			watch(tr);
			room = el.clientWidth - 2 * INSET - GAP - (tr ? tr.offsetWidth : 0);
			if (!tl || !strip) {
				compact = false;
				return;
			}
			const names = strip.textContent ?? '';
			if (names !== shownTools) {
				shownTools = names;
				// Other tools: show the labels again to measure them
				if (compact) {
					compact = false;
					return;
				}
			}
			if (!compact) fullWidth = tl.scrollWidth;
			compact = fullWidth > room;
		}
		watch(el);
		// The strip comes and goes with the context and the main view
		const mo = new MutationObserver(() => measure());
		mo.observe(el, { childList: true, subtree: true, characterData: true });
		untrack(measure);
		const raf = requestAnimationFrame(() => measure());
		return () => {
			cancelAnimationFrame(raf);
			ro.disconnect();
			mo.disconnect();
		};
	});
</script>

<div class="main-view-controls" bind:this={root}>
	{#if touch}
		<div class="corner tl" data-plan-scope>
			<MainViewBar {main} onSelect={onSelectMain} />
		</div>
		<div class="corner tr" data-plan-scope>
			<UndoRedo />
			<button type="button" class="mv-btn view-fit" aria-label="Fit" title="Fit the room in view" onclick={() => onFit?.()}>Fit</button>
			{#if main === '2d'}
				<SurfaceSwitcher surface={ctl.surface} surfaces={ctl.surfaces} onSelect={ctl.setSurface} />
			{/if}
		</div>
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
	{:else}
		<div class="corner tl" data-plan-scope style:max-width={compact && room !== null ? `${Math.max(80, room)}px` : undefined}>
			<UndoRedo />
			{#if editing}
				<span class="tl-divider" aria-hidden="true"></span>
				<PlanEditStrip controller={ctl} {compact} />
			{/if}
		</div>
		<div class="corner tr" data-plan-scope>
			<CalculateButton layout="floating" />
		</div>
		{#if main === '2d'}
			<div class="corner bl" data-plan-scope>
				<SurfaceSwitcher surface={ctl.surface} surfaces={ctl.surfaces} onSelect={ctl.setSurface} />
			</div>
		{/if}
		<div class="corner bc" data-plan-scope>
			<MainViewBar {main} onSelect={onSelectMain} />
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
		align-items: flex-start;
	}
	/* A thin rule between Undo | Redo and the edit strip; none when the strip shows nothing */
	.tl-divider {
		flex: none;
		align-self: stretch;
		width: 1px;
		margin: 4px 0;
		background: var(--color-border);
	}
	.tl > .tl-divider:last-child {
		display: none;
	}
	.tl > :global(.undo-redo) {
		flex: none;
	}
	.tr {
		top: 8px;
		right: 8px;
		align-items: flex-start;
	}
	.bl {
		bottom: 8px;
		left: 8px;
	}
	.bc {
		bottom: 8px;
		left: 50%;
		transform: translateX(-50%);
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
