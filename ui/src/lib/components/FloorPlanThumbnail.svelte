<script lang="ts">
	import { type Vertex, polygonBoundingBox } from '$lib/utils/roomGeometry';

	interface Props {
		vertices: Vertex[];
		/** Height in CSS pixels; the width follows the panel. */
		height?: number;
		onclick?: () => void;
		title?: string;
		/** Optional reference image (data URL) and its rect in display units, bottom-left origin. */
		imageSrc?: string | null;
		imageRect?: { x: number; y: number; width: number; height: number } | null;
		imageOpacity?: number;
		/** Object footprints (room units) drawn as faint context. */
		footprints?: Vertex[][];
	}

	let { vertices, height = 96, onclick, title = 'Open the floor plan editor', imageSrc = null, imageRect = null, imageOpacity = 0.6, footprints = [] }: Props = $props();

	// Fit the outline into the box with a little padding, y up
	const view = $derived.by(() => {
		const bb = polygonBoundingBox(vertices);
		const w = Math.max(bb.xMax, 1);
		const h = Math.max(bb.yMax, 1);
		const pad = Math.max(w, h) * 0.06;
		return { w: w + pad * 2, h: h + pad * 2, pad };
	});

	const points = $derived(
		vertices.map(([x, y]) => `${x + view.pad},${view.h - (y + view.pad)}`).join(' ')
	);
	const stroke = $derived(Math.max(view.w, view.h) / 120);
	const footprintPoints = $derived(
		footprints.map((fp) => fp.map(([x, y]) => `${x + view.pad},${view.h - (y + view.pad)}`).join(' '))
	);
	const img = $derived(
		imageSrc && imageRect
			? { x: imageRect.x + view.pad, y: view.h - (imageRect.y + imageRect.height + view.pad), width: imageRect.width, height: imageRect.height }
			: null
	);
</script>

<button type="button" class="thumb" style:height="{height}px" {onclick} {title} aria-label={title}>
	<svg viewBox="0 0 {view.w} {view.h}" preserveAspectRatio="xMidYMid meet">
		{#if img && imageSrc}
			<image href={imageSrc} x={img.x} y={img.y} width={img.width} height={img.height} opacity={imageOpacity} preserveAspectRatio="none" aria-hidden="true" />
		{/if}
		<polygon {points} stroke-width={stroke} />
		{#each footprintPoints as fp}
			<polygon class="footprint" points={fp} stroke-width={stroke * 0.8} />
		{/each}
	</svg>
</button>

<style>
	.thumb {
		width: 100%;
		padding: 4px;
		margin: 0;
		background: var(--color-bg-secondary, rgba(128, 128, 128, 0.08));
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm, 4px);
		cursor: pointer;
		display: block;
	}

	.thumb:hover {
		border-color: var(--color-accent);
	}

	svg {
		width: 100%;
		height: 100%;
		display: block;
	}

	polygon {
		fill: var(--color-scene-wire);
		fill-opacity: 0.15;
		stroke: var(--color-scene-wire);
		stroke-linejoin: round;
	}
	polygon.footprint {
		fill: var(--color-text-muted);
		fill-opacity: 0.35;
		stroke: var(--color-text-muted);
	}
</style>
