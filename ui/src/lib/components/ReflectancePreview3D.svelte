<script lang="ts">
	import { T, useThrelte } from '@threlte/core';
	import { OrbitControls, interactivity } from '@threlte/extras';
	import * as THREE from 'three';
	import { theme } from '$lib/stores/theme';
	import type { RoomConfig, SurfaceNumPointsAll, SceneObject } from '$lib/types/project';
	import { roomVertices, wallIdsFor, pointInPolygon, polygonBoundingBox } from '$lib/utils/roomGeometry';
	import { localFootprint } from '$lib/utils/objectGeometry';
	import { objectFaceIds, planeKey, faceNumPoints } from '$lib/utils/objectFaces';
	import RoomAxes from './RoomAxes.svelte';

	interface Props {
		/** Room outline (x/y extents, shape, vertices) and height */
		room: Pick<RoomConfig, 'x' | 'y' | 'z' | 'shape' | 'vertices'>;
		/** Per-room-surface grid counts */
		numPoints: SurfaceNumPointsAll;
		/** Obstacles, each drawn as its individual faces */
		objects?: SceneObject[];
		/** Whether to draw the calculation grid dots */
		showPoints?: boolean;
		/** Highlighted plane: a room surface id or "{objectId}:{faceId}" */
		selectedSurface: string | null;
		/** The selection changed: a plane key, or null after cycling past the last one */
		onSelect?: (key: string | null) => void;
	}

	let { room, numPoints, objects = [], showPoints = false, selectedSurface, onSelect }: Props = $props();

	interactivity();

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

	// Room surface definitions: key + geometry + (for floor/ceiling) placement,
	// plus the outward normal in three.js coords (used to resolve clicks).
	interface SurfaceDef {
		key: string;
		geometry: THREE.BufferGeometry;
		position: [number, number, number];
		rotation: [number, number, number];
		outward: THREE.Vector3;
	}

	const surfaces = $derived.by<SurfaceDef[]>(() => {
		const defs: SurfaceDef[] = [
			{ key: 'floor',   geometry: floorGeometry, position: [0, 0.001, 0],      rotation: [-Math.PI / 2, 0, 0], outward: new THREE.Vector3(0, -1, 0) },
			{ key: 'ceiling', geometry: floorGeometry, position: [0, rz - 0.001, 0], rotation: [-Math.PI / 2, 0, 0], outward: new THREE.Vector3(0, 1, 0) },
		];
		const n = outline.length;
		for (let i = 0; i < n; i++) {
			const [x1, y1] = outline[i];
			const [x2, y2] = outline[(i + 1) % n];
			// CCW outline: the outward normal of edge (dx, dy) is (dy, -dx) in
			// room coords, which is (dy, 0, dx) once room y maps to three -z.
			const dx = x2 - x1;
			const dy = y2 - y1;
			defs.push({
				key: wallIds[i],
				geometry: wallQuad(x1, y1, x2, y2),
				position: [0, 0, 0],
				rotation: [0, 0, 0],
				outward: new THREE.Vector3(dy, 0, dx).normalize(),
			});
		}
		return defs;
	});

	// Colors
	const highlightColor = '#22d3ee';
	const baseColor = $derived($theme === 'light' ? '#a0a8b0' : '#4a5568');
	const objectColor = $derived(wireColor);
	const pointColor = $derived($theme === 'light' ? '#555555' : '#aaaaaa');

	// Point size
	const pointSize = $derived(Math.max(0.02, maxDim * 0.012));

	// Generate grid points for a room surface (offset grid: cell centres,
	// matching guv_calcs offset=True). Floor/ceiling grids span the bounding
	// box and are masked to the outline; wall grids run along the edge and up
	// the height.
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

	// Build room point geometries reactively (only when shown)
	const pointGeometries = $derived.by(() => {
		const geos: Record<string, THREE.BufferGeometry> = {};
		if (!showPoints) return geos;
		for (const s of surfaces) {
			const geo = new THREE.BufferGeometry();
			geo.setAttribute('position', new THREE.BufferAttribute(generateGridPoints(s.key), 3));
			geos[s.key] = geo;
		}
		return geos;
	});

	// ---- Object faces ----
	//
	// Faces are authored in the object's local frame (room axes: x right, y
	// into the room, z up, footprint centred on the origin, base at z = 0) and
	// placed inside a group rotated -90° about X — the same transform chain
	// SceneObject3D uses, so yaw/pitch/roll match guv_calcs' Rz·Ry·Rx.
	const ROOM_TO_THREE = -Math.PI / 2;

	interface FaceDef {
		key: string;
		geometry: THREE.BufferGeometry;
		points: THREE.BufferGeometry | null;
	}

	interface ObjectDef {
		object: SceneObject;
		position: [number, number, number];
		rotation: THREE.Euler;
		faces: FaceDef[];
		edges: THREE.BufferGeometry;
	}

	// Wireframe in the object's local frame: bottom loop, top loop, verticals.
	function objectEdges(footprint: [number, number][], height: number): THREE.BufferGeometry {
		const positions: number[] = [];
		const n = footprint.length;
		for (let i = 0; i < n; i++) {
			const [x1, y1] = footprint[i];
			const [x2, y2] = footprint[(i + 1) % n];
			positions.push(x1, y1, 0, x2, y2, 0);
			positions.push(x1, y1, height, x2, y2, height);
			positions.push(x1, y1, 0, x1, y1, height);
		}
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
		return geo;
	}

	function faceGrid(obj: SceneObject, faceId: string, footprint: [number, number][]): Float32Array {
		const np = faceNumPoints(obj, faceId);
		const npx = Math.min(np.x, 30);
		const npy = Math.min(np.y, 30);
		const positions: number[] = [];
		if (faceId === 'bottom' || faceId === 'top') {
			const bb = polygonBoundingBox(footprint);
			const h = faceId === 'bottom' ? 0 : obj.height;
			for (let i = 0; i < npx; i++) {
				for (let j = 0; j < npy; j++) {
					const x = bb.xMin + ((i + 0.5) / npx) * (bb.xMax - bb.xMin);
					const y = bb.yMin + ((j + 0.5) / npy) * (bb.yMax - bb.yMin);
					if (!pointInPolygon(footprint, x, y)) continue;
					positions.push(x, y, h);
				}
			}
			return new Float32Array(positions);
		}
		const m = /^wall_(\d+)$/.exec(faceId);
		const edge = m ? Number(m[1]) : -1;
		if (edge < 0 || edge >= footprint.length) return new Float32Array(0);
		const [x1, y1] = footprint[edge];
		const [x2, y2] = footprint[(edge + 1) % footprint.length];
		for (let i = 0; i < npx; i++) {
			const u = (i + 0.5) / npx;
			for (let j = 0; j < npy; j++) {
				const v = (j + 0.5) / npy;
				positions.push(x1 + (x2 - x1) * u, y1 + (y2 - y1) * u, v * obj.height);
			}
		}
		return new Float32Array(positions);
	}

	function faceGeometry(obj: SceneObject, faceId: string, footprint: [number, number][]): THREE.BufferGeometry {
		if (faceId === 'bottom' || faceId === 'top') {
			const shape = new THREE.Shape(footprint.map(([x, y]) => new THREE.Vector2(x, y)));
			const geo = new THREE.ShapeGeometry(shape);
			if (faceId === 'top') geo.translate(0, 0, obj.height);
			return geo;
		}
		const m = /^wall_(\d+)$/.exec(faceId);
		const edge = m ? Number(m[1]) : 0;
		const [x1, y1] = footprint[edge % footprint.length];
		const [x2, y2] = footprint[(edge + 1) % footprint.length];
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.Float32BufferAttribute([
			x1, y1, 0,
			x2, y2, 0,
			x2, y2, obj.height,
			x1, y1, obj.height,
		], 3));
		geo.setIndex([0, 1, 2, 0, 2, 3]);
		geo.computeVertexNormals();
		return geo;
	}

	const objectDefs = $derived.by<ObjectDef[]>(() => {
		const toRad = Math.PI / 180;
		return objects.map((obj) => {
			const footprint = localFootprint(obj);
			const faces: FaceDef[] = objectFaceIds(obj).map((faceId) => {
				let points: THREE.BufferGeometry | null = null;
				if (showPoints) {
					points = new THREE.BufferGeometry();
					points.setAttribute('position', new THREE.BufferAttribute(faceGrid(obj, faceId, footprint), 3));
				}
				return { key: planeKey(obj.id, faceId), geometry: faceGeometry(obj, faceId, footprint), points };
			});
			return {
				object: obj,
				position: [obj.x, obj.y, obj.z] as [number, number, number],
				rotation: new THREE.Euler(obj.roll * toRad, obj.pitch * toRad, obj.yaw * toRad, 'ZYX'),
				faces,
				edges: objectEdges(footprint, obj.height),
			};
		});
	});

	// ---- Click vs. orbit drag ----
	let pointerDown: [number, number] | null = null;
	function onPointerDown(event: any) {
		const e = event.nativeEvent as PointerEvent | undefined;
		pointerDown = e ? [e.clientX, e.clientY] : null;
	}

	// Every plane under the cursor, in the order a click cycles through them:
	// obstacle faces nearest first, then the room surfaces the ray leaves
	// through (the ones seen from inside), then the transparent near walls it
	// entered through. The room encloses everything, so without this order the
	// nearest hit would always be a near wall.
	function candidatesAt(event: any): string[] {
		const dir: THREE.Vector3 | undefined = event.ray?.direction;
		const faces: string[] = [];
		const exits: string[] = [];
		const entries: string[] = [];
		for (const hit of event.intersections ?? []) {
			const data = hit.object?.userData ?? {};
			if (data.planeKind === 'face') {
				faces.push(data.planeKey as string);
			} else if (data.planeKind === 'room') {
				const outward = data.outward as THREE.Vector3 | undefined;
				const entering = dir && outward && dir.dot(outward) < 0;
				(entering ? entries : exits).push(data.planeKey as string);
			}
		}
		const ordered = [...faces, ...exits, ...entries];
		return ordered.filter((k, i) => ordered.indexOf(k) === i);
	}

	// Same click pattern as the main 3D view: the first click at a spot selects
	// the top candidate, clicking the same spot again moves to the next one,
	// and past the last one the selection clears.
	function onClick(event: any) {
		const e = event.nativeEvent as MouseEvent | undefined;
		if (pointerDown && e && Math.hypot(e.clientX - pointerDown[0], e.clientY - pointerDown[1]) > 5) return;
		event.stopPropagation();
		const candidates = candidatesAt(event);
		if (candidates.length === 0) return;
		const current = selectedSurface ? candidates.indexOf(selectedSurface) : -1;
		if (current === -1) onSelect?.(candidates[0]);
		else onSelect?.(current + 1 < candidates.length ? candidates[current + 1] : null);
	}

	// ---- Dispose old geometries when they change ----
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
			for (const geo of Object.values(current)) geo.dispose();
		};
	});
	$effect(() => {
		const current = objectDefs;
		return () => {
			for (const o of current) {
				o.edges.dispose();
				for (const f of o.faces) {
					f.geometry.dispose();
					f.points?.dispose();
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

<!-- Axes helper (uses RoomAxes for correct room-coordinate orientation) -->
<RoomAxes axisLength={maxDim * 0.15} />

<!-- Room wireframe -->
<T.LineSegments>
	<T is={edgesGeometry} />
	<T.LineBasicMaterial color={wireColor} linewidth={2} />
</T.LineSegments>

<!-- Room surface planes -->
{#each surfaces as surf (surf.key)}
	<T.Mesh
		position={surf.position}
		rotation={surf.rotation}
		userData={{ planeKind: 'room', planeKey: surf.key, outward: surf.outward }}
		onpointerdown={onPointerDown}
		onclick={onClick}
		oncreate={(ref) => { ref.cursor = 'pointer'; }}
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

<!-- Room grid points -->
{#if showPoints}
	{#each surfaces as surf (surf.key)}
		{#if pointGeometries[surf.key]}
			<T.Points geometry={pointGeometries[surf.key]}>
				<T.PointsMaterial
					color={selectedSurface === surf.key ? highlightColor : pointColor}
					size={pointSize}
					transparent
					opacity={selectedSurface === surf.key ? 0.9 : 0.4}
					sizeAttenuation={true}
				/>
			</T.Points>
		{/if}
	{/each}
{/if}

<!-- Obstacle faces -->
<T.Group rotation.x={ROOM_TO_THREE}>
	{#each objectDefs as def (def.object.id)}
		<T.Group position={def.position} rotation={[def.rotation.x, def.rotation.y, def.rotation.z, 'ZYX']}>
			<T.LineSegments>
				<T is={def.edges} />
				<T.LineBasicMaterial color={wireColor} transparent opacity={def.object.enabled === false ? 0.4 : 1} />
			</T.LineSegments>
			{#each def.faces as face (face.key)}
				<T.Mesh
					userData={{ planeKind: 'face', planeKey: face.key }}
					onpointerdown={onPointerDown}
					onclick={onClick}
					oncreate={(ref) => { ref.cursor = 'pointer'; }}
				>
					<T is={face.geometry} />
					<T.MeshStandardMaterial
						color={selectedSurface === face.key ? highlightColor : objectColor}
						transparent
						opacity={selectedSurface === face.key ? 0.8 : (def.object.enabled === false ? 0.1 : 0.3)}
						side={THREE.DoubleSide}
						depthWrite={false}
					/>
				</T.Mesh>
				{#if showPoints && face.points}
					<T.Points geometry={face.points}>
						<T.PointsMaterial
							color={selectedSurface === face.key ? highlightColor : pointColor}
							size={pointSize}
							transparent
							opacity={selectedSurface === face.key ? 0.9 : 0.4}
							sizeAttenuation={true}
						/>
					</T.Points>
				{/if}
			{/each}
		</T.Group>
	{/each}
</T.Group>
