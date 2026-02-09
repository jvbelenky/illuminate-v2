<script lang="ts">
	import { type EfficacyRow } from '$lib/utils/efficacy-filters';
	import { survivalCurvePoints, logReductionTime, LOG_LABELS } from '$lib/utils/survival-math';
	import { formatValue } from '$lib/utils/formatting';

	interface Props {
		selectedRows: EfficacyRow[];
		fluence: number;
		logLevel: number;
	}

	let { selectedRows, fluence, logLevel }: Props = $props();

	// Distinct color palette for per-species coloring (like guv-calcs)
	const SPECIES_COLORS = [
		'#e94560', '#4ade80', '#60a5fa', '#fbbf24', '#a855f7',
		'#14b8a6', '#f97316', '#ec4899', '#84cc16', '#06b6d4',
		'#f43f5e', '#8b5cf6', '#22d3ee', '#eab308', '#d946ef'
	];

	// Plot dimensions
	const plotWidth = 600;
	const plotHeight = 280;
	const padding = { top: 20, right: 20, bottom: 45, left: 60 };
	const innerWidth = plotWidth - padding.left - padding.right;
	const innerHeight = plotHeight - padding.top - padding.bottom;

	// Time unit selection following guv-calcs thresholds
	function selectTimeUnit(maxSeconds: number): { label: string; divisor: number } {
		if (maxSeconds < 100) return { label: 'Time (seconds)', divisor: 1 };
		if (maxSeconds < 6000) return { label: 'Time (minutes)', divisor: 60 };
		return { label: 'Time (hours)', divisor: 3600 };
	}

	// Generate curve data for all selected rows, colored by species
	const curveData = $derived.by(() => {
		if (selectedRows.length === 0 || fluence <= 0) return [];

		return selectedRows.map((row, i) => {
			const points = survivalCurvePoints(
				fluence, row.k1, row.k2 ?? 0, row.resistant_fraction, 200, logLevel
			);
			return {
				row,
				points,
				color: SPECIES_COLORS[i % SPECIES_COLORS.length]
			};
		});
	});

	// Compute max time across all curves for axis scaling
	const maxTime = $derived.by(() => {
		let max = 0;
		for (const curve of curveData) {
			const last = curve.points[curve.points.length - 1];
			if (last && isFinite(last.t) && last.t > max) max = last.t;
		}
		return max || 1;
	});

	const timeUnit = $derived(selectTimeUnit(maxTime));

	// Scale functions
	const xScale = $derived((t: number) => (t / timeUnit.divisor) / (maxTime / timeUnit.divisor) * innerWidth);
	const yScale = $derived((S: number) => {
		// Linear scale 0 to 1
		return innerHeight - S * innerHeight;
	});

	// Generate SVG path from points
	function pointsToPath(points: { t: number; S: number }[], xFn: (t: number) => number, yFn: (S: number) => number): string {
		if (points.length === 0) return '';
		return points.map((p, i) => {
			const x = xFn(p.t);
			const y = yFn(p.S);
			return `${i === 0 ? 'M' : 'L'}${x},${y}`;
		}).join(' ');
	}

	// X-axis ticks
	const xTicks = $derived.by(() => {
		const maxDisplay = maxTime / timeUnit.divisor;
		const tickCount = 6;
		const step = maxDisplay / (tickCount - 1);
		return Array.from({ length: tickCount }, (_, i) => {
			const val = i * step;
			return {
				value: val,
				x: (val / maxDisplay) * innerWidth,
				label: val < 10 ? formatValue(val, 1) : Math.round(val).toString()
			};
		});
	});

	// Log reduction reference lines
	const refLines = $derived.by(() => {
		const lines: { S: number; label: string; y: number }[] = [];
		for (let level = 1; level <= logLevel; level++) {
			const S = Math.pow(10, -level);
			const y = yScale(S);
			if (y >= 0 && y <= innerHeight) {
				lines.push({ S, label: LOG_LABELS[level], y });
			}
		}
		return lines;
	});

	// Tooltip state
	let hoveredCurve = $state<{ row: EfficacyRow; x: number; y: number } | null>(null);

	function formatTime(seconds: number): string {
		if (!isFinite(seconds) || seconds < 0) return '—';
		if (seconds < 60) return `${Math.round(seconds)}s`;
		if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
		return `${(seconds / 3600).toFixed(1)}h`;
	}
</script>

