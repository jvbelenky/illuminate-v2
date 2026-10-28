<script lang="ts" module>
	// Outlines by lamp placement, web and view, shared across panes (main and mini)
	const OUTLINE_MAX = 512;
	const outlines = new Map<string, [number, number][][]>();
</script>

<script lang="ts">
	// The photometric webs projected on the 2D view: each lamp's silhouette in its
	// wavelength colour, display-only, under the lamp markers.
	import type { LampInstance } from '$lib/types/project';
	import type { WallSegment } from '$lib/utils/surfaces';
	import type { LengthUnit } from '$lib/utils/unitConversion';
	import { lampColor } from '$lib/utils/wavelengthColor';
	import { DISABLED_COLOR } from '$lib/utils/sceneColors';
	import { webDisplayScale, webLongestSpoke } from '$lib/components/photometricWeb';
	import { webOutline2d, type WebLamp } from './planWeb';
	import { planWebVertices } from './planWebData.svelte';

	type Lamp2d = LampInstance & WebLamp & { show_photometric_web_2d?: boolean };

	interface Props {
		lamps: LampInstance[];
		/** The room's extents, for the oversize factor the 3D view uses. */
		room: { x: number; y: number; z: number };
		/** Lamps hidden from the scene. */
		hidden?: Set<string>;
		units: LengthUnit;
		/** The wall being viewed; null for the floor and ceiling. */
		seg?: WallSegment | null;
		/** Per-lamp opacity on a wall view (lamps in front only). */
		opacity?: Record<string, number>;
		/** One screen pixel in plan units. */
		px: number;
	}

	let { lamps, room, hidden, units, seg = null, opacity, px }: Props = $props();
	const segKey = $derived(seg ? `w${seg.x1},${seg.y1},${seg.x2},${seg.y2}` : 'plan');

	function outlineFor(lamp: Lamp2d, key: string, verts: number[][]): [number, number][][] {
		const scale = webDisplayScale(webLongestSpoke(verts), room);
		const k = `${key}|${lamp.x},${lamp.y},${lamp.z},${lamp.aimx},${lamp.aimy},${lamp.aimz},${lamp.angle ?? 0},${lamp.web_size_2d ?? 1},${scale}|${segKey}`;
		let o = outlines.get(k);
		if (!o) {
			o = webOutline2d(lamp, verts, seg, scale);
			outlines.set(k, o);
			if (outlines.size > OUTLINE_MAX) outlines.delete(outlines.keys().next().value!);
		}
		return o;
	}

	const webs = $derived(
		(lamps as Lamp2d[])
			.filter((l) => (l.show_photometric_web_2d ?? true) && !hidden?.has(l.id) && (!opacity || l.id in opacity))
			.flatMap((l) => {
				const { key, vertices: verts } = planWebVertices(l, units);
				if (!verts) return [];
				const polys = outlineFor(l, key, verts);
				if (!polys.length) return [];
				const color = l.enabled === false ? DISABLED_COLOR : lampColor(l);
				return [{ id: l.id, polys, color, opacity: opacity?.[l.id] }];
			})
	);
</script>

{#if webs.length}
	<g class="plan-webs" aria-hidden="true">
		{#each webs as w (w.id)}
			<g class="plan-web" data-lamp-id={w.id} style:opacity={w.opacity}>
				{#each w.polys as poly, i (i)}
					<polygon points={poly.map(([x, y]) => `${x},${-y}`).join(' ')} fill={w.color} stroke={w.color} stroke-width={px * 1.25} />
				{/each}
			</g>
		{/each}
	</g>
{/if}

<style>
	.plan-webs {
		pointer-events: none;
	}
	.plan-web polygon {
		fill-opacity: 0.3;
		stroke-opacity: 0.75;
		stroke-linejoin: round;
	}
</style>
