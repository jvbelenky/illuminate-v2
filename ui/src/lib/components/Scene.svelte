<script lang="ts">
	import { T } from '@threlte/core';
	import { OrbitControls, Grid } from '@threlte/extras';
	import * as THREE from 'three';
	import type { RoomConfig, LampInstance, CalcZone, ZoneResult } from '$lib/types/project';
	import Room3D from './Room3D.svelte';
	import Lamp3D from './Lamp3D.svelte';
	import CalcPlane3D from './CalcPlane3D.svelte';

	interface Props {
		room: RoomConfig;
		lamps: LampInstance[];
		zones?: CalcZone[];
		zoneResults?: Record<string, ZoneResult>;
	}

	let { room, lamps, zones = [], zoneResults = {} }: Props = $props();

	// Get values for a zone from results
	function getZoneValues(zoneId: string): number[][] | undefined {
		const result = zoneResults[zoneId];
		if (!result?.values) return undefined;
		// For planes, values should be 2D array
		return result.values as number[][];
	}

	// Convert feet to meters for consistent 3D rendering
	const scale = $derived(room.units === 'feet' ? 0.3048 : 1);
	const roomDims = $derived({
		x: room.x * scale,
		y: room.y * scale,
		z: room.z * scale
	});

	// Camera position based on room size
	const maxDim = $derived(Math.max(roomDims.x, roomDims.y, roomDims.z));
	const cameraDistance = $derived(maxDim * 2);
</script>

<!-- Camera -->
<T.PerspectiveCamera
	makeDefault
	position={[cameraDistance, cameraDistance * 0.8, cameraDistance]}
	fov={50}
>
	<OrbitControls
		enableDamping
		dampingFactor={0.1}
		target={[roomDims.x / 2, roomDims.z / 2, roomDims.y / 2]}
	/>
</T.PerspectiveCamera>

<!-- Lighting -->
<T.AmbientLight intensity={0.4} />
<T.DirectionalLight position={[10, 20, 10]} intensity={0.8} castShadow />
<T.DirectionalLight position={[-10, 10, -10]} intensity={0.3} />

<!-- Room wireframe -->
<Room3D dims={roomDims} />

<!-- Floor grid -->
<T.Group position={[roomDims.x / 2, 0.001, roomDims.y / 2]}>
	<Grid
		cellColor="#4a4a6a"
		sectionColor="#6a6a8a"
		cellSize={1}
		sectionSize={5}
		fadeDistance={50}
		infiniteGrid={false}
		cellThickness={1}
		sectionThickness={1.5}
	/>
</T.Group>

<!-- Lamps -->
{#each lamps as lamp (lamp.id)}
	<Lamp3D {lamp} {scale} roomHeight={roomDims.z} {room} />
{/each}

<!-- Calculation Zones -->
{#each zones.filter(z => z.type === 'plane') as zone (zone.id)}
	<CalcPlane3D {zone} {room} {scale} values={getZoneValues(zone.id)} />
{/each}

<!-- Axes helper (small, in corner) -->
<T.AxesHelper args={[1]} position={[-0.5, 0, -0.5]} />
