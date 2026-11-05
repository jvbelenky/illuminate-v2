<script lang="ts" module>
	// Rendered images, kept per results array (a new calculation drops them) and
	// then by everything else they depend on; shared by every plan pane.
	const images = new WeakMap<object, Map<string, string | null>>();
	// Marker paths by zone geometry and thinning step
	const PATHS_MAX = 256;
	const paths = new Map<string, string>();
	let uid = 0;
</script>

<script lang="ts">
	// Calculation planes and volumes on the 2D view, drawn as their 2D display
	// mode asks and as the 3D view draws them (CalcPlane3D, CalcVol3D): the
	// grid points as markers, or the results as a heatmap, contours or numbers.
	// Display-only, over the floor fill and the floor-plan image, under the
	// outlines, labels, lamps and handles.
	//
	// The images are built once per zone and results (memoised) and scale with
	// the plan, so panning and zooming only move them; the markers are one path
	// per zone, rebuilt only when the zoom thins them differently.
	import type { CalcZone, RoomConfig } from '$lib/types/project';
	import { results, plotSettings } from '$lib/stores/project';
	import { theme } from '$lib/stores/theme';
	import { zoneLimitSet } from '$lib/stores/plotStyles';
	import { zoneValueFactor } from '$lib/utils/calculations';
	import { formatValue } from '$lib/utils/formatting';
	import { buildColorScale, resolvePlotSettings, valueRange, volumeIsoScale, type ColorScale } from '$lib/utils/plotScale';
	import { drawPlaneData, levelFields, planeGrid, readPlotPalette, NO_ZOOM, type PlaneGrid, type PlotPalette } from '$lib/utils/planePlot';
	import { zoneDisplayMode } from '$lib/workspace/zones/zoneFields';
	import {
		cellRect, columnMax, fieldGrid, fieldKind, freshValues, globalPlaneRange, gridPoints, gridRange, gridSpacing,
		heatmapPixels, heatmapScale, markerPath, markerRadius, markerStep, type FieldGrid, type FieldKind,
		svgMatrix, type Affine,
	} from './zoneField';

	interface Props {
		/** The zones to draw (`fieldZones`: on this view, not hidden). */
		zones: CalcZone[];
		/** Every zone, for the shared value range when heatmaps are normalised together. */
		allZones: CalcZone[];
		room: RoomConfig;
		/** One screen pixel in plan units. */
		px: number;
		selectedId?: string | null;
		hoveredId?: string | null;
		/**
		 * The zone being edited on this canvas, before the edit applies: its layer moves
		 * with `transform` (a move, resize or turn), or it shows `zone`'s markers (a
		 * corner edit), or nothing (an outline that is not valid yet).
		 */
		live?: { id: string; transform: Affine | null; zone: CalcZone | null } | null;
	}

	let { zones, allZones, room, px, selectedId = null, hoveredId = null, live = null }: Props = $props();
	const clipBase = `zf${uid++}`;

	const colormap = $derived(room.colormap || 'plasma');
	const globalRange = $derived(room.globalHeatmapNormalization ? globalPlaneRange(allZones, $results?.zones) : null);
	const palette = $derived.by(() => {
		void $theme;
		return readPlotPalette();
	});

	type Rect = { x: number; y: number; w: number; h: number };
	type Item = {
		id: string;
		kind: FieldKind;
		grid: FieldGrid;
		/** The geometry's cache key, for the marker path. */
		geo: string;
		rect: Rect;
		href?: string;
		texts?: { x: number; y: number; text: string }[];
		fontSize?: number;
		enabled: boolean;
		volume: boolean;
	};

	/** A canvas drawn by `draw` as a data URL, built once per results array and key. */
	function image(values: object, key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): string | null {
		let byKey = images.get(values);
		if (!byKey) images.set(values, (byKey = new Map()));
		if (byKey.has(key)) return byKey.get(key) ?? null;
		let href: string | null = null;
		try {
			const canvas = document.createElement('canvas');
			canvas.width = Math.max(1, Math.round(w));
			canvas.height = Math.max(1, Math.round(h));
			const ctx = canvas.getContext('2d');
			if (ctx) {
				draw(ctx);
				href = canvas.toDataURL('image/png');
			}
		} catch {
			href = null;
		}
		byKey.set(key, href);
		return href;
	}

	function heatmapImage(values: object, key: string, grid: PlaneGrid, range: { min: number; max: number }): string | null {
		const scale = heatmapScale(grid);
		return image(values, key, grid.nU * scale, grid.nV * scale, (ctx) => {
			const img = ctx.createImageData(grid.nU * scale, grid.nV * scale);
			img.data.set(heatmapPixels(grid, range, colormap, scale));
			ctx.putImageData(img, 0, 0);
		});
	}

	/** Contours (or a volume's bands) by the plot window's renderer, at the 3D texture's resolution. */
	function bandsImage(values: object, key: string, grid: PlaneGrid, scale: ColorScale, filled: boolean, decimals: number, pal: PlotPalette, fields: (Float64Array | null)[] | undefined, floorless: boolean): string | null {
		const cellPx = Math.max(4, Math.min(32, Math.floor(2048 / Math.max(grid.nU, grid.nV))));
		const w = grid.nU * cellPx, h = grid.nV * cellPx;
		return image(values, key, w, h, (ctx) => {
			drawPlaneData(ctx, { x: 0, y: 0, w, h }, NO_ZOOM, {
				grid, view: 'contours', scale, fields, filled, decimals, palette: pal, px: Math.max(1, w / 600), clearHoles: true, floorless,
			});
		});
	}

	/** Each value at its point, sized to fit its cell (as 3D's numeric overlay). */
	function numbers(grid: PlaneGrid, rect: Rect, decimals: number): { texts: Item['texts']; fontSize: number } {
		const cw = rect.w / grid.nU, ch = rect.h / grid.nV;
		const texts: NonNullable<Item['texts']> = [];
		let maxLen = 1;
		for (let row = 0; row < grid.nV; row++) {
			for (let col = 0; col < grid.nU; col++) {
				const v = grid.data[row * grid.nU + col];
				if (!Number.isFinite(v)) continue;
				const text = formatValue(v, decimals);
				if (text.length > maxLen) maxLen = text.length;
				texts.push({ x: rect.x + (col + 0.5) * cw, y: rect.y + rect.h - (row + 0.5) * ch, text });
			}
		}
		return { texts, fontSize: Math.min((cw * 0.85) / (maxLen * 0.6), ch * 0.45) };
	}

	const items = $derived.by((): Item[] => {
		const zoneResults = $results?.zones;
		const stored = $plotSettings;
		const pal = palette;
		const out: Item[] = [];
		for (const stored0 of zones) {
			// Mid-edit without one map from the stored outline: its markers where the outline is now
			const reshaped = live?.id === stored0.id && !live.transform;
			if (reshaped && !live!.zone) continue;
			const z = reshaped ? live!.zone! : stored0;
			const grid = fieldGrid(z, room);
			if (!grid) continue;
			const result = zoneResults?.[z.id];
			const values = reshaped ? null : freshValues(z, result);
			const factor = zoneValueFactor(z, result);
			const mode = zoneDisplayMode(z, '2d');
			const decimals = room.precision ?? 1;
			const geo = `${z.id}|${grid.nU},${grid.nV},${grid.u1},${grid.u2},${grid.v1},${grid.v2},${grid.offset},${grid.mirrorU},${grid.length}|${JSON.stringify(grid.mask)}`;
			const rect = cellRect(grid);
			const base = { id: z.id, grid, geo, rect, enabled: z.enabled !== false, volume: z.type === 'volume' };
			const imgKey = `${mode}|${colormap}|${factor}|${grid.nU},${grid.nV},${grid.valuesUp},${grid.mirrorU}|${$theme}|${JSON.stringify(stored[z.id] ?? null)}`;

			if (z.type === 'volume') {
				const vol = values as number[][][] | null;
				let iso: ReturnType<typeof volumeIsoScale> | null = null;
				if (vol && mode === 'heatmap') iso = volumeIsoScale(stored[z.id], vol, factor, colormap);
				const kind = fieldKind(z, !!vol, { levels: iso ? !!iso.scale.levels?.length : undefined });
				if (!kind) continue;
				if (kind === 'markers' || !vol) {
					out.push({ ...base, kind: 'markers' });
					continue;
				}
				const top = columnMax(vol);
				if (kind === 'numeric') {
					out.push({ ...base, kind, ...numbers(planeGrid(top, true, 1, false), rect, decimals) });
					continue;
				}
				const settings = resolvePlotSettings('volume', stored[z.id]);
				const href = bandsImage(vol, `vol|${imgKey}`, planeGrid(top, true, factor, false), iso!.scale, settings.filled, settings.decimals, pal, undefined, true);
				out.push(href ? { ...base, kind, href } : { ...base, kind: 'markers' });
				continue;
			}

			const plane = values as number[][] | null;
			let bands: ColorScale | null = null;
			const zonePlot = resolvePlotSettings('plane', stored[z.id], mode);
			if (plane && mode === 'contours') {
				bands = buildColorScale({ ...zonePlot, view: 'contours' }, valueRange(plane.flat(), factor), colormap, zoneLimitSet(z, result));
			}
			const kind = fieldKind(z, !!plane, { levels: bands ? !!bands.levels?.length : undefined });
			if (!kind) continue;
			if (kind === 'markers' || !plane) {
				out.push({ ...base, kind: 'markers' });
				continue;
			}
			if (kind === 'numeric') {
				out.push({ ...base, kind, ...numbers(planeGrid(plane, grid.valuesUp, 1, grid.mirrorU), rect, decimals) });
				continue;
			}
			let href: string | null;
			if (kind === 'heatmap') {
				const raw = planeGrid(plane, grid.valuesUp, 1, grid.mirrorU);
				const range = globalRange ?? gridRange(raw.data) ?? { min: 0, max: 0 };
				href = heatmapImage(plane, `heat|${imgKey}|${range.min},${range.max}`, raw, range);
			} else {
				const display = planeGrid(plane, grid.valuesUp, factor, grid.mirrorU);
				const fields = levelFields(display, grid.valuesUp, bands!.levelLimits, grid.mirrorU);
				href = bandsImage(plane, `bands|${imgKey}`, display, bands!, zonePlot.filled, zonePlot.decimals, pal, fields, false);
			}
			out.push(href ? { ...base, kind, href } : { ...base, kind: 'markers' });
		}
		return out;
	});

	// Markers: thinned by the zoom, so they never crowd closer than a few pixels
	const markers = $derived(
		items.filter((it) => it.kind === 'markers').map((it) => {
			const spacing = gridSpacing(it.grid);
			const step = markerStep(spacing, px);
			const key = `${it.geo}|${step}`;
			let d = paths.get(key);
			if (d === undefined) {
				d = markerPath(gridPoints(it.grid, step));
				paths.set(key, d);
				if (paths.size > PATHS_MAX) paths.delete(paths.keys().next().value!);
			}
			return { id: it.id, d, r: markerRadius(spacing * step, px), enabled: it.enabled };
		})
	);
	const fields = $derived(items.filter((it) => it.kind !== 'markers'));

	const transform = (id: string) => (live?.id === id && live.transform ? svgMatrix(live.transform) : undefined);
	const opacity = (id: string) => (id === hoveredId ? 0.95 : id === selectedId ? 0.9 : 0.8);
	const polygon = (vs: [number, number][]) => vs.map(([x, y]) => `${x},${-y}`).join(' ');
