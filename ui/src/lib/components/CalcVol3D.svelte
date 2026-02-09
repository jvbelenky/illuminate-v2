<script lang="ts">
	import { T } from '@threlte/core';
	import * as THREE from 'three';
	import type { CalcZone, RoomConfig } from '$lib/types/project';
	import { buildIsosurfaces, getIsosurfaceColor, type IsosurfaceData } from '$lib/utils/isosurface';

	interface Props {
		zone: CalcZone;
		room: RoomConfig;
		scale: number;
		values?: number[][][];  // 3D grid of values if calculated
		selected?: boolean;
		onclick?: () => void;
	}

	let { zone, room, scale, values, selected = false, onclick }: Props = $props();

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

	// Derive geometry - rebuilds when zone or room changes
	const geometry = $derived(buildGeometry());

	// Derive isosurface data - rebuilds when values or colormap change
	const isosurfaces = $derived(buildIsosurfaceData(colormap));
	const hasValues = $derived(values && values.length > 0);

	// Color scheme: grey=disabled, purple=selected, blue=enabled
	const lineColor = $derived(
		zone.enabled === false ? '#888888' :
		selected ? '#a855f7' :
		'#3b82f6'
	);

	// Opacity levels for nested shells (innermost to outermost)
	// Lower values for inner shells so outer shells are more visible
	const opacityLevels = [0.25, 0.2, 0.15];
</script>

{#if zone.enabled !== false}
	{#if hasValues && isosurfaces && zone.show_values !== false}
		<!-- Isosurface shells when calculated and show_values is true -->
		{#each isosurfaces as iso, index}
			{@const color = getIsosurfaceColor(iso.normalizedLevel, colormap)}
			{@const opacity = opacityLevels[index] ?? 0.15}
			<T.Mesh geometry={iso.geometry} renderOrder={1} onclick={onclick} oncreate={(ref) => { if (onclick) ref.cursor = 'pointer'; }}>
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
				dashSize={0.15}
				gapSize={0.1}
				linewidth={1}
				opacity={0.5}
				transparent
			/>
		</T.LineSegments>
	{:else}
		<!-- Volume boundary wireframe (dashed) when no values -->
		<T.LineSegments
			position={geometry.position}
			geometry={geometry.edges}
			oncreate={(ref) => { ref.computeLineDistances(); }}
		>
			<T.LineDashedMaterial
				color={lineColor}
				dashSize={0.15}
				gapSize={0.1}
				linewidth={1}
			/>
		</T.LineSegments>

		<!-- Semi-transparent box to show volume bounds -->
		<T.Mesh position={geometry.position} onclick={onclick} oncreate={(ref) => { if (onclick) ref.cursor = 'pointer'; }}>
			<T.BoxGeometry args={[geometry.width, geometry.height, geometry.depth]} />
			<T.MeshBasicMaterial color={lineColor} transparent opacity={0.05} depthWrite={false} />
		</T.Mesh>
	{/if}
{/if}
