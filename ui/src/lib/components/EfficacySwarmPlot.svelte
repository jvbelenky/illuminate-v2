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

	// Swarm plot dimensions
	const plotWidth = 500;
	const plotHeight = 250;
	const plotPadding = { top: 20, right: 20, bottom: 40, left: 60 };
	const innerWidth = plotWidth - plotPadding.left - plotPadding.right;
	const innerHeight = plotHeight - plotPadding.top - plotPadding.bottom;

	// Calculate swarm plot data
	const swarmData = $derived.by(() => {
		if (filteredData.length === 0) return [];

		const cats = dataCategories;
		if (cats.length === 0) return [];

		// Calculate Y scale (eACH-UV)
		const yMin = Math.max(0, stats.min * 0.9);
		const yMax = stats.max * 1.1 || 1;
		const yScale = (val: number) => innerHeight - ((val - yMin) / (yMax - yMin)) * innerHeight;

		// Calculate X positions for each category
		const categoryWidth = innerWidth / cats.length;
		const categoryX = (cat: string) => {
			const idx = cats.indexOf(cat);
			return categoryWidth / 2 + idx * categoryWidth;
		};

		// Generate points with jitter
		return filteredData.map((row, i) => {
			const baseX = categoryX(row.category);
			// Use deterministic jitter based on index for stability
			const jitter = ((i * 7919) % 100 - 50) / 100 * (categoryWidth * 0.4);
			return {
				x: baseX + jitter,
				y: yScale(row.each_uv),
				color: getCategoryColor(row.category),
				row
			};
		});
	});

	// Y-axis ticks
	const yTicks = $derived.by(() => {
		if (stats.count === 0) return [];
		const yMin = Math.max(0, stats.min * 0.9);
		const yMax = stats.max * 1.1 || 1;
		const tickCount = 5;
		const step = (yMax - yMin) / (tickCount - 1);
		return Array.from({ length: tickCount }, (_, i) => ({
			value: yMin + i * step,
			y: innerHeight - (i / (tickCount - 1)) * innerHeight
		}));
	});

	// Format time for display
	function formatTime(seconds: number): string {
		if (seconds < 60) return `${Math.round(seconds)}s`;
		if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
		return `${(seconds / 3600).toFixed(1)}h`;
	}

	// Tooltip state
	let hoveredPoint = $state<{ row: EfficacyRow; x: number; y: number } | null>(null);
</script>

<div class="plot-container">
	<svg width={plotWidth} height={plotHeight}>
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
			{#each dataCategories as cat, i}
				{@const x = (innerWidth / dataCategories.length) * (i + 0.5)}
				<text x={x} y={innerHeight + 20} class="tick-label" text-anchor="middle">{cat}</text>
			{/each}

			<!-- Data points -->
			{#each swarmData as point}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<circle
					cx={point.x}
					cy={point.y}
					r="4"
					fill={point.color}
					fill-opacity="0.7"
					stroke={point.color}
					stroke-width="1"
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

	<!-- Tooltip -->
	{#if hoveredPoint}
		<div class="tooltip" style="left: {hoveredPoint.x + 10}px; top: {hoveredPoint.y - 10}px;">
			<div class="tooltip-title">{hoveredPoint.row.species}</div>
			{#if hoveredPoint.row.strain}
				<div class="tooltip-row">Strain: {hoveredPoint.row.strain}</div>
			{/if}
			<div class="tooltip-row">eACH-UV: {formatValue(hoveredPoint.row.each_uv, 2)}</div>
			<div class="tooltip-row">k1: {formatValue(hoveredPoint.row.k1, 4)} cm²/mJ</div>
			<div class="tooltip-row">99% in: {formatTime(hoveredPoint.row.seconds_to_99)}</div>
		</div>
	{/if}
</div>

<style>
	.plot-container {
		position: relative;
		display: flex;
		justify-content: center;
		background: var(--color-bg-secondary);
		border-radius: var(--radius-sm);
		padding: var(--spacing-sm);
	}

	.plot-container svg {
		display: block;
	}

	.axis-line, :global(.tick-line) {
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

	.data-point {
		cursor: pointer;
		transition: r 0.15s, fill-opacity 0.15s;
	}

	.data-point:hover {
		r: 6;
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
	}

	.tooltip-row {
		color: var(--color-text-muted);
	}
</style>
