<script lang="ts">
	import { Canvas } from '@threlte/core';
	import Scene from './Scene.svelte';
	import DisplayControlOverlay from './DisplayControlOverlay.svelte';
	import type { RoomConfig, LampInstance, CalcZone, ZoneResult } from '$lib/types/project';

	interface Props {
		room: RoomConfig;
		lamps: LampInstance[];
		zones?: CalcZone[];
		zoneResults?: Record<string, ZoneResult>;
		selectedLampIds?: string[];
		selectedZoneIds?: string[];
	}

	let { room, lamps, zones = [], zoneResults = {}, selectedLampIds = [], selectedZoneIds = [] }: Props = $props();

	// Visibility state for display control overlay
	// undefined means "not initialized yet, show all" - the overlay will set actual values on mount
	let visibleLampIds = $state<string[] | undefined>(undefined);
	let visibleZoneIds = $state<string[] | undefined>(undefined);

	function handleVisibilityChange(newVisibleLampIds: string[], newVisibleZoneIds: string[]) {
		visibleLampIds = newVisibleLampIds;
		visibleZoneIds = newVisibleZoneIds;
	}
</script>

<div class="viewer-container">
	<DisplayControlOverlay {lamps} {zones} onVisibilityChange={handleVisibilityChange} />
	<Canvas>
		<Scene {room} {lamps} {zones} {zoneResults} {selectedLampIds} {selectedZoneIds} {visibleLampIds} {visibleZoneIds} />
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
