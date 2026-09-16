<script lang="ts">
	import { type Vertex, polygonBoundingBox } from '$lib/utils/roomGeometry';

	interface Props {
		vertices: Vertex[];
		/** Height in CSS pixels; the width follows the panel. */
		height?: number;
		onclick?: () => void;
		title?: string;
	}

	let { vertices, height = 96, onclick, title = 'Open the floor plan editor' }: Props = $props();

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
</script>

<button type="button" class="thumb" style:height="{height}px" {onclick} {title} aria-label={title}>
	<svg viewBox="0 0 {view.w} {view.h}" preserveAspectRatio="xMidYMid meet">
		<polygon {points} stroke-width={stroke} />
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
		fill: var(--color-accent);
		fill-opacity: 0.15;
		stroke: var(--color-accent);
		stroke-linejoin: round;
	}
</style>
