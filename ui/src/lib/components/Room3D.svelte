<script lang="ts">
	import { T } from '@threlte/core';
	import { Text } from '@threlte/extras';
	import * as THREE from 'three';
	import { theme } from '$lib/stores/theme';
	import type { RoomConfig } from '$lib/types/project';

	interface Props {
		dims: { x: number; y: number; z: number };
		room: RoomConfig;
	}

	let { dims, room }: Props = $props();

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

	// Create wireframe edges for the room box
	// Three.js uses Y-up, so we map: room X -> 3D X, room Y -> 3D Z, room Z -> 3D Y
	const geometry = $derived(new THREE.BoxGeometry(dims.x, dims.z, dims.y));
	const edges = $derived(new THREE.EdgesGeometry(geometry));

	// Room center position
	const position = $derived<[number, number, number]>([dims.x / 2, dims.z / 2, dims.y / 2]);

	// Scale and units for tick labels
	const scale = $derived(room.units === 'feet' ? 0.3048 : 1);
	const units = $derived(room.units === 'feet' ? 'ft' : 'm');

	// Sizing derived from max dimension
	const maxDim = $derived(Math.max(dims.x, dims.y, dims.z));
	const fontSize = $derived(maxDim * 0.04);
	const tickSize = $derived(maxDim * 0.015);

	// Generate tick values for an axis (in original user units)
	function generateTicks(min: number, max: number, count: number = 5): number[] {
		const range = max - min;
		const step = range / (count - 1);
		const ticks: number[] = [];
		for (let i = 0; i < count; i++) {
			ticks.push(min + i * step);
		}
		return ticks;
	}

	// Format tick value for display
	function formatTick(value: number): string {
		if (Math.abs(value) < 0.01) return '0';
		if (Math.abs(value) >= 100) return value.toFixed(0);
		if (Math.abs(value) >= 10) return value.toFixed(1);
		return value.toFixed(2);
	}

	// Tick arrays in original user units
	const xTicks = $derived(generateTicks(0, room.x));
	const yTicks = $derived(generateTicks(0, room.y));
	const zTicks = $derived(generateTicks(0, room.z));
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

<!-- X axis: bottom-front edge (y≈0, z≈0), runs along x -->
<T.Group>
	<!-- Axis line -->
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

	<!-- Tick marks and labels -->
	{#each xTicks as tick}
		{@const xPos = tick * scale}
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
		<Text
			text={formatTick(tick)}
			fontSize={fontSize * 0.7}
			color={colors.tickText}
			position={[xPos, -tickSize * 3, 0]}
			anchorX="center"
			anchorY="top"
		/>
	{/each}

	<!-- Axis title -->
	<Text
		text={`X (${units})`}
		fontSize={fontSize}
		color={colors.tickText}
		position={[dims.x / 2, -tickSize * 5, 0]}
		anchorX="center"
		anchorY="top"
	/>
</T.Group>

<!-- Y axis: bottom-left edge (y≈0, x≈0), runs along Three.js z (room Y) -->
<T.Group>
	<!-- Axis line -->
	<T.Line>
		<T.BufferGeometry>
			<T.BufferAttribute
				attach="attributes-position"
				args={[new Float32Array([
					-tickSize, -tickSize, 0,
					-tickSize, -tickSize, dims.y
				]), 3]}
			/>
		</T.BufferGeometry>
		<T.LineBasicMaterial color={colors.axisLine} />
	</T.Line>

	<!-- Tick marks and labels -->
	{#each yTicks as tick}
		{@const zPos = tick * scale}
		<T.Line>
			<T.BufferGeometry>
				<T.BufferAttribute
					attach="attributes-position"
					args={[new Float32Array([
						-tickSize, -tickSize, zPos,
						-tickSize * 2, -tickSize, zPos
					]), 3]}
				/>
			</T.BufferGeometry>
			<T.LineBasicMaterial color={colors.axisLine} />
		</T.Line>
		<Text
			text={formatTick(tick)}
			fontSize={fontSize * 0.7}
			color={colors.tickText}
			position={[-tickSize * 3, -tickSize, zPos]}
			anchorX="right"
			anchorY="middle"
		/>
	{/each}

	<!-- Axis title -->
	<Text
		text={`Y (${units})`}
		fontSize={fontSize}
		color={colors.tickText}
		position={[-tickSize * 5, -tickSize, dims.y / 2]}
		anchorX="center"
		anchorY="middle"
		rotation={[0, Math.PI / 2, 0]}
	/>
</T.Group>

<!-- Z axis: front-left vertical edge (x≈0, z≈0), runs along Three.js y (room Z / height) -->
<T.Group>
	<!-- Axis line -->
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

	<!-- Tick marks and labels -->
	{#each zTicks as tick}
		{@const yPos = tick * scale}
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
		<Text
			text={formatTick(tick)}
			fontSize={fontSize * 0.7}
			color={colors.tickText}
			position={[-tickSize * 3, yPos, -tickSize]}
			anchorX="right"
			anchorY="middle"
		/>
	{/each}

	<!-- Axis title -->
	<Text
		text={`Z (${units})`}
		fontSize={fontSize}
		color={colors.tickText}
		position={[-tickSize * 5, dims.z / 2, -tickSize]}
		anchorX="center"
		anchorY="middle"
		rotation={[0, 0, Math.PI / 2]}
	/>
</T.Group>
