<script lang="ts">
	import { T } from '@threlte/core';
	import * as THREE from 'three';
	import type { CalcZone, RoomConfig } from '$lib/types/project';

	interface Props {
		zone: CalcZone;
		room: RoomConfig;
		scale: number;
		selected?: boolean;
	}

	let { zone, room, scale, selected = false }: Props = $props();

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

	// Color scheme: grey=disabled, purple=selected, blue=enabled
	const lineColor = $derived(
		zone.enabled === false ? '#888888' :
		selected ? '#a855f7' :
		'#3b82f6'
	);
</script>

{#if zone.enabled !== false}
	<!-- Volume boundary wireframe (dashed) -->
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
	<T.Mesh position={geometry.position}>
		<T.BoxGeometry args={[geometry.width, geometry.height, geometry.depth]} />
		<T.MeshBasicMaterial color={lineColor} transparent opacity={0.05} depthWrite={false} />
	</T.Mesh>
{/if}
