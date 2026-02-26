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

	// Unique categories in current data (for legend)
	const legendCategories = $derived.by(() => {
		const seen = new Map<string, string>();
		for (const row of plotData) {
			if (!seen.has(row.category)) {
				seen.set(row.category, getCategoryColor(row.category));
			}
		}
		return Array.from(seen, ([name, color]) => ({ name, color }));
	});

	// Tooltip state
	let hoveredPoint = $state<{ row: EfficacyRow; x: number; y: number } | null>(null);
	let svgEl = $state<SVGSVGElement | null>(null);
	let savingPlot = $state(false);

	function _getStyles() {
		const styles = getComputedStyle(document.documentElement);
		return {
			bgColor: styles.getPropertyValue('--color-bg-secondary').trim() || '#1a1a2e',
			textColor: styles.getPropertyValue('--color-text').trim() || '#e0e0e0',
			textMuted: styles.getPropertyValue('--color-text-muted').trim() || '#888',
			borderColor: styles.getPropertyValue('--color-border').trim() || '#333',
			fontMono: styles.getPropertyValue('--font-mono').trim() || 'monospace',
			fontSans: styles.getPropertyValue('--font-sans').trim() || '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
		};
	}

	function _inlineStyles(clone: SVGSVGElement, s: ReturnType<typeof _getStyles>) {
		clone.setAttribute('style', `font-family: ${s.fontSans}`);
		for (const el of clone.querySelectorAll('.tick-label')) {
			(el as SVGElement).setAttribute('fill', s.textMuted);
			(el as SVGElement).setAttribute('font-family', s.fontMono);
			(el as SVGElement).setAttribute('font-size', '0.7rem');
		}
		for (const el of clone.querySelectorAll('.axis-label')) {
			(el as SVGElement).setAttribute('fill', s.textColor);
			(el as SVGElement).setAttribute('font-family', s.fontSans);
			(el as SVGElement).setAttribute('font-size', '0.75rem');
		}
		for (const el of clone.querySelectorAll('.axis-line, .tick-line')) {
			(el as SVGElement).setAttribute('stroke', s.textMuted);
			(el as SVGElement).setAttribute('stroke-width', '1');
		}
		for (const el of clone.querySelectorAll('.grid-line')) {
			(el as SVGElement).setAttribute('stroke', s.borderColor);
			(el as SVGElement).setAttribute('stroke-width', '1');
			(el as SVGElement).setAttribute('stroke-dasharray', '2,2');
			(el as SVGElement).setAttribute('opacity', '0.5');
		}
		for (const el of clone.querySelectorAll('.data-point')) {
			const fill = (el as SVGElement).getAttribute('fill') || '';
			(el as SVGElement).setAttribute('fill', fill);
			(el as SVGElement).setAttribute('fill-opacity', '0.7');
			(el as SVGElement).setAttribute('stroke', fill);
			(el as SVGElement).setAttribute('stroke-width', '1');
		}
	}

	async function savePlot() {
		if (!svgEl) return;
		savingPlot = true;
		try {
			const scale = 2;
			const s = _getStyles();

			const clone = svgEl.cloneNode(true) as SVGSVGElement;
			clone.setAttribute('width', String(plotWidth));
			clone.setAttribute('height', String(plotHeight));
			_inlineStyles(clone, s);

			// Legend dimensions
			const showLegend = legendCategories.length >= 1;
			const legendPadding = 12;
			const swatchW = 10, swatchH = 10, itemGap = 16, labelFontSize = 11;
			let legendHeight = 0;

			let legendItems: { label: string; color: string; width: number }[] = [];
			if (showLegend) {
				const measure = document.createElement('canvas').getContext('2d')!;
				measure.font = `${labelFontSize}px sans-serif`;
				legendItems = legendCategories.map(c => {
					const w = swatchW + 4 + measure.measureText(c.name).width;
					return { label: c.name, color: c.color, width: w };
				});
				const maxRowWidth = plotWidth - legendPadding * 2;
				let rowCount = 1, rowWidth = 0;
				for (const item of legendItems) {
					if (rowWidth > 0 && rowWidth + itemGap + item.width > maxRowWidth) {
						rowCount++;
						rowWidth = item.width;
					} else {
						rowWidth += (rowWidth > 0 ? itemGap : 0) + item.width;
					}
				}
				legendHeight = legendPadding + rowCount * (labelFontSize + 6) + legendPadding;
			}

			const canvasW = plotWidth * scale;
			const canvasH = (plotHeight + legendHeight) * scale;
			const offscreen = document.createElement('canvas');
			offscreen.width = canvasW;
			offscreen.height = canvasH;
			const ctx = offscreen.getContext('2d');
			if (!ctx) throw new Error('Could not get 2d context');

			ctx.fillStyle = s.bgColor;
			ctx.fillRect(0, 0, canvasW, canvasH);

			const svgStr = new XMLSerializer().serializeToString(clone);
			const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
			const svgUrl = URL.createObjectURL(svgBlob);

			await new Promise<void>((resolve, reject) => {
				const img = new Image();
				img.onload = () => {
					ctx.drawImage(img, 0, 0, canvasW, plotHeight * scale);
					URL.revokeObjectURL(svgUrl);
					resolve();
				};
				img.onerror = () => {
					URL.revokeObjectURL(svgUrl);
					reject(new Error('Failed to load SVG image'));
				};
				img.src = svgUrl;
			});

			// Draw legend
			if (showLegend && legendItems.length > 0) {
				const legendTop = plotHeight * scale;
				const maxRowWidth = (plotWidth - legendPadding * 2) * scale;
				ctx.font = `${labelFontSize * scale}px sans-serif`;
				ctx.textBaseline = 'middle';

				const rows: { items: typeof legendItems; totalWidth: number }[] = [];
				let currentRow: typeof legendItems = [];
				let currentWidth = 0;
				for (const item of legendItems) {
					const itemW = item.width * scale;
					const gapW = itemGap * scale;
					if (currentWidth > 0 && currentWidth + gapW + itemW > maxRowWidth) {
						rows.push({ items: currentRow, totalWidth: currentWidth });
						currentRow = [item];
						currentWidth = itemW;
					} else {
						currentRow.push(item);
						currentWidth += (currentWidth > 0 ? gapW : 0) + itemW;
					}
				}
				if (currentRow.length > 0) rows.push({ items: currentRow, totalWidth: currentWidth });

				let yOff = legendTop + legendPadding * scale;
				const rowH = (labelFontSize + 6) * scale;
				for (const row of rows) {
					let xOff = (canvasW - row.totalWidth) / 2;
					for (const item of row.items) {
						ctx.fillStyle = item.color;
						ctx.beginPath();
						ctx.arc(xOff + swatchW * scale / 2, yOff + rowH / 2, swatchW * scale / 2, 0, Math.PI * 2);
						ctx.fill();
						ctx.fillStyle = s.textMuted;
						ctx.fillText(item.label, xOff + (swatchW + 4) * scale, yOff + rowH / 2);
						xOff += item.width * scale + itemGap * scale;
					}
					yOff += rowH;
				}
			}

			offscreen.toBlob((blob) => {
				if (!blob) return;
				const url = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				a.download = 'wavelength-plot.png';
				a.click();
				URL.revokeObjectURL(url);
			}, 'image/png');
		} finally {
			savingPlot = false;
		}
	}

	function openHiRes() {
		if (!svgEl) return;
		const s = _getStyles();
		const clone = svgEl.cloneNode(true) as SVGSVGElement;
		clone.setAttribute('width', String(plotWidth * 2));
		clone.setAttribute('height', String(plotHeight * 2));
		clone.setAttribute('viewBox', `0 0 ${plotWidth} ${plotHeight}`);
		_inlineStyles(clone, s);
		const svgStr = new XMLSerializer().serializeToString(clone);

		// Build legend HTML
		let legendHtml = '';
		if (legendCategories.length >= 1) {
			const items = legendCategories.map(c =>
				`<span style="display:inline-flex;align-items:center;gap:4px;margin-right:12px;">` +
				`<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${c.color};"></span>` +
				`<span style="color:${s.textMuted};font-size:11px;">${c.name}</span></span>`
			).join('');
			legendHtml = `<div style="text-align:center;margin-top:8px;">${items}</div>`;
		}

		const popup = window.open('', '_blank', `width=${plotWidth * 2 + 40},height=${plotHeight * 2 + 80}`);
		if (!popup) return;
		popup.document.write(`<!DOCTYPE html><html><head><title>Wavelength Plot</title>
			<style>
				body { margin: 20px; background: ${s.bgColor}; display: flex; flex-direction: column; justify-content: center; align-items: center; min-height: calc(100vh - 40px); font-family: ${s.fontSans}; }
				svg { max-width: 100%; height: auto; }
			</style></head><body>${svgStr}${legendHtml}</body></html>`);
		popup.document.close();
	}
</script>

<div class="wavelength-plot-container">
	<div class="plot-controls">
		<button class="popup-btn" onclick={savePlot} disabled={savingPlot || plotData.length === 0} title="Save plot as PNG">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
				<polyline points="7 10 12 15 17 10"/>
				<line x1="12" y1="15" x2="12" y2="3"/>
			</svg>
			Save
		</button>
		<button class="popup-btn" onclick={openHiRes} disabled={plotData.length === 0} title="Open hi-res in new window">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
				<polyline points="15 3 21 3 21 9"/>
				<line x1="10" y1="14" x2="21" y2="3"/>
			</svg>
			Open
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
		gap: var(--spacing-xs);
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
