<script lang="ts">
	import type { CalcZone, RoomConfig, LampInstance } from '$lib/types/project';
	import { valueToColor } from '$lib/utils/colormaps';
	import { theme } from '$lib/stores/theme';
	import { lamps } from '$lib/stores/project';
	import { TLV_LIMITS } from '$lib/constants/safety';
	import { getSessionZoneExport } from '$lib/api/client';
	import AlertDialog from './AlertDialog.svelte';
	import Modal from './Modal.svelte';
	import { enterToggle } from '$lib/actions/enterToggle';

	interface Props {
		zone: CalcZone;
		zoneName: string;
		room: RoomConfig;
		values: number[][];
		valueFactor?: number;
		onclose: () => void;
	}

	let { zone, zoneName, room, values, valueFactor = 1, onclose }: Props = $props();

	// Export state
	let exporting = $state(false);
	let savingPlot = $state(false);
	let alertDialog = $state<{ title: string; message: string } | null>(null);

	// Display mode toggle
	let displayMode = $state<'heatmap' | 'numeric'>('heatmap');

	// Axes, ticks, and tick labels toggles
	let showAxes = $state(true);
	let showTickMarks = $state(true);
	let showTickLabels = $state(true);

	// Lamp labels toggle
	let showLampLabels = $state(false);

	// Numeric overlay controls
	let numericFontSize = $state<'auto' | 'small' | 'medium' | 'large'>('auto');
	let numericSigFigs = $state(1);

	// Canvas refs
	let canvas: HTMLCanvasElement;
	let numericCanvas: HTMLCanvasElement;

	async function exportCSV() {
		exporting = true;
		try {
			const blob = await getSessionZoneExport(zone.id);
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `${zoneName}.csv`;
			a.click();
			URL.revokeObjectURL(url);
		} catch (error) {
			console.error('Failed to export zone:', error);
			alertDialog = { title: 'Export Failed', message: 'Failed to export zone. Please try again.' };
		} finally {
			exporting = false;
		}
	}

	async function savePlot() {
		savingPlot = true;
		try {
			const scale = 2; // hi-res scale factor

			// Layout margins (in scaled pixels)
			const marginLeft = 80 * scale;   // Y-axis label + ticks
			const marginRight = (isSafetyZone && tlvScaleData ? 120 : 70) * scale; // colorbar (+ TLV)
			const marginTop = 36 * scale;    // title
			const marginBottom = 56 * scale; // X-axis ticks + label

			const plotW = Math.round(displayDims.width * scale);
			const plotH = Math.round(displayDims.height * scale);
			const totalW = marginLeft + plotW + marginRight;
			const totalH = marginTop + plotH + marginBottom;

			const offscreen = document.createElement('canvas');
			offscreen.width = totalW;
			offscreen.height = totalH;
			const ctx = offscreen.getContext('2d');
			if (!ctx) throw new Error('Could not get 2d context');

			// White background
			ctx.fillStyle = '#ffffff';
			ctx.fillRect(0, 0, totalW, totalH);

			const textColor = '#222222';
			const mutedColor = '#666666';
			const borderColor = '#999999';

			// --- Title ---
			ctx.fillStyle = textColor;
			ctx.font = `bold ${14 * scale}px sans-serif`;
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			const titleText = `${zoneName} \u2014 2D Plane @ ${bounds.fixedLabel}=${formatTick(bounds.fixed)} ${units}`;
			ctx.fillText(titleText, totalW / 2, marginTop / 2);

			// --- Heatmap ---
			const nU = values.length;
			const nV = values[0]?.length || 0;
			const { min: minVal, max: maxVal } = valueStats;
			const range = maxVal - minVal || 1;
			const cellWidth = plotW / nU;
			const cellHeight = plotH / nV;
			const saveLut = colorLUT;

			for (let i = 0; i < nU; i++) {
				for (let j = 0; j < nV; j++) {
					const val = values[i][j];
					const t = (val - minVal) / range;
					const lutIdx = Math.round(t * 255) * 4;
					ctx.fillStyle = `rgb(${saveLut[lutIdx]}, ${saveLut[lutIdx + 1]}, ${saveLut[lutIdx + 2]})`;
					const x = marginLeft + i * cellWidth;
					const canvasJ = shouldFlipV ? (nV - 1 - j) : j;
					const y = marginTop + canvasJ * cellHeight;
					ctx.fillRect(x, y, Math.ceil(cellWidth), Math.ceil(cellHeight));
				}
			}

			// Heatmap border
			ctx.strokeStyle = borderColor;
			ctx.lineWidth = 1 * scale;
			ctx.strokeRect(marginLeft, marginTop, plotW, plotH);

			// --- Numeric overlay ---
			if (displayMode === 'numeric' && !isGridTooDense) {
				const fontSize = resolvedFontSize * scale;
				ctx.font = `${fontSize}px monospace`;
				ctx.textAlign = 'center';
				ctx.textBaseline = 'middle';

				for (let i = 0; i < nU; i++) {
					for (let j = 0; j < nV; j++) {
						const val = values[i][j];
						const t = (val - minVal) / range;
						const lutIdx = Math.round(t * 255) * 4;
						const luminance = (0.299 * saveLut[lutIdx] + 0.587 * saveLut[lutIdx + 1] + 0.114 * saveLut[lutIdx + 2]) / 255;
						ctx.fillStyle = luminance < 0.5 ? 'white' : 'black';

						const canvasJ = shouldFlipV ? (nV - 1 - j) : j;
						const cx = marginLeft + (i + 0.5) * cellWidth;
						const cy = marginTop + (canvasJ + 0.5) * cellHeight;
						ctx.fillText(formatValue(val * valueFactor), cx, cy);
					}
				}
			}

			// --- Lamp labels ---
			if (showLampLabels && projectedLamps.length > 0) {
				for (const placement of labelPlacements) {
					const lx = marginLeft + placement.lamp.px * scale;
					const ly = marginTop + placement.lamp.py * scale;

					// Marker circle
					ctx.beginPath();
					ctx.arc(lx, ly, 5 * scale, 0, Math.PI * 2);
					ctx.fillStyle = 'white';
					ctx.fill();
					ctx.strokeStyle = '#333';
					ctx.lineWidth = 1.5 * scale;
					ctx.stroke();

					// Leader line if nudged
					if (placement.needsLeader) {
						ctx.beginPath();
						ctx.setLineDash([4 * scale, 3 * scale]);
						ctx.moveTo(lx, ly);
						ctx.lineTo(marginLeft + (placement.x + placement.width / 2) * scale, marginTop + (placement.y + placement.height) * scale);
						ctx.strokeStyle = 'rgba(255,255,255,0.7)';
						ctx.lineWidth = 1 * scale;
						ctx.stroke();
						ctx.setLineDash([]);
					}

					// Label background
					const bgX = marginLeft + placement.x * scale;
					const bgY = marginTop + placement.y * scale;
					const bgW = placement.width * scale;
					const bgH = placement.height * scale;
					ctx.fillStyle = 'rgba(0,0,0,0.7)';
					ctx.beginPath();
					ctx.roundRect(bgX, bgY, bgW, bgH, 4 * scale);
					ctx.fill();

					// Label text
					ctx.fillStyle = 'white';
					ctx.font = `${12 * scale}px monospace`;
					ctx.textAlign = 'center';
					ctx.textBaseline = 'middle';
					ctx.fillText(placement.lamp.name, bgX + bgW / 2, bgY + bgH / 2);
				}
			}

			// --- X-axis ticks and labels ---
			ctx.strokeStyle = textColor;
			ctx.fillStyle = textColor;
			ctx.lineWidth = 1 * scale;
			const tickLen = 6 * scale;
			const xTickFont = `${10 * scale}px monospace`;
			ctx.font = xTickFont;
			ctx.textAlign = 'center';
			ctx.textBaseline = 'top';

			for (const tick of uTicks) {
				const pct = (tick - bounds.u1) / (bounds.u2 - bounds.u1);
				const x = marginLeft + pct * plotW;
				const y = marginTop + plotH;
				ctx.beginPath();
				ctx.moveTo(x, y);
				ctx.lineTo(x, y + tickLen);
				ctx.stroke();
				ctx.fillText(formatTick(tick), x, y + tickLen + 2 * scale);
			}

			// X-axis label
			ctx.font = `${12 * scale}px sans-serif`;
			ctx.fillStyle = textColor;
			ctx.textAlign = 'center';
			ctx.textBaseline = 'top';
			ctx.fillText(`${bounds.uLabel} (${units})`, marginLeft + plotW / 2, marginTop + plotH + 30 * scale);

			// --- Y-axis ticks and labels ---
			ctx.font = xTickFont;
			ctx.textAlign = 'right';
			ctx.textBaseline = 'middle';
			ctx.fillStyle = textColor;

			for (const tick of vTicks) {
				const pct = (tick - bounds.v1) / (bounds.v2 - bounds.v1);
				const y = marginTop + plotH - pct * plotH; // bottom = v1, top = v2
				const x = marginLeft;
				ctx.beginPath();
				ctx.moveTo(x, y);
				ctx.lineTo(x - tickLen, y);
				ctx.stroke();
				ctx.fillText(formatTick(tick), x - tickLen - 3 * scale, y);
			}

			// Y-axis label (rotated)
			ctx.save();
			ctx.translate(16 * scale, marginTop + plotH / 2);
			ctx.rotate(-Math.PI / 2);
			ctx.font = `${12 * scale}px sans-serif`;
			ctx.fillStyle = textColor;
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText(`${bounds.vLabel} (${units})`, 0, 0);
			ctx.restore();

			// --- Colorbar ---
			const cbX = marginLeft + plotW + 16 * scale;
			const cbW = 14 * scale;
			const cbH = plotH;
			const cbY = marginTop;

			// Draw gradient
			for (let py = 0; py < cbH; py++) {
				const t = 1 - py / cbH; // top = max, bottom = min
				const lutIdx = Math.round(t * 255) * 4;
				ctx.fillStyle = `rgb(${saveLut[lutIdx]}, ${saveLut[lutIdx + 1]}, ${saveLut[lutIdx + 2]})`;
				ctx.fillRect(cbX, cbY + py, cbW, 1);
			}
			ctx.strokeStyle = borderColor;
			ctx.lineWidth = 1 * scale;
			ctx.strokeRect(cbX, cbY, cbW, cbH);

			// Colorbar labels (max, mid, min)
			ctx.font = `${9 * scale}px monospace`;
			ctx.fillStyle = textColor;
			ctx.textAlign = 'left';
			const cbLabelX = cbX + cbW + 4 * scale;

			ctx.textBaseline = 'top';
			ctx.fillText(formatValue(displayStats.max), cbLabelX, cbY);

			ctx.textBaseline = 'middle';
			ctx.fillText(formatValue((displayStats.min + displayStats.max) / 2), cbLabelX, cbY + cbH / 2);

			ctx.textBaseline = 'bottom';
			ctx.fillText(formatValue(displayStats.min), cbLabelX, cbY + cbH);

			// Colorbar unit label
			ctx.font = `${9 * scale}px sans-serif`;
			ctx.fillStyle = mutedColor;
			ctx.textAlign = 'center';
			ctx.textBaseline = 'top';
			ctx.fillText(valueUnits, cbX + cbW / 2, cbY + cbH + 6 * scale);

			// --- TLV Scale (for safety zones) ---
			if (isSafetyZone && tlvScaleData) {
				const tlvX = cbX + cbW + 50 * scale;
				const tlvW = 10 * scale;
				const tlvH = plotH;
				const tlvY = marginTop;

				// Background bar
				const grad = ctx.createLinearGradient(0, tlvY + tlvH, 0, tlvY);
				grad.addColorStop(0, 'rgba(76, 175, 80, 0.05)');
				grad.addColorStop(1, 'rgba(76, 175, 80, 0.2)');
				ctx.fillStyle = grad;
				ctx.fillRect(tlvX, tlvY, tlvW, tlvH);
				ctx.strokeStyle = borderColor;
				ctx.lineWidth = 1 * scale;
				ctx.strokeRect(tlvX, tlvY, tlvW, tlvH);

				// +/-10% band
				const bandBottom = tlvY + tlvH - (tlvScaleData.bandLow / 100) * tlvH;
				const bandTop = tlvY + tlvH - (tlvScaleData.bandHigh / 100) * tlvH;
				ctx.fillStyle = 'rgba(255, 235, 59, 0.35)';
				ctx.fillRect(tlvX, bandTop, tlvW, bandBottom - bandTop);
				ctx.setLineDash([4 * scale, 3 * scale]);
				ctx.strokeStyle = 'rgba(200, 180, 0, 0.8)';
				ctx.beginPath();
				ctx.moveTo(tlvX, bandTop);
				ctx.lineTo(tlvX + tlvW, bandTop);
				ctx.moveTo(tlvX, bandBottom);
				ctx.lineTo(tlvX + tlvW, bandBottom);
				ctx.stroke();
				ctx.setLineDash([]);

				// Max value indicator
				const indicatorPct = Math.min(tlvScaleData.maxPercent, 100);
				const indicatorY = tlvY + tlvH - (indicatorPct / 100) * tlvH;
				ctx.fillStyle = tlvScaleData.exceedsLimit ? '#f44336' : '#4caf50';
				ctx.fillRect(tlvX - 3 * scale, indicatorY - 1.5 * scale, tlvW + 6 * scale, 3 * scale);

				// Indicator label
				ctx.font = `${8 * scale}px monospace`;
				ctx.fillStyle = tlvScaleData.exceedsLimit ? '#f44336' : textColor;
				ctx.textAlign = 'left';
				ctx.textBaseline = 'middle';
				ctx.fillText(formatValue(tlvScaleData.maxVal), tlvX + tlvW + 4 * scale, indicatorY);

				// TLV labels
				ctx.fillStyle = mutedColor;
				ctx.font = `${8 * scale}px monospace`;
				ctx.textAlign = 'left';
				const tlvLabelX = tlvX + tlvW + 4 * scale;
				ctx.textBaseline = 'top';
				ctx.fillText(formatValue(tlvLimit), tlvLabelX, tlvY);
				ctx.textBaseline = 'bottom';
				ctx.fillText('0', tlvLabelX, tlvY + tlvH);

				// TLV unit + status
				ctx.font = `bold ${9 * scale}px sans-serif`;
				ctx.fillStyle = mutedColor;
				ctx.textAlign = 'center';
				ctx.textBaseline = 'top';
				ctx.fillText('TLV', tlvX + tlvW / 2, tlvY + tlvH + 6 * scale);

				const statusColor = tlvScaleData.isCompliant ? '#4caf50' : '#f44336';
				ctx.fillStyle = statusColor;
				ctx.fillText(tlvScaleData.isCompliant ? 'PASS' : 'FAIL', tlvX + tlvW / 2, tlvY + tlvH + 20 * scale);
			}

			offscreen.toBlob((blob) => {
				if (!blob) return;
				const url = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				a.download = `${zoneName}.png`;
				a.click();
				URL.revokeObjectURL(url);
			}, 'image/png');
		} catch (error) {
			console.error('Failed to save plot:', error);
			alertDialog = { title: 'Save Failed', message: 'Failed to save plot. Please try again.' };
		} finally {
			savingPlot = false;
		}
	}

	// Reference surface determines plane orientation
	const refSurface = $derived(zone.ref_surface || 'xy');
	const units = $derived(room.units === 'feet' ? 'ft' : 'm');
	const colormap = $derived(room.colormap || 'plasma');

	// Value units depend on whether this is a dose calculation
	const valueUnits = $derived(zone.dose ? 'mJ/cm²' : 'µW/cm²');

	// Determine if V axis should be flipped (when v points in positive direction)
	// Use v_positive_direction from geometry if available, otherwise compute from ref_surface/direction
	const shouldFlipV = $derived.by(() => {
		// Prefer the computed value from backend geometry
		if (zone.v_positive_direction !== undefined) {
			return zone.v_positive_direction;
		}
		// Fallback: compute from ref_surface and direction (for axis-aligned planes)
		const direction = zone.direction ?? 1;
		if (refSurface === 'xz') {
			// XZ: v points +Z when direction=-1, -Z when direction=1
			return direction < 0;
		}
		// XY and YZ: v points positive when direction=1
		return direction > 0;
	});

	// Calculate plane bounds based on reference surface
	// For each plane type, the "fixed" axis is the perpendicular one:
	// XY plane: Z is fixed, XZ plane: Y is fixed, YZ plane: X is fixed
	const bounds = $derived.by(() => {
		const height = zone.height ?? 0;
		switch (refSurface) {
			case 'xz':
				return {
					u1: zone.x1 ?? 0,
					u2: zone.x2 ?? room.x,
					v1: zone.z_min ?? 0,
					v2: zone.z_max ?? room.z,
					fixed: height,
					uLabel: 'X',
					vLabel: 'Z',
					fixedLabel: 'Y'
				};
			case 'yz':
				return {
					u1: zone.y1 ?? 0,
					u2: zone.y2 ?? room.y,
					v1: zone.z_min ?? 0,
					v2: zone.z_max ?? room.z,
					fixed: height,
					uLabel: 'Y',
					vLabel: 'Z',
					fixedLabel: 'X'
				};
			case 'xy':
			default:
				return {
					u1: zone.x1 ?? 0,
					u2: zone.x2 ?? room.x,
					v1: zone.y1 ?? 0,
					v2: zone.y2 ?? room.y,
					fixed: height,
					uLabel: 'X',
					vLabel: 'Y',
					fixedLabel: 'Z'
				};
		}
	});

	// Aspect ratio from physical dimensions (width / height)
	const physicalWidth = $derived(bounds.u2 - bounds.u1);
	const physicalHeight = $derived(bounds.v2 - bounds.v1);
	const aspectRatio = $derived(physicalWidth / physicalHeight);

	// Calculate display dimensions to fit within max bounds while maintaining aspect ratio
	const maxDisplayWidth = 550;
	const maxDisplayHeight = 400;
	const displayDims = $derived.by(() => {
		let width = maxDisplayWidth;
		let height = width / aspectRatio;

		if (height > maxDisplayHeight) {
			height = maxDisplayHeight;
			width = height * aspectRatio;
		}

		return { width, height };
	});

	// Generate tick values for an axis
	function generateTicks(min: number, max: number, count: number = 5): number[] {
		const range = max - min;
		const step = range / (count - 1);
		const ticks: number[] = [];
		for (let i = 0; i < count; i++) {
			ticks.push(min + i * step);
		}
		return ticks;
	}

	// Format tick value for display
	function formatTick(value: number): string {
		if (Math.abs(value) < 0.01) return '0';
		if (Math.abs(value) >= 100) return value.toFixed(0);
		if (Math.abs(value) >= 10) return value.toFixed(1);
		return value.toFixed(2);
	}

	// Tick arrays
	const uTicks = $derived(generateTicks(bounds.u1, bounds.u2));
	const vTicks = $derived(generateTicks(bounds.v1, bounds.v2));

	// Calculate tick position as percentage
	function tickPercent(value: number, min: number, max: number): number {
		return ((value - min) / (max - min)) * 100;
	}

	// Value statistics for color mapping (raw, used for heatmap normalization)
	const valueStats = $derived.by(() => {
		let min = Infinity, max = -Infinity;
		for (const row of values) {
			for (const v of row) {
				if (v < min) min = v;
				if (v > max) max = v;
			}
		}
		return { min, max };
	});

	// Display-converted statistics (with dose conversion factor applied)
	const displayStats = $derived({
		min: valueStats.min * valueFactor,
		max: valueStats.max * valueFactor
	});

	// Format value for legend and numeric overlay
	function formatValue(value: number): string {
		if (value === 0) return '0';
		return value.toPrecision(numericSigFigs);
	}

	// Grid dimensions
	const numU = $derived(values.length);
	const numV = $derived(values[0]?.length || 0);
	const isGridTooDense = $derived(numU > 25 || numV > 25);

	// Resolved font size for numeric overlay
	const resolvedFontSize = $derived.by(() => {
		const cellWidth = displayDims.width / numU;
		const cellHeight = displayDims.height / numV;
		const autoSize = Math.max(8, Math.min(cellWidth, cellHeight) * 0.35);
		switch (numericFontSize) {
			case 'small': return Math.max(7, autoSize * 0.7);
			case 'large': return autoSize * 1.4;
			default: return autoSize;
		}
	});

	// Pre-build 256-entry RGBA lookup table for the current colormap.
	// Eliminates per-pixel valueToColor() calls (string parsing + binary search).
	const colorLUT = $derived.by(() => {
		const lut = new Uint8Array(256 * 4);
		for (let i = 0; i < 256; i++) {
			const t = i / 255;
			const c = valueToColor(t, colormap);
			lut[i * 4] = Math.round(c.r * 255);
			lut[i * 4 + 1] = Math.round(c.g * 255);
			lut[i * 4 + 2] = Math.round(c.b * 255);
			lut[i * 4 + 3] = 255;
		}
		return lut;
	});

	// Draw heatmap on canvas
	$effect(() => {
		if (!canvas) return;

		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		if (numU < 1 || numV < 1) return;

		// Set canvas size to match data dimensions for crisp pixels
		canvas.width = numU;
		canvas.height = numV;

		// Find value range
		const { min: minVal, max: maxVal } = valueStats;
		const range = maxVal - minVal || 1;

		// Draw each cell using pre-built color LUT
		const imageData = ctx.createImageData(numU, numV);
		const lut = colorLUT;
		for (let i = 0; i < numU; i++) {
			for (let j = 0; j < numV; j++) {
				const val = values[i][j];
				const t = (val - minVal) / range;
				const lutIdx = Math.round(t * 255) * 4;

				// Canvas Y=0 is at top. Flip when v points in positive direction
				// so that positive world coordinates appear at top of image.
				const canvasJ = shouldFlipV ? (numV - 1 - j) : j;
				const pixelIndex = (canvasJ * numU + i) * 4;
				imageData.data[pixelIndex] = lut[lutIdx];
				imageData.data[pixelIndex + 1] = lut[lutIdx + 1];
				imageData.data[pixelIndex + 2] = lut[lutIdx + 2];
				imageData.data[pixelIndex + 3] = 255;
			}
		}
		ctx.putImageData(imageData, 0, 0);
	});

	// Generate legend gradient stops
	const legendGradient = $derived.by(() => {
		const stops = [];
		for (let i = 0; i <= 10; i++) {
			const t = i / 10;
			const c = valueToColor(t, colormap);
			stops.push(`rgb(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}) ${t * 100}%`);
		}
		return stops.join(', ');
	});

	// Draw numeric values on overlay canvas
	$effect(() => {
		if (!numericCanvas) return;
		const ctx = numericCanvas.getContext('2d');
		if (!ctx) return;

		// Size to display pixels
		numericCanvas.width = displayDims.width;
		numericCanvas.height = displayDims.height;
		ctx.clearRect(0, 0, numericCanvas.width, numericCanvas.height);

		if (displayMode !== 'numeric' || isGridTooDense) return;

		const { min: minVal, max: maxVal } = valueStats;
		const range = maxVal - minVal || 1;
		const cellWidth = displayDims.width / numU;
		const cellHeight = displayDims.height / numV;

		ctx.font = `${resolvedFontSize}px monospace`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';

		const numLut = colorLUT;
		for (let i = 0; i < numU; i++) {
			for (let j = 0; j < numV; j++) {
				const val = values[i][j];
				const t = (val - minVal) / range;
				const lutIdx = Math.round(t * 255) * 4;
				const luminance = (0.299 * numLut[lutIdx] + 0.587 * numLut[lutIdx + 1] + 0.114 * numLut[lutIdx + 2]) / 255;
				ctx.fillStyle = luminance < 0.5 ? 'white' : 'black';

				const canvasJ = shouldFlipV ? (numV - 1 - j) : j;
				const cx = (i + 0.5) * cellWidth;
				const cy = (canvasJ + 0.5) * cellHeight;
				ctx.fillText(formatValue(val * valueFactor), cx, cy);
			}
		}
	});

	// --- TLV Safety Limit Scale ---
	const isSafetyZone = $derived(zone.id === 'SkinLimits' || zone.id === 'EyeLimits');
	const tlvLimit = $derived.by(() => {
		if (!isSafetyZone) return 0;
		const limits = TLV_LIMITS[room.standard];
		if (!limits) return 0;
		return zone.id === 'SkinLimits' ? limits.skin : limits.eye;
	});
	const tlvScaleData = $derived.by(() => {
		if (!isSafetyZone || tlvLimit <= 0) return null;
		const maxVal = displayStats.max;
		const maxPercent = Math.min((maxVal / tlvLimit) * 100, 100);
		const bandLow = Math.max(Math.min((tlvLimit * 0.9 / tlvLimit) * 100, 100), 0);
		const bandHigh = Math.min((tlvLimit * 1.1 / tlvLimit) * 100, 100);
		return {
			maxPercent,
			bandLow,   // 90% mark as percent of TLV
			bandHigh,  // 110% mark - clamped to 100 visually
			isCompliant: maxVal <= tlvLimit,
			exceedsLimit: maxVal > tlvLimit,
			maxVal
		};
	});

	// --- Lamp Labels ---
	interface ProjectedLamp {
		name: string;
		u: number;
		v: number;
		px: number;
		py: number;
	}

	interface LabelPlacement {
		lamp: ProjectedLamp;
		x: number;
		y: number;
		width: number;
		height: number;
		needsLeader: boolean;
	}

	const projectedLamps = $derived.by((): ProjectedLamp[] => {
		if (!showLampLabels) return [];
		const lampList: LampInstance[] = $lamps;
		if (!lampList?.length) return [];

		return lampList
			.filter(l => l.enabled)
			.map(l => {
				let u: number, v: number;
				switch (refSurface) {
					case 'xz': u = l.x; v = l.z; break;
					case 'yz': u = l.y; v = l.z; break;
					case 'xy':
					default:   u = l.x; v = l.y; break;
				}
				// Convert to pixel coords within displayDims
				const px = ((u - bounds.u1) / (bounds.u2 - bounds.u1)) * displayDims.width;
				const rawVPercent = (v - bounds.v1) / (bounds.v2 - bounds.v1);
				const py = shouldFlipV
					? (1 - rawVPercent) * displayDims.height
					: rawVPercent * displayDims.height;
				return { name: l.name || l.id, u, v, px, py };
			})
			.filter(l =>
				l.px >= -10 && l.px <= displayDims.width + 10 &&
				l.py >= -10 && l.py <= displayDims.height + 10
			);
	});

	const labelPlacements = $derived.by((): LabelPlacement[] => {
		if (!projectedLamps.length) return [];
		const charWidth = 7;
		const labelHeight = 18;
		const labelPadding = 8;
		const markerOffset = 20;

		let placements: LabelPlacement[] = projectedLamps.map(lamp => {
			const width = lamp.name.length * charWidth + labelPadding * 2;
			return {
				lamp,
				x: lamp.px - width / 2,
				y: lamp.py - markerOffset - labelHeight,
				width,
				height: labelHeight,
				needsLeader: false
			};
		});

		// Iterative collision avoidance
		for (let iter = 0; iter < 10; iter++) {
			let anyOverlap = false;
			for (let i = 0; i < placements.length; i++) {
				for (let j = i + 1; j < placements.length; j++) {
					const a = placements[i];
					const b = placements[j];
					// Check overlap
					if (a.x < b.x + b.width && a.x + a.width > b.x &&
						a.y < b.y + b.height && a.y + a.height > b.y) {
						anyOverlap = true;
						const nudge = 10;
						// Push them apart vertically
						if (a.y <= b.y) {
							a.y -= nudge;
							b.y += nudge;
						} else {
							a.y += nudge;
							b.y -= nudge;
						}
						a.needsLeader = true;
						b.needsLeader = true;
					}
				}
			}
			if (!anyOverlap) break;
		}

		// Clamp labels within plot bounds
		const margin = 4;
		for (const p of placements) {
			if (p.x < margin) p.x = margin;
			else if (p.x + p.width > displayDims.width - margin) p.x = displayDims.width - margin - p.width;

			if (p.y < margin) { p.y = margin; p.needsLeader = true; }
			else if (p.y + p.height > displayDims.height - margin) { p.y = displayDims.height - margin - p.height; p.needsLeader = true; }
		}

		return placements;
	});
