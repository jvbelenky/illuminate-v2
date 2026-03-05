<script lang="ts">
	import { T, useThrelte } from '@threlte/core';
	import { useTask } from '@threlte/core';
	import { Text } from '@threlte/extras';
	import * as THREE from 'three';
	import { theme } from '$lib/stores/theme';
	import { userSettings } from '$lib/stores/settings';
	import type { RoomConfig } from '$lib/types/project';
	import { toDisplayUnit, fromDisplayUnit } from '$lib/utils/unitConversion';

	interface Props {
		dims: { x: number; y: number; z: number };
		room: RoomConfig;
	}

	let { dims, room }: Props = $props();

	// Billboard: make all tick labels face the camera
	const { camera } = useThrelte();
	let labelsGroup = $state<THREE.Group | null>(null);

	useTask(() => {
		if (!labelsGroup || !camera.current) return;
		labelsGroup.traverse((child) => {
			if ((child as any).isMesh) {
				child.quaternion.copy(camera.current.quaternion);
			}
		});
	});

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

	// Dispose GPU geometry when reassigned or on unmount
	$effect(() => {
		const geo = geometry;
		return () => { geo.dispose(); };
	});
	$effect(() => {
		const geo = edges;
		return () => { geo.dispose(); };
	});

	// Room center position
	const position = $derived<[number, number, number]>([dims.x / 2, dims.z / 2, -dims.y / 2]);

	const units = $derived($userSettings.units);

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

	// Tick arrays in display units (include 0 at the origin)
	const xTicks = $derived(generateTicks(toDisplayUnit(room.x, units)));
	const yTicks = $derived(generateTicks(toDisplayUnit(room.y, units)));
	const zTicks = $derived(generateTicks(toDisplayUnit(room.z, units)));
</script>

<!-- Room wireframe box -->
<T.LineSegments {position}>
	<T is={edges} />
	<T.LineBasicMaterial color={colors.wireframe} linewidth={2} />
</T.LineSegments>

<!-- Semi-transparent floor -->
<T.Mesh position={[dims.x / 2, 0.001, -dims.y / 2]} rotation.x={-Math.PI / 2}>
	<T.PlaneGeometry args={[dims.x, dims.y]} />
	<T.MeshStandardMaterial color={colors.floor} transparent opacity={0.3} side={THREE.DoubleSide} depthWrite={false} />
</T.Mesh>

<!-- Semi-transparent ceiling -->
<T.Mesh position={[dims.x / 2, dims.z - 0.001, -dims.y / 2]} rotation.x={-Math.PI / 2}>
	<T.PlaneGeometry args={[dims.x, dims.y]} />
	<T.MeshStandardMaterial color={colors.ceiling} transparent opacity={0.2} side={THREE.DoubleSide} depthWrite={false} />
</T.Mesh>

<!-- Wall indicators (subtle) -->
<T.Mesh position={[0.001, dims.z / 2, -dims.y / 2]} rotation.y={Math.PI / 2}>
	<T.PlaneGeometry args={[dims.y, dims.z]} />
	<T.MeshStandardMaterial color={colors.walls} transparent opacity={0.1} side={THREE.DoubleSide} depthWrite={false} />
</T.Mesh>

<T.Mesh position={[dims.x / 2, dims.z / 2, 0.001]}>
	<T.PlaneGeometry args={[dims.x, dims.z]} />
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
	{@const xPos = fromDisplayUnit(tick, units)}
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
	{@const zPos = fromDisplayUnit(tick, units)}
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
	{@const yPos = fromDisplayUnit(tick, units)}
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
			position={[fromDisplayUnit(tick, units), -tickSize * 3, 0]}
			anchorX="center"
			anchorY="middle"
		/>
	{/each}
	{#each yTicks as tick}
		<Text
			text={formatTick(tick)}
			fontSize={fontSize * 0.7}
			color={colors.tickText}
			position={[-tickSize * 3, -tickSize, -fromDisplayUnit(tick, units)]}
			anchorX="center"
			anchorY="middle"
		/>
	{/each}
	{#each zTicks as tick}
		<Text
			text={formatTick(tick)}
			fontSize={fontSize * 0.7}
			color={colors.tickText}
			position={[-tickSize * 3, fromDisplayUnit(tick, units), -tickSize]}
			anchorX="center"
			anchorY="middle"
		/>
	{/each}

</T.Group>
{/if}
