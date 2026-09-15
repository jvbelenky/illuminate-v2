<script lang="ts">
	import { T, useThrelte } from '@threlte/core';
	import { OrbitControls } from '@threlte/extras';
	import * as THREE from 'three';
	import { theme } from '$lib/stores/theme';
	import type { RoomConfig, SurfaceNumPointsAll } from '$lib/types/project';
	import { roomVertices, wallIdsFor, pointInPolygon } from '$lib/utils/roomGeometry';
	import RoomAxes from './RoomAxes.svelte';

	interface Props {
		/** Room outline (x/y extents, shape, vertices) and height */
		room: Pick<RoomConfig, 'x' | 'y' | 'z' | 'shape' | 'vertices'>;
		numPoints: SurfaceNumPointsAll;
		selectedSurface: string | null;
	}

	let { room, numPoints, selectedSurface }: Props = $props();

	// Room dims in Three.js coords: room X→X, room Y→-Z, room Z→Y
	const rx = $derived(room.x);
	const ry = $derived(room.y);
	const rz = $derived(room.z);
	const maxDim = $derived(Math.max(rx, ry, rz));
	const outline = $derived(roomVertices(room));
	const wallIds = $derived(wallIdsFor(outline));

	// Camera
	const cameraDistance = $derived(maxDim * 1.8);
	const center = $derived<[number, number, number]>([rx / 2, rz / 2, -ry / 2]);

	// Scene background
	const { scene } = useThrelte();
	$effect(() => {
		scene.background = new THREE.Color($theme === 'light' ? '#d0d7de' : '#1a1a2e');
	});

	const wireColor = $derived($theme === 'light' ? '#4a7fcf' : '#6a9fff');

	// Wireframe from the outline: floor loop, ceiling loop, verticals
	const edgesGeometry = $derived.by(() => {
		const positions: number[] = [];
		const n = outline.length;
		for (let i = 0; i < n; i++) {
			const [x1, y1] = outline[i];
			const [x2, y2] = outline[(i + 1) % n];
			positions.push(x1, 0, -y1, x2, 0, -y2);
			positions.push(x1, rz, -y1, x2, rz, -y2);
			positions.push(x1, 0, -y1, x1, rz, -y1);
		}
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
		return geo;
	});

	// Floor/ceiling shape (rotated onto XZ: (x, y) -> (x, 0, -y))
	const floorGeometry = $derived.by(() => {
		const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
		return new THREE.ShapeGeometry(shape);
	});

	function wallQuad(x1: number, y1: number, x2: number, y2: number): THREE.BufferGeometry {
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.Float32BufferAttribute([
			x1, 0, -y1,
			x2, 0, -y2,
			x2, rz, -y2,
			x1, rz, -y1,
		], 3));
		geo.setIndex([0, 1, 2, 0, 2, 3]);
		geo.computeVertexNormals();
		return geo;
	}

	// Surface definitions: key + geometry + (for floor/ceiling) placement
	interface SurfaceDef {
		key: string;
		geometry: THREE.BufferGeometry;
		position: [number, number, number];
		rotation: [number, number, number];
	}

	const surfaces = $derived.by<SurfaceDef[]>(() => {
		const defs: SurfaceDef[] = [
			{ key: 'floor',   geometry: floorGeometry, position: [0, 0.001, 0],      rotation: [-Math.PI / 2, 0, 0] },
			{ key: 'ceiling', geometry: floorGeometry, position: [0, rz - 0.001, 0], rotation: [-Math.PI / 2, 0, 0] },
		];
		const n = outline.length;
		for (let i = 0; i < n; i++) {
			const [x1, y1] = outline[i];
			const [x2, y2] = outline[(i + 1) % n];
			defs.push({ key: wallIds[i], geometry: wallQuad(x1, y1, x2, y2), position: [0, 0, 0], rotation: [0, 0, 0] });
		}
		return defs;
	});

	// Colors for surfaces
	const highlightColor = '#22d3ee';
	const baseColor = $derived($theme === 'light' ? '#a0a8b0' : '#4a5568');

	// Point size
	const pointSize = $derived(Math.max(0.02, maxDim * 0.012));

	// Generate grid points for a surface (offset grid: cell centres, matching
	// guv_calcs offset=True). Floor/ceiling grids span the bounding box and are
	// masked to the outline; wall grids run along the edge and up the height.
	function generateGridPoints(key: string): Float32Array {
		const np = numPoints[key] ?? { x: 10, y: 10 };
		const npx = Math.min(np.x, 30);
		const npy = Math.min(np.y, 30);
		const positions: number[] = [];

		if (key === 'floor' || key === 'ceiling') {
			const h = key === 'floor' ? 0 : rz;
			for (let i = 0; i < npx; i++) {
				for (let j = 0; j < npy; j++) {
					const x = ((i + 0.5) / npx) * rx;
					const y = ((j + 0.5) / npy) * ry;
					if (!pointInPolygon(outline, x, y)) continue;
					positions.push(x, h, -y);
				}
			}
			return new Float32Array(positions);
		}

		const edgeIndex = wallIds.indexOf(key);
		if (edgeIndex < 0) return new Float32Array(0);
		const [x1, y1] = outline[edgeIndex];
		const [x2, y2] = outline[(edgeIndex + 1) % outline.length];
		for (let i = 0; i < npx; i++) {
			const u = (i + 0.5) / npx;
			const x = x1 + (x2 - x1) * u;
			const y = y1 + (y2 - y1) * u;
			for (let j = 0; j < npy; j++) {
				const v = (j + 0.5) / npy;
				positions.push(x, v * rz, -y);
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
	$effect(() => {
		const geo = edgesGeometry;
		return () => { geo.dispose(); };
	});
	$effect(() => {
		const geo = floorGeometry;
		return () => { geo.dispose(); };
	});
	$effect(() => {
		const current = surfaces;
		return () => {
			for (const s of current) {
				if (s.key !== 'floor' && s.key !== 'ceiling') s.geometry.dispose();
			}
		};
	});
	$effect(() => {
		const current = pointGeometries;
		return () => {
			for (const geo of Object.values(current)) {
				geo.dispose();
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

<!-- Axes helper (uses RoomAxes for correct room-coordinate orientation) -->
<RoomAxes axisLength={maxDim * 0.15} />

<!-- Room wireframe -->
<T.LineSegments>
	<T is={edgesGeometry} />
	<T.LineBasicMaterial color={wireColor} linewidth={2} />
</T.LineSegments>

<!-- Surface planes -->
{#each surfaces as surf (surf.key)}
	<T.Mesh
		position={surf.position}
		rotation={surf.rotation}
	>
		<T is={surf.geometry} />
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
