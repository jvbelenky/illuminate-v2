<script lang="ts" module>
	// Module-level cache shared across all lamp instances
	import type { PhotometricWebData } from '$lib/api/client';
	const webCache = new Map<string, PhotometricWebData>();
</script>

<script lang="ts">
	import { T } from '@threlte/core';
	import * as THREE from 'three';
	import type { LampInstance, RoomConfig } from '$lib/types/project';
	import { getPhotometricWeb } from '$lib/api/client';
	import { onMount } from 'svelte';

	interface Props {
		lamp: LampInstance;
		scale: number;
		roomHeight: number;
		room: RoomConfig;
	}

	let { lamp, scale, roomHeight, room }: Props = $props();

	// State
	let meshGeometry = $state<THREE.BufferGeometry | null>(null);
	let meshColor = $state('#cc61ff');
	let loading = $state(false);
	let lastFetchKey = '';
	let geometryKey = $state(0); // Force re-render when geometry changes

	// Cache key only includes preset and scaling
	function getCacheKey(): string {
		return `${lamp.preset_id}-${lamp.scaling_factor}-${room.units}`;
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
		if (!lamp.preset_id || lamp.preset_id === 'custom' || lamp.lamp_type === 'lp_254') {
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
			const data = await getPhotometricWeb({
				preset_id: lamp.preset_id,
				scaling_factor: lamp.scaling_factor,
				units: room.units
			});
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

	// Watch for preset/scaling changes only
	let prevKey = '';
	$effect(() => {
		const key = `${lamp.preset_id}-${lamp.scaling_factor}`;
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

	function getColor(): string {
		if (!lamp.enabled) return '#d1d1d1';
		if (lamp.lamp_type === 'lp_254') return '#3b82f6';
		return '#cc61ff';
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

	// Reactive values
	const pos = $derived(getPosition());
	const rot = $derived(getRotation());
	const color = $derived(getColor());
	const aimEnd = $derived(getAimEnd());
	const beamLength = $derived(Math.min(lamp.z * scale, roomHeight) * 0.8);


</script>

{#if meshGeometry}
	<!-- Photometric web mesh -->
	{#key geometryKey}
		<T.Group position={pos} quaternion={rot}>
			<T.Mesh geometry={meshGeometry}>
				<T.MeshBasicMaterial
					color={meshColor}
					transparent
					opacity={0.4}
					side={THREE.DoubleSide}
					depthWrite={false}
				/>
			</T.Mesh>
		</T.Group>
	{/key}

	<!-- Lamp marker -->
	<T.Mesh position={pos}>
		<T.SphereGeometry args={[0.08, 12, 12]} />
		<T.MeshBasicMaterial color={meshColor} />
	</T.Mesh>
{:else}
	<T.Mesh position={pos}>
		<T.SphereGeometry args={[0.1, 16, 16]} />
		<T.MeshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} />
	</T.Mesh>

	<T.Mesh position={pos}>
		<T.CylinderGeometry args={[0.08, 0.12, 0.15, 16]} />
		<T.MeshStandardMaterial color="#333344" metalness={0.8} roughness={0.2} />
	</T.Mesh>

	<T.Group position={pos}>
		<T.Mesh quaternion={rot}>
			<T.ConeGeometry args={[beamLength * 0.3, beamLength, 16, 1, true]} />
			<T.MeshBasicMaterial color={color} transparent opacity={0.15} side={THREE.DoubleSide} depthWrite={false} />
		</T.Mesh>
	</T.Group>

	{#if loading}
		<T.Mesh position={pos}>
			<T.SphereGeometry args={[0.15, 8, 8]} />
			<T.MeshBasicMaterial color="#fbbf24" wireframe />
		</T.Mesh>
	{/if}
{/if}

<T.PointLight position={pos} color={color} intensity={0.5} distance={beamLength * 2} />
