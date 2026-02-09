<script lang="ts">
	import { Canvas } from '@threlte/core';
	import Scene from './Scene.svelte';
	import DisplayControlOverlay from './DisplayControlOverlay.svelte';
	import ViewSnapOverlay, { type ViewPreset } from './ViewSnapOverlay.svelte';
	import type { RoomConfig, LampInstance, CalcZone, ZoneResult } from '$lib/types/project';
	import { project } from '$lib/stores/project';

	interface Props {
		room: RoomConfig;
		lamps: LampInstance[];
		zones?: CalcZone[];
		zoneResults?: Record<string, ZoneResult>;
		selectedLampIds?: string[];
		selectedZoneIds?: string[];
		onLampClick?: (lampId: string) => void;
		onZoneClick?: (zoneId: string) => void;
	}

	let { room, lamps, zones = [], zoneResults = {}, selectedLampIds = [], selectedZoneIds = [], onLampClick, onZoneClick }: Props = $props();

	// Visibility state for display control overlay
	// undefined means "not initialized yet, show all" - the overlay will set actual values on mount
	let visibleLampIds = $state<string[] | undefined>(undefined);
	let visibleZoneIds = $state<string[] | undefined>(undefined);

	// View control function from Scene
	let setViewFn = $state<((view: ViewPreset) => void) | null>(null);
	let activeView = $state<ViewPreset | null>(null);

	function handleVisibilityChange(newVisibleLampIds: string[], newVisibleZoneIds: string[]) {
		visibleLampIds = newVisibleLampIds;
		visibleZoneIds = newVisibleZoneIds;
	}

	function handleCalcToggle(type: 'lamp' | 'zone', id: string, enabled: boolean) {
		if (type === 'lamp') {
			project.updateLamp(id, { enabled });
		} else {
			project.updateZone(id, { enabled });
		}
	}

	function handleViewControlReady(setView: (view: ViewPreset) => void) {
		setViewFn = setView;
	}

	function handleViewChange(view: ViewPreset) {
		if (setViewFn) {
			setViewFn(view);
			activeView = view;
		}
	}

	function handleUserOrbit() {
		activeView = null;
	}
</script>

<div class="viewer-container">
	<DisplayControlOverlay {lamps} {zones} onVisibilityChange={handleVisibilityChange} onCalcToggle={handleCalcToggle} />
	<ViewSnapOverlay onViewChange={handleViewChange} {activeView} />
	<Canvas>
		<Scene {room} {lamps} {zones} {zoneResults} {selectedLampIds} {selectedZoneIds} {visibleLampIds} {visibleZoneIds} onViewControlReady={handleViewControlReady} onUserOrbit={handleUserOrbit} {onLampClick} {onZoneClick} />
	</Canvas>
</div>

<style>
	.viewer-container {
		position: relative;
		width: 100%;
		height: 100%;
		min-height: 500px;
		background: var(--color-bg-secondary);
		border-radius: var(--radius-lg);
		overflow: hidden;
	}
</style>
