<script lang="ts">
	import { Canvas } from '@threlte/core';
	import Scene from './Scene.svelte';
	import ViewSnapOverlay, { type ViewPreset } from './ViewSnapOverlay.svelte';
	import type { RoomConfig, LampInstance, CalcZone, ZoneResult } from '$lib/types/project';
	import ProjectionToggle from './ProjectionToggle.svelte';

	interface Props {
		room: RoomConfig;
		lamps: LampInstance[];
		zones?: CalcZone[];
		zoneResults?: Record<string, ZoneResult>;
		selectedLampIds?: string[];
		selectedZoneIds?: string[];
		highlightedLampIds?: string[];
		highlightedZoneIds?: string[];
		visibleLampIds?: string[];
		visibleZoneIds?: string[];
		onLampClick?: (lampId: string) => void;
		onZoneClick?: (zoneId: string) => void;
		globalValueRange?: { min: number; max: number } | null;
	}

	let { room, lamps, zones = [], zoneResults = {}, selectedLampIds = [], selectedZoneIds = [], highlightedLampIds = [], highlightedZoneIds = [], visibleLampIds, visibleZoneIds, onLampClick, onZoneClick, globalValueRange = null }: Props = $props();

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

	// Projection mode (Scene manages state, we mirror it for the icon)
	let useOrtho = $state(false);
	let toggleProjectionFn = $state<(() => boolean) | null>(null);

	function handleProjectionControlReady(toggle: () => boolean) {
		toggleProjectionFn = toggle;
	}

	function handleToggleProjection() {
		if (toggleProjectionFn) {
			useOrtho = toggleProjectionFn();
		}
	}

	// View control function from Scene
	let setViewFn = $state<((view: ViewPreset) => void) | null>(null);
	let activeView = $state<ViewPreset | null>(null);

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
	<ViewSnapOverlay onViewChange={handleViewChange} {activeView} />
	<ProjectionToggle isOrtho={useOrtho} onclick={handleToggleProjection} />
	<span class="units-label">Units: {room.units === 'feet' ? 'feet' : 'meters'}</span>
	<Canvas>
		<Scene {room} {lamps} {zones} {zoneResults} {selectedLampIds} {selectedZoneIds} {highlightedLampIds} {highlightedZoneIds} {visibleLampIds} {visibleZoneIds} {globalValueRange} onViewControlReady={handleViewControlReady} onProjectionControlReady={handleProjectionControlReady} onUserOrbit={handleUserOrbit} onLampClick={wrappedLampClick} onZoneClick={wrappedZoneClick} />
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

	@media (max-width: 767px) {
		.viewer-container {
			min-height: 0;
		}
	}

	.units-label {
		position: absolute;
		bottom: var(--spacing-md);
		left: calc(var(--spacing-sm) + 124px);
		z-index: 10;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		line-height: 1;
	}

	@media (max-width: 767px) {
		.units-label {
			left: calc(var(--spacing-sm) + 156px);
		}
	}
</style>
