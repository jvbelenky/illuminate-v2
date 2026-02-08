<script lang="ts">
	import { T } from '@threlte/core';
	import * as THREE from 'three';
	import type { CalcZone, RoomConfig } from '$lib/types/project';
	import { valueToColor } from '$lib/utils/colormaps';

	interface Props {
		zone: CalcZone;
		room: RoomConfig;
		scale: number;
		values?: number[][];  // 2D grid of values if calculated
		selected?: boolean;
	}

	let { zone, room, scale, values, selected = false }: Props = $props();

	// Color scheme: grey=disabled, purple=selected, blue=enabled
	const pointColor = $derived(
		zone.enabled === false ? '#888888' :
		selected ? '#a855f7' :
		'#3b82f6'
	);

	// Get colormap from room config
	const colormap = $derived(room.colormap || 'plasma');

	// Reference surface determines plane orientation
	const refSurface = $derived(zone.ref_surface || 'xy');

	// Determine if we need to flip the V index when reading values
	// Use v_positive_direction from geometry if available, otherwise compute from ref_surface/direction
	const shouldFlipValues = $derived.by(() => {
		// Prefer the computed value from backend geometry
		if (zone.v_positive_direction !== undefined) {
			// When v points negative, values are ordered opposite to world coordinates
			return !zone.v_positive_direction;
		}
		// Fallback: compute from ref_surface and direction (for axis-aligned planes)
		const direction = zone.direction ?? 1;
		if (refSurface === 'xz') {
			// XZ: v points +Z when direction=-1, -Z when direction=1
			// Flip when v points -Z (direction > 0)
			return direction > 0;
		}
		// XY and YZ: v points positive when direction=1, flip when negative
		return direction < 0;
	});

	// Get plane bounds based on reference surface
	function getPlaneBounds(): { u1: number; u2: number; v1: number; v2: number; fixed: number } {
		const height = zone.height ?? 0;

		switch (refSurface) {
			case 'xz':
				// Vertical plane perpendicular to Y axis
				// U = X, V = Z, fixed = Y (height)
				return {
					u1: zone.x1 ?? 0,
					u2: zone.x2 ?? room.x,
					v1: zone.z_min ?? 0,
					v2: zone.z_max ?? room.z,
					fixed: height
				};
			case 'yz':
				// Vertical plane perpendicular to X axis
				// U = Y, V = Z, fixed = X (height)
				return {
					u1: zone.y1 ?? 0,
					u2: zone.y2 ?? room.y,
					v1: zone.z_min ?? 0,
					v2: zone.z_max ?? room.z,
					fixed: height
				};
			case 'xy':
			default:
				// Horizontal plane at constant Z
				// U = X, V = Y, fixed = Z (height)
				return {
					u1: zone.x1 ?? 0,
					u2: zone.x2 ?? room.x,
					v1: zone.y1 ?? 0,
					v2: zone.y2 ?? room.y,
					fixed: height
				};
		}
	}

	// Get grid dimensions from zone or calculate defaults
	function getGridDimensions(): { numU: number; numV: number } {
		if (zone.num_x && zone.num_y) {
			return { numU: zone.num_x, numV: zone.num_y };
		}
		// Fallback: derive from spacing or room.precision
		const bounds = getPlaneBounds();
		const uRange = bounds.u2 - bounds.u1;
		const vRange = bounds.v2 - bounds.v1;
		const uSpacing = zone.x_spacing || room.precision || 0.5;
		const vSpacing = zone.y_spacing || room.precision || 0.5;
		return {
			numU: Math.max(2, Math.ceil(uRange / uSpacing) + 1),
			numV: Math.max(2, Math.ceil(vRange / vSpacing) + 1)
		};
	}

	// Convert plane coordinates (u, v) to Three.js world coordinates (x, y, z)
	// Note: Three.js uses Y-up, so room Y becomes Three.js Z
	function planeToWorld(u: number, v: number, fixed: number): [number, number, number] {
		switch (refSurface) {
			case 'xz':
				// u=X, v=Z, fixed=Y -> Three.js: (X, Z, Y)
				return [u * scale, v * scale, fixed * scale];
			case 'yz':
				// u=Y, v=Z, fixed=X -> Three.js: (X, Z, Y)
				return [fixed * scale, v * scale, u * scale];
			case 'xy':
			default:
				// u=X, v=Y, fixed=Z -> Three.js: (X, Z, Y)
				return [u * scale, fixed * scale, v * scale];
		}
	}

	// Build geometry for heatmap surface when values exist
	// Takes colormap and flipV as parameters to ensure reactivity when they change
	function buildSurfaceGeometry(cm: string, flipV: boolean, useOffset: boolean): THREE.BufferGeometry | null {
		if (!values || values.length === 0) return null;

		const bounds = getPlaneBounds();
		const numU = values.length;
		const numV = values[0].length;

		const geometry = new THREE.BufferGeometry();
		const positions: number[] = [];
		const colors: number[] = [];
		const indices: number[] = [];

		// Find value range for color mapping
		const flatValues = values.flat();
		const minVal = Math.min(...flatValues);
		const maxVal = Math.max(...flatValues);
		const range = maxVal - minVal || 1;

		// Create vertices with colors based on values
		for (let i = 0; i < numU; i++) {
			for (let j = 0; j < numV; j++) {
				const u = useOffset
					? bounds.u1 + ((i + 0.5) / numU) * (bounds.u2 - bounds.u1)
					: bounds.u1 + (i / (numU - 1)) * (bounds.u2 - bounds.u1);
				const v = useOffset
					? bounds.v1 + ((j + 0.5) / numV) * (bounds.v2 - bounds.v1)
					: bounds.v1 + (j / (numV - 1)) * (bounds.v2 - bounds.v1);
				const [wx, wy, wz] = planeToWorld(u, v, bounds.fixed);
				positions.push(wx, wy, wz);

				// Color based on value using the room's colormap
				// Flip V index when v axis points in negative direction (values ordered opposite to world coords)
				const valueJ = flipV ? (numV - 1 - j) : j;
				const val = values[i][valueJ];
				const t = (val - minVal) / range;
				const color = valueToColor(t, cm);
				colors.push(color.r, color.g, color.b);
			}
		}

		// Create triangle indices
		for (let i = 0; i < numU - 1; i++) {
			for (let j = 0; j < numV - 1; j++) {
				const a = i * numV + j;
				const b = i * numV + (j + 1);
				const c = (i + 1) * numV + j;
				const d = (i + 1) * numV + (j + 1);
				indices.push(a, b, c);
				indices.push(b, d, c);
			}
		}

		geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
		geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
		geometry.setIndex(indices);
		geometry.computeVertexNormals();
		geometry.computeBoundingBox();
		geometry.computeBoundingSphere();

		return geometry;
	}

	// Build points geometry for uncalculated zones (much faster than individual meshes)
	function buildPointsGeometry(useOffset: boolean): THREE.BufferGeometry {
		const geometry = new THREE.BufferGeometry();
		const positions: number[] = [];
		const bounds = getPlaneBounds();
		const { numU, numV } = getGridDimensions();

		for (let i = 0; i < numU; i++) {
			for (let j = 0; j < numV; j++) {
				const u = useOffset
					? bounds.u1 + ((i + 0.5) / numU) * (bounds.u2 - bounds.u1)
					: bounds.u1 + (i / (numU - 1)) * (bounds.u2 - bounds.u1);
				const v = useOffset
					? bounds.v1 + ((j + 0.5) / numV) * (bounds.v2 - bounds.v1)
					: bounds.v1 + (j / (numV - 1)) * (bounds.v2 - bounds.v1);
				const [wx, wy, wz] = planeToWorld(u, v, bounds.fixed);
				positions.push(wx, wy, wz);
			}
		}

		geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
		return geometry;
	}

	// Derived values
	const useOffset = $derived(zone.offset !== false);
	const pointsGeometry = $derived(buildPointsGeometry(useOffset));
	// Pass colormap and offset to ensure geometry rebuilds when they change
	const surfaceGeometry = $derived(buildSurfaceGeometry(colormap, shouldFlipValues, useOffset));
	const hasValues = $derived(values && values.length > 0);
</script>

{#if zone.enabled !== false}
	{#if hasValues && surfaceGeometry && zone.show_values !== false}
		<!-- Heatmap surface when calculated and show_values is true -->
		<T.Mesh geometry={surfaceGeometry}>
			<T.MeshBasicMaterial
				vertexColors
				transparent
				opacity={0.8}
				side={THREE.DoubleSide}
				depthWrite={false}
			/>
		</T.Mesh>
	{:else}
		<!-- Points at grid positions (uncalculated or show_values is false) -->
		<T.Points geometry={pointsGeometry}>
			<T.PointsMaterial color={pointColor} size={0.06} sizeAttenuation={true} />
		</T.Points>
	{/if}
{/if}
