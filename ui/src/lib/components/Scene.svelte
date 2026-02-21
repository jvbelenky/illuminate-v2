<script lang="ts">
	import { T, useThrelte } from '@threlte/core';
	import { OrbitControls, Grid, interactivity } from '@threlte/extras';

	interactivity();
	import * as THREE from 'three';
	import type { RoomConfig, LampInstance, CalcZone, ZoneResult, ZoneDimensionSnapshot } from '$lib/types/project';
	import Room3D from './Room3D.svelte';
	import Lamp3D from './Lamp3D.svelte';
	import CalcPlane3D from './CalcPlane3D.svelte';
	import CalcVol3D from './CalcVol3D.svelte';
	import RoomAxes from './RoomAxes.svelte';
	import { theme } from '$lib/stores/theme';
	import type { ViewPreset } from './ViewSnapOverlay.svelte';

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
		onViewControlReady?: (setView: (view: ViewPreset) => void) => void;
		onUserOrbit?: () => void;
		onLampClick?: (lampId: string) => void;
		onZoneClick?: (zoneId: string) => void;
	}

	let { room, lamps, zones = [], zoneResults = {}, selectedLampIds = [], selectedZoneIds = [], highlightedLampIds = [], highlightedZoneIds = [], visibleLampIds, visibleZoneIds, onViewControlReady, onUserOrbit, onLampClick, onZoneClick }: Props = $props();

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

	// Unified click handler: reads ALL intersections from the event to find
	// every lamp/zone under the cursor, then reports them all.  This ensures
	// overlapping objects (e.g. a plane inside a volume) are all discoverable
	// for the click-cycling logic in the parent.
	function handleSceneClick(event: any) {
		event.stopPropagation();
		const seen = new Set<string>();
		for (const hit of event.intersections) {
			// Walk up from the hit object to find our userData marker
			let obj: any = hit.eventObject ?? hit.object;
			while (obj) {
				const { clickType, clickId } = obj.userData ?? {};
				if (clickType && clickId) {
					const key = `${clickType}:${clickId}`;
					if (!seen.has(key)) {
						seen.add(key);
						if (clickType === 'lamp') onLampClick?.(clickId);
						else if (clickType === 'zone') onZoneClick?.(clickId);
					}
					break;
				}
				obj = obj.parent;
			}
		}
	}

	const sceneClickHandler = $derived(
		(onLampClick || onZoneClick) ? handleSceneClick : undefined
	);

	// Check if a zone's current dimensions match the snapshot from calculation time
	function dimensionsMatch(zone: CalcZone, snapshot?: ZoneDimensionSnapshot): boolean {
		if (!snapshot) return true; // No snapshot means legacy result, show values
		if (zone.type === 'volume') {
			return zone.x_min === snapshot.x_min && zone.x_max === snapshot.x_max
				&& zone.y_min === snapshot.y_min && zone.y_max === snapshot.y_max
				&& zone.z_min === snapshot.z_min && zone.z_max === snapshot.z_max
				&& zone.num_x === snapshot.num_x && zone.num_y === snapshot.num_y
				&& zone.num_z === snapshot.num_z;
		}
		return zone.x1 === snapshot.x1 && zone.x2 === snapshot.x2
			&& zone.y1 === snapshot.y1 && zone.y2 === snapshot.y2
			&& zone.height === snapshot.height && zone.ref_surface === snapshot.ref_surface
			&& zone.num_x === snapshot.num_x && zone.num_y === snapshot.num_y;
	}

	// Get values for a plane zone from results
	function getZoneValues(zoneId: string): number[][] | undefined {
		const result = zoneResults[zoneId];
		if (!result?.values) return undefined;
		const zone = zones.find(z => z.id === zoneId);
		if (zone && !dimensionsMatch(zone, result.dimensionSnapshot)) return undefined;
		// For planes, values should be 2D array
		return result.values as number[][];
	}

	// Get values for a volume zone from results
	function getVolumeValues(zoneId: string): number[][][] | undefined {
		const result = zoneResults[zoneId];
		if (!result?.values) return undefined;
		const zone = zones.find(z => z.id === zoneId);
		if (zone && !dimensionsMatch(zone, result.dimensionSnapshot)) return undefined;
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
		z: -roomDims.y / 2  // depth center (negated for Z-up→Y-up)
	});

	// Animation state for smooth view transitions
	let animationId: number | null = null;
	const ANIMATION_DURATION = 600; // ms
	const POLE_ANIMATION_DURATION = 900; // ms - slower for pole transitions

	function easeInOutCubic(t: number): number {
		return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
	}

	// Gentler easing for pole transitions - less aggressive acceleration
	function easeInOutQuad(t: number): number {
		return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
	}

	function cancelAnimation() {
		if (animationId !== null) {
			cancelAnimationFrame(animationId);
			animationId = null;
			// Re-enable controls if animation was interrupted
			if (controlsRef) controlsRef.enabled = true;
		}
	}

	// Compute target camera position for a preset view
	function getViewPosition(view: ViewPreset): [number, number, number] | null {
		const dist = cameraDistance;
		const isoDist = dist * 0.7;
		const isoHeight = dist * 0.6;

		switch (view) {
			case 'front':
				return [roomCenter.x, roomCenter.y, dist];
			case 'back':
				return [roomCenter.x, roomCenter.y, -roomDims.y - dist];
			case 'left':
				return [-dist, roomCenter.y, roomCenter.z];
			case 'right':
				return [roomDims.x + dist, roomCenter.y, roomCenter.z];
			case 'iso-front-left':
				return [-isoDist, isoHeight, isoDist];
			case 'iso-front-right':
				return [roomDims.x + isoDist, isoHeight, isoDist];
			case 'iso-back-left':
				return [-isoDist, isoHeight, -roomDims.y - isoDist];
			case 'iso-back-right':
				return [roomDims.x + isoDist, isoHeight, -roomDims.y - isoDist];
			default:
				return null;
		}
	}

	// Shortest-path delta for an angle, wrapping around ±PI
	function shortestAngleDelta(from: number, to: number): number {
		let delta = to - from;
		if (delta > Math.PI) delta -= 2 * Math.PI;
		if (delta < -Math.PI) delta += 2 * Math.PI;
		return delta;
	}

	// Animate camera to a preset view using spherical interpolation
	function setView(view: ViewPreset) {
		if (!cameraRef || !controlsRef) return;

		cancelAnimation();

		const endTarget = new THREE.Vector3(roomCenter.x, roomCenter.y, roomCenter.z);
		const startTarget = controlsRef.target.clone();

		// Compute start spherical coords relative to current target
		const startOffset = cameraRef.position.clone().sub(startTarget);
		const startSph = new THREE.Spherical().setFromVector3(startOffset);

		let endSph: THREE.Spherical;

		if (view === 'top') {
			// Plan view: tilt straight up from current angle, keeping theta
			const topRadius = cameraDistance * 1.2;
			endSph = new THREE.Spherical(topRadius, 0.001, startSph.theta);
		} else {
			const pos = getViewPosition(view);
			if (!pos) return;
			const endOffset = new THREE.Vector3(pos[0], pos[1], pos[2]).sub(endTarget);
			endSph = new THREE.Spherical().setFromVector3(endOffset);
		}

		// Near the poles (phi ≈ 0 for top), theta is arbitrary—
		// match it to the other end to prevent spurious rotation
		const POLE_THRESHOLD = 0.05;
		if (endSph.phi < POLE_THRESHOLD) endSph.theta = startSph.theta;
		if (startSph.phi < POLE_THRESHOLD) startSph.theta = endSph.theta;

		const dTheta = shortestAngleDelta(startSph.theta, endSph.theta);
		const startTime = performance.now();

		// Capture start position for Cartesian fallback near poles
		const startPos = cameraRef.position.clone();
		const endOffset = new THREE.Vector3().setFromSpherical(endSph);
		const endPos = endTarget.clone().add(endOffset);
		const nearPole = startSph.phi < POLE_THRESHOLD || endSph.phi < POLE_THRESHOLD;
		const duration = nearPole ? POLE_ANIMATION_DURATION : ANIMATION_DURATION;

		// Disable OrbitControls during animation so damping doesn't fight
		controlsRef.enabled = false;

		function animate(now: number) {
			const elapsed = now - startTime;
			const t = Math.min(elapsed / duration, 1);
			const eased = nearPole ? easeInOutQuad(t) : easeInOutCubic(t);

			// Interpolate the look-at target
			const currentTarget = new THREE.Vector3().lerpVectors(startTarget, endTarget, eased);

			if (nearPole) {
				// Near poles, spherical interpolation is unstable (gimbal lock).
				// Use Cartesian lerp for smooth, predictable motion.
				cameraRef!.position.lerpVectors(startPos, endPos, eased);
			} else {
				// Normal spherical interpolation for non-pole transitions
				const r = startSph.radius + (endSph.radius - startSph.radius) * eased;
				const phi = startSph.phi + (endSph.phi - startSph.phi) * eased;
				const theta = startSph.theta + dTheta * eased;
				const offset = new THREE.Vector3().setFromSpherical(new THREE.Spherical(r, phi, theta));
				cameraRef!.position.copy(currentTarget).add(offset);
			}

			cameraRef!.lookAt(currentTarget);

			if (t < 1) {
				animationId = requestAnimationFrame(animate);
			} else {
				// Sync OrbitControls to final state and re-enable
				controlsRef!.target.copy(endTarget);
				controlsRef!.update();
				controlsRef!.enabled = true;
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
	position={[-cameraDistance, cameraDistance * 0.8, cameraDistance]}
	fov={50}
	bind:ref={cameraRef}
>
	<OrbitControls
		bind:ref={controlsRef}
		enableDamping
		dampingFactor={0.1}
		target={[roomDims.x / 2, roomDims.z / 2, -roomDims.y / 2]}
	/>
</T.PerspectiveCamera>

<!-- Lighting -->
<T.AmbientLight intensity={0.4} />
<T.DirectionalLight position={[10, 20, 10]} intensity={0.8} castShadow />
<T.DirectionalLight position={[-10, 10, -10]} intensity={0.3} />

<!-- Room wireframe -->
<Room3D dims={roomDims} {room} />

<!-- Floor grid -->
<T.Group position={[roomDims.x / 2, 0.001, -roomDims.y / 2]}>
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
	<Lamp3D {lamp} {scale} roomHeight={roomDims.z} {room} selected={selectedLampIds.includes(lamp.id)} highlighted={highlightedLampIds.includes(lamp.id)} onclick={sceneClickHandler} />
{/each}

<!-- Calculation Zones - Planes -->
{#each filteredZones.filter(z => z.type === 'plane') as zone (zone.id)}
	<CalcPlane3D {zone} {room} {scale} values={getZoneValues(zone.id)} selected={selectedZoneIds.includes(zone.id)} highlighted={highlightedZoneIds.includes(zone.id)} onclick={sceneClickHandler} />
{/each}

<!-- Calculation Zones - Volumes (isosurface visualization) -->
{#each filteredZones.filter(z => z.type === 'volume') as zone (zone.id)}
	<CalcVol3D {zone} {room} {scale} values={getVolumeValues(zone.id)} selected={selectedZoneIds.includes(zone.id)} highlighted={highlightedZoneIds.includes(zone.id)} onclick={sceneClickHandler} />
{/each}

<!-- Axes helper (small, in corner) -->
<RoomAxes />
