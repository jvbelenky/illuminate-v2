<script lang="ts">
	import { T } from '@threlte/core';
	import * as THREE from 'three';
	import type { CalcZone, RoomConfig, ZoneDisplayMode } from '$lib/types/project';
	import { buildIsosurfaces, getIsosurfaceColor, type IsosurfaceData } from '$lib/utils/isosurface';
	import { formatValue } from '$lib/utils/formatting';

	interface Props {
		zone: CalcZone;
		room: RoomConfig;
		scale: number;
		values?: number[][][];  // 3D grid of values if calculated
		selected?: boolean;
		highlighted?: boolean;
		onclick?: (event: any) => void;
	}

	let { zone, room, scale, values, selected = false, highlighted = false, onclick }: Props = $props();

	// Get colormap from room config
	const colormap = $derived(room.colormap || 'plasma');

	// Get volume bounds (in room coordinates, not scaled)
	function getVolumeBounds(): { x1: number; x2: number; y1: number; y2: number; z1: number; z2: number } {
		return {
			x1: zone.x_min ?? 0,
			x2: zone.x_max ?? room.x,
			y1: zone.y_min ?? 0,
			y2: zone.y_max ?? room.y,
			z1: zone.z_min ?? 0,
			z2: zone.z_max ?? room.z
		};
	}

	// Build isosurface geometries when values exist
	function buildIsosurfaceData(cm: string): IsosurfaceData[] | null {
		if (!values || values.length === 0) return null;
		const bounds = getVolumeBounds();
		return buildIsosurfaces(values, bounds, scale, cm, 3);
	}

	// Build box geometry and edges - using function pattern like CalcPlane3D
	function buildGeometry(): {
		edges: THREE.EdgesGeometry;
		position: [number, number, number];
		width: number;
		height: number;
		depth: number;
	} {
		// Get volume bounds with fallbacks to room dimensions
		const x1 = (zone.x_min ?? 0) * scale;
		const x2 = (zone.x_max ?? room.x) * scale;
		const y1 = (zone.y_min ?? 0) * scale;
		const y2 = (zone.y_max ?? room.y) * scale;
		const z1 = (zone.z_min ?? 0) * scale;
		const z2 = (zone.z_max ?? room.z) * scale;

		// Box dimensions (width, height, depth in Three.js coords)
		// Note: Three.js uses Y-up, so room Z (height) maps to Three.js Y
		const width = x2 - x1;   // Room X -> Three.js X
		const height = z2 - z1;  // Room Z -> Three.js Y
		const depth = y2 - y1;   // Room Y -> Three.js Z

		// Box center position in Three.js coords
		const position: [number, number, number] = [
			(x1 + x2) / 2,  // X center
			(z1 + z2) / 2,  // Room Z center -> Three.js Y
			(y1 + y2) / 2   // Room Y center -> Three.js Z
		];

		// Create box geometry and extract edges
		const boxGeometry = new THREE.BoxGeometry(width, height, depth);
		const edges = new THREE.EdgesGeometry(boxGeometry);
		// Required for dashed lines to work
		edges.computeBoundingSphere();

		return { edges, position, width, height, depth };
	}

	const MARKER_RADIUS = 0.03;
	const MARKER_SEGMENTS = 12;

	// Get grid dimensions from zone config or derive from spacing
	function getGridDimensions(): { numX: number; numY: number; numZ: number } {
		if (zone.num_x && zone.num_y && zone.num_z) {
			return { numX: zone.num_x, numY: zone.num_y, numZ: zone.num_z };
		}
		const bounds = getVolumeBounds();
		const xRange = bounds.x2 - bounds.x1;
		const yRange = bounds.y2 - bounds.y1;
		const zRange = bounds.z2 - bounds.z1;
		const xSpacing = zone.x_spacing || room.precision || 0.5;
		const ySpacing = zone.y_spacing || room.precision || 0.5;
		const zSpacing = zone.z_spacing || room.precision || 0.5;
		return {
			numX: Math.max(2, Math.ceil(xRange / xSpacing) + 1),
			numY: Math.max(2, Math.ceil(yRange / ySpacing) + 1),
			numZ: Math.max(2, Math.ceil(zRange / zSpacing) + 1)
		};
	}

	// Build an InstancedMesh of spheres at each 3D grid position
	function buildMarkerMesh(useOffset: boolean, color: string): THREE.InstancedMesh {
		const bounds = getVolumeBounds();
		const { numX, numY, numZ } = getGridDimensions();
		const count = numX * numY * numZ;

		const geometry = new THREE.SphereGeometry(MARKER_RADIUS, MARKER_SEGMENTS, 6);
		const material = new THREE.MeshBasicMaterial({ color });
		const mesh = new THREE.InstancedMesh(geometry, material, count);

		const scaleVec = new THREE.Vector3(scale, scale, scale);
		const quat = new THREE.Quaternion();
		const mat = new THREE.Matrix4();

		let idx = 0;
		for (let ix = 0; ix < numX; ix++) {
			const x = useOffset
				? bounds.x1 + ((ix + 0.5) / numX) * (bounds.x2 - bounds.x1)
				: bounds.x1 + (ix / (numX - 1)) * (bounds.x2 - bounds.x1);
			for (let iy = 0; iy < numY; iy++) {
				const y = useOffset
					? bounds.y1 + ((iy + 0.5) / numY) * (bounds.y2 - bounds.y1)
					: bounds.y1 + (iy / (numY - 1)) * (bounds.y2 - bounds.y1);
				for (let iz = 0; iz < numZ; iz++) {
					const z = useOffset
						? bounds.z1 + ((iz + 0.5) / numZ) * (bounds.z2 - bounds.z1)
						: bounds.z1 + (iz / (numZ - 1)) * (bounds.z2 - bounds.z1);
					// Map to Three.js coords: room (x,y,z) -> Three.js (x*scale, z*scale, y*scale)
					const pos = new THREE.Vector3(x * scale, z * scale, y * scale);
					mat.compose(pos, quat, scaleVec);
					mesh.setMatrixAt(idx, mat);
					idx++;
				}
			}
		}

		mesh.instanceMatrix.needsUpdate = true;
		return mesh;
	}

	// Build a group of text sprites at each 3D grid point showing numeric values
	function buildNumericSprites(useOffset: boolean): THREE.Group | null {
		if (!values || values.length === 0) return null;

		const numX = values.length;
		const numY = values[0].length;
		const numZ = values[0][0].length;

		// Skip if grid is too large (text would overlap badly)
		if (numX * numY * numZ > 1000) return null;

		const bounds = getVolumeBounds();
		const group = new THREE.Group();
		const textureCache = new Map<string, THREE.Texture>();
		const decimals = room.precision ?? 1;

		// Canvas size for each label
		const canvasWidth = 256;
		const canvasHeight = 64;

		for (let ix = 0; ix < numX; ix++) {
			const x = useOffset
				? bounds.x1 + ((ix + 0.5) / numX) * (bounds.x2 - bounds.x1)
				: bounds.x1 + (ix / (numX - 1)) * (bounds.x2 - bounds.x1);
			for (let iy = 0; iy < numY; iy++) {
				const y = useOffset
					? bounds.y1 + ((iy + 0.5) / numY) * (bounds.y2 - bounds.y1)
					: bounds.y1 + (iy / (numY - 1)) * (bounds.y2 - bounds.y1);
				for (let iz = 0; iz < numZ; iz++) {
					const z = useOffset
						? bounds.z1 + ((iz + 0.5) / numZ) * (bounds.z2 - bounds.z1)
						: bounds.z1 + (iz / (numZ - 1)) * (bounds.z2 - bounds.z1);

					const val = values[ix][iy][iz];
					const text = formatValue(val, decimals);

					let texture = textureCache.get(text);
					if (!texture) {
						const canvas = document.createElement('canvas');
						canvas.width = canvasWidth;
						canvas.height = canvasHeight;
						const ctx = canvas.getContext('2d')!;
						ctx.clearRect(0, 0, canvasWidth, canvasHeight);
						const fontSize = 36;
						ctx.font = `bold ${fontSize}px monospace`;
						ctx.textAlign = 'center';
						ctx.textBaseline = 'middle';
						// Dark outline for contrast
						ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
						ctx.lineWidth = 4;
						ctx.strokeText(text, canvasWidth / 2, canvasHeight / 2);
						ctx.fillStyle = '#ffffff';
						ctx.fillText(text, canvasWidth / 2, canvasHeight / 2);

						texture = new THREE.CanvasTexture(canvas);
						texture.minFilter = THREE.LinearFilter;
						texture.generateMipmaps = false;
						textureCache.set(text, texture);
					}

					const material = new THREE.SpriteMaterial({
						map: texture,
						transparent: true,
						depthWrite: false
					});
					const sprite = new THREE.Sprite(material);
					// Scale sprite to be readable but not huge
					const spriteScale = 0.15 * scale;
					sprite.scale.set(spriteScale * (canvasWidth / canvasHeight), spriteScale, 1);
					// Map to Three.js coords: room (x,y,z) -> Three.js (x*scale, z*scale, y*scale)
					sprite.position.set(x * scale, z * scale, y * scale);
					group.add(sprite);
				}
			}
		}

		return group;
	}

	// Derive geometry - rebuilds when zone or room changes
	const geometry = $derived(buildGeometry());

	// Resolve display_mode, migrating from legacy show_values
	const displayMode = $derived<ZoneDisplayMode>(
		zone.display_mode ?? (zone.show_values === false ? 'markers' : 'heatmap')
	);

	const useOffset = $derived(zone.offset !== false);

	// Derive isosurface data - rebuilds when values or colormap change
	const isosurfaces = $derived(buildIsosurfaceData(colormap));
	const hasValues = $derived(values && values.length > 0);

	// Color scheme: grey=disabled, light blue=highlighted, magenta=selected, blue=enabled
	const lineColor = $derived(
		zone.enabled === false ? '#888888' :
		highlighted ? '#60a5fa' :
		selected ? '#d946ef' :
		'#3b82f6'
	);

	// Higher opacity for box face when highlighted or selected
	const boxFaceOpacity = $derived(highlighted ? 0.15 : selected ? 0.1 : 0.05);

	// Opacity levels for nested shells (innermost to outermost)
	// Lower values for inner shells so outer shells are more visible
	const opacityLevels = [0.25, 0.2, 0.15];

	// Marker and numeric derived state
	const markerMesh = $derived(buildMarkerMesh(useOffset, lineColor));
	const numericGroup = $derived(displayMode === 'numeric' ? buildNumericSprites(useOffset) : null);

	// Cleanup instanced mesh resources when it changes
	$effect(() => {
		const mesh = markerMesh;
		return () => {
			mesh.geometry.dispose();
			(mesh.material as THREE.Material).dispose();
		};
	});

	// Cleanup numeric sprite resources when they change
	$effect(() => {
		const group = numericGroup;
		return () => {
			if (group) {
				const disposed = new Set<THREE.Texture>();
				group.children.forEach((child) => {
					if (child instanceof THREE.Sprite) {
						const tex = child.material.map;
						if (tex && !disposed.has(tex)) {
							tex.dispose();
							disposed.add(tex);
						}
						child.material.dispose();
					}
				});
			}
		};
	});
