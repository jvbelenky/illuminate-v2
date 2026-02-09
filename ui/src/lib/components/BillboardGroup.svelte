<script lang="ts">
	import type { Snippet } from 'svelte';
	import { T, useThrelte, useTask } from '@threlte/core';
	import * as THREE from 'three';

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();

	const { camera } = useThrelte();
	let group = $state<THREE.Group | undefined>(undefined);

	useTask(() => {
		if (!group || !camera.current) return;
		group.traverse((child) => {
			if ((child as any).isMesh) {
				child.quaternion.copy(camera.current.quaternion);
			}
		});
	});
</script>

<T.Group bind:ref={group}>
	{@render children()}
</T.Group>
