<script lang="ts">
	import { T } from '@threlte/core';

	interface Props {
		axisLength?: number;
		offset?: number;
	}

	let { axisLength = 1, offset = 0.5 }: Props = $props();

	const origin: [number, number, number] = $derived([-offset, 0, offset]);
</script>

<T.Group position={origin} scale={[1, 1, -1]}>
	<T.AxesHelper args={[axisLength]} />
</T.Group>
