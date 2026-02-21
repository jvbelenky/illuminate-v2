<script lang="ts">
	import { T, useThrelte } from '@threlte/core';
	import { OrbitControls } from '@threlte/extras';
	import * as THREE from 'three';
	import { theme } from '$lib/stores/theme';

	interface Props {
		fixtureBounds: number[][] | null;
		surfacePoints: number[][] | null;
		sourceWidth: number | null;
		sourceLength: number | null;
	}

	let { fixtureBounds, surfacePoints, sourceWidth, sourceLength }: Props = $props();

	// Scene background
	const { scene } = useThrelte();
	$effect(() => {
		scene.background = new THREE.Color($theme === 'light' ? '#d0d7de' : '#1a1a2e');
	});

	// Build fixture wireframe geometry from 8 corners
	const fixtureGeometry = $derived.by(() => {
		if (!fixtureBounds || fixtureBounds.length !== 8) return null;
		const corners = fixtureBounds;
		const edges = [
			[0, 1], [1, 2], [2, 3], [3, 0],
			[4, 5], [5, 6], [6, 7], [7, 4],
			[0, 4], [1, 5], [2, 6], [3, 7],
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
	});

	// Build surface points geometry
	const surfacePointsGeometry = $derived.by(() => {
		if (!surfacePoints || surfacePoints.length === 0) return null;
		const geometry = new THREE.BufferGeometry();
		const positions: number[] = [];
		for (const [x, y, z] of surfacePoints) {
			positions.push(x, z, -y); // Swap y/z for Three.js, negate Z
		}
		geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
		return geometry;
	});

	// Luminous opening plane dimensions
	const hasLuminousOpening = $derived(
		sourceWidth !== null && sourceWidth > 0 &&
		sourceLength !== null && sourceLength > 0
	);

	// Compute bounding box center and camera distance
	const sceneBounds = $derived.by(() => {
		let minX = -0.1, maxX = 0.1;
		let minY = -0.1, maxY = 0.1;
		let minZ = -0.1, maxZ = 0.1;

		if (fixtureBounds && fixtureBounds.length === 8) {
			for (const [x, y, z] of fixtureBounds) {
				// In Three.js coords: x, z(=room_y), y(=room_z)
				minX = Math.min(minX, x);
				maxX = Math.max(maxX, x);
				minY = Math.min(minY, z); // room z -> three.js y
				maxY = Math.max(maxY, z);
				minZ = Math.min(minZ, -y); // room y -> three.js -z
				maxZ = Math.max(maxZ, -y);
			}
		}

		if (hasLuminousOpening) {
			const hw = (sourceWidth ?? 0) / 2;
			const hl = (sourceLength ?? 0) / 2;
			minX = Math.min(minX, -hw);
			maxX = Math.max(maxX, hw);
			minZ = Math.min(minZ, -hl);
			maxZ = Math.max(maxZ, hl);
		}

		const cx = (minX + maxX) / 2;
		const cy = (minY + maxY) / 2;
		const cz = (minZ + maxZ) / 2;
		const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 0.2);

		return { center: [cx, cy, cz] as [number, number, number], size };
	});

	const cameraDistance = $derived(sceneBounds.size * 2.5);
	const axesSize = $derived(sceneBounds.size * 0.3);
	const wireColor = $derived($theme === 'light' ? '#4a7fcf' : '#6a9fff');

	// Dispose old geometries
	let prevFixtureGeo: THREE.BufferGeometry | null = null;
	let prevSurfaceGeo: THREE.BufferGeometry | null = null;
	$effect(() => {
		const fg = fixtureGeometry;
		if (prevFixtureGeo && prevFixtureGeo !== fg) prevFixtureGeo.dispose();
		prevFixtureGeo = fg;
		return () => { prevFixtureGeo?.dispose(); };
	});
	$effect(() => {
		const sg = surfacePointsGeometry;
		if (prevSurfaceGeo && prevSurfaceGeo !== sg) prevSurfaceGeo.dispose();
		prevSurfaceGeo = sg;
		return () => { prevSurfaceGeo?.dispose(); };
	});
</script>

<!-- Camera + controls -->
<T.PerspectiveCamera
	makeDefault
	position={[
		sceneBounds.center[0] + cameraDistance * 0.7,
		sceneBounds.center[1] + cameraDistance * 0.5,
		sceneBounds.center[2] + cameraDistance * 0.7
	]}
	fov={50}
>
	<OrbitControls
		enableDamping
		dampingFactor={0.1}
		target={sceneBounds.center}
	/>
</T.PerspectiveCamera>

<!-- Lighting -->
<T.AmbientLight intensity={0.5} />
<T.DirectionalLight position={[10, 20, 10]} intensity={0.7} />
<T.DirectionalLight position={[-10, 10, -10]} intensity={0.3} />

<!-- Axes helper -->
<T.AxesHelper args={[axesSize]} position={[-cameraDistance * 0.35, 0, -cameraDistance * 0.35]} />

<!-- Fixture wireframe -->
{#if fixtureGeometry}
	<T.LineSegments geometry={fixtureGeometry}>
		<T.LineBasicMaterial color={wireColor} linewidth={2} />
	</T.LineSegments>
{/if}

<!-- Surface points -->
{#if surfacePointsGeometry}
	<T.Points geometry={surfacePointsGeometry}>
		<T.PointsMaterial
			color="#22d3ee"
			size={0.015}
			transparent
			opacity={0.9}
			sizeAttenuation={true}
		/>
	</T.Points>
{/if}

<!-- Luminous opening plane -->
{#if hasLuminousOpening}
	<T.Mesh rotation={[-Math.PI / 2, 0, 0]}>
		<T.PlaneGeometry args={[sourceWidth ?? 0, sourceLength ?? 0]} />
		<T.MeshStandardMaterial
			color="#22d3ee"
			transparent
			opacity={0.35}
			side={THREE.DoubleSide}
			depthWrite={false}
		/>
	</T.Mesh>
{/if}

<!-- Fallback: placeholder axes if nothing to show -->
{#if !fixtureGeometry && !hasLuminousOpening && !surfacePointsGeometry}
	<T.Mesh>
		<T.SphereGeometry args={[0.02, 8, 8]} />
		<T.MeshBasicMaterial color="#888888" />
	</T.Mesh>
{/if}
