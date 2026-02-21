<script lang="ts">
	import { T } from '@threlte/core';

	const origin: [number, number, number] = [-0.5, 0, 0.5];
</script>

<T.Group position={origin} scale={[1, 1, -1]}>
	<T.AxesHelper args={[1]} />
</T.Group>
