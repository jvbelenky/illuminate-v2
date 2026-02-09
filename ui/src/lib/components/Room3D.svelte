<script lang="ts">
	import { T } from '@threlte/core';
	import * as THREE from 'three';
	import { theme } from '$lib/stores/theme';

	interface Props {
		dims: { x: number; y: number; z: number };
	}

	let { dims }: Props = $props();

	// Theme-based colors
	const colors = $derived($theme === 'light' ? {
		wireframe: '#4a7fcf',
		floor: '#a0a8b0',
		ceiling: '#b8c0c8',
		walls: '#a0a8b0'
	} : {
		wireframe: '#6a9fff',
		floor: '#2a2a4a',
		ceiling: '#1a1a3a',
		walls: '#2a2a4a'
	});

	// Create wireframe edges for the room box
	// Three.js uses Y-up, so we map: room X -> 3D X, room Y -> 3D Z, room Z -> 3D Y
	const geometry = $derived(new THREE.BoxGeometry(dims.x, dims.z, dims.y));
	const edges = $derived(new THREE.EdgesGeometry(geometry));

	// Room center position
	const position = $derived<[number, number, number]>([dims.x / 2, dims.z / 2, dims.y / 2]);
</script>

<!-- Room wireframe box -->
<T.LineSegments {position}>
	<T is={edges} />
	<T.LineBasicMaterial color={colors.wireframe} linewidth={2} />
</T.LineSegments>

<!-- Semi-transparent floor -->
<T.Mesh position={[dims.x / 2, 0.001, dims.y / 2]} rotation.x={-Math.PI / 2}>
	<T.PlaneGeometry args={[dims.x, dims.y]} />
	<T.MeshStandardMaterial color={colors.floor} transparent opacity={0.3} side={THREE.DoubleSide} depthWrite={false} />
</T.Mesh>

<!-- Semi-transparent ceiling -->
<T.Mesh position={[dims.x / 2, dims.z - 0.001, dims.y / 2]} rotation.x={-Math.PI / 2}>
	<T.PlaneGeometry args={[dims.x, dims.y]} />
	<T.MeshStandardMaterial color={colors.ceiling} transparent opacity={0.2} side={THREE.DoubleSide} depthWrite={false} />
</T.Mesh>

<!-- Wall indicators (subtle) -->
<T.Mesh position={[0.001, dims.z / 2, dims.y / 2]} rotation.y={Math.PI / 2}>
	<T.PlaneGeometry args={[dims.y, dims.z]} />
	<T.MeshStandardMaterial color={colors.walls} transparent opacity={0.1} side={THREE.DoubleSide} depthWrite={false} />
</T.Mesh>

<T.Mesh position={[dims.x / 2, dims.z / 2, 0.001]}>
	<T.PlaneGeometry args={[dims.x, dims.z]} />
	<T.MeshStandardMaterial color={colors.walls} transparent opacity={0.1} side={THREE.DoubleSide} depthWrite={false} />
</T.Mesh>