</script>

{#if items.length}
	<g class="zone-fields" aria-hidden="true">
		{#each fields as f, i (f.id)}
			<clipPath id="{clipBase}-{i}"><polygon points={polygon(f.grid.clip)} /></clipPath>
			{#if f.href}
				<image
					class="zone-field {f.kind}"
					data-zone-id={f.id}
					href={f.href}
					x={f.rect.x}
					y={-(f.rect.y + f.rect.h)}
					width={f.rect.w}
					height={f.rect.h}
					preserveAspectRatio="none"
					clip-path="url(#{clipBase}-{i})"
					transform={transform(f.id)}
					opacity={opacity(f.id) * (f.volume ? 0.8 : 1)}
				/>
			{:else if f.texts}
				<g class="zone-field numeric" data-zone-id={f.id} clip-path="url(#{clipBase}-{i})" transform={transform(f.id)} font-size={f.fontSize} stroke-width={(f.fontSize ?? 0) * 0.18}>
					{#each f.texts as t, k (k)}
						<text x={t.x} y={-t.y}>{t.text}</text>
					{/each}
				</g>
			{/if}
		{/each}
		{#each markers as m (m.id)}
			<path class="zone-markers" class:selected={m.id === selectedId} class:highlighted={m.id !== selectedId && m.id === hoveredId} class:off={!m.enabled} data-zone-id={m.id} d={m.d} stroke-width={m.r * 2} transform={transform(m.id)} />
		{/each}
	</g>
{/if}

<style>
	.zone-fields {
		pointer-events: none;
	}
	.zone-field.heatmap {
		image-rendering: auto;
	}
	/* Numbers as 3D prints them: white, outlined in black */
	.zone-field.numeric text {
		fill: #ffffff;
		stroke: rgba(0, 0, 0, 0.9);
		paint-order: stroke;
		stroke-linejoin: round;
		font-family: monospace;
		font-weight: bold;
		text-anchor: middle;
		dominant-baseline: central;
	}
	/* Grid points in the scene's neutral, the selected zone's in the selection cyan */
	.zone-markers {
		fill: none;
		stroke: var(--color-scene-item);
		stroke-linecap: round;
	}
	.zone-markers.highlighted {
		stroke: color-mix(in srgb, var(--color-scene-selected) 55%, transparent);
	}
	.zone-markers.selected {
		stroke: var(--color-scene-selected);
	}
	.zone-markers.off {
		stroke-opacity: 0.45;
	}
</style>
