<script lang="ts" module>
	// Module-level cache shared across all lamp instances
	import type { PhotometricWebData } from '$lib/api/client';
	const WEB_CACHE_MAX = 64;
	const webCache = new Map<string, PhotometricWebData>();
</script>

<script lang="ts">
	import { T } from '@threlte/core';
	import * as THREE from 'three';
	import type { LampInstance, RoomConfig } from '$lib/types/project';
	import { getPhotometricWeb, getSessionLampPhotometricWeb } from '$lib/api/client';
	import { onMount } from 'svelte';

	interface Props {
		lamp: LampInstance;
		scale: number;
		roomHeight: number;
		room: RoomConfig;
		selected?: boolean;
		highlighted?: boolean;
		onclick?: (event: any) => void;
	}

	let { lamp, scale, roomHeight, room, selected = false, highlighted = false, onclick }: Props = $props();

	// State
	let meshGeometry = $state<THREE.BufferGeometry | null>(null);
	let surfacePointsGeometry = $state<THREE.BufferGeometry | null>(null);
	let fixtureGeometry = $state<THREE.BufferGeometry | null>(null);
	let meshColor = $state('#cc61ff');
	let loading = $state(false);
	let lastFetchKey = '';
	let geometryKey = $state(0); // Force re-render when geometry changes

	// Cache key - includes preset for preset lamps, lamp.id for session lamps
	// Also includes source settings that affect surface point visualization
	function getCacheKey(): string {
		const density = lamp.source_density ?? 'default';
		const width = lamp.source_width ?? 'default';
		const length = lamp.source_length ?? 'default';
		if (lamp.preset_id && lamp.preset_id !== 'custom') {
			return `preset-${lamp.preset_id}-${lamp.scaling_factor}-${room.units}-${density}-${width}-${length}`;
		}
		// For session lamps (custom IES), use lamp ID since the IES data is tied to the session
		return `session-${lamp.id}-${lamp.scaling_factor}-${density}-${width}-${length}`;
	}

	// Build geometry from web data
	function buildGeometry(data: PhotometricWebData): THREE.BufferGeometry {
		const geometry = new THREE.BufferGeometry();
		const positions: number[] = [];
		for (const [x, y, z] of data.vertices) {
			positions.push(x, z, -y); // Swap y/z for Three.js, negate Z
		}

		const indices: number[] = [];
		for (const [i, j, k] of data.triangles) {
			indices.push(i, j, k);
		}
		geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
		geometry.setIndex(indices);
		geometry.computeVertexNormals();
		geometry.computeBoundingBox();
		geometry.computeBoundingSphere();
		return geometry;
	}

	// Build surface points geometry (discrete emission surface grid)
	function buildSurfacePointsGeometry(data: PhotometricWebData): THREE.BufferGeometry | null {
		if (!data.surface_points || data.surface_points.length === 0) {
			return null;
		}
		const geometry = new THREE.BufferGeometry();
		const positions: number[] = [];
		for (const [x, y, z] of data.surface_points) {
			positions.push(x, z, -y); // Swap y/z for Three.js, negate Z
		}
		geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
		return geometry;
	}

	// Build fixture bounding box wireframe geometry
	function buildFixtureGeometry(data: PhotometricWebData): THREE.BufferGeometry | null {
		if (!data.fixture_bounds || data.fixture_bounds.length !== 8) {
			return null;
		}
		const corners = data.fixture_bounds;
		// Define edges by vertex indices (12 edges of a box)
		// Corners are: 0-3 bottom face, 4-7 top face
		const edges = [
			[0, 1], [1, 2], [2, 3], [3, 0],  // Bottom face
			[4, 5], [5, 6], [6, 7], [7, 4],  // Top face
			[0, 4], [1, 5], [2, 6], [3, 7],  // Side edges
		];

		const geometry = new THREE.BufferGeometry();
		const positions: number[] = [];
		for (const [v1, v2] of edges) {
			const [x1, y1, z1] = corners[v1];
			const [x2, y2, z2] = corners[v2];
			// Swap y/z for Three.js
			positions.push(x1, z1, -y1);
			positions.push(x2, z2, -y2);
		}
		geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
		return geometry;
	}

	// Fetch photometric web data
	async function fetchPhotometricWeb() {
		// Determine if we can show a photometric web
		const hasPreset = lamp.preset_id && lamp.preset_id !== 'custom';
		const hasSessionIes = lamp.has_ies_file;

		if (!hasPreset && !hasSessionIes) {
			// No IES data available - unconfigured lamp
			meshGeometry = null;
			surfacePointsGeometry = null;
			fixtureGeometry = null;
			return;
		}

		const key = getCacheKey();
		if (key === lastFetchKey) {
			return;
		}

		const cached = webCache.get(key);
		if (cached) {
			meshGeometry = buildGeometry(cached);
			surfacePointsGeometry = buildSurfacePointsGeometry(cached);
			fixtureGeometry = buildFixtureGeometry(cached);
			meshColor = cached.color;
			geometryKey++;
			lastFetchKey = key;
			return;
		}

		loading = true;
		try {
			let data;
			if (hasPreset) {
				// Use preset endpoint for known presets
				data = await getPhotometricWeb({
					preset_id: lamp.preset_id!,
					scaling_factor: lamp.scaling_factor,
					units: room.units,
					source_density: lamp.source_density,
					source_width: lamp.source_width,
					source_length: lamp.source_length
				});
			} else {
				// Use session endpoint for custom/loaded lamps with IES data
				data = await getSessionLampPhotometricWeb(lamp.id);
			}
			webCache.set(key, data);
			if (webCache.size > WEB_CACHE_MAX) {
				const firstKey = webCache.keys().next().value;
				if (firstKey !== undefined) webCache.delete(firstKey);
			}
			meshGeometry = buildGeometry(data);
			surfacePointsGeometry = buildSurfacePointsGeometry(data);
			fixtureGeometry = buildFixtureGeometry(data);
			meshColor = data.color;
			geometryKey++;
			lastFetchKey = key;
		} catch (e) {
			console.error('Failed to fetch photometric web:', e);
			meshGeometry = null;
			surfacePointsGeometry = null;
			fixtureGeometry = null;
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		fetchPhotometricWeb();
	});

	// Watch for preset/scaling/IES/source setting changes
	let prevKey = '';
	$effect(() => {
		const key = `${lamp.preset_id}-${lamp.scaling_factor}-${lamp.has_ies_file}-${lamp.source_density}-${lamp.source_width}-${lamp.source_length}`;
		if (key !== prevKey) {
			prevKey = key;
			fetchPhotometricWeb();
		}
	});

	// Computed values for transforms (these are cheap)
	function getPosition(): [number, number, number] {
		return [lamp.x * scale, lamp.z * scale, -lamp.y * scale];
	}

	function getRotation(): [number, number, number, number] {
		// Calculate direction from lamp position to aim point (in room coords)
		const dirX = lamp.aimx - lamp.x;
		const dirY = lamp.aimy - lamp.y;
		const dirZ = lamp.aimz - lamp.z;

		const norm = Math.sqrt(dirX ** 2 + dirY ** 2 + dirZ ** 2);
		if (norm === 0) {
			return [0, 0, 0, 1]; // Identity quaternion
		}

		// Compute heading and bank matching guv_calcs' LampOrientation model
		const headingRad = (Math.abs(dirX) < 1e-10 && Math.abs(dirY) < 1e-10)
			? 0
			: Math.atan2(dirY, dirX);
		const bankRad = Math.acos(Math.max(-1, Math.min(1, -dirZ / norm)));
		const angleRad = (lamp.angle || 0) * Math.PI / 180;

		// Build quaternion using guv_calcs' Euler decomposition adapted to Three.js coords.
		// Room lamp-to-world: R_z(heading) @ R_y(-bank) @ R_z(angle)
		// Three.js equivalent: R_y(heading) @ R_z(bank) @ R_y(angle)
		// (coordinate swap X,Y,Z -> X,Z,-Y preserves handedness, so rotation angles stay the same)
		const qHeading = new THREE.Quaternion().setFromAxisAngle(
			new THREE.Vector3(0, 1, 0), headingRad
		);
		const qBank = new THREE.Quaternion().setFromAxisAngle(
			new THREE.Vector3(0, 0, 1), bankRad
		);
		const qAngle = new THREE.Quaternion().setFromAxisAngle(
			new THREE.Vector3(0, 1, 0), angleRad
		);

		const q = new THREE.Quaternion();
		q.copy(qHeading);
		q.multiply(qBank);
		q.multiply(qAngle);

		return [q.x, q.y, q.z, q.w];
	}

	// Color scheme: grey=disabled, light blue=highlighted, magenta=selected, blue=enabled
	function getColor(): string {
		if (!lamp.enabled) return '#888888';
		if (highlighted) return '#60a5fa';     // Lighter blue for hover highlight
		if (selected) return '#a855f7';        // Soft purple for selected
		return '#3b82f6';                      // Blue for enabled
	}

	// Higher opacity when highlighted or selected for visibility
	const meshOpacity = $derived(highlighted ? 0.7 : selected ? 0.6 : 0.4);
	const aimOpacity = $derived(highlighted ? 0.7 : selected ? 0.6 : 0.4);

	function getAimEnd(): [number, number, number] {
		// Calculate direction from lamp to aim point (room coords)
		const dirX = lamp.aimx - lamp.x;
		const dirY = lamp.aimy - lamp.y;
		const dirZ = lamp.aimz - lamp.z;
		const dirLength = Math.sqrt(dirX ** 2 + dirY ** 2 + dirZ ** 2) || 1;

		// Normalize and scale to a reasonable display length
		const len = Math.min(lamp.z, 2) * scale;
		return [
			(dirX / dirLength) * len,
			(dirZ / dirLength) * len,  // Swap Y/Z for Three.js
			-(dirY / dirLength) * len
		];
	}

	// Aim point position in Three.js coords
	function getAimPos(): [number, number, number] {
		return [lamp.aimx * scale, lamp.aimz * scale, -lamp.aimy * scale];
	}

	// Build line geometry from lamp to aim point
	function buildAimLineGeometry(): THREE.BufferGeometry {
		const geometry = new THREE.BufferGeometry();
		const aimPt = getAimPos();
		const lampPt = getPosition();
		// Relative positions (line starts at origin since we position the group)
		const positions = new Float32Array([
			0, 0, 0,
			aimPt[0] - lampPt[0], aimPt[1] - lampPt[1], aimPt[2] - lampPt[2]
		]);
		geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		return geometry;
	}

	// Reactive values
	const pos = $derived(getPosition());
	const rot = $derived(getRotation());
	const color = $derived(getColor());
	const aimEnd = $derived(getAimEnd());
	const aimPos = $derived(getAimPos());
	const aimLineGeometry = $derived(buildAimLineGeometry());
	const beamLength = $derived(Math.min(lamp.z * scale, roomHeight) * 0.8);

	// Dispose GPU geometry when reassigned or on unmount
	$effect(() => {
		const geo = meshGeometry;
		return () => { geo?.dispose(); };
	});
	$effect(() => {
		const geo = surfacePointsGeometry;
		return () => { geo?.dispose(); };
	});
	$effect(() => {
		const geo = fixtureGeometry;
		return () => { geo?.dispose(); };
	});
	$effect(() => {
		const geo = aimLineGeometry;
		return () => { geo?.dispose(); };
	});
