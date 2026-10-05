<script lang="ts">
	// Empty stand-in for components that need WebGL in unit tests.
	let { children }: { children?: import("svelte").Snippet } = $props();
</script>

{#if children}{@render children()}{/if}
