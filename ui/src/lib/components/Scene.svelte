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
		isOrtho?: boolean;
		onViewControlReady?: (setView: (view: ViewPreset) => void) => void;
	}

	let { room, lamps, zones = [], zoneResults = {}, selectedLampIds = [], selectedZoneIds = [], visibleLampIds, visibleZoneIds, isOrtho = false, onViewControlReady }: Props = $props();

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
	const { scene, size } = useThrelte();
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
	let perspCameraRef = $state<THREE.PerspectiveCamera | null>(null);
	let orthoCameraRef = $state<THREE.OrthographicCamera | null>(null);
	let controlsRef = $state<any>(null);

	// Active camera based on projection mode
	const cameraRef = $derived(isOrtho ? orthoCameraRef : perspCameraRef);

	// Ortho frustum size based on room
	const orthoSize = $derived(maxDim * 1.5);

	// Canvas aspect ratio for ortho frustum
	const aspect = $derived($size.width / $size.height || 1);

	// Room center in Three.js coordinates (room Y→Three.js Z, room Z→Three.js Y)
	const roomCenter = $derived({
		x: roomDims.x / 2,
		y: roomDims.z / 2, // height center
		z: roomDims.y / 2  // depth center
	});

	// Set initial camera positions once (not as reactive props, so orbit changes persist)
	let perspInitialized = false;
	$effect(() => {
		if (perspCameraRef && !perspInitialized) {
			perspCameraRef.position.set(cameraDistance, cameraDistance * 0.8, cameraDistance);
			perspInitialized = true;
		}
	});
	let orthoInitialized = false;
	$effect(() => {
		if (orthoCameraRef && !orthoInitialized) {
			orthoCameraRef.position.set(cameraDistance, cameraDistance * 0.8, cameraDistance);
			orthoInitialized = true;
		}
	});

	// Save camera state BEFORE projection switch (runs before DOM destroys old OrbitControls)
	let prevIsOrtho = isOrtho;
	let pendingSwitch: {
		position: THREE.Vector3;
		target: THREE.Vector3;
		perspDist: number;
		orthoZoom: number;
	} | null = null;

	$effect.pre(() => {
		if (isOrtho === prevIsOrtho) return;

		if (cameraRef && controlsRef) {
			const target = controlsRef.target as THREE.Vector3;
			pendingSwitch = {
				position: cameraRef.position.clone(),
				target: target.clone(),
				perspDist: cameraRef.position.distanceTo(target),
				orthoZoom: orthoCameraRef?.zoom ?? 1
			};
		}
		prevIsOrtho = isOrtho;
	});

	// When OrbitControls mounts (new ref), apply pending switch state or set defaults
	$effect(() => {
		if (!controlsRef) return;

		if (pendingSwitch) {
			const { position, target, perspDist, orthoZoom } = pendingSwitch;
			pendingSwitch = null;

			if (isOrtho && orthoCameraRef) {
				// Switched persp → ortho: match visible area
				orthoCameraRef.position.copy(position);
				controlsRef.target.copy(target);
				const fovRad = THREE.MathUtils.degToRad(50);
				const visibleHeight = 2 * perspDist * Math.tan(fovRad / 2);
				orthoCameraRef.zoom = (orthoSize * 2) / visibleHeight;
				orthoCameraRef.updateProjectionMatrix();
			} else if (!isOrtho && perspCameraRef) {
				// Switched ortho → persp: position camera at correct distance
				const direction = position.clone().sub(target).normalize();
				const fovRad = THREE.MathUtils.degToRad(50);
				const visibleHeight = (orthoSize * 2) / orthoZoom;
				const dist = visibleHeight / (2 * Math.tan(fovRad / 2));
				perspCameraRef.position.copy(target).add(direction.multiplyScalar(dist));
				controlsRef.target.copy(target);
			}
		} else {
			// Initial mount — set default target
			controlsRef.target.set(roomCenter.x, roomCenter.y, roomCenter.z);
		}
		controlsRef.update();
	});

	// Set camera to a preset view
	function setView(view: ViewPreset) {
		if (!cameraRef || !controlsRef) return;

		const dist = cameraDistance;
		const isoDist = dist * 0.7;
		const isoHeight = dist * 0.6;
		let pos: [number, number, number];

		switch (view) {
			case 'top':
				pos = [roomCenter.x, dist * 1.2, roomCenter.z];
				break;
			case 'front':
				pos = [roomCenter.x, roomCenter.y, -dist];
				break;
			case 'back':
				pos = [roomCenter.x, roomCenter.y, roomDims.y + dist];
				break;
			case 'left':
				pos = [-dist, roomCenter.y, roomCenter.z];
				break;
			case 'right':
				pos = [roomDims.x + dist, roomCenter.y, roomCenter.z];
				break;
			case 'iso-front-left':
				pos = [-isoDist, isoHeight, -isoDist];
				break;
			case 'iso-front-right':
				pos = [roomDims.x + isoDist, isoHeight, -isoDist];
				break;
			case 'iso-back-left':
				pos = [-isoDist, isoHeight, roomDims.y + isoDist];
				break;
			case 'iso-back-right':
				pos = [roomDims.x + isoDist, isoHeight, roomDims.y + isoDist];
				break;
			default:
				return;
		}

		cameraRef.position.set(pos[0], pos[1], pos[2]);
		controlsRef.target.set(roomCenter.x, roomCenter.y, roomCenter.z);
		controlsRef.update();
	}

	// Notify parent when view control is ready
	$effect(() => {
		if (cameraRef && controlsRef && onViewControlReady) {
			onViewControlReady(setView);
		}
	});
</script>

<!-- Cameras -->
<T.PerspectiveCamera
	makeDefault={!isOrtho}
	fov={50}
	bind:ref={perspCameraRef}
>
	{#if !isOrtho}
		<OrbitControls
			bind:ref={controlsRef}
			enableDamping
			dampingFactor={0.1}
		/>
	{/if}
</T.PerspectiveCamera>

<T.OrthographicCamera
	makeDefault={isOrtho}
	left={-orthoSize * aspect}
	right={orthoSize * aspect}
	top={orthoSize}
	bottom={-orthoSize}
	near={0.1}
	far={cameraDistance * 10}
	bind:ref={orthoCameraRef}
>
	{#if isOrtho}
		<OrbitControls
			bind:ref={controlsRef}
			enableDamping
			dampingFactor={0.1}
		/>
	{/if}
</T.OrthographicCamera>

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