</script>

{#if meshGeometry}
	<!-- Photometric web mesh -->
	{#if room.showPhotometricWebs !== false}
		{#key geometryKey}
			<T.Group position={pos} quaternion={rot}>
				<T.Mesh geometry={meshGeometry} renderOrder={2} onclick={onclick} userData={{ clickType: 'lamp', clickId: lamp.id }} oncreate={(ref) => { if (onclick) ref.cursor = 'pointer'; }}>
					<T.MeshBasicMaterial
						color={color}
						transparent
						opacity={meshOpacity}
						side={THREE.DoubleSide}
						depthWrite={false}
					/>
				</T.Mesh>
			</T.Group>
		{/key}
	{/if}

	<!-- Surface points (discrete emission surface grid) -->
	{#if surfacePointsGeometry}
		{#key geometryKey}
			<T.Group position={pos} quaternion={rot}>
				<T.Points geometry={surfacePointsGeometry}>
					<T.PointsMaterial
						color={color}
						size={0.03}
						transparent
						opacity={0.9}
						sizeAttenuation={true}
					/>
				</T.Points>
			</T.Group>
		{/key}
	{/if}

	<!-- Fixture bounding box wireframe -->
	{#if fixtureGeometry}
		{#key geometryKey}
			<T.Group position={pos} quaternion={rot}>
				<T.LineSegments geometry={fixtureGeometry}>
					<T.LineBasicMaterial
						color={color}
						transparent
						opacity={0.7}
						linewidth={2}
					/>
				</T.LineSegments>
			</T.Group>
		{/key}
	{/if}
{:else}
	<!-- Unconfigured lamp: tiny dot -->
	<T.Mesh position={pos} onclick={onclick} userData={{ clickType: 'lamp', clickId: lamp.id }} oncreate={(ref) => { if (onclick) ref.cursor = 'pointer'; }}>
		<T.SphereGeometry args={[0.03, 8, 8]} />
		<T.MeshBasicMaterial color={color} />
	</T.Mesh>

	{#if loading}
		<T.Mesh position={pos}>
			<T.SphereGeometry args={[0.06, 8, 8]} />
			<T.MeshBasicMaterial color="#fbbf24" wireframe />
		</T.Mesh>
	{/if}
{/if}

<!-- Aim line (dashed) - shown for all lamps -->
<T.Group position={pos}>
	<T.LineSegments
		oncreate={(ref) => { ref.computeLineDistances(); }}
		geometry={aimLineGeometry}
	>
		<T.LineDashedMaterial color={color} dashSize={0.1} gapSize={0.06} transparent opacity={aimOpacity} />
	</T.LineSegments>
</T.Group>

<T.PointLight position={pos} color={color} intensity={0.5} distance={beamLength * 2} />
