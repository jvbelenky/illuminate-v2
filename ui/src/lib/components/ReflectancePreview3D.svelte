<script lang="ts">
	import { T, useThrelte } from '@threlte/core';
	import { OrbitControls } from '@threlte/extras';
	import * as THREE from 'three';
	import { theme } from '$lib/stores/theme';
	import type { SurfaceReflectances, SurfaceNumPointsAll } from '$lib/types/project';

	interface Props {
		roomDims: { x: number; y: number; z: number };
		numPoints: SurfaceNumPointsAll;
		selectedSurface: keyof SurfaceReflectances | null;
	}

	let { roomDims, numPoints, selectedSurface }: Props = $props();

	// Room dims in Three.js coords: room X→X, room Y→Z, room Z→Y
	const rx = $derived(roomDims.x);
	const ry = $derived(roomDims.y);
	const rz = $derived(roomDims.z);
	const maxDim = $derived(Math.max(rx, ry, rz));

	// Camera
	const cameraDistance = $derived(maxDim * 1.8);
	const center = $derived<[number, number, number]>([rx / 2, rz / 2, ry / 2]);

	// Scene background
	const { scene } = useThrelte();
	$effect(() => {
		scene.background = new THREE.Color($theme === 'light' ? '#d0d7de' : '#1a1a2e');
	});

	// Wireframe
	const boxGeometry = $derived(new THREE.BoxGeometry(rx, rz, ry));
	const edgesGeometry = $derived(new THREE.EdgesGeometry(boxGeometry));
	const wireColor = $derived($theme === 'light' ? '#4a7fcf' : '#6a9fff');

	// Surface definitions
	type SurfaceKey = keyof SurfaceReflectances;
	interface SurfaceDef {
		key: SurfaceKey;
		position: [number, number, number];
		rotation: [number, number, number];
		size: [number, number];
	}

	const surfaces = $derived<SurfaceDef[]>([
		{ key: 'floor',   position: [rx / 2, 0.001, ry / 2],        rotation: [-Math.PI / 2, 0, 0], size: [rx, ry] },
		{ key: 'ceiling', position: [rx / 2, rz - 0.001, ry / 2],   rotation: [-Math.PI / 2, 0, 0], size: [rx, ry] },
		{ key: 'south',   position: [rx / 2, rz / 2, 0.001],        rotation: [0, 0, 0],             size: [rx, rz] },
		{ key: 'north',   position: [rx / 2, rz / 2, ry - 0.001],   rotation: [0, 0, 0],             size: [rx, rz] },
		{ key: 'west',    position: [0.001, rz / 2, ry / 2],        rotation: [0, Math.PI / 2, 0],   size: [ry, rz] },
		{ key: 'east',    position: [rx - 0.001, rz / 2, ry / 2],   rotation: [0, Math.PI / 2, 0],   size: [ry, rz] },
	]);

	// Colors for surfaces
	const highlightColor = '#22d3ee';
	const baseColor = $derived($theme === 'light' ? '#a0a8b0' : '#4a5568');

	// Point size
	const pointSize = $derived(Math.max(0.02, maxDim * 0.012));

	// Generate grid points for a surface
	function generateGridPoints(surface: SurfaceKey): Float32Array {
		const np = numPoints[surface];
		const npx = Math.min(np.x, 30);
		const npy = Math.min(np.y, 30);

		const positions: number[] = [];
		for (let i = 0; i < npx; i++) {
			for (let j = 0; j < npy; j++) {
				const u = npx > 1 ? i / (npx - 1) : 0.5;
				const v = npy > 1 ? j / (npy - 1) : 0.5;

				// Map UV to 3D position on the surface (Three.js coords)
				switch (surface) {
					case 'floor':
						positions.push(u * rx, 0, v * ry);
						break;
					case 'ceiling':
						positions.push(u * rx, rz, v * ry);
						break;
					case 'south':
						positions.push(u * rx, v * rz, 0);
						break;
					case 'north':
						positions.push(u * rx, v * rz, ry);
						break;
					case 'west':
						positions.push(0, v * rz, u * ry);
						break;
					case 'east':
						positions.push(rx, v * rz, u * ry);
						break;
				}
			}
		}
		return new Float32Array(positions);
	}

	// Build point geometries reactively
	const pointGeometries = $derived.by(() => {
		const geos: Record<string, THREE.BufferGeometry> = {};
		for (const s of surfaces) {
			const geo = new THREE.BufferGeometry();
			geo.setAttribute('position', new THREE.BufferAttribute(generateGridPoints(s.key), 3));
			geos[s.key] = geo;
		}
		return geos;
	});

	// Dispose old geometries when they change
	let prevGeos: Record<string, THREE.BufferGeometry> | null = null;
	$effect(() => {
		const current = pointGeometries;
		if (prevGeos && prevGeos !== current) {
			for (const geo of Object.values(prevGeos)) {
				geo.dispose();
			}
		}
		prevGeos = current;
		return () => {
			if (prevGeos) {
				for (const geo of Object.values(prevGeos)) {
					geo.dispose();
				}
			}
		};
	});
</script>

<!-- Camera + controls -->
<T.PerspectiveCamera
	makeDefault
	position={[center[0] + cameraDistance * 0.7, center[1] + cameraDistance * 0.5, center[2] + cameraDistance * 0.7]}
	fov={50}
>
	<OrbitControls
		enableDamping
		dampingFactor={0.1}
		target={center}
	/>
</T.PerspectiveCamera>

<!-- Lighting -->
<T.AmbientLight intensity={0.5} />
<T.DirectionalLight position={[10, 20, 10]} intensity={0.7} />
<T.DirectionalLight position={[-10, 10, -10]} intensity={0.3} />

<!-- Room wireframe box -->
<T.LineSegments position={center}>
	<T is={edgesGeometry} />
	<T.LineBasicMaterial color={wireColor} linewidth={2} />
</T.LineSegments>

<!-- Surface planes -->
{#each surfaces as surf (surf.key)}
	<T.Mesh
		position={surf.position}
		rotation={surf.rotation}
	>
		<T.PlaneGeometry args={surf.size} />
		<T.MeshStandardMaterial
			color={selectedSurface === surf.key ? highlightColor : baseColor}
			transparent
			opacity={selectedSurface === surf.key ? 0.45 : 0.15}
			side={THREE.DoubleSide}
			depthWrite={false}
		/>
	</T.Mesh>
{/each}

<!-- Grid points on each surface -->
{#each surfaces as surf (surf.key)}
	{#if pointGeometries[surf.key]}
		<T.Points geometry={pointGeometries[surf.key]}>
			<T.PointsMaterial
				color={selectedSurface === surf.key ? highlightColor : '#888888'}
				size={pointSize}
				transparent
				opacity={selectedSurface === surf.key ? 0.9 : 0.4}
				sizeAttenuation={true}
			/>
		</T.Points>
	{/if}
{/each}
