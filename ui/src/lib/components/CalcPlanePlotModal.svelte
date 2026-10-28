<script lang="ts">
	import { untrack } from 'svelte';
	import type { CalcZone, RoomConfig, LampInstance, ZonePlotSettings } from '$lib/types/project';
	import { theme } from '$lib/stores/theme';
	import { lamps, plotSettings, project, zones } from '$lib/stores/project';
	import { userSettings } from '$lib/stores/settings';
	import { unitAbbrev } from '$lib/utils/unitConversion';
	import { wallPlotAxes } from '$lib/utils/planeWorld';
	import { surfaceName } from '$lib/utils/surfaces';
	import { getSessionZoneExport } from '$lib/api/client';
	import { buildColorScale, formatPlotValue, levelText, limitLevels, resolvePlotSettings, roundSig, setLevelValue, valueRange, type LimitSet } from '$lib/utils/plotScale';
	import {
		contourShapes,
		levelFields,
		holesFilled,
		sampleGrid,
		shapePaths,
		drawPlanePlot,
		numberWidth,
		numbersFit,
		planeGrid,
		planeLayout,
		readableNumbersSize,
		zoomForNumbers,
		readPlotPalette,
		legendTextWidth,
		NO_ZOOM,
		type PlanePlotOptions,
		type PlaneLayout,
		type PlotLamp,
		type View,
	} from '$lib/utils/planePlot';
	import AlertDialog from './AlertDialog.svelte';
	import Modal from './Modal.svelte';
	import PlotZoneSelect, { type PlotZoneChoice } from './PlotZoneSelect.svelte';
	import PlotSettingsPanel from './PlotSettingsPanel.svelte';
	import { enterToggle } from '$lib/actions/enterToggle';

	interface Props {
		zone: CalcZone;
		zoneName: string;
		room: RoomConfig;
		values: number[][];
		valueFactor?: number;
		effectiveTlv?: number;
		/** The safety limits in this zone's units, for the Limits levels. */
		limits?: LimitSet | null;
		onclose: () => void;
		dockId?: string;
		/** Zones the title can switch to; without them the title is plain text. */
		zoneChoices?: PlotZoneChoice[];
		onSwitchZone?: (zoneId: string) => void;
	}

	let { zone, zoneName, room, values, valueFactor = 1, effectiveTlv, limits = null, onclose, dockId, zoneChoices, onSwitchZone }: Props = $props();

	let exporting = $state(false);
	let savingPlot = $state(false);
	let alertDialog = $state<{ title: string; message: string } | null>(null);

	let showAxes = $state(true);
	let showTickMarks = $state(true);
	let showTickLabels = $state(true);
	let showLampLabels = $state(false);
	let showContourLabels = $state(true);

	async function exportCSV() {
		exporting = true;
		try {
			const blob = await getSessionZoneExport(zone.id);
			downloadBlob(blob, `${zoneName}.csv`);
		} catch (error) {
			console.error('Failed to export zone:', error);
			alertDialog = { title: 'Export Failed', message: 'Failed to export zone. Please try again.' };
		} finally {
			exporting = false;
		}
	}

	function downloadBlob(blob: Blob, filename: string) {
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		a.click();
		URL.revokeObjectURL(url);
	}

	const refSurface = $derived(zone.ref_surface || 'xy');
	const units = $derived(unitAbbrev($userSettings.units));
	const colormap = $derived(room.colormap || 'plasma');
	const valueUnits = $derived(zone.dose ? 'mJ/cm²' : 'µW/cm²');

	// A plane on a wall: Along (seen from inside, mirrored) and Up
	const wallPlot = $derived(wallPlotAxes(zone, room));
	const mirrorU = $derived(!!wallPlot);

	// True when the values run toward +v (their last column is the top of the plot)
	const shouldFlipV = $derived.by(() => {
		if (wallPlot) return wallPlot.flipV;
		if (zone.v_positive_direction != null) return zone.v_positive_direction;
		const direction = zone.direction ?? 1;
		// XZ: v points +Z when direction=-1; XY and YZ: v points positive when direction=1
		return refSurface === 'xz' ? direction < 0 : direction > 0;
	});

	// The in-plane axes; the fixed one is perpendicular to the plane
	const bounds = $derived.by(() => {
		if (wallPlot) {
			const { u1, u2, v1, v2, uLabel, vLabel, fixed } = wallPlot;
			return { u1, u2, v1, v2, fixed, uLabel, vLabel, fixedLabel: '' };
		}
		const height = zone.height ?? 0;
		switch (refSurface) {
			case 'xz':
				return { u1: zone.x1 ?? 0, u2: zone.x2 ?? room.x, v1: zone.z_min ?? 0, v2: zone.z_max ?? room.z, fixed: height, uLabel: 'X', vLabel: 'Z', fixedLabel: 'Y' };
			case 'yz':
				return { u1: zone.y1 ?? 0, u2: zone.y2 ?? room.y, v1: zone.z_min ?? 0, v2: zone.z_max ?? room.z, fixed: height, uLabel: 'Y', vLabel: 'Z', fixedLabel: 'X' };
			case 'xy':
			default:
				return { u1: zone.x1 ?? 0, u2: zone.x2 ?? room.x, v1: zone.y1 ?? 0, v2: zone.y2 ?? room.y, fixed: height, uLabel: 'X', vLabel: 'Y', fixedLabel: 'Z' };
		}
	});
	const aspect = $derived((bounds.u2 - bounds.u1) / (bounds.v2 - bounds.v1) || 1);
	const planeLabel = $derived(
		wallPlot && zone.surface
			? `${surfaceName(zone.surface)} @ ${bounds.fixed.toFixed(2)} ${units}`
			: `2D Plane @ ${bounds.fixedLabel}=${bounds.fixed.toFixed(2)} ${units}`
	);
	const defaultTitle = $derived(`${zoneName} \u2014 ${planeLabel}`);

	// --- Plot settings and color scale (saved per zone) ---
	// The zone as it is now (the prop is a snapshot from when the window opened)
	const liveZone = $derived($zones.find((z) => z.id === zone.id) ?? zone);
	const settings = $derived(resolvePlotSettings('plane', $plotSettings[zone.id], liveZone.display_mode));
	function updateSettings(partial: Partial<ZonePlotSettings>) {
		project.updatePlotSettings(zone.id, partial);
		// Heatmap or contours is one setting with the room view's display
		const display = liveZone.display_mode ?? 'heatmap';
		if (partial.view && (display === 'heatmap' || display === 'contours') && partial.view !== display) {
			project.updateZone(zone.id, { display_mode: partial.view === 'contours' ? 'contours' : 'heatmap' });
		}
	}

	const grid = $derived(planeGrid(values, shouldFlipV, valueFactor, mirrorU));
	const range = $derived(valueRange(grid.data));

	const isSafetyZone = $derived(zone.id === 'SkinLimits' || zone.id === 'EyeLimits');
	const tlvLimit = $derived(isSafetyZone && effectiveTlv ? effectiveTlv : 0);
	const tlv = $derived(tlvLimit > 0 && range ? { limit: tlvLimit, max: range.max } : null);

	const scale = $derived(buildColorScale(settings, range, colormap, limits));

	// The room view draws levels from the limits as stored; keep them in step with the current limits
	$effect(() => {
		const current = limitLevels(settings, limits);
		if (!current) return;
		const stored = settings.levels;
		if (current.levels.length !== stored.length || current.levels.some((v, i) => v !== stored[i])) {
			untrack(() => updateSettings({ levels: current.levels, labels: [...current.labels] }));
		}
	});
	// Traced once per scale, not on every zoom frame
	// A level being dragged on the plot: shown at its new value, saved on release
	let dragLevel = $state<{ index: number; value: number; x: number; y: number } | null>(null);
	// The level whose line is under the pointer, drawn heavier to show it can be grabbed
	let hoverLevel = $state<number | null>(null);
	const shownScale = $derived.by(() => {
		const drag = dragLevel;
		if (!drag || !scale.levels) return scale;
		return { ...scale, levels: scale.levels.map((level, i) => (i === drag.index ? drag.value : level)) };
	});
	// A level from a limit that varies across the plane is traced where each point reaches that share of its own limit
	const fields = $derived(levelFields(grid, shouldFlipV, scale.levelLimits, mirrorU));
	const shapes = $derived(settings.view === 'contours' && shownScale.levels ? contourShapes(grid, shownScale.levels, shownScale.colors, fields) : undefined);

	const plotLamps = $derived.by((): PlotLamp[] => {
		if (!showLampLabels) return [];
		return ($lamps as LampInstance[])
			.filter((l) => l.enabled)
			.map((l) => {
				const [u, v] = wallPlot ? wallPlot.toPlot(l.x, l.y, l.z) : refSurface === 'xz' ? [l.x, l.z] : refSurface === 'yz' ? [l.y, l.z] : [l.x, l.y];
				return { name: l.name || l.id, u, v };
			});
	});

	// --- Colors from the theme ---
	const palette = $derived.by(() => {
		void $theme;
		return readPlotPalette();
	});

	// --- Canvas, sized to the fixed plot area ---
	let plotArea: HTMLDivElement | undefined = $state();
	let canvas: HTMLCanvasElement | undefined = $state();
	let areaW = $state(0);
	let areaH = $state(0);

	$effect(() => {
		if (!plotArea || typeof ResizeObserver === 'undefined') return;
		const observer = new ResizeObserver(([entry]) => {
			areaW = entry.contentRect.width;
			areaH = entry.contentRect.height;
		});
		observer.observe(plotArea);
		return () => observer.disconnect();
	});

	// Room beside the legend for its longest label (a level's name can be long)
	const legendText = $derived(
		legendTextWidth(scale.levels ? scale.levels.map((_, i) => levelText(scale, i, settings.decimals)) : [formatPlotValue(scale.range.max, settings.decimals)])
	);
	const layout = $derived(planeLayout(areaW, areaH, aspect, { tlv: !!tlv, title: !!settings.title, legendText }));

	function plotOptions(zoomView: View, px: number, title?: string): PlanePlotOptions {
		return {
			grid,
			view: settings.view === 'contours' ? 'contours' : 'heatmap',
			showValues: settings.showValues,
			scale: shownScale,
			activeLevel: dragLevel?.index ?? hoverLevel,
			filled: settings.filled,
			decimals: settings.decimals,
			palette,
			px,
			contourLabels: showContourLabels,
			shapes,
			axes: { ...bounds, units },
			zoom: zoomView,
			showTickMarks,
			showTickLabels,
			showAxisLabels: showAxes,
			lamps: plotLamps,
			tlv,
			unitLabel: valueUnits,
			title,
		};
	}

	// --- Zoom and pan ---
	let zoom = $state<View>(NO_ZOOM);

	// A new zone starts unzoomed
	$effect(() => {
		void zone.id;
		untrack(() => { zoom = NO_ZOOM; });
	});

	let measureCtx: CanvasRenderingContext2D | null = null;
	function measure(): CanvasRenderingContext2D | null {
		measureCtx ??= document.createElement('canvas').getContext('2d');
		return measureCtx;
	}

	const cell = $derived({ w: layout.plot.w / grid.nU, h: layout.plot.h / grid.nV });
	const numberTextWidth = $derived.by(() => {
		const ctx = settings.showValues ? measure() : null;
		return ctx ? numberWidth(ctx, grid, settings.decimals) : 0;
	});
	// Zoom at which numbers appear, while they don't fit yet
	const numbersAt = $derived(
		settings.showValues && cell.w > 0 && !numbersFit(numberTextWidth, cell.w * zoom.k, cell.h * zoom.k)
			? zoomForNumbers(numberTextWidth, cell.w, cell.h)
			: null
	);
	const maxZoom = $derived(Math.max(16, cell.w > 0 ? zoomForNumbers(numberTextWidth || 30, cell.w, cell.h) * 1.5 : 16));

	function clampZoom(z: View, l: PlaneLayout): View {
		const k = Math.min(maxZoom, Math.max(1, z.k));
		return {
			k,
			tx: Math.min(0, Math.max(l.plot.w - l.plot.w * k, z.tx)),
			ty: Math.min(0, Math.max(l.plot.h - l.plot.h * k, z.ty)),
		};
	}

	function zoomAt(factor: number, x: number, y: number) {
		const k = Math.min(maxZoom, Math.max(1, zoom.k * factor));
		const ox = x - layout.plot.x;
		const oy = y - layout.plot.y;
		zoom = clampZoom({ k, tx: ox - (ox - zoom.tx) * (k / zoom.k), ty: oy - (oy - zoom.ty) * (k / zoom.k) }, layout);
	}

	const plotCenter = () => [layout.plot.x + layout.plot.w / 2, layout.plot.y + layout.plot.h / 2] as const;

	function localPoint(e: MouseEvent): [number, number] {
		const r = canvas!.getBoundingClientRect();
		return [e.clientX - r.left, e.clientY - r.top];
	}

	function handleWheel(e: WheelEvent) {
		e.preventDefault();
		const [x, y] = localPoint(e);
		zoomAt(Math.exp(-e.deltaY * 0.0015), x, y);
	}

	const pointers = new Map<number, [number, number]>();
	let pinchDistance: number | null = null;

	// --- Dragging a contour line sets its level to the value under the pointer ---
	const filledValues = $derived(settings.view === 'contours' ? holesFilled(grid) : null);
	const linePaths = $derived.by(() => {
		if (!shapes || typeof Path2D === 'undefined') return null;
		return shapePaths(shapes, grid, layout.plot, clampZoom(zoom, layout));
	});

	/** The level whose line is under the point, topmost first; -1 for none. */
	function levelAt(x: number, y: number): number {
		const ctx = measure();
		if (!linePaths || !ctx) return -1;
		ctx.lineWidth = 10;
		for (let i = linePaths.length - 1; i >= 0; i--) {
			if (ctx.isPointInStroke(linePaths[i], x, y)) return i;
		}
		return -1;
	}

	/** The data value under a point on the plot, in display units. */
	function valueAt(x: number, y: number): number | null {
		if (!filledValues) return null;
		const z = clampZoom(zoom, layout);
		const gu = (x - layout.plot.x - z.tx) / ((layout.plot.w / grid.nU) * z.k);
		const gv = (y - layout.plot.y - z.ty) / ((layout.plot.h / grid.nV) * z.k);
		const v = sampleGrid(filledValues, grid.nU, grid.nV, gu, gv);
		return Number.isFinite(v) && v > 0 ? roundSig(v, 3) : null;
	}

	function commitDrag() {
		const drag = dragLevel;
		dragLevel = null;
		if (!drag || !scale.levels || drag.value === scale.levels[drag.index]) return;
		const next = setLevelValue({ levels: scale.levels, colors: settings.colors, labels: settings.labels }, drag.index, drag.value);
		updateSettings({ levelsSource: 'custom', levels: next.levels, colors: next.colors, labels: next.labels });
	}

	function handlePointerDown(e: PointerEvent) {
		canvas?.setPointerCapture(e.pointerId);
		const point = localPoint(e);
		if (pointers.size === 0 && scale.levels) {
			const index = levelAt(point[0], point[1]);
			if (index >= 0) {
				dragLevel = { index, value: scale.levels[index], x: point[0], y: point[1] };
				if (canvas) canvas.style.cursor = 'grabbing';
				return;
			}
		}
		pointers.set(e.pointerId, point);
	}

	function handlePointerMove(e: PointerEvent) {
		const point = localPoint(e);
		if (dragLevel) {
			const value = valueAt(point[0], point[1]);
			dragLevel = { ...dragLevel, value: value ?? dragLevel.value, x: point[0], y: point[1] };
			return;
		}
		const prev = pointers.get(e.pointerId);
		if (!prev) {
			// Hovering: show that a line can be grabbed
			const index = levelAt(point[0], point[1]);
			hoverLevel = index >= 0 ? index : null;
			if (canvas) canvas.style.cursor = index >= 0 ? 'grab' : '';
			return;
		}
		const cur = localPoint(e);
		pointers.set(e.pointerId, cur);
		if (pointers.size === 2) {
			const [a, b] = [...pointers.values()];
			const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
			if (pinchDistance) zoomAt(d / pinchDistance, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
			pinchDistance = d;
			return;
		}
		zoom = clampZoom({ k: zoom.k, tx: zoom.tx + cur[0] - prev[0], ty: zoom.ty + cur[1] - prev[1] }, layout);
	}

	function handlePointerEnd(e: PointerEvent) {
		if (dragLevel) {
			commitDrag();
			if (canvas) canvas.style.cursor = 'grab';
			return;
		}
		pointers.delete(e.pointerId);
		if (pointers.size < 2) pinchDistance = null;
	}

	// --- Draw ---
	$effect(() => {
		if (!canvas || areaW <= 0 || areaH <= 0) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		const dpr = window.devicePixelRatio || 1;
		canvas.width = Math.round(areaW * dpr);
		canvas.height = Math.round(areaH * dpr);
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		drawPlanePlot(ctx, layout, plotOptions(clampZoom(zoom, layout), 1, settings.title ?? undefined));
	});

	// --- Save Plot: the whole plane, sized so numbers are readable ---
	function exportLayout(): PlaneLayout {
		const hasTlv = !!tlv;
		if (settings.showValues) {
			const ctx = measure();
			const tw = ctx ? numberWidth(ctx, grid, settings.decimals) : 30;
			const size = readableNumbersSize(tw, grid, aspect, { tlv: hasTlv, legendText });
			return planeLayout(size.width, size.height, aspect, { tlv: hasTlv, title: true, legendText });
		}
		const px = 2;
		let plotW = 720;
		let plotH = plotW / aspect;
		if (plotH > 600) {
			plotH = 600;
			plotW = plotH * aspect;
		}
		const width = Math.round((plotW + 70 + 49 + Math.max(50, legendText) + (hasTlv ? 70 : 0)) * px);
		const height = Math.round((plotH + 40 + 52) * px);
		return planeLayout(width, height, aspect, { tlv: hasTlv, title: true, px, legendText });
	}

	async function savePlot() {
		savingPlot = true;
		try {
			const l = exportLayout();
			const offscreen = document.createElement('canvas');
			offscreen.width = l.width;
			offscreen.height = l.height;
			const ctx = offscreen.getContext('2d');
			if (!ctx) throw new Error('Could not get 2d context');
			drawPlanePlot(ctx, l, plotOptions(NO_ZOOM, l.px, settings.title ?? defaultTitle));
			offscreen.toBlob((blob) => {
				if (blob) downloadBlob(blob, `${zoneName}.png`);
			}, 'image/png');
		} catch (error) {
			console.error('Failed to save plot:', error);
			alertDialog = { title: 'Save Failed', message: 'Failed to save plot. Please try again.' };
		} finally {
			savingPlot = false;
		}
	}
</script>

{#snippet zoneTitle()}
	<PlotZoneSelect current={zone.id} choices={zoneChoices ?? []} onSelect={(id) => onSwitchZone?.(id)} />
{/snippet}

<Modal title={zoneName} titleContent={zoneChoices && onSwitchZone ? zoneTitle : undefined} onClose={onclose} width="min(1080px, 96vw)" maxWidth="96vw" maxHeight="96vh" titleFontSize="1rem" {dockId}>
	{#snippet headerExtra()}
		<span class="plane-badge">{planeLabel}</span>
	{/snippet}
	{#snippet body()}
		<div class="plot-main">
			<div class="plot-area" bind:this={plotArea}>
				<canvas
					bind:this={canvas}
					aria-label="{zoneName} plot"
					onwheel={handleWheel}
					ondblclick={(e) => { const [x, y] = localPoint(e); zoomAt(2, x, y); }}
					onpointerdown={handlePointerDown}
					onpointermove={handlePointerMove}
					onpointerup={handlePointerEnd}
					onpointercancel={handlePointerEnd}
					onpointerleave={() => { if (!dragLevel) hoverLevel = null; }}
				></canvas>
				{#if dragLevel}
					<!-- The value the dragged line will take -->
					<div class="drag-tag" style="left: {dragLevel.x + 14}px; top: {dragLevel.y - 28}px;">
						{levelText(shownScale, dragLevel.index, settings.decimals) === formatPlotValue(dragLevel.value, settings.decimals)
							? formatPlotValue(dragLevel.value, settings.decimals)
							: `${levelText(shownScale, dragLevel.index, settings.decimals)} · ${formatPlotValue(dragLevel.value, settings.decimals)}`}
					</div>
				{/if}
				<div class="zoom-controls" style="left: {layout.plot.x + 8}px; top: {layout.plot.y + 8}px;">
					<button type="button" aria-label="Zoom out" onclick={() => zoomAt(1 / 1.6, ...plotCenter())} disabled={zoom.k <= 1}>&minus;</button>
					<span class="zoom-level">{zoom.k.toFixed(1)}&times;{#if numbersAt}&ensp;&middot; values at {numbersAt.toFixed(1)}&times;{/if}</span>
					<button type="button" aria-label="Zoom in" onclick={() => zoomAt(1.6, ...plotCenter())} disabled={zoom.k >= maxZoom}>+</button>
					<button type="button" onclick={() => { zoom = NO_ZOOM; }} disabled={zoom.k === 1}>Fit</button>
				</div>
			</div>
			<aside class="side-panel">
				<PlotSettingsPanel kind="plane" {settings} {scale} {limits} unitLabel={valueUnits} {defaultTitle} onChange={updateSettings} />
			</aside>
		</div>
	{/snippet}
	{#snippet footer()}
		<div class="modal-footer">
			<div class="footer-controls">
				<span class="show-prefix">Show:</span>
				<label class="checkbox-label">
					<input type="checkbox" bind:checked={showTickMarks} use:enterToggle />
					<span>Tick marks</span>
				</label>
				<label class="checkbox-label">
					<input type="checkbox" bind:checked={showTickLabels} use:enterToggle />
					<span>Tick labels</span>
				</label>
				<label class="checkbox-label">
					<input type="checkbox" bind:checked={showAxes} use:enterToggle />
					<span>Axis labels</span>
				</label>
				<label class="checkbox-label">
					<input type="checkbox" bind:checked={showLampLabels} use:enterToggle />
					<span>Lamp positions</span>
				</label>
				<label class="checkbox-label">
					<input type="checkbox" checked={settings.showValues} onchange={(e) => updateSettings({ showValues: e.currentTarget.checked })} use:enterToggle />
					<span>Values</span>
				</label>
				{#if settings.view === 'contours'}
					<label class="checkbox-label">
						<input type="checkbox" bind:checked={showContourLabels} use:enterToggle />
						<span>Contour labels</span>
					</label>
				{/if}
			</div>
			<div class="footer-buttons">
				<button class="export-btn" onclick={savePlot} disabled={savingPlot}>
					{savingPlot ? 'Saving...' : 'Save Plot'}
				</button>
				<button class="export-btn" onclick={exportCSV} disabled={exporting}>
					{exporting ? 'Exporting...' : 'Export CSV'}
				</button>
			</div>
		</div>
	{/snippet}
</Modal>

{#if alertDialog}
	<AlertDialog
		title={alertDialog.title}
		message={alertDialog.message}
		onDismiss={() => alertDialog = null}
	/>
{/if}

<style>
	.plane-badge {
		font-size: 0.65rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		background: var(--color-bg-tertiary);
		padding: 2px 8px;
		border-radius: var(--radius-sm);
		white-space: nowrap;
	}

	/* One size for every zone and view; the plot fits inside */
	.plot-main {
		display: flex;
		height: min(580px, calc(96vh - 130px));
	}

	.plot-area {
		flex: 1;
		min-width: 0;
		position: relative;
		overflow: hidden;
	}

	.plot-area canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		touch-action: none;
		cursor: grab;
	}

	.plot-area canvas:active {
		cursor: grabbing;
	}

	.drag-tag {
		position: absolute;
		pointer-events: none;
		padding: 2px 8px;
		border-radius: var(--radius-sm);
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-highlight);
		color: var(--color-text);
		font-family: var(--font-mono);
		font-size: 0.75rem;
		white-space: nowrap;
	}

	.zoom-controls {
		position: absolute;
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 3px;
		background: color-mix(in srgb, var(--color-bg-secondary) 92%, transparent);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.zoom-controls button {
		background: transparent;
		color: var(--color-text-muted);
		border: none;
		border-radius: var(--radius-sm);
		min-width: 24px;
		height: 22px;
		padding: 0 5px;
		font-size: 0.8rem;
	}

	.zoom-controls button:hover:not(:disabled) {
		background: var(--color-bg-tertiary);
		color: var(--color-text);
	}

	.zoom-controls button:disabled {
		opacity: 0.4;
	}

	.zoom-level {
		padding: 0 4px;
		font-family: var(--font-mono);
		font-size: 0.7rem;
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	.side-panel {
		width: 268px;
		flex: none;
		overflow-y: auto;
		padding: var(--spacing-md);
		border-left: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
	}

	@media (max-width: 767px) {
		.plot-main {
			flex-direction: column;
			height: auto;
			flex: 1;
			min-height: 0;
		}

		.plot-area {
			flex: none;
			height: 55vh;
		}

		.side-panel {
			width: auto;
			flex: 1;
			border-left: none;
			border-top: 1px solid var(--color-border);
		}
	}

	.modal-footer {
		padding: var(--spacing-xs) var(--spacing-md);
		border-top: 1px solid var(--color-border);
		display: flex;
		justify-content: space-between;
		align-items: center;
		flex-shrink: 0;
		gap: var(--spacing-sm);
	}

	@media (max-width: 767px) {
		.modal-footer {
			flex-direction: column;
			align-items: stretch;
		}

		.footer-buttons {
			justify-content: flex-end;
			flex-wrap: wrap;
		}
	}

	.footer-controls {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		flex-wrap: wrap;
	}

	.show-prefix {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		font-weight: 500;
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		margin: 0;
		font-size: 0.8rem;
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.footer-buttons {
		display: flex;
		gap: var(--spacing-sm);
		flex-shrink: 0;
	}

	.export-btn {
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: var(--spacing-xs) var(--spacing-sm);
		font-size: 0.8rem;
		color: var(--color-text);
		cursor: pointer;
		transition: all 0.15s;
	}

	.export-btn:hover:not(:disabled) {
		background: var(--color-border);
	}

	.export-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
</style>
