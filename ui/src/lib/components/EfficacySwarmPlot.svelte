<script lang="ts">
	import {
		getCategoryColor,
		type EfficacyRow,
		type EfficacyStats
	} from '$lib/utils/efficacy-filters';
	import { formatValue } from '$lib/utils/formatting';

	interface Props {
		filteredData: EfficacyRow[];
		stats: EfficacyStats;
		dataCategories: string[];
		roomVolumeM3: number;
		airChanges: number;
		fluence?: number;
		mediums: string[];
		cadrUnit: 'lps' | 'cfm';
		onCadrUnitChange: (unit: 'lps' | 'cfm') => void;
	}

	let { filteredData, stats, dataCategories, roomVolumeM3, airChanges, fluence, mediums, cadrUnit, onCadrUnitChange }: Props = $props();

	// eACH/CADR/air changes only apply when Aerosol is the only medium selected
	const showAirMetrics = $derived(fluence !== undefined && mediums.length === 1 && mediums[0] === 'Aerosol');

	// Value accessor: eACH-UV when air metrics shown, k1 otherwise
	const getValue = $derived((r: EfficacyRow) => showAirMetrics ? r.each_uv : r.k1);
	const yAxisLabel = $derived(showAirMetrics ? 'eACH-UV' : 'k₁ [cm²/mJ]');

	// --- Layout: x-axis = species, grouped by category, like guv-calcs ---

	interface SpeciesGroup {
		species: string;
		category: string;
		rows: EfficacyRow[];
	}

	const speciesGroups = $derived.by((): SpeciesGroup[] => {
		if (filteredData.length === 0) return [];

		const map = new Map<string, { category: string; rows: EfficacyRow[] }>();
		for (const row of filteredData) {
			const existing = map.get(row.species);
			if (existing) {
				existing.rows.push(row);
			} else {
				map.set(row.species, { category: row.category, rows: [row] });
			}
		}

		const groups = Array.from(map.entries()).map(([species, { category, rows }]) => ({
			species,
			category,
			rows
		}));
		groups.sort((a, b) => {
			const catCmp = a.category.localeCompare(b.category);
			if (catCmp !== 0) return catCmp;
			return a.species.localeCompare(b.species);
		});

		return groups;
	});

	interface CategorySeparator {
		x: number;
		label: string;
		labelX: number;
	}

	// Color by wavelength when multiple wavelengths present
	const uniqueWavelengths = $derived(
		[...new Set(filteredData.map(r => r.wavelength))].sort((a, b) => a - b)
	);
	const colorByWavelength = $derived(uniqueWavelengths.length > 1);

	// Wavelength legend items (matching guv-calcs binning logic)
	function formatWavelength(wl: number): string {
		return Number.isInteger(wl) ? `${wl} nm` : `${wl.toFixed(1)} nm`;
	}

	interface LegendItem {
		label: string;
		color: string;
	}

	const wavelengthLegendItems = $derived.by((): LegendItem[] => {
		if (uniqueWavelengths.length <= 1) return [];
		if (uniqueWavelengths.length <= 10) {
			return uniqueWavelengths.map(wl => ({
				label: formatWavelength(wl),
				color: wavelengthToColor(wl)
			}));
		}
		// Bin into 10nm ranges
		const binSize = 10;
		const minWl = Math.floor(uniqueWavelengths[0] / binSize) * binSize;
		const maxWl = Math.ceil(uniqueWavelengths[uniqueWavelengths.length - 1] / binSize) * binSize;
		const items: LegendItem[] = [];
		for (let binStart = minWl; binStart < maxWl; binStart += binSize) {
			const binEnd = binStart + binSize;
			const inBin = uniqueWavelengths.filter(w => w >= binStart && w < binEnd);
			if (inBin.length === 0) continue;
			const avg = inBin.reduce((s, w) => s + w, 0) / inBin.length;
			items.push({
				label: `${binStart}–${binEnd} nm`,
				color: wavelengthToColor(avg)
			});
		}
		return items;
	});

	const showLegend = $derived(colorByWavelength && wavelengthLegendItems.length > 0);

	// Medium shapes (matching guv-calcs seaborn defaults: circle, square, diamond)
	type MarkerShape = 'circle' | 'square' | 'diamond';
	const MEDIUM_SHAPES: Record<string, MarkerShape> = {
		'Aerosol': 'circle',
		'Surface': 'square',
		'Liquid': 'diamond',
	};
	const uniqueMediumsInData = $derived(
		[...new Set(filteredData.map(r => r.medium))].sort()
	);
	const multipleMediums = $derived(uniqueMediumsInData.length > 1);

	function getMediumShape(medium: string): MarkerShape {
		return MEDIUM_SHAPES[medium] || 'circle';
	}

	// UV rainbow colormap: hand-picked high-contrast colors for dark backgrounds.
	// Each stop is maximally distinct from its neighbors.
	function wavelengthToColor(wl: number): string {
		const stops: { wl: number; hex: string }[] = [
			{ wl: 200, hex: '#a855f7' }, // purple
			{ wl: 222, hex: '#3b82f6' }, // blue
			{ wl: 240, hex: '#06b6d4' }, // cyan
			{ wl: 255, hex: '#10b981' }, // emerald
			{ wl: 270, hex: '#eab308' }, // yellow
			{ wl: 285, hex: '#f97316' }, // orange
			{ wl: 310, hex: '#ef4444' }, // red
		];
		if (wl <= stops[0].wl) return stops[0].hex;
		if (wl >= stops[stops.length - 1].wl) return stops[stops.length - 1].hex;
		for (let i = 0; i < stops.length - 1; i++) {
			if (wl <= stops[i + 1].wl) {
				const f = (wl - stops[i].wl) / (stops[i + 1].wl - stops[i].wl);
				const c1 = hexToRgb(stops[i].hex);
				const c2 = hexToRgb(stops[i + 1].hex);
				const r = Math.round(c1[0] + (c2[0] - c1[0]) * f);
				const g = Math.round(c1[1] + (c2[1] - c1[1]) * f);
				const b = Math.round(c1[2] + (c2[2] - c1[2]) * f);
				return `rgb(${r}, ${g}, ${b})`;
			}
		}
		return stops[stops.length - 1].hex;
	}

	function hexToRgb(hex: string): [number, number, number] {
		const n = parseInt(hex.slice(1), 16);
		return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
	}

	function getPointColor(row: EfficacyRow): string {
		if (colorByWavelength) return wavelengthToColor(row.wavelength);
		return getCategoryColor(row.category);
	}

	// CADR conversion: eACH-UV * volume -> CADR
	// CADR (lps) = eACH * volume_m3 * 1000 / 3600
	// CADR (cfm) = eACH * volume_ft3 / 60
	const CUBIC_FEET_PER_M3 = 35.3147;
	function eachToCADR(each_uv: number): number {
		if (cadrUnit === 'cfm') {
			return each_uv * roomVolumeM3 * CUBIC_FEET_PER_M3 / 60;
		}
		return each_uv * roomVolumeM3 * 1000 / 3600;
	}

	// Scale mode toggle
	let logScale = $state(false);

	// Approximate text width for species labels (~5.5px per char at 0.65rem)
	const CHAR_WIDTH = 5.5;
	const COS45 = Math.SQRT1_2;
	const SIN45 = Math.SQRT1_2;
	const LABEL_Y_OFFSET = 12; // species labels start this far below x-axis

	// Longest species name descent (vertical extent of rotated text below x-axis)
	const maxLabelDescent = $derived(
		speciesGroups.length > 0
			? Math.max(...speciesGroups.map(g => g.species.length)) * CHAR_WIDTH * SIN45
			: 50
	);

	// Bottom padding: species labels + category labels (both inside SVG)
	const dynamicBottom = $derived(LABEL_Y_OFFSET + Math.ceil(maxLabelDescent) + 24);

	// Left padding: ensure the leftmost rotated label doesn't bleed past the SVG edge.
	// First label anchor is at 0.5 * groupWidth inside the plot area.
	// Its text extends left by textWidth * cos(45°) after rotation.
	// We need: leftPad + 0.5 * groupWidth >= firstLabelWidth * cos45
	// But groupWidth depends on leftPad (circular), so estimate with a base width first.
	let containerWidth = $state(0);
	const nGroups = $derived(speciesGroups.length);
	const minGroupWidth = 25;
	const firstLabelExtent = $derived(
		speciesGroups.length > 0
			? speciesGroups[0].species.length * CHAR_WIDTH * COS45
			: 0
	);
	// Estimate groupWidth using base left=60 to break the circularity
	const estInnerW = $derived(Math.max((containerWidth || 500) - 60 - 65, nGroups * minGroupWidth));
	const estGroupW = $derived(nGroups > 0 ? estInnerW / nGroups : 0);
	const dynamicLeft = $derived(
		Math.max(60, Math.ceil(firstLabelExtent - estGroupW * 0.5) + 4)
	);

	// Dynamic dimensions
	const plotPadding = $derived({ top: 20, right: 65, bottom: dynamicBottom, left: dynamicLeft });
	const dynamicWidth = $derived(Math.max(containerWidth || 500, nGroups * minGroupWidth + plotPadding.left + plotPadding.right));
	const plotHeight = $derived(300 + dynamicBottom);
	const innerWidth = $derived(dynamicWidth - plotPadding.left - plotPadding.right);
	const innerHeight = $derived(plotHeight - plotPadding.top - plotPadding.bottom);

	// Compute floor for log scale: smallest positive value, floored to a power of 10
	const logFloor = $derived.by(() => {
		const positiveValues = filteredData.map(r => getValue(r)).filter(v => v > 0);
		if (positiveValues.length === 0) return 0.01;
		const minVal = Math.min(...positiveValues);
		return Math.pow(10, Math.floor(Math.log10(minVal)));
	});

	// Y scale: linear or log
	const yMax = $derived(stats.max * 1.1 || 1);
	const yScale = $derived.by(() => {
		if (!logScale) {
			return (val: number) => innerHeight - (val / yMax) * innerHeight;
		}
		const logMin = Math.log10(logFloor);
		const logMax = Math.log10(yMax);
		const logRange = logMax - logMin || 1;
		return (val: number) => {
			if (val <= 0) return innerHeight;
			const logVal = Math.log10(Math.max(val, logFloor));
			return innerHeight - ((logVal - logMin) / logRange) * innerHeight;
		};
	});

	const groupWidth = $derived(nGroups > 0 ? innerWidth / nGroups : 0);

	// Category separators and labels
	const categorySeparators = $derived.by((): CategorySeparator[] => {
		if (speciesGroups.length <= 1) return [];

		const seps: CategorySeparator[] = [];
		let currentCat = speciesGroups[0].category;
		let catStartIdx = 0;

		for (let i = 1; i <= speciesGroups.length; i++) {
			const nextCat = i < speciesGroups.length ? speciesGroups[i].category : null;
			if (nextCat !== currentCat) {
				const labelX = ((catStartIdx + i) / 2) * groupWidth;
				seps.push({
					x: nextCat !== null ? i * groupWidth : -1,
					label: currentCat,
					labelX
				});
				currentCat = nextCat ?? currentCat;
				catStartIdx = i;
			}
		}

		return seps;
	});

	// --- Beeswarm layout: place points avoiding overlap ---
	const pointRadius = 4;
	const pointSpacing = pointRadius * 2 + 1; // minimum distance between centers

	function beeswarmLayout(
		rows: EfficacyRow[],
		centerX: number,
		yFn: (val: number) => number,
		maxHalfWidth: number,
		valFn: (r: EfficacyRow) => number
	): { x: number; y: number; row: EfficacyRow }[] {
		if (rows.length === 0) return [];

		// Sort by y-value for stable placement
		const sorted = rows.map(r => ({ row: r, yPx: yFn(valFn(r)) }))
			.sort((a, b) => a.yPx - b.yPx);

		const placed: { x: number; y: number; row: EfficacyRow }[] = [];

		for (const { row, yPx } of sorted) {
			let bestX = centerX;
			let found = false;

			// Only check nearby placed points (within vertical range of pointSpacing)
			const nearby = placed.filter(p => Math.abs(yPx - p.y) < pointSpacing);

			// Step by 1px for tight packing
			for (let offset = 0; offset <= maxHalfWidth + pointSpacing; offset += 1) {
				const candidates = offset === 0 ? [centerX] : [centerX - offset, centerX + offset];
				for (const cx of candidates) {
					const overlaps = nearby.some(p => {
						const dx = cx - p.x;
						const dy = yPx - p.y;
						return dx * dx + dy * dy < pointSpacing * pointSpacing;
					});
					if (!overlaps) {
						bestX = cx;
						found = true;
						break;
					}
				}
				if (found) break;
			}

			placed.push({ x: bestX, y: yPx, row });
		}

		return placed;
	}

	// Generate beeswarm points for all groups
	const scatterPoints = $derived.by(() => {
		if (speciesGroups.length === 0) return [];

		const allPoints: { x: number; y: number; color: string; shape: MarkerShape; row: EfficacyRow }[] = [];
		const maxHalf = groupWidth * 0.4;

		speciesGroups.forEach((group, groupIdx) => {
			const centerX = (groupIdx + 0.5) * groupWidth;
			const placed = beeswarmLayout(group.rows, centerX, yScale, maxHalf, getValue);
			for (const p of placed) {
				allPoints.push({
					x: p.x,
					y: p.y,
					color: getPointColor(p.row),
					shape: getMediumShape(p.row.medium),
					row: p.row
				});
			}
		});

		return allPoints;
	});

	// Range boxes behind points
	interface RangeBox {
		x: number;
		yMin: number;
		yMax: number;
		yMedian: number;
		width: number;
	}

	const rangeBoxes = $derived.by((): RangeBox[] => {
		return speciesGroups.map((group, idx) => {
			const values = group.rows.map(r => getValue(r)).filter(v => isFinite(v)).sort((a, b) => a - b);
			if (values.length === 0) return null;

			const median = values.length % 2 === 0
				? (values[values.length / 2 - 1] + values[values.length / 2]) / 2
				: values[Math.floor(values.length / 2)];

			return {
				x: (idx + 0.5) * groupWidth,
				yMin: yScale(values[0]),
				yMax: yScale(values[values.length - 1]),
				yMedian: yScale(median),
				width: groupWidth * 0.4
			};
		}).filter((b): b is RangeBox => b !== null);
	});

	// Y-axis ticks (linear or log)
	const yTicks = $derived.by(() => {
		if (stats.count === 0) return [];
		if (!logScale) {
			const tickCount = 5;
			const step = yMax / (tickCount - 1);
			return Array.from({ length: tickCount }, (_, i) => ({
				value: i * step,
				y: innerHeight - (i / (tickCount - 1)) * innerHeight
			}));
		}
		// Log ticks: powers of 10 within range
		const ticks: { value: number; y: number }[] = [];
		const minExp = Math.floor(Math.log10(logFloor));
		const maxExp = Math.ceil(Math.log10(yMax));
		for (let exp = minExp; exp <= maxExp; exp++) {
			const val = Math.pow(10, exp);
			if (val >= logFloor * 0.99 && val <= yMax * 1.01) {
				ticks.push({ value: val, y: yScale(val) });
			}
		}
		return ticks;
	});

	// CADR ticks (right y-axis) - same y positions as eACH ticks but with CADR values
	const cadrTicks = $derived.by(() => {
		return yTicks.map(tick => ({
			value: eachToCADR(tick.value),
			y: tick.y
		}));
	});

	// Air changes from ventilation reference line
	const achLineY = $derived(yScale(airChanges));
	const achLineVisible = $derived(airChanges > 0 && airChanges < yMax);
	const achLabel = $derived.by(() => {
		const ac = Number.isInteger(airChanges) ? airChanges : Math.round(airChanges * 100) / 100;
		const word = ac === 1 ? 'air change' : 'air changes';
		return `${ac} ${word}\nfrom ventilation`;
	});
	// Offset label upward if line is near the bottom
	const achLabelY = $derived.by(() => {
		const y = achLineY;
		if (airChanges < 0.1 * yMax) {
			return y - 0.05 * innerHeight;
		}
		return y;
	});

	function formatTime(seconds: number): string {
		if (seconds < 60) return `${Math.round(seconds)}s`;
		if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
		return `${(seconds / 3600).toFixed(1)}h`;
	}

	let hoveredPoint = $state<{ row: EfficacyRow; x: number; y: number } | null>(null);
	let svgEl = $state<SVGSVGElement | null>(null);
	let savingPlot = $state(false);

	async function savePlot() {
		if (!svgEl) return;
		savingPlot = true;
		try {
			const scale = 2;
			const styles = getComputedStyle(document.documentElement);
			const bgColor = styles.getPropertyValue('--color-bg-secondary').trim() || '#1a1a2e';
			const textColor = styles.getPropertyValue('--color-text').trim() || '#e0e0e0';
			const textMuted = styles.getPropertyValue('--color-text-muted').trim() || '#888';
			const borderColor = styles.getPropertyValue('--color-border').trim() || '#333';
			const fontMono = styles.getPropertyValue('--font-mono').trim() || 'monospace';
			const fontSans = styles.getPropertyValue('--font-sans').trim() || '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

			// Clone SVG and inline styles
			const clone = svgEl.cloneNode(true) as SVGSVGElement;
			const svgW = Number(svgEl.getAttribute('width') || dynamicWidth);
			const svgH = Number(svgEl.getAttribute('height') || plotHeight);
			clone.setAttribute('width', String(svgW));
			clone.setAttribute('height', String(svgH));
			clone.setAttribute('style', `font-family: ${fontSans}`);

			for (const el of clone.querySelectorAll('.tick-label')) {
				(el as SVGElement).setAttribute('fill', textMuted);
				(el as SVGElement).setAttribute('font-family', fontMono);
				(el as SVGElement).setAttribute('font-size', '0.7rem');
			}
			for (const el of clone.querySelectorAll('.axis-label')) {
				(el as SVGElement).setAttribute('fill', textColor);
				(el as SVGElement).setAttribute('font-family', fontSans);
				(el as SVGElement).setAttribute('font-size', '0.75rem');
			}
			for (const el of clone.querySelectorAll('.axis-line, .tick-line')) {
				(el as SVGElement).setAttribute('stroke', textMuted);
				(el as SVGElement).setAttribute('stroke-width', '1');
			}
			for (const el of clone.querySelectorAll('.grid-line')) {
				(el as SVGElement).setAttribute('stroke', borderColor);
				(el as SVGElement).setAttribute('stroke-width', '1');
				(el as SVGElement).setAttribute('stroke-dasharray', '4,3');
				(el as SVGElement).setAttribute('opacity', '0.5');
			}
			for (const el of clone.querySelectorAll('.species-label')) {
				(el as SVGElement).setAttribute('fill', textMuted);
				(el as SVGElement).setAttribute('font-family', fontSans);
				(el as SVGElement).setAttribute('font-size', '0.65rem');
				(el as SVGElement).setAttribute('font-style', 'italic');
			}
			for (const el of clone.querySelectorAll('.category-label')) {
				(el as SVGElement).setAttribute('fill', textColor);
				(el as SVGElement).setAttribute('font-family', fontSans);
				(el as SVGElement).setAttribute('font-size', '0.7rem');
				(el as SVGElement).setAttribute('font-weight', '600');
			}
			for (const el of clone.querySelectorAll('.category-separator')) {
				(el as SVGElement).setAttribute('stroke', textMuted);
				(el as SVGElement).setAttribute('stroke-width', '1');
				(el as SVGElement).setAttribute('stroke-dasharray', '4,3');
				(el as SVGElement).setAttribute('opacity', '0.4');
			}
			for (const el of clone.querySelectorAll('.range-box')) {
				(el as SVGElement).setAttribute('fill', textMuted);
				(el as SVGElement).setAttribute('fill-opacity', '0.08');
				(el as SVGElement).setAttribute('stroke', textMuted);
				(el as SVGElement).setAttribute('stroke-width', '0.5');
				(el as SVGElement).setAttribute('stroke-opacity', '0.2');
			}
			for (const el of clone.querySelectorAll('.median-line')) {
				(el as SVGElement).setAttribute('stroke', textMuted);
				(el as SVGElement).setAttribute('stroke-width', '1.5');
				(el as SVGElement).setAttribute('stroke-opacity', '0.4');
			}
			for (const el of clone.querySelectorAll('.ach-line')) {
				(el as SVGElement).setAttribute('stroke', '#e94560');
				(el as SVGElement).setAttribute('stroke-width', '1.5');
				(el as SVGElement).setAttribute('stroke-dasharray', '6,3');
			}
			for (const el of clone.querySelectorAll('.ach-label')) {
				(el as SVGElement).setAttribute('fill', '#e94560');
				(el as SVGElement).setAttribute('font-size', '0.6rem');
				(el as SVGElement).setAttribute('font-weight', '500');
			}
			for (const el of clone.querySelectorAll('.ref-label')) {
				(el as SVGElement).setAttribute('fill', textMuted);
				(el as SVGElement).setAttribute('font-family', fontMono);
				(el as SVGElement).setAttribute('font-size', '0.6rem');
			}

			// Compute legend dimensions for canvas
			const legendPadding = 12;
			const swatchSize = 10, itemGap = 16, labelFontSize = 11;
			let legendCanvasH = 0;

			if (showLegend) {
				const measure = document.createElement('canvas').getContext('2d')!;
				measure.font = `${labelFontSize}px sans-serif`;
				const maxRowWidth = svgW - legendPadding * 2;
				let rowCount = 1, rowWidth = 0;
				for (const item of wavelengthLegendItems) {
					const w = swatchSize + 4 + measure.measureText(item.label).width;
					if (rowWidth > 0 && rowWidth + itemGap + w > maxRowWidth) {
						rowCount++;
						rowWidth = w;
					} else {
						rowWidth += (rowWidth > 0 ? itemGap : 0) + w;
					}
				}
				legendCanvasH = legendPadding + rowCount * (labelFontSize + 6) + legendPadding;
			}

			// Create offscreen canvas
			const canvasW = svgW * scale;
			const canvasH = (svgH + legendCanvasH) * scale;
			const offscreen = document.createElement('canvas');
			offscreen.width = canvasW;
			offscreen.height = canvasH;
			const ctx = offscreen.getContext('2d');
			if (!ctx) throw new Error('Could not get 2d context');

			ctx.fillStyle = bgColor;
			ctx.fillRect(0, 0, canvasW, canvasH);

			// Draw SVG onto canvas
			const svgStr = new XMLSerializer().serializeToString(clone);
			const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
			const svgUrl = URL.createObjectURL(svgBlob);

			await new Promise<void>((resolve, reject) => {
				const img = new Image();
				img.onload = () => {
					ctx.drawImage(img, 0, 0, canvasW, svgH * scale);
					URL.revokeObjectURL(svgUrl);
					resolve();
				};
				img.onerror = () => {
					URL.revokeObjectURL(svgUrl);
					reject(new Error('Failed to load SVG image'));
				};
				img.src = svgUrl;
			});

			// Draw legend below SVG
			if (showLegend && wavelengthLegendItems.length > 0) {
				const legendTop = svgH * scale;
				const maxRowWidth = (svgW - legendPadding * 2) * scale;
				const measure = document.createElement('canvas').getContext('2d')!;
				measure.font = `${labelFontSize}px sans-serif`;
				ctx.font = `${labelFontSize * scale}px sans-serif`;
				ctx.textBaseline = 'middle';

				// Layout items into rows
				const rows: { items: { label: string; color: string; width: number }[]; totalWidth: number }[] = [];
				let currentRow: { label: string; color: string; width: number }[] = [];
				let currentWidth = 0;
				for (const item of wavelengthLegendItems) {
					const itemW = (swatchSize + 4 + measure.measureText(item.label).width) * scale;
					const gapW = itemGap * scale;
					if (currentWidth > 0 && currentWidth + gapW + itemW > maxRowWidth) {
						rows.push({ items: currentRow, totalWidth: currentWidth });
						currentRow = [{ ...item, width: itemW }];
						currentWidth = itemW;
					} else {
						currentRow.push({ ...item, width: itemW });
						currentWidth += (currentWidth > 0 ? gapW : 0) + itemW;
					}
				}
				if (currentRow.length > 0) rows.push({ items: currentRow, totalWidth: currentWidth });

				let yOff = legendTop + legendPadding * scale;
				const rowH = (labelFontSize + 6) * scale;
				for (const row of rows) {
					let xOff = (canvasW - row.totalWidth) / 2;
					for (const item of row.items) {
						ctx.beginPath();
						ctx.arc(xOff + (swatchSize * scale) / 2, yOff + rowH / 2, (swatchSize * scale) / 2, 0, Math.PI * 2);
						ctx.fillStyle = item.color;
						ctx.fill();
						ctx.fillStyle = textMuted;
						ctx.fillText(item.label, xOff + (swatchSize + 4) * scale, yOff + rowH / 2);
						xOff += item.width + itemGap * scale;
					}
					yOff += rowH;
				}
			}

			// Download
			offscreen.toBlob((blob) => {
				if (!blob) return;
				const url = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				a.download = 'swarm-plot.png';
				a.click();
				URL.revokeObjectURL(url);
			}, 'image/png');
		} finally {
			savingPlot = false;
		}
	}

	function openHiRes() {
		if (!svgEl) return;
		const clone = svgEl.cloneNode(true) as SVGSVGElement;
		const w = svgEl.getAttribute('width');
		const h = svgEl.getAttribute('height');
		if (w && h) {
			clone.setAttribute('width', String(Number(w) * 2));
			clone.setAttribute('height', String(Number(h) * 2));
			clone.setAttribute('viewBox', `0 0 ${w} ${h}`);
		}
		// Inline computed styles for the popup
		const styles = getComputedStyle(document.documentElement);
		const bgColor = styles.getPropertyValue('--color-bg-secondary').trim() || '#1a1a2e';
		const textColor = styles.getPropertyValue('--color-text').trim() || '#e0e0e0';
		const textMuted = styles.getPropertyValue('--color-text-muted').trim() || '#888';
		const borderColor = styles.getPropertyValue('--color-border').trim() || '#333';
		const fontMono = styles.getPropertyValue('--font-mono').trim() || 'monospace';
		const fontSans = styles.getPropertyValue('--font-sans').trim() || '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
		const svgStr = new XMLSerializer().serializeToString(clone);

		// Build legend HTML for popup
		let legendHtml = '';
		if (showLegend) {
			const items = wavelengthLegendItems.map(item =>
				`<span style="display:inline-flex;align-items:center;gap:4px;margin:0 8px;">` +
				`<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${item.color};"></span>` +
				`<span>${item.label}</span></span>`
			).join('');
			legendHtml = `<div style="text-align:center;padding:12px 0;color:${textMuted};font-size:0.7rem;font-family:${fontSans};">${items}</div>`;
		}

		const popup = window.open('', '_blank', `width=${Number(w) * 2 + 40},height=${Number(h) * 2 + 40}`);
		if (!popup) return;
		popup.document.write(`<!DOCTYPE html><html><head><title>Swarm Plot</title>
			<style>
				body { margin: 20px; background: ${bgColor}; font-family: ${fontSans}; display: flex; flex-direction: column; align-items: center; min-height: calc(100vh - 40px); }
				svg { max-width: 100%; height: auto; font-family: ${fontSans}; }
				svg .tick-label, svg .ref-label { font-family: ${fontMono}; }
				svg .axis-line, svg .tick-line { stroke: ${textMuted}; stroke-width: 1; }
				svg .grid-line { stroke: ${borderColor}; stroke-width: 1; stroke-dasharray: 4,3; opacity: 0.5; }
				svg .tick-label { font-size: 0.7rem; fill: ${textMuted}; }
				svg .axis-label { font-size: 0.75rem; fill: ${textColor}; font-family: ${fontSans}; }
				svg .species-label { font-size: 0.65rem; fill: ${textMuted}; font-family: ${fontSans}; font-style: italic; }
				svg .category-label { font-size: 0.7rem; fill: ${textColor}; font-family: ${fontSans}; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; }
				svg .category-separator { stroke: ${textMuted}; stroke-width: 1; stroke-dasharray: 4,3; opacity: 0.4; }
				svg .range-box { fill: ${textMuted}; fill-opacity: 0.08; stroke: ${textMuted}; stroke-width: 0.5; stroke-opacity: 0.2; rx: 3; }
				svg .median-line { stroke: ${textMuted}; stroke-width: 1.5; stroke-opacity: 0.4; }
				svg .ach-line { stroke: #e94560; stroke-width: 1.5; stroke-dasharray: 6,3; }
				svg .ach-label { font-size: 0.6rem; fill: #e94560; font-weight: 500; }
			</style></head><body>${svgStr}${legendHtml}</body></html>`);
		popup.document.close();
	}
