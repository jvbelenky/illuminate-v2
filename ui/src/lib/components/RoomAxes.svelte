<script lang="ts">
	import { T, useThrelte } from '@threlte/core';
	import { useTask } from '@threlte/core';
	import { Text } from '@threlte/extras';
	import * as THREE from 'three';

	const LABEL_OFFSET = 1.15;

	// The built-in AxesHelper draws: Red=Three.js X, Green=Three.js Y, Blue=Three.js Z
	// Room coordinate mapping: room X→Three.js X, room Y→Three.js Z, room Z→Three.js Y
	// So we label:
	//   Red arrow (Three.js +X) → "X" (room X, correct as-is)
	//   Green arrow (Three.js +Y, up) → "Z" (room Z = height)
	//   Blue arrow (Three.js +Z, depth) → "Y" (room Y = width/depth)
	const labels = [
		{ text: 'X', color: '#ff0000', position: [LABEL_OFFSET, 0, 0] as [number, number, number] },
		{ text: 'Z', color: '#00ff00', position: [0, LABEL_OFFSET, 0] as [number, number, number] },
		{ text: 'Y', color: '#0000ff', position: [0, 0, LABEL_OFFSET] as [number, number, number] },
	];

	const origin: [number, number, number] = [-0.5, 0, 0.5];

	// Billboard: make labels face the camera
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
</script>

<T.Group position={origin} scale={[1, 1, -1]}>
	<T.AxesHelper args={[1]} />

	<T.Group bind:ref={labelsGroup}>
		{#each labels as label}
			<Text
				text={label.text}
				fontSize={0.15}
				color={label.color}
				position={label.position}
				anchorX="center"
				anchorY="middle"
				fontWeight="bold"
			/>
		{/each}
	</T.Group>
</T.Group>
