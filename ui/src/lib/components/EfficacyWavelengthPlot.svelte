<script lang="ts">
	import { getCategoryColor, type EfficacyRow } from '$lib/utils/efficacy-filters';
	import { formatValue } from '$lib/utils/formatting';

	interface Props {
		filteredData: EfficacyRow[];
	}

	let { filteredData }: Props = $props();

	// Plot dimensions
	const plotWidth = 600;
	const plotHeight = 280;
	const padding = { top: 20, right: 20, bottom: 45, left: 60 };
	const innerWidth = plotWidth - padding.left - padding.right;
	const innerHeight = plotHeight - padding.top - padding.bottom;

	// Toggle between k1 and k2
	let showK2 = $state(false);

	// Filter out rows with valid data
	const plotData = $derived.by(() => {
		return filteredData.filter(row => {
			if (showK2) return row.k2 !== null && row.k2 > 0;
			return row.k1 > 0;
		});
	});

	// Axis ranges
	const xRange = $derived.by(() => {
		if (plotData.length === 0) return { min: 200, max: 280 };
		const wavelengths = plotData.map(r => r.wavelength);
		const min = Math.min(...wavelengths);
		const max = Math.max(...wavelengths);
		const padding = (max - min) * 0.1 || 10;
		return { min: min - padding, max: max + padding };
	});

	const yRange = $derived.by(() => {
		if (plotData.length === 0) return { min: 0, max: 1 };
		const values = plotData.map(r => showK2 ? (r.k2 ?? 0) : r.k1);
		const min = Math.min(...values);
		const max = Math.max(...values);
		const paddingAmt = (max - min) * 0.1 || 0.1;
		return { min: Math.max(0, min - paddingAmt), max: max + paddingAmt };
	});

	// Scale functions
	const xScale = $derived((w: number) => ((w - xRange.min) / (xRange.max - xRange.min)) * innerWidth);
	const yScale = $derived((k: number) => innerHeight - ((k - yRange.min) / (yRange.max - yRange.min)) * innerHeight);

	// X-axis ticks
	const xTicks = $derived.by(() => {
		const range = xRange.max - xRange.min;
		const tickCount = 6;
		const step = range / (tickCount - 1);
		return Array.from({ length: tickCount }, (_, i) => {
			const val = xRange.min + i * step;
			return {
				value: Math.round(val),
				x: xScale(val)
			};
		});
	});

	// Y-axis ticks
	const yTicks = $derived.by(() => {
		const range = yRange.max - yRange.min;
		const tickCount = 5;
		const step = range / (tickCount - 1);
		return Array.from({ length: tickCount }, (_, i) => {
			const val = yRange.min + i * step;
			return {
				value: val,
				y: yScale(val)
			};
		});
	});

	// Tooltip state
	let hoveredPoint = $state<{ row: EfficacyRow; x: number; y: number } | null>(null);
	let svgEl = $state<SVGSVGElement | null>(null);

	function openHiRes() {
		if (!svgEl) return;
		const clone = svgEl.cloneNode(true) as SVGSVGElement;
		clone.setAttribute('width', String(plotWidth * 2));
		clone.setAttribute('height', String(plotHeight * 2));
		clone.setAttribute('viewBox', `0 0 ${plotWidth} ${plotHeight}`);
		const styles = getComputedStyle(document.documentElement);
		const bgColor = styles.getPropertyValue('--color-bg-secondary').trim() || '#1a1a2e';
		const textColor = styles.getPropertyValue('--color-text').trim() || '#e0e0e0';
		const textMuted = styles.getPropertyValue('--color-text-muted').trim() || '#888';
		const borderColor = styles.getPropertyValue('--color-border').trim() || '#333';
		const fontMono = styles.getPropertyValue('--font-mono').trim() || 'monospace';
		const svgStr = new XMLSerializer().serializeToString(clone);
		const popup = window.open('', '_blank', `width=${plotWidth * 2 + 40},height=${plotHeight * 2 + 40}`);
		if (!popup) return;
		popup.document.write(`<!DOCTYPE html><html><head><title>Wavelength Plot</title>
			<style>
				body { margin: 20px; background: ${bgColor}; display: flex; justify-content: center; align-items: center; min-height: calc(100vh - 40px); }
				svg { max-width: 100%; height: auto; }
				svg .tick-label { font-family: ${fontMono}; }
				svg .axis-line, svg .tick-line { stroke: ${textMuted}; stroke-width: 1; }
				svg .grid-line { stroke: ${borderColor}; stroke-width: 1; stroke-dasharray: 2,2; opacity: 0.5; }
				svg .tick-label { font-size: 0.7rem; fill: ${textMuted}; }
				svg .axis-label { font-size: 0.75rem; fill: ${textColor}; }
			</style></head><body>${svgStr}</body></html>`);
		popup.document.close();
	}
