<script lang="ts">
	import { Canvas } from '@threlte/core';
	import Scene from './Scene.svelte';
	import type { RoomConfig, LampInstance, CalcZone, ZoneResult } from '$lib/types/project';

	interface Props {
		room: RoomConfig;
		lamps: LampInstance[];
		zones?: CalcZone[];
		zoneResults?: Record<string, ZoneResult>;
	}

	let { room, lamps, zones = [], zoneResults = {} }: Props = $props();
</script>

<div class="viewer-container">
	<Canvas>
		<Scene {room} {lamps} {zones} {zoneResults} />
	</Canvas>
</div>

<style>
	.viewer-container {
		width: 100%;
		height: 100%;
		min-height: 500px;
		background: var(--color-bg-secondary);
		border-radius: var(--radius-lg);
		overflow: hidden;
	}
</style>
