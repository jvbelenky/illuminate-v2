<script lang="ts">
	import { T } from '@threlte/core';

	interface Props {
		axisLength?: number;
	}

	let { axisLength = 1 }: Props = $props();

	const origin: [number, number, number] = [-0.5, 0, 0.5];
</script>

<T.Group position={origin} scale={[1, 1, -1]}>
	<T.AxesHelper args={[axisLength]} />
</T.Group>