<div class="survival-plot-container">
	{#if selectedRows.length === 0}
		<div class="placeholder">
			Select pathogens from the table below to view survival curves
		</div>
	{:else}
		<svg width={plotWidth} height={plotHeight}>
			<g transform="translate({padding.left}, {padding.top})">
				<!-- Y-axis -->
				<line x1="0" y1="0" x2="0" y2={innerHeight} class="axis-line" />
				{#each [0, 0.2, 0.4, 0.6, 0.8, 1.0] as val}
					{@const y = yScale(val)}
					<g transform="translate(0, {y})">
						<line x1="-5" y1="0" x2="0" y2="0" class="tick-line" />
						<text x="-8" y="4" class="tick-label" text-anchor="end">{val.toFixed(1)}</text>
						<line x1="0" y1="0" x2={innerWidth} y2="0" class="grid-line" />
					</g>
				{/each}
				<text x="-45" y={innerHeight / 2} class="axis-label" text-anchor="middle" transform="rotate(-90, -45, {innerHeight / 2})">Survival Fraction</text>

				<!-- X-axis -->
				<line x1="0" y1={innerHeight} x2={innerWidth} y2={innerHeight} class="axis-line" />
				{#each xTicks as tick}
					<g transform="translate({tick.x}, {innerHeight})">
						<line x1="0" y1="0" x2="0" y2="5" class="tick-line" />
						<text x="0" y="18" class="tick-label" text-anchor="middle">{tick.label}</text>
					</g>
				{/each}
				<text x={innerWidth / 2} y={innerHeight + 38} class="axis-label" text-anchor="middle">{timeUnit.label}</text>

				<!-- Log reduction reference lines -->
				{#each refLines as line}
					<line x1="0" y1={line.y} x2={innerWidth} y2={line.y} class="ref-line" />
					<text x={innerWidth + 4} y={line.y + 3} class="ref-label">{line.label}</text>
				{/each}

				<!-- Survival curves -->
				{#each curveData as curve}
					<path
						d={pointsToPath(curve.points, xScale, yScale)}
						fill="none"
						stroke={curve.color}
						stroke-width="2"
						stroke-opacity="0.8"
						class="curve-path"
						onmouseenter={(e) => {
							const rect = (e.target as SVGElement).getBoundingClientRect();
							hoveredCurve = { row: curve.row, x: rect.left + rect.width / 2, y: rect.top };
						}}
						onmouseleave={() => hoveredCurve = null}
					/>
				{/each}
			</g>
		</svg>

		<!-- Tooltip -->
		{#if hoveredCurve}
			<div class="tooltip" style="left: {hoveredCurve.x + 10}px; top: {hoveredCurve.y - 10}px;">
				<div class="tooltip-title">{hoveredCurve.row.species}</div>
				{#if hoveredCurve.row.strain}
					<div class="tooltip-row">Strain: {hoveredCurve.row.strain}</div>
				{/if}
				{#each [1, 2, 3] as level}
					{@const t = logReductionTime(level, fluence, hoveredCurve.row.k1, hoveredCurve.row.k2 ?? 0, hoveredCurve.row.resistant_fraction)}
					<div class="tooltip-row">{LOG_LABELS[level]}: {formatTime(t)}</div>
				{/each}
			</div>
		{/if}

		<!-- Legend -->
		{#if curveData.length > 1}
			<div class="legend">
				{#each curveData as curve}
					<div class="legend-item">
						<span class="legend-swatch" style="background: {curve.color};"></span>
						<span class="legend-label">{curve.row.species}{curve.row.strain ? ` (${curve.row.strain})` : ''}</span>
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</div>

<style>
	.survival-plot-container {
		position: relative;
		background: var(--color-bg-secondary);
		border-radius: var(--radius-sm);
		padding: var(--spacing-sm);
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.placeholder {
		padding: var(--spacing-xl);
		text-align: center;
		color: var(--color-text-muted);
		font-size: 0.85rem;
	}

	svg {
		display: block;
	}

	.axis-line, .tick-line {
		stroke: var(--color-text-muted);
		stroke-width: 1;
	}

	.grid-line {
		stroke: var(--color-border);
		stroke-width: 1;
		stroke-dasharray: 2,2;
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

	.ref-line {
		stroke: var(--color-text-muted);
		stroke-width: 1;
		stroke-dasharray: 6,3;
		opacity: 0.4;
	}

	.ref-label {
		font-size: 0.6rem;
		fill: var(--color-text-muted);
		font-family: var(--font-mono);
	}

	.curve-path {
		cursor: pointer;
		transition: stroke-width 0.15s, stroke-opacity 0.15s;
	}

	.curve-path:hover {
		stroke-width: 3;
		stroke-opacity: 1;
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
		width: 12px;
		height: 3px;
		border-radius: 1px;
		flex-shrink: 0;
	}

	.legend-label {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 150px;
	}
</style>
