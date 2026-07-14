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

	// autoInvalidate defaults to true, which would force the renderer to redraw
	// the whole scene every frame forever, even when nothing has changed. The
	// billboard only needs to run before a frame that is already being drawn, so
	// opt out and let camera moves and scene changes drive invalidation.
	useTask(
		() => {
			if (!group || !camera.current) return;
			group.traverse((child) => {
				if ((child as any).isMesh) {
					child.quaternion.copy(camera.current.quaternion);
				}
			});
		},
		{ autoInvalidate: false }
	);
</script>

<T.Group bind:ref={group}>
	{@render children()}
</T.Group>
