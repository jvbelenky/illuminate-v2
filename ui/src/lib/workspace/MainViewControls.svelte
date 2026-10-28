<script lang="ts">
	// The controls over the main view, one row per corner, on an 8 px inset:
	// top-left the 2D | 3D switch and (2D) the surface; top-right Auto and
	// Calculate; bottom-left the edit strip, also while 3D is main. Units and
	// the view tools sit bottom-right inside each view (PlanCanvas, RoomViewer).
	import CalculateButton from '$lib/components/CalculateButton.svelte';
	import PlanEditStrip from '$lib/plan/PlanEditStrip.svelte';
	import SurfaceSwitcher from '$lib/plan/SurfaceSwitcher.svelte';
	import type { PlanController } from '$lib/plan/planController.svelte';
	import MainViewBar from './MainViewBar.svelte';
	import type { MainView } from './dockLayout';

	interface Props {
		main: MainView;
		onSelectMain: (v: MainView) => void;
		controller: PlanController;
		/** The editor is open (the summary is view-only: no surface switch, no edit strip). */
		editing: boolean;
	}

	let { main, onSelectMain, controller, editing }: Props = $props();
	const ctl = $derived(controller);
</script>

<div class="main-view-controls">
	<div class="corner tl" data-plan-scope>
		<MainViewBar {main} onSelect={onSelectMain} />
		{#if main === '2d' && editing}
			<SurfaceSwitcher surface={ctl.surface} surfaces={ctl.surfaces} onSelect={ctl.setSurface} />
		{/if}
	</div>
	<div class="corner tr">
		<CalculateButton layout="corner" />
	</div>
	{#if editing}
		<div class="corner bl" data-plan-scope>
			<PlanEditStrip controller={ctl} />
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
</style>
