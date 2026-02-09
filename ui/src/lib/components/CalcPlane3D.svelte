<script lang="ts">
	import { T } from '@threlte/core';
	import * as THREE from 'three';
	import type { CalcZone, RoomConfig, PlaneCalcType, RefSurface } from '$lib/types/project';
	import { valueToColor } from '$lib/utils/colormaps';

	const MARKER_RADIUS = 0.03;
	const MARKER_SEGMENTS = 12;

	interface Props {
		zone: CalcZone;
		room: RoomConfig;
		scale: number;
		values?: number[][];  // 2D grid of values if calculated
		selected?: boolean;
		highlighted?: boolean;
		onclick?: () => void;
	}

	let { zone, room, scale, values, selected = false, highlighted = false, onclick }: Props = $props();

	// Color scheme: grey=disabled, gold=highlighted, magenta=selected, blue=enabled
	const pointColor = $derived(
		zone.enabled === false ? '#888888' :
		highlighted ? '#facc15' :
		selected ? '#e879f9' :
		'#3b82f6'
	);

	// Higher opacity when highlighted or selected for visibility
	const heatmapOpacity = $derived(highlighted ? 0.95 : selected ? 0.9 : 0.8);

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

	// Get the plane normal direction in Three.js coordinates (Y-up)
	function getPlaneNormal(ref: RefSurface, direction: number): THREE.Vector3 {
		const dir = direction || 1;
		switch (ref) {
			case 'xy': return new THREE.Vector3(0, dir, 0);   // normal along Three.js Y (room Z)
			case 'xz': return new THREE.Vector3(0, 0, dir);   // normal along Three.js Z (room Y)
			case 'yz': return new THREE.Vector3(dir, 0, 0);   // normal along Three.js X (room X)
			default:   return new THREE.Vector3(0, dir, 0);
		}
	}

	// Build the appropriate marker geometry for each calc type
	function buildMarkerGeometry(calcType: PlaneCalcType): THREE.BufferGeometry {
		const r = MARKER_RADIUS;
		const s = MARKER_SEGMENTS;
		switch (calcType) {
			case 'fluence_rate':
				return new THREE.SphereGeometry(r, s, 6);
			case 'planar_max':
				return new THREE.SphereGeometry(r, s, 6, 0, Math.PI * 2, 0, Math.PI / 2);
			case 'planar_normal':
				return new THREE.CircleGeometry(r, s);
			case 'vertical':
				return new THREE.CircleGeometry(r, s);
			case 'vertical_dir':
				return new THREE.CircleGeometry(r, s, 0, Math.PI);
			default:
				return new THREE.SphereGeometry(r, s, 6);
		}
	}

	// Build orientation quaternion for each shape based on calc type and plane orientation
	function buildOrientationQuaternion(calcType: PlaneCalcType, ref: RefSurface, direction: number): THREE.Quaternion {
		const q = new THREE.Quaternion();
		switch (calcType) {
			case 'fluence_rate':
				// Sphere — no orientation needed
				return q;
			case 'planar_max': {
				// Dome points along plane normal
				const normal = getPlaneNormal(ref, direction);
				q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
				return q;
			}
			case 'planar_normal': {
				// Flat disc lies horizontal — CircleGeometry faces +Z by default,
				// rotate so it faces +Y (lies flat on XZ plane)
				q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0));
				return q;
			}
			case 'vertical':
				// CircleGeometry is already in XY plane (vertical in Three.js)
				// DoubleSide material handles back-face visibility
				return q;
			case 'vertical_dir': {
				// Half-disc with flat edge facing the normal direction
				const face = getPlaneNormal(ref, direction);
				// Choose an up vector that isn't parallel to face
				let up = new THREE.Vector3(0, 1, 0);
				if (Math.abs(face.dot(up)) > 0.9) {
					up = new THREE.Vector3(0, 0, 1);
				}
				const right = new THREE.Vector3().crossVectors(up, face).normalize();
				up = new THREE.Vector3().crossVectors(face, right).normalize();
				const m = new THREE.Matrix4().makeBasis(right, up, face);
				q.setFromRotationMatrix(m);
				return q;
			}
			default:
				return q;
		}
	}

	// Build an InstancedMesh with shaped markers at each grid position
	function buildInstancedMesh(
		calcType: PlaneCalcType,
		ref: RefSurface,
		direction: number,
		useOffset: boolean,
		color: string
	): THREE.InstancedMesh {
		const bounds = getPlaneBounds();
		const { numU, numV } = getGridDimensions();
		const count = numU * numV;

		const geometry = buildMarkerGeometry(calcType);
		const material = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
		const mesh = new THREE.InstancedMesh(geometry, material, count);

		const orientation = buildOrientationQuaternion(calcType, ref, direction);
		const scaleVec = new THREE.Vector3(scale, scale, scale);
		const mat = new THREE.Matrix4();

		let idx = 0;
		for (let i = 0; i < numU; i++) {
			for (let j = 0; j < numV; j++) {
				const u = useOffset
					? bounds.u1 + ((i + 0.5) / numU) * (bounds.u2 - bounds.u1)
					: bounds.u1 + (i / (numU - 1)) * (bounds.u2 - bounds.u1);
				const v = useOffset
					? bounds.v1 + ((j + 0.5) / numV) * (bounds.v2 - bounds.v1)
					: bounds.v1 + (j / (numV - 1)) * (bounds.v2 - bounds.v1);
				const [wx, wy, wz] = planeToWorld(u, v, bounds.fixed);
				const pos = new THREE.Vector3(wx, wy, wz);
				mat.compose(pos, orientation, scaleVec);
				mesh.setMatrixAt(idx, mat);
				idx++;
			}
		}

		mesh.instanceMatrix.needsUpdate = true;
		return mesh;
	}

	// Reverse-map primitive fields (horiz, vert, direction) to a PlaneCalcType
	// so standard zones (EyeLimits, SkinLimits) get the correct marker shape.
	function deriveCalcType(zone: CalcZone): PlaneCalcType {
		if (zone.calc_type) return zone.calc_type;
		if (zone.horiz) return 'planar_normal';
		if (zone.vert) return zone.direction ? 'vertical_dir' : 'vertical';
		return zone.direction ? 'planar_max' : 'fluence_rate';
	}

	// Derived values
	const useOffset = $derived(zone.offset !== false);
	const markerMesh = $derived(buildInstancedMesh(
		deriveCalcType(zone),
		refSurface,
		zone.direction ?? 0,
		useOffset,
		pointColor
	));
	// Pass colormap and offset to ensure geometry rebuilds when they change
	const surfaceGeometry = $derived(buildSurfaceGeometry(colormap, shouldFlipValues, useOffset));
	const hasValues = $derived(values && values.length > 0);

	// Cleanup instanced mesh resources when it changes
	$effect(() => {
		const mesh = markerMesh;
		return () => {
			mesh.geometry.dispose();
			(mesh.material as THREE.Material).dispose();
		};
	});
</script>

{#if zone.enabled !== false}
	{#if hasValues && surfaceGeometry && zone.show_values !== false}
		<!-- Heatmap surface when calculated and show_values is true -->
		<T.Mesh geometry={surfaceGeometry} renderOrder={1} onclick={onclick} oncreate={(ref) => { if (onclick) ref.cursor = 'pointer'; }}>
			<T.MeshBasicMaterial
				vertexColors
				transparent
				opacity={heatmapOpacity}
				side={THREE.DoubleSide}
				depthWrite={false}
			/>
		</T.Mesh>
	{:else}
		<!-- Shaped markers at grid positions (uncalculated or show_values is false) -->
		<T is={markerMesh} onclick={onclick} oncreate={(ref) => { if (onclick) ref.cursor = 'pointer'; }} />
	{/if}
{/if}
