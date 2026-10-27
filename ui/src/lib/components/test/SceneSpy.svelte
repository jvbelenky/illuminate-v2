<script lang="ts">
	// Stand-in for Scene that records the props it was given, for RoomViewer tests.
	let props: Record<string, unknown> = $props();
	$effect(() => {
		(globalThis as Record<string, unknown>).__sceneProps = { ...props };
	});
</script>
