<script lang="ts">
	import { T, useThrelte } from '@threlte/core';
	import { useTask } from '@threlte/core';
	import { Text } from '@threlte/extras';
	import * as THREE from 'three';
	import { theme } from '$lib/stores/theme';
	import { userSettings } from '$lib/stores/settings';
	import type { RoomConfig } from '$lib/types/project';
	import { roomVertices, isPolygonRoom } from '$lib/utils/roomGeometry';
	import { boxWireframe } from '$lib/utils/outlineGeometry';
	import { floorplanImage } from '$lib/stores/floorplanImage';
	import { imageRect } from '$lib/utils/floorplanImage';
	import { compositeFloorPlan } from '$lib/utils/floorplanComposite';
	import { FEET_PER_METER } from '$lib/utils/unitConversion';

	interface Props {
		/** Bounding-box extents (rectangle size, or polygon bbox maxima) */
		dims: { x: number; y: number; z: number };
		room: RoomConfig;
	}

	let { dims, room }: Props = $props();

	// Billboard: make all tick labels face the camera
	const { camera } = useThrelte();
	let labelsGroup = $state<THREE.Group | undefined>(undefined);

	// autoInvalidate defaults to true, which would force the renderer to redraw
	// the whole scene every frame forever, even when nothing has changed. The
	// billboard only needs to run before a frame that is already being drawn, so
	// opt out and let camera moves and scene changes drive invalidation.
	useTask(
		() => {
			if (!labelsGroup || !camera.current) return;
			labelsGroup.traverse((child) => {
				if ((child as any).isMesh) {
					child.quaternion.copy(camera.current.quaternion);
				}
			});
		},
		{ autoInvalidate: false }
	);

	// Theme-based colors
	const colors = $derived($theme === 'light' ? {
		wireframe: '#4a7fcf',
		floor: '#a0a8b0',
		ceiling: '#b8c0c8',
		walls: '#a0a8b0',
		axisLine: '#666666',
		tickText: '#333333'
	} : {
		wireframe: '#6a9fff',
		floor: '#2a2a4a',
		ceiling: '#1a1a3a',
		walls: '#2a2a4a',
		axisLine: '#888888',
		tickText: '#cccccc'
	});

	const units = $derived($userSettings.units);

	// Floor outline (CCW). Rectangles and polygons share one code path.
	// Three.js uses Y-up, so we map: room X -> 3D X, room Y -> 3D -Z, room Z -> 3D Y
	const outline = $derived(roomVertices(room));
	const height = $derived(dims.z);

	// Floor/ceiling: a Shape in the XY plane rotated -90° about X lands on XZ
	// with (x, y) -> (x, 0, -y), which is exactly the room -> Three mapping.
	// ShapeGeometry triangulates concave outlines correctly.
	const floorGeometry = $derived.by(() => {
		const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
		return new THREE.ShapeGeometry(shape);
	});

	// --- Floor-plan reference image as a floor texture ---
	const planPlacement = $derived(room.floorplan ?? null);
	const planImage = $derived($floorplanImage && planPlacement && $floorplanImage.id === planPlacement.imageId ? $floorplanImage : null);
	const planSrc = $derived(planImage?.src ?? null);
	const showPlan = $derived((room.showFloorPlanImage ?? true) && planPlacement !== null && planImage !== null);
	let planTexture = $state<THREE.CanvasTexture | null>(null);
	let planImgEl = $state<HTMLImageElement | null>(null);

	// The placement's geometry fields are read one at a time, as scalar deriveds,
	// so that an opacity edit — which mints a new `room.floorplan` object — leaves
	// them all equal and invalidates nothing. Opacity itself is never read here:
	// it flows to the GPU through the material's `opacity` prop alone.
	const planWidthPx = $derived(planPlacement?.widthPx ?? 0);
	const planHeightPx = $derived(planPlacement?.heightPx ?? 0);
	const planScale = $derived(planPlacement?.scale ?? 0);
	const planOffsetX = $derived(planPlacement?.offsetX ?? 0);
	const planOffsetY = $derived(planPlacement?.offsetY ?? 0);
	const planRect = $derived(imageRect(
		{
			imageId: '', opacity: 1,
			widthPx: planWidthPx, heightPx: planHeightPx, scale: planScale,
			offsetX: planOffsetX, offsetY: planOffsetY,
		},
		units === 'feet' ? FEET_PER_METER : 1,
	));

	// Decoding a multi-MB data URL is the expensive half of building the floor
	// texture, so it gets its own effect keyed on the source alone; the decoded
	// <img> is then cached and reused by the compositing effect below.
	$effect(() => {
		const src = planSrc;
		if (!src) { planImgEl = null; return; }
		let cancelled = false;
		const img = new Image();
		img.onload = () => { if (!cancelled) planImgEl = img; };
		img.onerror = () => { if (!cancelled) planImgEl = null; };
		img.src = src;
		return () => { cancelled = true; };
	});

	// Cheap half: re-composite the cached image onto a canvas whenever the
	// placement geometry, the room extents, the units or the visibility change.
	$effect(() => {
		const img = planImgEl;
		const rect = planRect;
		const extents = { x: dims.x, y: dims.y };
		if (!showPlan || !img) { planTexture = null; return; }
		const canvas = compositeFloorPlan(img, extents, rect);
		if (!canvas) { planTexture = null; return; }
		const tex = new THREE.CanvasTexture(canvas);
		tex.colorSpace = THREE.SRGBColorSpace;
		// ShapeGeometry UVs are the vertex XY (display units): map bbox -> [0,1]
		tex.matrixAutoUpdate = false;
		tex.matrix.set(1 / extents.x, 0, 0, 0, 1 / extents.y, 0, 0, 0, 1);
		tex.wrapS = THREE.ClampToEdgeWrapping;
		tex.wrapT = THREE.ClampToEdgeWrapping;
		planTexture = tex;
		return () => {
			tex.dispose();
			planTexture = null;
		};
	});

	// Walls: one quad per edge, all in a single geometry
	const wallGeometry = $derived.by(() => {
		const positions: number[] = [];
		const indices: number[] = [];
		const n = outline.length;
		for (let i = 0; i < n; i++) {
			const [x1, y1] = outline[i];
			const [x2, y2] = outline[(i + 1) % n];
			const base = positions.length / 3;
			positions.push(
				x1, 0, -y1,
				x2, 0, -y2,
				x2, height, -y2,
				x1, height, -y1,
			);
			indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
		}
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
		geo.setIndex(indices);
		geo.computeVertexNormals();
		return geo;
	});

	// Wireframe: floor loop, ceiling loop, verticals
	const edges = $derived.by(() => {
		const positions: number[] = [];
		const n = outline.length;
		for (let i = 0; i < n; i++) {
			const [x1, y1] = outline[i];
			const [x2, y2] = outline[(i + 1) % n];
			positions.push(x1, 0, -y1, x2, 0, -y2);
			positions.push(x1, height, -y1, x2, height, -y2);
			positions.push(x1, 0, -y1, x1, height, -y1);
		}
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
		return geo;
	});

	// Faint bounding-box hint for polygon rooms (the rulers measure this box)
	const showBoundingBox = $derived(isPolygonRoom(room));
	const boundingBoxEdges = $derived(showBoundingBox ? boxWireframe(0, dims.x, 0, dims.y, 0, dims.z) : null);

	// Dispose GPU geometry when reassigned or on unmount
	$effect(() => {
		const geo = boundingBoxEdges;
		return () => { geo?.dispose(); };
	});
	$effect(() => {
		const geo = floorGeometry;
		return () => { geo.dispose(); };
	});
	$effect(() => {
		const geo = wallGeometry;
		return () => { geo.dispose(); };
	});
	$effect(() => {
		const geo = edges;
		return () => { geo.dispose(); };
	});

	// Sizing derived from max dimension
	const maxDim = $derived(Math.max(dims.x, dims.y, dims.z));
	const fontSize = $derived(Math.min(maxDim * 0.04, 0.5));
	const tickSize = $derived(Math.min(maxDim * 0.015, 0.2));

	// Generate "nice" tick values for an axis (in original user units)
	function generateTicks(max: number): number[] {
		const niceSteps = [1, 2, 2.5, 5, 10];
		const rawStep = max / 5;
		const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
		const normalized = rawStep / magnitude;
		const niceNorm = niceSteps.find(s => s >= normalized) ?? 10;
		const step = niceNorm * magnitude;

		const ticks: number[] = [];
		for (let v = 0; v <= max + step * 0.01; v += step) {
			ticks.push(Math.round(v * 1e6) / 1e6);
		}
		return ticks;
	}

	// Format tick value to match room's configured precision
	function formatTick(value: number): string {
		return value.toFixed(room.precision);
	}

	// Tick arrays in display units (show 0 only on X axis to mark the origin once).
	// Rulers follow the bounding box for both shapes.
	const xTicks = $derived(generateTicks(room.x));
	const yTicks = $derived(generateTicks(room.y).filter(t => t > 0));
	const zTicks = $derived(generateTicks(room.z).filter(t => t > 0));
