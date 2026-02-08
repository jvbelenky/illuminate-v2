<script lang="ts">
	import { T, useThrelte } from '@threlte/core';
	import { OrbitControls, Grid } from '@threlte/extras';
	import * as THREE from 'three';
	import type { RoomConfig, LampInstance, CalcZone, ZoneResult } from '$lib/types/project';
	import Room3D from './Room3D.svelte';
	import Lamp3D from './Lamp3D.svelte';
	import CalcPlane3D from './CalcPlane3D.svelte';
	import CalcVol3D from './CalcVol3D.svelte';
	import { theme } from '$lib/stores/theme';
	import type { ViewPreset } from './ViewSnapOverlay.svelte';

	interface Props {
		room: RoomConfig;
		lamps: LampInstance[];
		zones?: CalcZone[];
		zoneResults?: Record<string, ZoneResult>;
		selectedLampIds?: string[];
		selectedZoneIds?: string[];
		visibleLampIds?: string[];
		visibleZoneIds?: string[];
		onViewControlReady?: (setView: (view: ViewPreset) => void) => void;
		onUserOrbit?: () => void;
	}

	let { room, lamps, zones = [], zoneResults = {}, selectedLampIds = [], selectedZoneIds = [], visibleLampIds, visibleZoneIds, onViewControlReady, onUserOrbit }: Props = $props();

	// Filter lamps and zones by visibility
	const filteredLamps = $derived(
		visibleLampIds ? lamps.filter(l => visibleLampIds.includes(l.id)) : lamps
	);
	const filteredZones = $derived(
		visibleZoneIds ? zones.filter(z => visibleZoneIds.includes(z.id)) : zones
	);

	// Theme-based colors
	const colors = $derived($theme === 'light' ? {
		gridCell: '#b0b0b0',
		gridSection: '#909090',
		sceneBg: '#d0d7de'
	} : {
		gridCell: '#4a4a6a',
		gridSection: '#6a6a8a',
		sceneBg: '#1a1a2e'
	});

	// Set scene background color
	const { scene } = useThrelte();
	$effect(() => {
		scene.background = new THREE.Color(colors.sceneBg);
	});

	// Get values for a plane zone from results
	function getZoneValues(zoneId: string): number[][] | undefined {
		const result = zoneResults[zoneId];
		if (!result?.values) return undefined;
		// For planes, values should be 2D array
		return result.values as number[][];
	}

	// Get values for a volume zone from results
	function getVolumeValues(zoneId: string): number[][][] | undefined {
		const result = zoneResults[zoneId];
		if (!result?.values) return undefined;
		// For volumes, values should be 3D array
		return result.values as number[][][];
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

	// Camera and controls refs for view snapping
	let cameraRef = $state<THREE.PerspectiveCamera | null>(null);
	let controlsRef = $state<any>(null);

	// Room center in Three.js coordinates (room Y→Three.js Z, room Z→Three.js Y)
	const roomCenter = $derived({
		x: roomDims.x / 2,
		y: roomDims.z / 2, // height center
		z: roomDims.y / 2  // depth center
	});

	// Animation state for smooth view transitions
	let animationId: number | null = null;
	const ANIMATION_DURATION = 400; // ms

	function easeOutCubic(t: number): number {
		return 1 - Math.pow(1 - t, 3);
	}

	function cancelAnimation() {
		if (animationId !== null) {
			cancelAnimationFrame(animationId);
			animationId = null;
		}
	}

	// Compute target camera position for a preset view
	function getViewPosition(view: ViewPreset): [number, number, number] | null {
		const dist = cameraDistance;
		const isoDist = dist * 0.7;
		const isoHeight = dist * 0.6;

		switch (view) {
			case 'top':
				return [roomCenter.x, dist * 1.2, roomCenter.z];
			case 'front':
				return [roomCenter.x, roomCenter.y, -dist];
			case 'back':
				return [roomCenter.x, roomCenter.y, roomDims.y + dist];
			case 'left':
				return [-dist, roomCenter.y, roomCenter.z];
			case 'right':
				return [roomDims.x + dist, roomCenter.y, roomCenter.z];
			case 'iso-front-left':
				return [-isoDist, isoHeight, -isoDist];
			case 'iso-front-right':
				return [roomDims.x + isoDist, isoHeight, -isoDist];
			case 'iso-back-left':
				return [-isoDist, isoHeight, roomDims.y + isoDist];
			case 'iso-back-right':
				return [roomDims.x + isoDist, isoHeight, roomDims.y + isoDist];
			default:
				return null;
		}
	}

	// Animate camera to a preset view
	function setView(view: ViewPreset) {
		if (!cameraRef || !controlsRef) return;

		const pos = getViewPosition(view);
		if (!pos) return;

		cancelAnimation();

		const startPos = cameraRef.position.clone();
		const endPos = new THREE.Vector3(pos[0], pos[1], pos[2]);
		const startTarget = controlsRef.target.clone();
		const endTarget = new THREE.Vector3(roomCenter.x, roomCenter.y, roomCenter.z);
		const startTime = performance.now();

		function animate(now: number) {
			const elapsed = now - startTime;
			const t = Math.min(elapsed / ANIMATION_DURATION, 1);
			const eased = easeOutCubic(t);

			cameraRef!.position.lerpVectors(startPos, endPos, eased);
			controlsRef!.target.lerpVectors(startTarget, endTarget, eased);
			controlsRef!.update();

			if (t < 1) {
				animationId = requestAnimationFrame(animate);
			} else {
				animationId = null;
			}
		}

		animationId = requestAnimationFrame(animate);
	}

	// Notify parent when view control is ready, and listen for manual orbit
	$effect(() => {
		if (cameraRef && controlsRef && onViewControlReady) {
			onViewControlReady(setView);
		}
		if (controlsRef && onUserOrbit) {
			const handler = () => {
				cancelAnimation();
				onUserOrbit();
			};
			controlsRef.addEventListener('start', handler);
			return () => controlsRef.removeEventListener('start', handler);
		}
	});
</script>

<!-- Camera -->
<T.PerspectiveCamera
	makeDefault
	position={[cameraDistance, cameraDistance * 0.8, cameraDistance]}
	fov={50}
	bind:ref={cameraRef}
>
	<OrbitControls
		bind:ref={controlsRef}
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
		cellColor={colors.gridCell}
		sectionColor={colors.gridSection}
		cellSize={1}
		sectionSize={5}
		fadeDistance={50}
		infiniteGrid={false}
		cellThickness={1}
		sectionThickness={1.5}
	/>
</T.Group>

<!-- Lamps -->
{#each filteredLamps as lamp (lamp.id)}
	<Lamp3D {lamp} {scale} roomHeight={roomDims.z} {room} selected={selectedLampIds.includes(lamp.id)} />
{/each}

<!-- Calculation Zones - Planes -->
{#each filteredZones.filter(z => z.type === 'plane') as zone (zone.id)}
	<CalcPlane3D {zone} {room} {scale} values={getZoneValues(zone.id)} selected={selectedZoneIds.includes(zone.id)} />
{/each}

<!-- Calculation Zones - Volumes (isosurface visualization) -->
{#each filteredZones.filter(z => z.type === 'volume') as zone (zone.id)}
	<CalcVol3D {zone} {room} {scale} values={getVolumeValues(zone.id)} selected={selectedZoneIds.includes(zone.id)} />
{/each}

<!-- Axes helper (small, in corner) -->
<T.AxesHelper args={[1]} position={[-0.5, 0, -0.5]} />
