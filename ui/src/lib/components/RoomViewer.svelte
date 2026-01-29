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
	let visibleLampIds = $state<string[]>([]);
	let visibleZoneIds = $state<string[]>([]);

	// Initialize visibility to include all items
	$effect(() => {
		// When lamps change, ensure new lamps are visible by default
		const currentLampIds = new Set(visibleLampIds);
		const newLampIds = lamps.map(l => l.id);
		const addedLamps = newLampIds.filter(id => !currentLampIds.has(id) || visibleLampIds.length === 0);
		if (addedLamps.length > 0 || visibleLampIds.length === 0) {
			visibleLampIds = newLampIds;
		}
	});

	$effect(() => {
		// When zones change, ensure new zones are visible by default
		const currentZoneIds = new Set(visibleZoneIds);
		const newZoneIds = zones.map(z => z.id);
		const addedZones = newZoneIds.filter(id => !currentZoneIds.has(id) || visibleZoneIds.length === 0);
		if (addedZones.length > 0 || visibleZoneIds.length === 0) {
			visibleZoneIds = newZoneIds;
		}
	});

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