</script>

<Modal title={zoneName} onClose={onclose} maxWidth={isSafetyZone ? "min(820px, 95vw)" : "min(750px, 95vw)"} maxHeight="95vh" titleFontSize="1rem">
	{#snippet headerExtra()}
		<span class="plane-badge">2D Plane @ {bounds.fixedLabel}={formatTick(bounds.fixed)} {units}</span>
	{/snippet}
	{#snippet body()}
		<div class="modal-body">
			<div class="plot-wrapper">
				<!-- Y axis label (rotated) -->
				<div class="y-label" class:hidden-keep-layout={!showAxes} style="height: {displayDims.height}px;">{bounds.vLabel} ({units})</div>

				<!-- Y axis ticks -->
				<div class="y-axis" style="height: {displayDims.height}px;">
					{#each vTicks as tick}
						<div class="y-tick" style="bottom: {tickPercent(tick, bounds.v1, bounds.v2)}%">
							<span class="tick-label" class:hidden-keep-layout={!showTickLabels}>{formatTick(tick)}</span>
							<span class="tick-mark" class:hidden-keep-layout={!showTickMarks}></span>
						</div>
					{/each}
				</div>

				<!-- Center column: canvas + x-axis -->
				<div class="center-column">
					<div class="canvas-container" style="width: {displayDims.width}px; height: {displayDims.height}px;">
						<canvas bind:this={canvas}></canvas>
						<canvas bind:this={numericCanvas} class="numeric-overlay"></canvas>
						{#if displayMode === 'numeric' && isGridTooDense}
							<div class="dense-grid-message">
								Grid too dense ({numU}&times;{numV}) to display numeric values
							</div>
						{/if}
						{#if showLampLabels && projectedLamps.length > 0}
							<svg class="lamp-overlay" viewBox="0 0 {displayDims.width} {displayDims.height}">
								{#each labelPlacements as placement}
									<!-- Leader line -->
									{#if placement.needsLeader}
										<line
											x1={placement.lamp.px}
											y1={placement.lamp.py}
											x2={placement.x + placement.width / 2}
											y2={placement.y + placement.height}
											stroke="rgba(255,255,255,0.7)"
											stroke-width="1"
											stroke-dasharray="4 3"
										/>
									{/if}
									<!-- Marker circle -->
									<circle
										cx={placement.lamp.px}
										cy={placement.lamp.py}
										r="5"
										fill="white"
										stroke="#333"
										stroke-width="1.5"
									/>
									<!-- Label background -->
									<rect
										x={placement.x}
										y={placement.y}
										width={placement.width}
										height={placement.height}
										rx="4"
										fill="rgba(0,0,0,0.7)"
									/>
									<!-- Label text -->
									<text
										x={placement.x + placement.width / 2}
										y={placement.y + placement.height / 2}
										text-anchor="middle"
										dominant-baseline="central"
										fill="white"
										font-size="11"
										font-family="var(--font-mono, monospace)"
									>{placement.lamp.name}</text>
								{/each}
							</svg>
						{/if}
					</div>

					<div class="x-axis" style="width: {displayDims.width}px;">
						{#each uTicks as tick}
							<div class="x-tick" style="left: {tickPercent(tick, bounds.u1, bounds.u2)}%">
								<span class="tick-mark" class:hidden-keep-layout={!showTickMarks}></span>
								<span class="tick-label" class:hidden-keep-layout={!showTickLabels}>{formatTick(tick)}</span>
							</div>
						{/each}
					</div>
					<div class="x-label" class:hidden-keep-layout={!showAxes}>{bounds.uLabel} ({units})</div>
				</div>

				<!-- Color legend -->
				<div class="legend-column">
					<div class="legend-content" style="height: {displayDims.height}px;">
						<div class="legend-bar" style="background: linear-gradient(to top, {legendGradient})"></div>
						<div class="legend-labels">
							<span class="legend-label-top">{formatValue(displayStats.max)}</span>
							<span class="legend-label-mid">{formatValue((displayStats.min + displayStats.max) / 2)}</span>
							<span class="legend-label-bot">{formatValue(displayStats.min)}</span>
						</div>
					</div>
					<div class="legend-unit">{valueUnits}</div>
				</div>

				<!-- TLV Safety Limit Scale -->
				{#if isSafetyZone && tlvScaleData}
					<div class="tlv-column">
						<div class="tlv-content" style="height: {displayDims.height}px;">
							<div class="tlv-bar">
								<!-- +/-10% band -->
								<div
									class="tlv-band"
									style="bottom: {tlvScaleData.bandLow}%; height: {tlvScaleData.bandHigh - tlvScaleData.bandLow}%;"
								></div>
								<!-- Max value indicator -->
								{#if tlvScaleData.exceedsLimit}
									<div class="tlv-indicator tlv-indicator-fail" style="bottom: 100%;">
										<span class="tlv-indicator-label tlv-fail">{formatValue(tlvScaleData.maxVal)}</span>
									</div>
								{:else}
									<div class="tlv-indicator tlv-indicator-pass" style="bottom: {tlvScaleData.maxPercent}%;">
										<span class="tlv-indicator-label">{formatValue(tlvScaleData.maxVal)}</span>
									</div>
								{/if}
							</div>
							<div class="tlv-labels">
								<span class="tlv-label-top">{formatValue(tlvLimit)}</span>
								<span class="tlv-label-bot">0</span>
							</div>
						</div>
						<div class="tlv-unit">TLV</div>
						<div class="tlv-status" class:tlv-pass={tlvScaleData.isCompliant} class:tlv-fail-status={tlvScaleData.exceedsLimit}>
							{tlvScaleData.isCompliant ? 'PASS' : 'FAIL'}
						</div>
					</div>
				{/if}
			</div>
		</div>
	{/snippet}
	{#snippet footer()}
		<div class="modal-footer">
			<div class="footer-controls">
				<select class="display-mode-select" bind:value={displayMode}>
					<option value="heatmap">Heatmap</option>
					<option value="numeric">Numeric</option>
				</select>
				{#if displayMode === 'numeric'}
					<select class="display-mode-select" bind:value={numericFontSize}>
						<option value="auto">Font: Auto</option>
						<option value="small">Font: Small</option>
						<option value="medium">Font: Medium</option>
						<option value="large">Font: Large</option>
					</select>
					<label class="precision-label">
						Display precision
						<input type="number" class="precision-input" bind:value={numericSigFigs} step={1} />
					</label>
				{/if}
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
	.hidden-keep-layout {
		visibility: hidden;
	}

	.plane-badge {
		font-size: 0.65rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		background: var(--color-bg-tertiary);
		padding: 2px 8px;
		border-radius: var(--radius-sm);
	}

	.modal-body {
		padding: var(--spacing-md);
		display: flex;
		justify-content: center;
		align-items: center;
		min-height: 0;
		flex: 1;
		overflow: auto;
	}

	.plot-wrapper {
		display: flex;
		align-items: flex-start;
		gap: 8px;
	}

	.y-label {
		writing-mode: vertical-rl;
		transform: rotate(180deg);
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--color-text);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.y-axis {
		width: 45px;
		position: relative;
		flex-shrink: 0;
	}

	.y-tick {
		position: absolute;
		right: 0;
		transform: translateY(50%);
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.y-tick .tick-label {
		font-size: 0.8rem;
		color: var(--color-text);
		font-family: var(--font-mono);
		text-align: right;
	}

	.y-tick .tick-mark {
		width: 6px;
		height: 1px;
		background: var(--color-text-muted);
	}

	.center-column {
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.canvas-container {
		position: relative;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		overflow: hidden;
		background: var(--color-bg-secondary);
	}

	.canvas-container canvas {
		width: 100%;
		height: 100%;
		display: block;
		image-rendering: pixelated;
		image-rendering: crisp-edges;
	}

	.numeric-overlay {
		position: absolute;
		top: 0;
		left: 0;
		image-rendering: auto !important;
		pointer-events: none;
	}

	.dense-grid-message {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		background: rgba(0, 0, 0, 0.75);
		color: white;
		padding: 8px 16px;
		border-radius: var(--radius-sm);
		font-size: 0.8rem;
		white-space: normal;
		text-align: center;
		max-width: 90%;
		pointer-events: none;
	}

	.lamp-overlay {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}

	.x-axis {
		position: relative;
		height: 28px;
		margin-top: 4px;
	}

	.x-tick {
		position: absolute;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
	}

	.x-tick .tick-mark {
		width: 1px;
		height: 6px;
		background: var(--color-text-muted);
	}

	.x-tick .tick-label {
		font-size: 0.8rem;
		color: var(--color-text);
		font-family: var(--font-mono);
	}

	.x-label {
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--color-text);
		text-align: center;
		margin-top: 4px;
	}

	.legend-column {
		display: flex;
		flex-direction: column;
		align-items: center;
		margin-left: 12px;
	}

	.legend-content {
		display: flex;
		gap: 6px;
	}

	.legend-bar {
		width: 16px;
		height: 100%;
		border-radius: 2px;
		border: 1px solid var(--color-border);
	}

	.legend-labels {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		height: 100%;
	}

	.legend-labels span {
		font-size: 0.75rem;
		color: var(--color-text);
		font-family: var(--font-mono);
		line-height: 1;
	}

	.legend-label-top {
		align-self: flex-start;
	}

	.legend-label-mid {
		align-self: center;
	}

	.legend-label-bot {
		align-self: flex-end;
	}

	.legend-unit {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		margin-top: 4px;
		text-align: center;
	}

	/* TLV Safety Limit Scale */
	.tlv-column {
		display: flex;
		flex-direction: column;
		align-items: center;
		margin-left: 12px;
	}

	.tlv-content {
		display: flex;
		gap: 6px;
	}

	.tlv-bar {
		width: 12px;
		height: 100%;
		border-radius: 2px;
		border: 1px solid var(--color-border);
		background: linear-gradient(to top, rgba(76, 175, 80, 0.2), rgba(76, 175, 80, 0.05));
		position: relative;
	}

	.tlv-band {
		position: absolute;
		left: 0;
		right: 0;
		background: rgba(255, 235, 59, 0.35);
		border-top: 1px dashed rgba(255, 235, 59, 0.8);
		border-bottom: 1px dashed rgba(255, 235, 59, 0.8);
	}

	.tlv-indicator {
		position: absolute;
		left: -4px;
		right: -4px;
		height: 3px;
		border-radius: 1px;
		transform: translateY(50%);
	}

	.tlv-indicator-pass {
		background: #4caf50;
	}

	.tlv-indicator-fail {
		background: #f44336;
	}

	.tlv-indicator-label {
		position: absolute;
		left: calc(100% + 4px);
		top: 50%;
		transform: translateY(-50%);
		font-size: 0.65rem;
		font-family: var(--font-mono);
		color: var(--color-text);
		white-space: nowrap;
	}

	.tlv-indicator-label.tlv-fail {
		color: #f44336;
		font-weight: 600;
	}

	.tlv-labels {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		height: 100%;
	}

	.tlv-labels span {
		font-size: 0.65rem;
		color: var(--color-text-muted);
		font-family: var(--font-mono);
		line-height: 1;
	}

	.tlv-label-top {
		align-self: flex-start;
	}

	.tlv-label-bot {
		align-self: flex-end;
	}

	.tlv-unit {
		font-size: 0.65rem;
		color: var(--color-text-muted);
		margin-top: 4px;
		text-align: center;
		font-weight: 600;
	}

	.tlv-status {
		font-size: 0.65rem;
		font-weight: 700;
		margin-top: 2px;
		text-align: center;
	}

	.tlv-pass {
		color: #4caf50;
	}

	.tlv-fail-status {
		color: #f44336;
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

	.footer-controls {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		flex-wrap: wrap;
	}

	.display-mode-select {
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: 2px var(--spacing-xs);
		font-size: 0.8rem;
		color: var(--color-text);
		cursor: pointer;
	}

	.precision-label {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	.precision-input {
		width: 3.5rem;
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: 2px var(--spacing-xs);
		font-size: 0.8rem;
		color: var(--color-text);
		text-align: center;
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
		font-size: 0.8rem;
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.checkbox-label input[type="checkbox"] {
		width: auto;
		margin: 0;
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

	.export-btn:hover {
		background: var(--color-bg-secondary);
		border-color: var(--color-text-muted);
	}

	.export-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.footer-buttons {
		display: flex;
		gap: var(--spacing-sm);
		flex-shrink: 0;
	}
</style>