</script>

<!-- Room wireframe -->
<T.LineSegments>
	<T is={edges} />
	<T.LineBasicMaterial color={colors.wireframe} linewidth={2} />
</T.LineSegments>

{#if boundingBoxEdges}
<!-- Very faint bounding box of a polygon room, for reference against the rulers -->
<T.LineSegments>
	<T is={boundingBoxEdges} />
	<T.LineBasicMaterial color={colors.wireframe} transparent opacity={0.12} depthWrite={false} />
</T.LineSegments>
{/if}

<!-- Semi-transparent floor -->
<T.Mesh position={[0, 0.001, 0]} rotation.x={-Math.PI / 2}>
	<T is={floorGeometry} />
	<T.MeshStandardMaterial color={colors.floor} transparent opacity={0.3} side={THREE.DoubleSide} depthWrite={false} />
</T.Mesh>

{#if planTexture}
<!-- Floor-plan reference image, clipped by the floor polygon. It sits above the
	floor grid (y = 0.001) and WRITES depth: the grid is a transparent shader plane
	that may render after this mesh, and without a depth write its lines paint
	straight over the image. -->
<T.Mesh position={[0, 0.03, 0]} rotation.x={-Math.PI / 2} renderOrder={-1}>
	<T is={floorGeometry} />
	<T.MeshBasicMaterial map={planTexture} transparent opacity={planPlacement?.opacity ?? 0.6} depthWrite={true} side={THREE.DoubleSide} />
</T.Mesh>
{/if}

<!-- Semi-transparent ceiling -->
<T.Mesh position={[0, height - 0.001, 0]} rotation.x={-Math.PI / 2}>
	<T is={floorGeometry} />
	<T.MeshStandardMaterial color={colors.ceiling} transparent opacity={0.2} side={THREE.DoubleSide} depthWrite={false} />
</T.Mesh>

<!-- Wall indicators (subtle) -->
<T.Mesh>
	<T is={wallGeometry} />
	<T.MeshStandardMaterial color={colors.walls} transparent opacity={0.1} side={THREE.DoubleSide} depthWrite={false} />
</T.Mesh>

{#if room.showDimensions ?? true}
<!-- Axis lines and tick marks -->

<!-- X axis: bottom-front edge (y≈0, z≈0), runs along x -->
<T.Line>
	<T.BufferGeometry>
		<T.BufferAttribute
			attach="attributes-position"
			args={[new Float32Array([
				0, -tickSize, 0,
				dims.x, -tickSize, 0
			]), 3]}
		/>
	</T.BufferGeometry>
	<T.LineBasicMaterial color={colors.axisLine} />
</T.Line>
{#each xTicks as tick}
	{@const xPos = tick}
	<T.Line>
		<T.BufferGeometry>
			<T.BufferAttribute
				attach="attributes-position"
				args={[new Float32Array([
					xPos, -tickSize, 0,
					xPos, -tickSize * 2, 0
				]), 3]}
			/>
		</T.BufferGeometry>
		<T.LineBasicMaterial color={colors.axisLine} />
	</T.Line>
{/each}

<!-- Y axis: bottom-left edge (y≈0, x≈0), runs along Three.js z (room Y) -->
<T.Line>
	<T.BufferGeometry>
		<T.BufferAttribute
			attach="attributes-position"
			args={[new Float32Array([
				-tickSize, -tickSize, 0,
				-tickSize, -tickSize, -dims.y
			]), 3]}
		/>
	</T.BufferGeometry>
	<T.LineBasicMaterial color={colors.axisLine} />
</T.Line>
{#each yTicks as tick}
	{@const zPos = tick}
	<T.Line>
		<T.BufferGeometry>
			<T.BufferAttribute
				attach="attributes-position"
				args={[new Float32Array([
					-tickSize, -tickSize, -zPos,
					-tickSize * 2, -tickSize, -zPos
				]), 3]}
			/>
		</T.BufferGeometry>
		<T.LineBasicMaterial color={colors.axisLine} />
	</T.Line>
{/each}

<!-- Z axis: front-left vertical edge (x≈0, z≈0), runs along Three.js y (room Z / height) -->
<T.Line>
	<T.BufferGeometry>
		<T.BufferAttribute
			attach="attributes-position"
			args={[new Float32Array([
				-tickSize, 0, -tickSize,
				-tickSize, dims.z, -tickSize
			]), 3]}
		/>
	</T.BufferGeometry>
	<T.LineBasicMaterial color={colors.axisLine} />
</T.Line>
{#each zTicks as tick}
	{@const yPos = tick}
	<T.Line>
		<T.BufferGeometry>
			<T.BufferAttribute
				attach="attributes-position"
				args={[new Float32Array([
					-tickSize, yPos, -tickSize,
					-tickSize * 2, yPos, -tickSize
				]), 3]}
			/>
		</T.BufferGeometry>
		<T.LineBasicMaterial color={colors.axisLine} />
	</T.Line>
{/each}

<!-- Tick labels (billboarded - always face camera) -->
<T.Group bind:ref={labelsGroup}>
	{#each xTicks as tick}
		<Text
			text={formatTick(tick)}
			fontSize={fontSize * 0.7}
			color={colors.tickText}
			position={[tick, -tickSize * 3, 0]}
			anchorX="center"
			anchorY="middle"
		/>
	{/each}
	{#each yTicks as tick}
		<Text
			text={formatTick(tick)}
			fontSize={fontSize * 0.7}
			color={colors.tickText}
			position={[-tickSize * 3, -tickSize, -tick]}
			anchorX="center"
			anchorY="middle"
		/>
	{/each}
	{#each zTicks as tick}
		<Text
			text={formatTick(tick)}
			fontSize={fontSize * 0.7}
			color={colors.tickText}
			position={[-tickSize * 3, tick, -tickSize]}
			anchorX="center"
			anchorY="middle"
		/>
	{/each}

</T.Group>
{/if}
