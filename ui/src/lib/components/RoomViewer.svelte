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
		highlightedLampIds?: string[];
		highlightedZoneIds?: string[];
		onLampClick?: (lampId: string) => void;
		onZoneClick?: (zoneId: string) => void;
	}

	let { room, lamps, zones = [], zoneResults = {}, selectedLampIds = [], selectedZoneIds = [], highlightedLampIds = [], highlightedZoneIds = [], onLampClick, onZoneClick }: Props = $props();

	// Drag detection: suppress clicks that follow a drag (orbit/pan)
	const DRAG_THRESHOLD = 5; // pixels
	let pointerStart: { x: number; y: number } | null = null;
	let dragDistance = 0;

	function handlePointerDown(e: PointerEvent) {
		pointerStart = { x: e.clientX, y: e.clientY };
		dragDistance = 0;
	}

	function handlePointerUp(e: PointerEvent) {
		if (pointerStart) {
			const dx = e.clientX - pointerStart.x;
			const dy = e.clientY - pointerStart.y;
			dragDistance = Math.sqrt(dx * dx + dy * dy);
		}
		pointerStart = null;
	}

	const wrappedLampClick = $derived(
		onLampClick
			? (id: string) => { if (dragDistance <= DRAG_THRESHOLD) onLampClick(id); }
			: undefined
	);
	const wrappedZoneClick = $derived(
		onZoneClick
			? (id: string) => { if (dragDistance <= DRAG_THRESHOLD) onZoneClick(id); }
			: undefined
	);

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

<div class="viewer-container" onpointerdown={handlePointerDown} onpointerup={handlePointerUp}>
	<DisplayControlOverlay {lamps} {zones} onVisibilityChange={handleVisibilityChange} onCalcToggle={handleCalcToggle} />
	<ViewSnapOverlay onViewChange={handleViewChange} {activeView} />
	<span class="units-label">Units: {room.units === 'feet' ? 'feet' : 'meters'}</span>
	<Canvas>
		<Scene {room} {lamps} {zones} {zoneResults} {selectedLampIds} {selectedZoneIds} {highlightedLampIds} {highlightedZoneIds} {visibleLampIds} {visibleZoneIds} onViewControlReady={handleViewControlReady} onUserOrbit={handleUserOrbit} onLampClick={wrappedLampClick} onZoneClick={wrappedZoneClick} />
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

	.units-label {
		position: absolute;
		bottom: var(--spacing-md);
		left: calc(var(--spacing-md) + 88px);
		z-index: 10;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		line-height: 1;
	}
</style>
