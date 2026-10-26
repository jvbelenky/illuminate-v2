<script lang="ts">
	// The mark for a ceiling item: smoke detector, vent, sensor or keep-out area.
	// Drawn in currentColor; usable in HTML and nested in the plan's SVG.
	import type { CeilingKind } from './ceilingLayout';

	let { kind, size = 14, x, y }: { kind: CeilingKind; size?: number; x?: number; y?: number } = $props();
</script>

<svg {x} {y} width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
	{#if kind === 'smoke'}
		<circle cx="7" cy="7" r="5" />
		<circle cx="7" cy="7" r="1.6" fill="currentColor" stroke="none" />
	{:else if kind === 'vent'}
		<rect x="2" y="2" width="10" height="10" />
		<path d="M4 5h6M4 7h6M4 9h6" />
	{:else if kind === 'sensor'}
		<path d="M3 9a5 5 0 0 1 8 0M5 11a2.5 2.5 0 0 1 4 0" />
	{:else}
		<rect x="2" y="2" width="10" height="10" stroke-dasharray="2 1.5" />
		<path d="M4 4l6 6M10 4l-6 6" />
	{/if}
</svg>
