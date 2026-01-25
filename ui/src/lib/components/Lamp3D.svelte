<script lang="ts" module>
	// Module-level cache shared across all lamp instances
	import type { PhotometricWebData } from '$lib/api/client';
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
	}

	let { lamp, scale, roomHeight, room, selected = false }: Props = $props();

	// State
	let meshGeometry = $state<THREE.BufferGeometry | null>(null);
	let meshColor = $state('#cc61ff');
	let loading = $state(false);
	let lastFetchKey = '';
	let geometryKey = $state(0); // Force re-render when geometry changes

	// Cache key - includes preset for preset lamps, lamp.id for session lamps
	function getCacheKey(): string {
		if (lamp.preset_id && lamp.preset_id !== 'custom') {
			return `preset-${lamp.preset_id}-${lamp.scaling_factor}-${room.units}`;
		}
		// For session lamps (custom IES), use lamp ID since the IES data is tied to the session
		return `session-${lamp.id}-${lamp.scaling_factor}`;
	}

	// Build geometry from web data
	function buildGeometry(data: PhotometricWebData): THREE.BufferGeometry {
		const geometry = new THREE.BufferGeometry();
		const positions: number[] = [];
		for (const [x, y, z] of data.vertices) {
			positions.push(x, z, y); // Swap y/z for Three.js
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

	// Fetch photometric web data
	async function fetchPhotometricWeb() {
		// 254nm lamps don't have photometric webs in this visualization
		if (lamp.lamp_type === 'lp_254') {
			meshGeometry = null;
			return;
		}

		// Determine if we can show a photometric web
		const hasPreset = lamp.preset_id && lamp.preset_id !== 'custom';
		const hasSessionIes = lamp.has_ies_file;

		if (!hasPreset && !hasSessionIes) {
			// No IES data available - unconfigured lamp
			meshGeometry = null;
			return;
		}

		const key = getCacheKey();
		if (key === lastFetchKey) {
			return;
		}

		const cached = webCache.get(key);
		if (cached) {
			meshGeometry = buildGeometry(cached);
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
					units: room.units
				});
			} else {
				// Use session endpoint for custom/loaded lamps with IES data
				data = await getSessionLampPhotometricWeb(lamp.id);
			}
			webCache.set(key, data);
			meshGeometry = buildGeometry(data);
			meshColor = data.color;
			geometryKey++;
			lastFetchKey = key;
		} catch (e) {
			console.error('Failed to fetch photometric web:', e);
			meshGeometry = null;
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		fetchPhotometricWeb();
	});

	// Watch for preset/scaling/IES changes
	let prevKey = '';
	$effect(() => {
		const key = `${lamp.preset_id}-${lamp.scaling_factor}-${lamp.has_ies_file}`;
		if (key !== prevKey) {
			prevKey = key;
			fetchPhotometricWeb();
		}
	});

	// Computed values for transforms (these are cheap)
	function getPosition(): [number, number, number] {
		return [lamp.x * scale, lamp.z * scale, lamp.y * scale];
	}

	function getRotation(): [number, number, number, number] {
		const q = new THREE.Quaternion();
		// Default mesh direction is -Y (down) in Three.js
		const defaultDir = new THREE.Vector3(0, -1, 0);

		// Calculate direction from lamp position to aim point (in room coords)
		const dirX = lamp.aimx - lamp.x;
		const dirY = lamp.aimy - lamp.y;
		const dirZ = lamp.aimz - lamp.z;

		// Convert direction to Three.js coords (swap Y and Z)
		// Room (X, Y, Z) -> Three.js (X, Z, Y)
		const targetDir = new THREE.Vector3(dirX, dirZ, dirY).normalize();

		// Handle zero-length direction (aim point equals lamp position)
		if (targetDir.length() === 0) {
			return [0, 0, 0, 1]; // Identity quaternion
		}

		q.setFromUnitVectors(defaultDir, targetDir);
		return [q.x, q.y, q.z, q.w];
	}

	// Color scheme: grey=disabled, purple=selected, blue=enabled
	function getColor(): string {
		if (!lamp.enabled) return '#888888';  // Grey for disabled
		if (selected) return '#a855f7';        // Purple for selected
		return '#3b82f6';                      // Blue for enabled
	}

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
			(dirY / dirLength) * len
		];
	}

	// Aim point position in Three.js coords
	function getAimPos(): [number, number, number] {
		return [lamp.aimx * scale, lamp.aimz * scale, lamp.aimy * scale];
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
</script>

{#if meshGeometry}
	<!-- Photometric web mesh (no marker sphere when configured) -->
	{#key geometryKey}
		<T.Group position={pos} quaternion={rot}>
			<T.Mesh geometry={meshGeometry}>
				<T.MeshBasicMaterial
					color={color}
					transparent
					opacity={0.4}
					side={THREE.DoubleSide}
					depthWrite={false}
				/>
			</T.Mesh>
		</T.Group>
	{/key}
{:else}
	<!-- Unconfigured lamp: tiny dot -->
	<T.Mesh position={pos}>
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
		<T.LineDashedMaterial color={color} dashSize={0.1} gapSize={0.06} transparent opacity={0.4} />
	</T.LineSegments>
</T.Group>

<T.PointLight position={pos} color={color} intensity={0.5} distance={beamLength * 2} />
