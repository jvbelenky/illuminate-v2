<script lang="ts" module>
	// Line glyphs for the main view's controls (24 px grid, drawn with currentColor).
	const GLYPHS = {
		grid2: '<rect x="4" y="4" width="16" height="16"/><path d="M4 12h16M12 4v16"/>',
		cube: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
		floor: '<path d="M3 16l9-5 9 5-9 5z"/>',
		ceiling: '<path d="M3 8l9-5 9 5-9 5z"/><path d="M12 13v8" stroke-dasharray="2 2"/>',
		wall: '<path d="M5 4h14v16H5zM5 9h14M5 14h14M12 4v5M9 9v5M15 9v5M12 14v6"/>',
		play: '<path d="M7 5l12 7-12 7z" fill="currentColor"/>',
		pen: '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/>',
		corners: '<path d="M6 18L8 6l10 3-2 9z"/><rect x="4.5" y="16.5" width="3" height="3" fill="currentColor"/><rect x="6.5" y="4.5" width="3" height="3" fill="currentColor"/><rect x="16.5" y="7.5" width="3" height="3" fill="currentColor"/><rect x="14.5" y="16.5" width="3" height="3" fill="currentColor"/>',
		image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="M21 16l-5-5-8 8"/>',
		copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
		trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
		move: '<path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>',
		aim: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3"/>',
		tiles: '<rect x="4" y="4" width="16" height="16"/><path d="M4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16"/>',
		hand: '<path d="M8 13V6a1.5 1.5 0 0 1 3 0v5M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v7c0 4-2 7-6 7-3 0-4-1-6-4l-2-3a1.5 1.5 0 0 1 2.5-1.6L8 13"/>',
		zoom: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5M11 8v6M8 11h6"/>',
		fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
		views: '<rect x="4" y="4" width="4" height="4"/><rect x="10" y="4" width="4" height="4"/><rect x="16" y="4" width="4" height="4"/><rect x="4" y="10" width="4" height="4"/><rect x="10" y="10" width="4" height="4" fill="currentColor"/><rect x="16" y="10" width="4" height="4"/><rect x="4" y="16" width="4" height="4"/><rect x="10" y="16" width="4" height="4"/><rect x="16" y="16" width="4" height="4"/>',
		perspective: '<path d="M4 7l6 2v6l-6 2z"/><path d="M10 9l10-4v14l-10-4"/>',
		ortho: '<rect x="4" y="7" width="10" height="10"/><path d="M14 7l6-2v10l-6 2M4 7l6-2h10"/>',
		external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
		download: '<path d="M12 4v11M7 10l5 5 5-5M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2"/>',
		chevron: '<path d="M7 10l5 5 5-5"/>'
	} as const;

	export type GlyphName = keyof typeof GLYPHS;
</script>

<script lang="ts">
	interface Props {
		name: GlyphName;
		size?: number;
	}

	let { name, size = 20 }: Props = $props();
</script>

<svg
	class="glyph"
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.7"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	focusable="false"
>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- static markup from GLYPHS -->
	{@html GLYPHS[name]}
</svg>

<style>
	.glyph {
		flex: none;
		display: block;
	}
</style>
