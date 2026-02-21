<script lang="ts">
	import { T, useThrelte } from '@threlte/core';
	import { useTask } from '@threlte/core';
	import { Text } from '@threlte/extras';
	import * as THREE from 'three';

	const AXIS_LENGTH = 0.8;
	const LABEL_OFFSET = 1.0;

	// Axes in room coordinates, mapped to Three.js:
	// Room X -> Three.js X (red)
	// Room Y -> Three.js Z (green)
	// Room Z -> Three.js Y (blue)
	const axes = [
		{ label: 'X', color: '#ff0000', dir: [AXIS_LENGTH, 0, 0] as [number, number, number], labelPos: [LABEL_OFFSET, 0, 0] as [number, number, number] },
		{ label: 'Y', color: '#00cc00', dir: [0, 0, AXIS_LENGTH] as [number, number, number], labelPos: [0, 0, LABEL_OFFSET] as [number, number, number] },
		{ label: 'Z', color: '#0066ff', dir: [0, AXIS_LENGTH, 0] as [number, number, number], labelPos: [0, LABEL_OFFSET, 0] as [number, number, number] },
	];

	const origin: [number, number, number] = [-0.5, 0, -0.5];

	// Billboard labels to face camera
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

<T.Group position={origin}>
	{#each axes as axis}
		<!-- Arrow line -->
		<T.Line>
			<T.BufferGeometry>
				<T.BufferAttribute
					attach="attributes-position"
					args={[new Float32Array([0, 0, 0, ...axis.dir]), 3]}
				/>
			</T.BufferGeometry>
			<T.LineBasicMaterial color={axis.color} linewidth={2} />
		</T.Line>
	{/each}

	<!-- Labels (billboarded) -->
	<T.Group bind:ref={labelsGroup}>
		{#each axes as axis}
			<Text
				text={axis.label}
				fontSize={0.15}
				color={axis.color}
				position={axis.labelPos}
				anchorX="center"
				anchorY="middle"
				fontWeight="bold"
			/>
		{/each}
	</T.Group>
</T.Group>
