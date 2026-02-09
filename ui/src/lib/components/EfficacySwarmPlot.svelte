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
	}

	let { filteredData, stats, dataCategories }: Props = $props();

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

	// UV rainbow colormap
	function wavelengthToColor(wl: number): string {
		const minWl = 200;
		const maxWl = 310;
		const t = Math.max(0, Math.min(1, (wl - minWl) / (maxWl - minWl)));
		const r = t < 0.4 ? Math.round(100 + (0.4 - t) / 0.4 * 120) :
				  t < 0.6 ? Math.round(30 + (t - 0.4) / 0.2 * 50) :
				  Math.round(80 + (t - 0.6) / 0.4 * 175);
		const g = t < 0.3 ? Math.round(50 + t / 0.3 * 100) :
				  t < 0.7 ? Math.round(150 + (t - 0.3) / 0.4 * 80) :
				  Math.round(230 - (t - 0.7) / 0.3 * 160);
		const b = t < 0.5 ? Math.round(220 - t / 0.5 * 120) :
				  Math.round(100 - (t - 0.5) / 0.5 * 80);
		return `rgb(${r}, ${g}, ${b})`;
	}

	function getPointColor(row: EfficacyRow): string {
		if (colorByWavelength) return wavelengthToColor(row.wavelength);
		return getCategoryColor(row.category);
	}

	// Dynamic dimensions
	const nGroups = $derived(speciesGroups.length);
	const dynamicWidth = $derived(Math.max(500, nGroups * 50));
	// Bottom padding: species labels (rotated 45°) need ~55px, then gap, then category labels
	const plotPadding = { top: 20, right: 20, bottom: 100, left: 60 };
	const plotHeight = 300;
	const innerWidth = $derived(dynamicWidth - plotPadding.left - plotPadding.right);
	const innerHeight = plotHeight - plotPadding.top - plotPadding.bottom;

	// Y scale starts at 0
	const yMax = $derived(stats.max * 1.1 || 1);
	const yScale = $derived((val: number) => innerHeight - (val / yMax) * innerHeight);

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
	const pointRadius = 5;

	function beeswarmLayout(
		rows: EfficacyRow[],
		centerX: number,
		yFn: (val: number) => number,
		maxHalfWidth: number
	): { x: number; y: number; row: EfficacyRow }[] {
		if (rows.length === 0) return [];

		// Sort by y-value for stable placement
		const sorted = rows.map(r => ({ row: r, yPx: yFn(r.each_uv) }))
			.sort((a, b) => a.yPx - b.yPx);

		const placed: { x: number; y: number; row: EfficacyRow }[] = [];
		const diameter = pointRadius * 2 + 1; // minimum distance between centers

		for (const { row, yPx } of sorted) {
			// Try center first, then alternate left/right
			let bestX = centerX;
			let found = false;

			for (let offset = 0; offset <= maxHalfWidth; offset += pointRadius) {
				const candidates = offset === 0 ? [centerX] : [centerX - offset, centerX + offset];
				for (const cx of candidates) {
					// Check overlap with all placed points
					const overlaps = placed.some(p => {
						const dx = cx - p.x;
						const dy = yPx - p.y;
						return Math.sqrt(dx * dx + dy * dy) < diameter;
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

		const allPoints: { x: number; y: number; color: string; row: EfficacyRow }[] = [];
		const maxHalf = groupWidth * 0.4;

		speciesGroups.forEach((group, groupIdx) => {
			const centerX = (groupIdx + 0.5) * groupWidth;
			const placed = beeswarmLayout(group.rows, centerX, yScale, maxHalf);
			for (const p of placed) {
				allPoints.push({
					x: p.x,
					y: p.y,
					color: getPointColor(p.row),
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
			const values = group.rows.map(r => r.each_uv).filter(v => isFinite(v)).sort((a, b) => a - b);
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

	// Y-axis ticks
	const yTicks = $derived.by(() => {
		if (stats.count === 0) return [];
		const tickCount = 5;
		const step = yMax / (tickCount - 1);
		return Array.from({ length: tickCount }, (_, i) => ({
			value: i * step,
			y: innerHeight - (i / (tickCount - 1)) * innerHeight
		}));
	});

	function formatTime(seconds: number): string {
		if (seconds < 60) return `${Math.round(seconds)}s`;
		if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
		return `${(seconds / 3600).toFixed(1)}h`;
	}

	let hoveredPoint = $state<{ row: EfficacyRow; x: number; y: number } | null>(null);
</script>

<div class="plot-container">
	<div class="plot-scroll">
		<svg width={dynamicWidth} height={plotHeight}>
			<g transform="translate({plotPadding.left}, {plotPadding.top})">
				<!-- Y-axis -->
				<line x1="0" y1="0" x2="0" y2={innerHeight} class="axis-line" />
				{#each yTicks as tick}
					<g transform="translate(0, {tick.y})">
						<line x1="-5" y1="0" x2="0" y2="0" class="tick-line" />
						<text x="-8" y="4" class="tick-label" text-anchor="end">{formatValue(tick.value, 1)}</text>
						<line x1="0" y1="0" x2={innerWidth} y2="0" class="grid-line" />
					</g>
				{/each}
				<text x="-45" y={innerHeight / 2} class="axis-label" text-anchor="middle" transform="rotate(-90, -45, {innerHeight / 2})">eACH-UV</text>

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
					<!-- Category label below the species labels -->
					<text
						x={sep.labelX}
						y={innerHeight + 88}
						class="category-label"
						text-anchor="middle"
					>{sep.label}</text>
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

				<!-- Data points (beeswarm) -->
				{#each scatterPoints as point}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
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
					/>
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
			<div class="tooltip-row">eACH-UV: {formatValue(hoveredPoint.row.each_uv, 2)}</div>
			<div class="tooltip-row">k1: {formatValue(hoveredPoint.row.k1, 4)} cm²/mJ</div>
			{#if hoveredPoint.row.wavelength}
				<div class="tooltip-row">Wavelength: {hoveredPoint.row.wavelength} nm</div>
			{/if}
			<div class="tooltip-row">99% in: {formatTime(hoveredPoint.row.seconds_to_99)}</div>
		</div>
	{/if}

	<!-- Wavelength legend -->
	{#if colorByWavelength}
		<div class="legend">
			{#each uniqueWavelengths as wl}
				<div class="legend-item">
					<span class="legend-swatch" style="background: {wavelengthToColor(wl)};"></span>
					<span class="legend-label">{wl} nm</span>
				</div>
			{/each}
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

	.plot-scroll {
		width: 100%;
		overflow-x: auto;
		display: flex;
		justify-content: center;
	}

	.plot-scroll svg {
		display: block;
		min-width: 0;
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

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: var(--spacing-sm);
		padding: var(--spacing-sm) 0 0 0;
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
</style>