</script>

<div class="plot-container">
	<div class="plot-controls">
		<div class="controls-left">
			<button class="popup-btn" onclick={savePlot} disabled={savingPlot || filteredData.length === 0} title="Save plot as PNG">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
					<polyline points="7 10 12 15 17 10"/>
					<line x1="12" y1="15" x2="12" y2="3"/>
				</svg>
				Save
			</button>
			<button class="popup-btn" onclick={openHiRes} disabled={filteredData.length === 0} title="Open hi-res in new window">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
					<polyline points="15 3 21 3 21 9"/>
					<line x1="10" y1="14" x2="21" y2="3"/>
				</svg>
				Open
			</button>
		</div>
		<div class="controls-right">
			<label class="scale-toggle">
				<input type="checkbox" bind:checked={logScale} />
				Log
			</label>
			{#if showAirMetrics}
			<label class="cadr-toggle">
				CADR:
				<select value={cadrUnit} onchange={(e) => onCadrUnitChange((e.target as HTMLSelectElement).value as 'lps' | 'cfm')}>
					<option value="lps">lps</option>
					<option value="cfm">cfm</option>
				</select>
			</label>
			{/if}
		</div>
	</div>
	<!-- Wavelength legend (above plot, always visible) -->
	{#if showLegend}
		<div class="legend">
			{#each wavelengthLegendItems as item}
				<div class="legend-item">
					<span class="legend-swatch" style="background: {item.color};"></span>
					<span>{item.label}</span>
				</div>
			{/each}
		</div>
	{/if}
	<div class="plot-scroll" bind:clientWidth={containerWidth}>
		{#if multipleMediums}
			<div class="medium-legend">
				{#each uniqueMediumsInData as medium}
					{@const shape = getMediumShape(medium)}
					<div class="medium-legend-item">
						<svg width="10" height="10" viewBox="0 0 12 12" class="legend-shape">
							{#if shape === 'circle'}
								<circle cx="6" cy="6" r="4.5" fill="var(--color-text-muted)" />
							{:else if shape === 'square'}
								<rect x="1.5" y="1.5" width="9" height="9" fill="var(--color-text-muted)" />
							{:else if shape === 'diamond'}
								<path d="M6,0.5 L11.5,6 L6,11.5 L0.5,6Z" fill="var(--color-text-muted)" />
							{/if}
						</svg>
						<span>{medium}</span>
					</div>
				{/each}
			</div>
		{/if}
		<svg bind:this={svgEl} width={dynamicWidth} height={plotHeight} style="font-family: var(--font-sans); overflow: visible;">
			<g transform="translate({plotPadding.left}, {plotPadding.top})">
				<!-- Y-axis (eACH-UV, left) -->
				<line x1="0" y1="0" x2="0" y2={innerHeight} class="axis-line" />
				{#each yTicks as tick}
					<g transform="translate(0, {tick.y})">
						<line x1="-5" y1="0" x2="0" y2="0" class="tick-line" />
						<text x="-8" y="4" class="tick-label" text-anchor="end">{logScale ? tick.value.toPrecision(1) : formatValue(tick.value, 1)}</text>
						<line x1="0" y1="0" x2={innerWidth} y2="0" class="grid-line" />
					</g>
				{/each}
				<text x="-45" y={innerHeight / 2} class="axis-label" text-anchor="middle" transform="rotate(-90, -45, {innerHeight / 2})">{yAxisLabel}</text>

				<!-- CADR axis (right) — only when fluence is set -->
				{#if showAirMetrics}
				<line x1={innerWidth} y1="0" x2={innerWidth} y2={innerHeight} class="axis-line" />
				{#each cadrTicks as tick}
					<g transform="translate({innerWidth}, {tick.y})">
						<line x1="0" y1="0" x2="5" y2="0" class="tick-line" />
						<text x="8" y="4" class="tick-label" text-anchor="start">{formatValue(tick.value, 1)}</text>
					</g>
				{/each}
				<text x={innerWidth + 50} y={innerHeight / 2} class="axis-label" text-anchor="middle" transform="rotate(90, {innerWidth + 50}, {innerHeight / 2})">CADR-UV [{cadrUnit}]</text>
				{/if}

				<!-- X-axis -->
				<line x1="0" y1={innerHeight} x2={innerWidth} y2={innerHeight} class="axis-line" />

				<!-- Range boxes -->
				{#each rangeBoxes as box}
					<rect
						x={box.x - box.width / 2}
						y={box.yMax}
						width={box.width}
						height={Math.max(1, box.yMin - box.yMax)}
						class="range-box"
					/>
					<line
						x1={box.x - box.width / 2}
						y1={box.yMedian}
						x2={box.x + box.width / 2}
						y2={box.yMedian}
						class="median-line"
					/>
				{/each}

				<!-- Air changes from ventilation reference line — only when fluence is set -->
				{#if showAirMetrics && achLineVisible}
					<line
						x1="0"
						y1={achLineY}
						x2={innerWidth}
						y2={achLineY}
						class="ach-line"
					/>
					<text
						x="4"
						y={achLabelY - 5}
						class="ach-label"
						text-anchor="start"
					>{achLabel.replace('\n', ' ')}</text>
				{/if}

				<!-- Category separators -->
				{#each categorySeparators as sep}
					{#if sep.x >= 0}
						<line
							x1={sep.x}
							y1="0"
							x2={sep.x}
							y2={innerHeight}
							class="category-separator"
						/>
					{/if}
				{/each}

				<!-- Species labels (rotated 45°) -->
				{#each speciesGroups as group, i}
					{@const x = (i + 0.5) * groupWidth}
					<text
						x={x}
						y={innerHeight + 12}
						class="species-label"
						text-anchor="end"
						transform="rotate(-45, {x}, {innerHeight + 12})"
					>{group.species}</text>
				{/each}

				<!-- Category labels (inside SVG) -->
				{#each categorySeparators as sep}
					<text
						x={sep.labelX}
						y={innerHeight + dynamicBottom - 6}
						class="category-label"
						text-anchor="middle"
					>{sep.label}</text>
				{/each}

				<!-- Data points (beeswarm) -->
				{#each scatterPoints as point}
					<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
					{#if point.shape === 'square'}
						<rect
							x={point.x - pointRadius}
							y={point.y - pointRadius}
							width={pointRadius * 2}
							height={pointRadius * 2}
							fill={point.color}
							fill-opacity="0.8"
							stroke={point.color}
							stroke-width="0.5"
							class="data-point"
							onmouseenter={(e) => {
								const rect = (e.target as SVGElement).getBoundingClientRect();
								hoveredPoint = { row: point.row, x: rect.left, y: rect.top };
							}}
							onmouseleave={() => hoveredPoint = null}
							onclick={() => {
								if (point.row.link) window.open(point.row.link, '_blank', 'noopener');
							}}
						/>
					{:else if point.shape === 'diamond'}
						<path
							d="M{point.x},{point.y - pointRadius * 1.2} L{point.x + pointRadius},{point.y} L{point.x},{point.y + pointRadius * 1.2} L{point.x - pointRadius},{point.y}Z"
							fill={point.color}
							fill-opacity="0.8"
							stroke={point.color}
							stroke-width="0.5"
							class="data-point"
							onmouseenter={(e) => {
								const rect = (e.target as SVGElement).getBoundingClientRect();
								hoveredPoint = { row: point.row, x: rect.left, y: rect.top };
							}}
							onmouseleave={() => hoveredPoint = null}
							onclick={() => {
								if (point.row.link) window.open(point.row.link, '_blank', 'noopener');
							}}
						/>
					{:else}
						<circle
							cx={point.x}
							cy={point.y}
							r={pointRadius}
							fill={point.color}
							fill-opacity="0.8"
							stroke={point.color}
							stroke-width="0.5"
							class="data-point"
							onmouseenter={(e) => {
								const rect = (e.target as SVGElement).getBoundingClientRect();
								hoveredPoint = { row: point.row, x: rect.left, y: rect.top };
							}}
							onmouseleave={() => hoveredPoint = null}
							onclick={() => {
								if (point.row.link) window.open(point.row.link, '_blank', 'noopener');
							}}
						/>
					{/if}
				{/each}
			</g>
		</svg>
	</div>

	<!-- Tooltip -->
	{#if hoveredPoint}
		<div class="tooltip" style="left: {hoveredPoint.x + 10}px; top: {hoveredPoint.y - 10}px;">
			<div class="tooltip-title">{hoveredPoint.row.species}</div>
			{#if hoveredPoint.row.strain}
				<div class="tooltip-row">Strain: {hoveredPoint.row.strain}</div>
			{/if}
			<div class="tooltip-row">Category: {hoveredPoint.row.category}</div>
			{#if multipleMediums}
				<div class="tooltip-row">Medium: {hoveredPoint.row.medium}</div>
			{/if}
			{#if showAirMetrics}
				<div class="tooltip-row">eACH-UV: {formatValue(hoveredPoint.row.each_uv, 2)}</div>
			{/if}
			<div class="tooltip-row">k₁: {formatValue(hoveredPoint.row.k1, 4)} cm²/mJ</div>
			{#if hoveredPoint.row.wavelength}
				<div class="tooltip-row">Wavelength: {hoveredPoint.row.wavelength} nm</div>
			{/if}
			{#if showAirMetrics}
				<div class="tooltip-row">99% in: {formatTime(hoveredPoint.row.seconds_to_99)}</div>
			{/if}
			{#if hoveredPoint.row.link}
				<div class="tooltip-row tooltip-doi">{hoveredPoint.row.link}</div>
			{/if}
		</div>
	{/if}

</div>

<style>
	.plot-container {
		position: relative;
		background: var(--color-bg-secondary);
		border-radius: var(--radius-sm);
		padding: var(--spacing-sm);
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.plot-controls {
		width: 100%;
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--spacing-xs);
	}

	.controls-left {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
	}

	.controls-right {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
	}

	.scale-toggle {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		display: flex;
		align-items: center;
		gap: 4px;
		cursor: pointer;
	}

	.scale-toggle input[type="checkbox"] {
		width: auto;
		margin: 0;
		cursor: pointer;
	}

	.popup-btn {
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: 3px 6px;
		cursor: pointer;
		color: var(--color-text-muted);
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 0.75rem;
		transition: all 0.15s;
	}

	.popup-btn:hover:not(:disabled) {
		background: var(--color-bg-tertiary);
		color: var(--color-text);
		border-color: var(--color-text-muted);
	}

	.popup-btn:disabled {
		opacity: 0.35;
		cursor: default;
	}

	.cadr-toggle {
		font-size: 0.85rem;
		color: var(--color-text-muted);
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.cadr-toggle select {
		font-size: 0.85rem;
		background: var(--color-bg);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: var(--spacing-xs) var(--spacing-sm);
		cursor: pointer;
	}

	.plot-scroll {
		width: 100%;
		overflow-x: auto;
		position: relative;
	}

	.medium-legend {
		position: absolute;
		top: 8px;
		right: 12px;
		z-index: 5;
		display: flex;
		flex-direction: column;
		gap: 3px;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: 4px 8px;
		font-size: 0.7rem;
		color: var(--color-text-muted);
	}

	.medium-legend-item {
		display: flex;
		align-items: center;
		gap: 5px;
	}

	.plot-scroll svg {
		display: block;
		margin: 0 auto;
	}

	.axis-line, .tick-line {
		stroke: var(--color-text-muted);
		stroke-width: 1;
	}

	.grid-line {
		stroke: var(--color-border);
		stroke-width: 1;
		stroke-dasharray: 4,3;
		opacity: 0.5;
	}

	.tick-label {
		font-size: 0.7rem;
		fill: var(--color-text-muted);
		font-family: var(--font-mono);
	}

	.axis-label {
		font-size: 0.75rem;
		fill: var(--color-text);
	}

	.species-label {
		font-size: 0.65rem;
		fill: var(--color-text-muted);
		font-style: italic;
	}

	.category-label {
		font-size: 0.7rem;
		fill: var(--color-text);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.category-separator {
		stroke: var(--color-text-muted);
		stroke-width: 1;
		stroke-dasharray: 4,3;
		opacity: 0.4;
	}

	.range-box {
		fill: var(--color-text-muted);
		fill-opacity: 0.08;
		stroke: var(--color-text-muted);
		stroke-width: 0.5;
		stroke-opacity: 0.2;
		rx: 3;
	}

	.median-line {
		stroke: var(--color-text-muted);
		stroke-width: 1.5;
		stroke-opacity: 0.4;
	}

	.ach-line {
		stroke: #e94560;
		stroke-width: 1.5;
		stroke-dasharray: 6,3;
	}

	.ach-label {
		font-size: 0.6rem;
		fill: #e94560;
		font-weight: 500;
	}

	.data-point {
		cursor: pointer;
		transition: r 0.15s, fill-opacity 0.15s;
	}

	.data-point:hover {
		r: 7;
		fill-opacity: 1;
	}

	.tooltip {
		position: fixed;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: var(--spacing-xs) var(--spacing-sm);
		font-size: 0.75rem;
		z-index: 1001;
		pointer-events: none;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
	}

	.tooltip-title {
		font-weight: 600;
		color: var(--color-text);
		margin-bottom: 2px;
		font-style: italic;
	}

	.tooltip-row {
		color: var(--color-text-muted);
	}

	.tooltip-doi {
		font-size: 0.65rem;
		opacity: 0.7;
		word-break: break-all;
		max-width: 220px;
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: var(--spacing-sm);
		padding: var(--spacing-xs) 0 0 0;
		justify-content: center;
	}

	.legend-item {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 0.7rem;
		color: var(--color-text-muted);
	}

	.legend-swatch {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.legend-shape {
		flex-shrink: 0;
	}
</style>