</script>

<div class="wavelength-plot-container">
	<div class="plot-controls">
		<button class="popup-btn" onclick={openHiRes} title="Open hi-res in new window">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
				<polyline points="15 3 21 3 21 9"/>
				<line x1="10" y1="14" x2="21" y2="3"/>
			</svg>
		</button>
		<label class="k-toggle">
			<input type="checkbox" bind:checked={showK2} />
			Show k2 instead of k1
		</label>
	</div>

	{#if plotData.length === 0}
		<div class="placeholder">
			{showK2 ? 'No k2 data available for current selection' : 'No data available for current selection'}
		</div>
	{:else}
		<div class="plot-scroll">
		<svg bind:this={svgEl} width={plotWidth} height={plotHeight}>
			<g transform="translate({padding.left}, {padding.top})">
				<!-- Y-axis -->
				<line x1="0" y1="0" x2="0" y2={innerHeight} class="axis-line" />
				{#each yTicks as tick}
					<g transform="translate(0, {tick.y})">
						<line x1="-5" y1="0" x2="0" y2="0" class="tick-line" />
						<text x="-8" y="4" class="tick-label" text-anchor="end">{formatValue(tick.value, 3)}</text>
						<line x1="0" y1="0" x2={innerWidth} y2="0" class="grid-line" />
					</g>
				{/each}
				<text x="-45" y={innerHeight / 2} class="axis-label" text-anchor="middle" transform="rotate(-90, -45, {innerHeight / 2})">{showK2 ? 'k2' : 'k1'} (cm²/mJ)</text>

				<!-- X-axis -->
				<line x1="0" y1={innerHeight} x2={innerWidth} y2={innerHeight} class="axis-line" />
				{#each xTicks as tick}
					<g transform="translate({tick.x}, {innerHeight})">
						<line x1="0" y1="0" x2="0" y2="5" class="tick-line" />
						<text x="0" y="18" class="tick-label" text-anchor="middle">{tick.value}</text>
					</g>
				{/each}
				<text x={innerWidth / 2} y={innerHeight + 38} class="axis-label" text-anchor="middle">Wavelength (nm)</text>

				<!-- Data points -->
				{#each plotData as row}
					{@const kVal = showK2 ? (row.k2 ?? 0) : row.k1}
					{@const cx = xScale(row.wavelength)}
					{@const cy = yScale(kVal)}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<circle
						cx={cx}
						cy={cy}
						r="4"
						fill={getCategoryColor(row.category)}
						fill-opacity="0.7"
						stroke={getCategoryColor(row.category)}
						stroke-width="1"
						class="data-point"
						onmouseenter={(e) => {
							const rect = (e.target as SVGElement).getBoundingClientRect();
							hoveredPoint = { row, x: rect.left, y: rect.top };
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
				<div class="tooltip-row">Wavelength: {hoveredPoint.row.wavelength} nm</div>
				<div class="tooltip-row">k1: {formatValue(hoveredPoint.row.k1, 4)} cm²/mJ</div>
				{#if hoveredPoint.row.k2 !== null}
					<div class="tooltip-row">k2: {formatValue(hoveredPoint.row.k2, 4)} cm²/mJ</div>
				{/if}
			</div>
		{/if}
	{/if}
</div>

<style>
	.wavelength-plot-container {
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
		justify-content: flex-end;
		margin-bottom: var(--spacing-xs);
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
		transition: all 0.15s;
	}

	.popup-btn:hover {
		background: var(--color-bg-tertiary);
		color: var(--color-text);
		border-color: var(--color-text-muted);
	}

	.k-toggle {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		display: flex;
		align-items: center;
		gap: 4px;
		cursor: pointer;
	}

	.placeholder {
		padding: var(--spacing-xl);
		text-align: center;
		color: var(--color-text-muted);
		font-size: 0.85rem;
	}

	.plot-scroll {
		width: 100%;
		overflow-x: auto;
	}

	svg {
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
