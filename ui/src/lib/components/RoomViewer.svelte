<script lang="ts">
	import { Canvas } from '@threlte/core';
	import Scene from './Scene.svelte';
	import ViewSnapOverlay, { type ViewPreset } from './ViewSnapOverlay.svelte';
	import type { RoomConfig, LampInstance, CalcZone, ZoneResult } from '$lib/types/project';

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
	}

	let { room, lamps, zones = [], zoneResults = {}, selectedLampIds = [], selectedZoneIds = [], highlightedLampIds = [], highlightedZoneIds = [], visibleLampIds, visibleZoneIds, onLampClick, onZoneClick }: Props = $props();

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
	<button
		class="proj-toggle"
		title={useOrtho ? 'Switch to perspective projection' : 'Switch to orthographic projection'}
		onclick={handleToggleProjection}
	>
		<svg viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round">
			{#if useOrtho}
				<!-- Ortho icon: cube with parallel edges -->
				<path d="M7 14 L7 28 L21 28 L21 14 Z" />
				<path d="M7 14 L17 8 L31 8 L21 14 Z" />
				<path d="M21 14 L31 8 L31 22 L21 28 Z" />
				<line x1="7" y1="14" x2="17" y2="8" stroke-dasharray="2 2" opacity="0.4" />
				<line x1="17" y1="8" x2="17" y2="22" stroke-dasharray="2 2" opacity="0.4" />
				<line x1="17" y1="22" x2="7" y2="28" stroke-dasharray="2 2" opacity="0.4" />
			{:else}
				<!-- Perspective icon: cube with converging edges -->
				<path d="M3 11 L3 29 L21 29 L21 11 Z" />
				<path d="M19 7 L19 17 L29 17 L29 7 Z" opacity="0.6" />
				<line x1="3" y1="11" x2="19" y2="7" />
				<line x1="21" y1="11" x2="29" y2="7" />
				<line x1="21" y1="29" x2="29" y2="17" />
				<line x1="3" y1="29" x2="19" y2="17" stroke-dasharray="2 2" opacity="0.4" />
			{/if}
		</svg>
	</button>
	<span class="units-label">Units: {room.units === 'feet' ? 'feet' : 'meters'}</span>
	<Canvas>
		<Scene {room} {lamps} {zones} {zoneResults} {selectedLampIds} {selectedZoneIds} {highlightedLampIds} {highlightedZoneIds} {visibleLampIds} {visibleZoneIds} onViewControlReady={handleViewControlReady} onProjectionControlReady={handleProjectionControlReady} onUserOrbit={handleUserOrbit} onLampClick={wrappedLampClick} onZoneClick={wrappedZoneClick} />
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

	.proj-toggle {
		position: absolute;
		bottom: var(--spacing-sm);
		left: calc(var(--spacing-sm) + 74px);
		z-index: 10;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 72px;
		height: 72px;
		padding: 14px;
		background: color-mix(in srgb, var(--color-bg-secondary) 85%, transparent);
		backdrop-filter: blur(4px);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-muted);
		cursor: pointer;
		transition: all 0.15s;
	}

	.proj-toggle:hover {
		background: var(--color-bg-secondary);
		border-color: var(--color-accent);
		color: var(--color-text);
	}

	.proj-toggle svg {
		width: 100%;
		height: 100%;
	}

	.units-label {
		position: absolute;
		bottom: var(--spacing-md);
		left: calc(var(--spacing-sm) + 154px);
		z-index: 10;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		line-height: 1;
	}
</style>
