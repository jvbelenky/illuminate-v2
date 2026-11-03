<script lang="ts">
	// The selected shape's box, PowerPoint style: drawn in the shape's own frame
	// (turned by its yaw), with eight square resize handles and a round rotate
	// handle on a stem above the top edge. Handles keep their size on screen and
	// grow for touch. The canvas owns the drags; this only draws and reports presses.
	import type { Vertex } from '$lib/utils/roomGeometry';
	import { HANDLES, boxCorners, handleAngle, handlePoint, rotateHandlePoint, shapeBox, type Handle } from './shapeTransform';

	interface Props {
		vertices: Vertex[];
		yaw: number;
		/** Room units per screen pixel. */
		px: number;
		/** Room units per pixel for pointer targets. */
		hitPx: number;
		/** Larger handles (a touch screen). */
		coarse?: boolean;
		/** The angle shown by the rotate handle while it is dragged (degrees), or null. */
		angle?: number | null;
		onHandleDown: (event: PointerEvent, handle: Handle) => void;
		onRotateDown: (event: PointerEvent) => void;
	}

	let { vertices, yaw, px, hitPx, coarse = false, angle = null, onHandleDown, onRotateDown }: Props = $props();

	const box = $derived(shapeBox(vertices, yaw));
	const size = $derived(px * (coarse ? 16 : 9));
	const hit = $derived(Math.max(size, hitPx * (coarse ? 24 : 14)));
	const stem = $derived(px * (coarse ? 34 : 24));
	const svg = ([x, y]: Vertex): Vertex => [x, -y];
	const corners = $derived(boxCorners(box).map(svg));
	const topMid = $derived(svg(handlePoint(box, { sx: 0, sy: 1 })));
	const knob = $derived(svg(rotateHandlePoint(box, stem)));

	/** The resize cursor along a handle's direction on screen. */
	function cursor(h: Handle): string {
		const a = ((Math.round(handleAngle(h, yaw) / 45) % 4) + 4) % 4;
		return ['ew-resize', 'nesw-resize', 'ns-resize', 'nwse-resize'][a];
	}
	const handleName = (h: Handle) => [h.sy > 0 ? 'top' : h.sy < 0 ? 'bottom' : '', h.sx > 0 ? 'right' : h.sx < 0 ? 'left' : ''].filter(Boolean).join('-');
	const fmtAngle = (a: number) => `${Number.isInteger(a) ? a : a.toFixed(1)}°`;
</script>

<g class="transform-box">
	<polygon class="tb-frame" points={corners.map((p) => p.join(',')).join(' ')} stroke-width={px * 1.5} />
	<line class="tb-stem" x1={topMid[0]} y1={topMid[1]} x2={knob[0]} y2={knob[1]} stroke-width={px * 1.5} />
	{#each HANDLES as h (`${h.sx},${h.sy}`)}
		{@const [hx, hy] = svg(handlePoint(box, h))}
		<g class="tb-handle" role="button" tabindex="-1" aria-label="Resize {handleName(h)}" style:cursor={cursor(h)} onpointerdown={(e) => onHandleDown(e, h)}>
			<rect class="tb-hit" x={hx - hit / 2} y={hy - hit / 2} width={hit} height={hit} />
			<rect class="tb-square" x={hx - size / 2} y={hy - size / 2} width={size} height={size} stroke-width={px * 1.5} />
		</g>
	{/each}
	<g class="tb-rotate" role="button" tabindex="-1" aria-label="Rotate" onpointerdown={onRotateDown}>
		<circle class="tb-hit" cx={knob[0]} cy={knob[1]} r={hit / 2} />
		<circle class="tb-knob" cx={knob[0]} cy={knob[1]} r={size * 0.6} stroke-width={px * 1.5} />
	</g>
	{#if angle !== null}
		<text class="tb-angle" x={knob[0] + size + px * 6} y={knob[1] - size} font-size={px * 12}>{fmtAngle(angle)}</text>
	{/if}
</g>

<style>
	.tb-frame {
		fill: none;
		stroke: var(--color-scene-selected);
		pointer-events: none;
	}
	.tb-stem {
		stroke: var(--color-scene-selected);
		pointer-events: none;
	}
	.tb-square,
	.tb-knob {
		fill: var(--color-bg, #fff);
		stroke: var(--color-scene-selected);
	}
	/* The fill only: an unset stroke width would be a room unit wide */
	.tb-hit {
		fill: transparent;
		stroke: none;
		pointer-events: fill;
	}
	.tb-rotate {
		cursor: grab;
	}
	.tb-angle {
		fill: var(--color-scene-selected);
		paint-order: stroke;
		stroke: var(--color-bg, #fff);
		stroke-width: 0.3em;
		stroke-linejoin: round;
		font-family: var(--font-mono, monospace);
		font-weight: 600;
		pointer-events: none;
	}
</style>
