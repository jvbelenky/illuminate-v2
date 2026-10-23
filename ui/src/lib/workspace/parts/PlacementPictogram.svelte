<script lang="ts">
	// A placement drawn as the room from above: the dot is the lamp, the shading
	// its beam. Coloured by currentColor.
	import type { PlacementMode } from '$lib/utils/lampPlacement';

	interface Props {
		mode: PlacementMode;
	}

	let { mode }: Props = $props();
</script>

<svg class="placement-pictogram" width="26" height="22" viewBox="0 0 26 22" aria-hidden="true" data-mode={mode}>
	<rect x="2" y="2" width="22" height="18" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".55" />
	{#if mode === 'downlight'}
		<circle cx="13" cy="11" r="5" fill="currentColor" opacity=".18" />
		<circle cx="13" cy="11" r="2" fill="currentColor" />
	{:else if mode === 'corner'}
		<path d="M4 4L20 17" stroke="currentColor" stroke-width="1" stroke-dasharray="1.5 1.2" opacity=".6" />
		<path d="M4 4l9 1.5-7.5 6z" fill="currentColor" opacity=".18" />
		<circle cx="4.5" cy="4.5" r="2" fill="currentColor" />
	{:else if mode === 'edge'}
		<path d="M13 3.5L13 18" stroke="currentColor" stroke-width="1" stroke-dasharray="1.5 1.2" opacity=".6" />
		<path d="M13 4l-5 9h10z" fill="currentColor" opacity=".18" />
		<circle cx="13" cy="4" r="2" fill="currentColor" />
	{:else}
		<path d="M4 11h17M18.5 8.5l3 2.5-3 2.5" stroke="currentColor" stroke-width="1.3" fill="none" />
		<circle cx="4" cy="11" r="2" fill="currentColor" />
	{/if}
</svg>

<style>
	.placement-pictogram {
		display: block;
		flex: none;
	}
</style>
