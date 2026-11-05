<script lang="ts">
	import { T } from '@threlte/core';
	import * as THREE from 'three';
	import { AXIS_COLORS } from '$lib/utils/viewGrid';

	interface Props {
		axisLength?: number;
		offset?: number;
	}

	let { axisLength = 1, offset = 0.5 }: Props = $props();

	const origin: [number, number, number] = $derived([-offset, 0, offset]);
	// Three's y is the room's Z (up) and its z the room's Y (flipped): colours shared with the 2D plan
	let helper = $state<THREE.AxesHelper | undefined>(undefined);
	$effect(() => {
		helper?.setColors(new THREE.Color(AXIS_COLORS.x), new THREE.Color(AXIS_COLORS.z), new THREE.Color(AXIS_COLORS.y));
	});
</script>

<T.Group position={origin} scale={[1, 1, -1]}>
	<T.AxesHelper args={[axisLength]} bind:ref={helper} />
</T.Group>