</script>

{#if zone.enabled !== false && hasValues && displayMode === 'heatmap' && isosurfaces}
	<!-- Isosurface shells when calculated and in heatmap mode -->
	{#each isosurfaces as iso, index}
		{@const color = getIsosurfaceColor(iso.normalizedLevel, colormap)}
		{@const opacity = opacityLevels[index] ?? 0.15}
		<T.Mesh geometry={iso.geometry} renderOrder={1} onclick={onclick} userData={{ clickType: 'zone', clickId: zone.id }} oncreate={(ref) => { if (onclick) ref.cursor = 'pointer'; }}>
			<T.MeshBasicMaterial
				color={new THREE.Color(color.r, color.g, color.b)}
				transparent
				opacity={opacity}
				side={THREE.DoubleSide}
				depthWrite={false}
			/>
		</T.Mesh>
	{/each}

	<!-- Keep a subtle wireframe to show volume bounds -->
	<T.LineSegments
		position={geometry.position}
		geometry={geometry.edges}
		oncreate={(ref) => { ref.computeLineDistances(); }}
	>
		<T.LineDashedMaterial
			color={lineColor}
			dashSize={0.4}
			gapSize={0.25}
			linewidth={1}
			opacity={0.85}
			transparent
		/>
	</T.LineSegments>
{:else if zone.enabled !== false && hasValues && displayMode === 'numeric' && numericGroup}
	<!-- Numeric text sprites at each grid point -->
	<T is={numericGroup} />

	<!-- Wireframe to show volume bounds -->
	<T.LineSegments
		position={geometry.position}
		geometry={geometry.edges}
		oncreate={(ref) => { ref.computeLineDistances(); }}
	>
		<T.LineDashedMaterial
			color={lineColor}
			dashSize={0.4}
			gapSize={0.25}
			linewidth={1}
		/>
	</T.LineSegments>
{:else if zone.enabled !== false && (displayMode === 'markers' || (displayMode === 'numeric' && !hasValues))}
	<!-- Marker spheres at grid positions (markers mode, or numeric fallback without values) -->
	<T is={markerMesh} onclick={onclick} userData={{ clickType: 'zone', clickId: zone.id }} oncreate={(ref) => { if (onclick) ref.cursor = 'pointer'; }} />

	<!-- Wireframe to show volume bounds -->
	<T.LineSegments
		position={geometry.position}
		geometry={geometry.edges}
		oncreate={(ref) => { ref.computeLineDistances(); }}
	>
		<T.LineDashedMaterial
			color={lineColor}
			dashSize={0.4}
			gapSize={0.25}
			linewidth={1}
		/>
	</T.LineSegments>

	<!-- Semi-transparent box to show volume bounds -->
	<T.Mesh position={geometry.position} onclick={onclick} userData={{ clickType: 'zone', clickId: zone.id }} oncreate={(ref) => { if (onclick) ref.cursor = 'pointer'; }}>
		<T.BoxGeometry args={[geometry.width, geometry.height, geometry.depth]} />
		<T.MeshBasicMaterial color={lineColor} transparent opacity={boxFaceOpacity} depthWrite={false} />
	</T.Mesh>
{:else}
	<!-- Fallback: wireframe + tinted box (heatmap uncalculated, or disabled) -->
	<T.LineSegments
		position={geometry.position}
		geometry={geometry.edges}
		oncreate={(ref) => { ref.computeLineDistances(); }}
	>
		<T.LineDashedMaterial
			color={lineColor}
			dashSize={0.4}
			gapSize={0.25}
			linewidth={1}
		/>
	</T.LineSegments>

	<!-- Semi-transparent box to show volume bounds -->
	<T.Mesh position={geometry.position} onclick={onclick} userData={{ clickType: 'zone', clickId: zone.id }} oncreate={(ref) => { if (onclick) ref.cursor = 'pointer'; }}>
		<T.BoxGeometry args={[geometry.width, geometry.height, geometry.depth]} />
		<T.MeshBasicMaterial color={lineColor} transparent opacity={boxFaceOpacity} depthWrite={false} />
	</T.Mesh>
{/if}
