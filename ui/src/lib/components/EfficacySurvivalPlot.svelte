<script lang="ts">
	import { type EfficacyRow } from '$lib/utils/efficacy-filters';
	import { survivalFraction, survivalCurvePoints, logReductionTime, LOG_LABELS } from '$lib/utils/survival-math';
	import { formatValue } from '$lib/utils/formatting';

	interface Props {
		selectedRows: EfficacyRow[];
		filteredData: EfficacyRow[];
		fluence: number;
		logLevels: number[];
		speciesSelectionOrder: string[];
	}

	let { selectedRows, filteredData, fluence, logLevels, speciesSelectionOrder }: Props = $props();

	// Distinct color palette for per-species coloring (like guv-calcs)
	const SPECIES_COLORS = [
		'#e94560', '#4ade80', '#60a5fa', '#fbbf24', '#a855f7',
		'#14b8a6', '#f97316', '#ec4899', '#84cc16', '#06b6d4',
		'#f43f5e', '#8b5cf6', '#22d3ee', '#eab308', '#d946ef'
	];

	// Max log level for computing time range
	const maxLogLevel = $derived(Math.max(...logLevels));

	// Plot dimensions
	const plotWidth = 600;
	const plotHeight = 280;
	const legendWidth = 150;
	const padding = { top: 20, right: 20 + legendWidth, bottom: 45, left: 60 };
	const innerWidth = plotWidth - padding.left - padding.right;
	const innerHeight = plotHeight - padding.top - padding.bottom;

	// Time unit selection following guv-calcs thresholds
	function selectTimeUnit(maxSeconds: number): { label: string; divisor: number } {
		if (maxSeconds < 100) return { label: 'Time (seconds)', divisor: 1 };
		if (maxSeconds < 6000) return { label: 'Time (minutes)', divisor: 60 };
		return { label: 'Time (hours)', divisor: 3600 };
	}

	// Aggregate selected rows by species — one curve per species using mean k1/k2/f
	interface SpeciesCurve {
		species: string;
		meanK1: number;
		meanK2: number;
		meanF: number;
		n: number;
		points: { t: number; S: number }[];
		color: string;
		// CI band (null if n < 2)
		ciUpper: { t: number; S: number }[] | null;
		ciLower: { t: number; S: number }[] | null;
	}

	// Intermediate: group selected rows by species and compute mean kinetics
	interface SpeciesAgg {
		species: string;
		meanK1: number;
		meanK2: number;
		meanF: number;
		n: number;
		k1Values: number[];
		color: string;
	}

	// Assign colors based on speciesSelectionOrder
	function getSpeciesColor(species: string): string {
		const idx = speciesSelectionOrder.indexOf(species);
		if (idx >= 0) return SPECIES_COLORS[idx % SPECIES_COLORS.length];
		// Fallback: use position after selection order
		return SPECIES_COLORS[speciesSelectionOrder.length % SPECIES_COLORS.length];
	}

	const speciesAggs = $derived.by((): SpeciesAgg[] => {
		if (selectedRows.length === 0 || fluence <= 0) return [];

		const grouped = new Map<string, EfficacyRow[]>();
		for (const row of selectedRows) {
			const existing = grouped.get(row.species);
			if (existing) existing.push(row);
			else grouped.set(row.species, [row]);
		}

		// Iterate in speciesSelectionOrder, then any remaining species
		const orderedSpecies: string[] = [];
		for (const s of speciesSelectionOrder) {
			if (grouped.has(s)) orderedSpecies.push(s);
		}
		for (const s of grouped.keys()) {
			if (!orderedSpecies.includes(s)) orderedSpecies.push(s);
		}

		const aggs: SpeciesAgg[] = [];
		for (const species of orderedSpecies) {
			const rows = grouped.get(species)!;
			const k1Values = rows.map(r => r.k1).filter(k => k > 0);
			if (k1Values.length === 0) continue;
			const n = k1Values.length;
			const meanK1 = k1Values.reduce((s, v) => s + v, 0) / n;
			const meanK2 = rows.map(r => r.k2 ?? 0).reduce((s, v) => s + v, 0) / rows.length;
			const meanF = rows.map(r => r.resistant_fraction).reduce((s, v) => s + v, 0) / rows.length;
			const color = getSpeciesColor(species);
			aggs.push({ species, meanK1, meanK2, meanF, n, k1Values, color });
		}
		return aggs;
	});

	// Compute max time from main curves (log-reduction endpoint) + 10% padding
	const maxTime = $derived.by(() => {
		let max = 0;
		for (const agg of speciesAggs) {
			const pts = survivalCurvePoints(fluence, agg.meanK1, agg.meanK2, agg.meanF, 10, maxLogLevel);
			const last = pts[pts.length - 1];
			if (last && isFinite(last.t) && last.t > max) max = last.t;
		}
		return max > 0 ? max * 1.1 : 1;
	});

	// Generate curves spanning full time range (0 to maxTime)
	const NUM_POINTS = 300;
	const speciesCurves = $derived.by((): SpeciesCurve[] => {
		return speciesAggs.map((agg) => {
			const points: { t: number; S: number }[] = [];
			for (let i = 0; i <= NUM_POINTS; i++) {
				const t = (i / NUM_POINTS) * maxTime;
				points.push({ t, S: survivalFraction(t, fluence, agg.meanK1, agg.meanK2, agg.meanF) });
			}

			let ciUpper: { t: number; S: number }[] | null = null;
			let ciLower: { t: number; S: number }[] | null = null;

			if (agg.n >= 2) {
				const variance = agg.k1Values.reduce((s, v) => s + (v - agg.meanK1) ** 2, 0) / (agg.n - 1);
				const se = Math.sqrt(variance / agg.n);
				const k1Lo = Math.max(0.0001, agg.meanK1 - 1.96 * se);
				const k1Hi = agg.meanK1 + 1.96 * se;
				ciUpper = [];
				ciLower = [];
				for (let i = 0; i <= NUM_POINTS; i++) {
					const t = (i / NUM_POINTS) * maxTime;
					ciUpper.push({ t, S: survivalFraction(t, fluence, k1Lo, agg.meanK2, agg.meanF) });
					ciLower.push({ t, S: survivalFraction(t, fluence, k1Hi, agg.meanK2, agg.meanF) });
				}
			}

			return {
				species: agg.species, meanK1: agg.meanK1, meanK2: agg.meanK2, meanF: agg.meanF,
				n: agg.n, points, color: agg.color, ciUpper, ciLower,
			};
		});
	});

	// Generate a closed SVG path for the CI band (upper path forward, lower path reversed)
	function ciBandPath(
		upper: { t: number; S: number }[],
		lower: { t: number; S: number }[],
		xFn: (t: number) => number,
		yFn: (S: number) => number
	): string {
		if (upper.length === 0 || lower.length === 0) return '';
		let d = upper.map((p, i) => `${i === 0 ? 'M' : 'L'}${xFn(p.t)},${yFn(p.S)}`).join(' ');
		for (let i = lower.length - 1; i >= 0; i--) {
			d += ` L${xFn(lower[i].t)},${yFn(lower[i].S)}`;
		}
		d += ' Z';
		return d;
	}

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

	// Log reduction reference lines — one for each checked level
	const sortedLogLevels = $derived(logLevels.toSorted((a, b) => a - b));
	const refLines = $derived.by(() => {
		const lines: { S: number; label: string; y: number }[] = [];
		for (const level of sortedLogLevels) {
			const S = Math.pow(10, -level);
			const y = yScale(S);
			if (y >= 0 && y <= innerHeight) {
				lines.push({ S, label: LOG_LABELS[level], y });
			}
		}
		return lines;
	});

	// Tooltip state
	let hoveredCurve = $state<{ curve: SpeciesCurve; x: number; y: number } | null>(null);
	let svgEl = $state<SVGSVGElement | null>(null);
	let savingPlot = $state(false);

	// Font variable for export functions
	const fontSans = 'var(--font-sans)';

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
			const resolvedFontSans = styles.getPropertyValue('--font-sans').trim() || '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

			// Clone SVG and inline styles so CSS variables resolve when serialized
			const clone = svgEl.cloneNode(true) as SVGSVGElement;
			clone.setAttribute('width', String(plotWidth));
			clone.setAttribute('height', String(plotHeight));
			clone.setAttribute('style', `font-family: ${resolvedFontSans}`);

			for (const el of clone.querySelectorAll('.tick-label, .ref-label')) {
				(el as SVGElement).setAttribute('fill', textMuted);
				(el as SVGElement).setAttribute('font-family', fontMono);
				(el as SVGElement).setAttribute('font-size', el.classList.contains('ref-label') ? '0.6rem' : '0.7rem');
			}
			for (const el of clone.querySelectorAll('.axis-label')) {
				(el as SVGElement).setAttribute('fill', textColor);
				(el as SVGElement).setAttribute('font-family', resolvedFontSans);
				(el as SVGElement).setAttribute('font-size', '0.75rem');
			}
			for (const el of clone.querySelectorAll('.axis-line, .tick-line')) {
				(el as SVGElement).setAttribute('stroke', textMuted);
				(el as SVGElement).setAttribute('stroke-width', '1');
			}
			for (const el of clone.querySelectorAll('.grid-line')) {
				(el as SVGElement).setAttribute('stroke', borderColor);
				(el as SVGElement).setAttribute('stroke-width', '1');
				(el as SVGElement).setAttribute('stroke-dasharray', '2,2');
				(el as SVGElement).setAttribute('opacity', '0.5');
			}
			for (const el of clone.querySelectorAll('.ref-line')) {
				(el as SVGElement).setAttribute('stroke', textMuted);
				(el as SVGElement).setAttribute('stroke-width', '1');
				(el as SVGElement).setAttribute('stroke-dasharray', '6,3');
				(el as SVGElement).setAttribute('opacity', '0.4');
			}
			for (const el of clone.querySelectorAll('.legend-label')) {
				(el as SVGElement).setAttribute('fill', textMuted);
				(el as SVGElement).setAttribute('font-family', resolvedFontSans);
				(el as SVGElement).setAttribute('font-size', '0.65rem');
			}

			// Create offscreen canvas (legend is already in SVG, no extra height needed)
			const canvasW = plotWidth * scale;
			const canvasH = plotHeight * scale;
			const offscreen = document.createElement('canvas');
			offscreen.width = canvasW;
			offscreen.height = canvasH;
			const ctx = offscreen.getContext('2d');
			if (!ctx) throw new Error('Could not get 2d context');

			// Background
			ctx.fillStyle = bgColor;
			ctx.fillRect(0, 0, canvasW, canvasH);

			// Draw SVG onto canvas
			const svgStr = new XMLSerializer().serializeToString(clone);
			const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
			const svgUrl = URL.createObjectURL(svgBlob);

			await new Promise<void>((resolve, reject) => {
				const img = new Image();
				img.onload = () => {
					ctx.drawImage(img, 0, 0, canvasW, canvasH);
					URL.revokeObjectURL(svgUrl);
					resolve();
				};
				img.onerror = () => {
					URL.revokeObjectURL(svgUrl);
					reject(new Error('Failed to load SVG image'));
				};
				img.src = svgUrl;
			});

			// Download
			offscreen.toBlob((blob) => {
				if (!blob) return;
				const url = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				a.download = 'survival-curves.png';
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
		clone.setAttribute('width', String(plotWidth * 2));
		clone.setAttribute('height', String(plotHeight * 2));
		clone.setAttribute('viewBox', `0 0 ${plotWidth} ${plotHeight}`);
		const styles = getComputedStyle(document.documentElement);
		const bgColor = styles.getPropertyValue('--color-bg-secondary').trim() || '#1a1a2e';
		const textColor = styles.getPropertyValue('--color-text').trim() || '#e0e0e0';
		const textMuted = styles.getPropertyValue('--color-text-muted').trim() || '#888';
		const borderColor = styles.getPropertyValue('--color-border').trim() || '#333';
		const fontMono = styles.getPropertyValue('--font-mono').trim() || 'monospace';
		const resolvedFontSans = styles.getPropertyValue('--font-sans').trim() || '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
		const svgStr = new XMLSerializer().serializeToString(clone);

		const popup = window.open('', '_blank', `width=${plotWidth * 2 + 40},height=${plotHeight * 2 + 40}`);
		if (!popup) return;
		popup.document.write(`<!DOCTYPE html><html><head><title>Survival Curves</title>
			<style>
				body { margin: 20px; background: ${bgColor}; font-family: ${resolvedFontSans}; display: flex; flex-direction: column; align-items: center; min-height: calc(100vh - 40px); }
				svg { max-width: 100%; height: auto; font-family: ${resolvedFontSans}; }
				svg .tick-label, svg .ref-label { font-family: ${fontMono}; }
				svg .axis-line, svg .tick-line { stroke: ${textMuted}; stroke-width: 1; }
				svg .grid-line { stroke: ${borderColor}; stroke-width: 1; stroke-dasharray: 2,2; opacity: 0.5; }
				svg .tick-label { font-size: 0.7rem; fill: ${textMuted}; }
				svg .axis-label { font-size: 0.75rem; fill: ${textColor}; font-family: ${resolvedFontSans}; }
				svg .ref-line { stroke: ${textMuted}; stroke-width: 1; stroke-dasharray: 6,3; opacity: 0.4; }
				svg .ref-label { font-size: 0.6rem; fill: ${textMuted}; }
				svg .legend-label { font-size: 0.65rem; fill: ${textMuted}; }
			</style></head><body>${svgStr}</body></html>`);
		popup.document.close();
	}

	function formatTime(seconds: number): string {
		if (!isFinite(seconds) || seconds < 0) return '—';
		if (seconds < 60) return `${Math.round(seconds)}s`;
		if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
		return `${(seconds / 3600).toFixed(1)}h`;
	}
</script>

<div class="survival-plot-container">
	<div class="plot-controls">
		<button class="popup-btn" onclick={savePlot} disabled={savingPlot || selectedRows.length === 0} title="Save plot as PNG">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
				<polyline points="7 10 12 15 17 10"/>
				<line x1="12" y1="15" x2="12" y2="3"/>
			</svg>
			Save
		</button>
		<button class="popup-btn" onclick={openHiRes} disabled={selectedRows.length === 0} title="Open hi-res in new window">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
				<polyline points="15 3 21 3 21 9"/>
				<line x1="10" y1="14" x2="21" y2="3"/>
			</svg>
			Open
		</button>
	</div>
	{#if selectedRows.length === 0}
		<div class="placeholder">
			Select pathogens from the table below to view survival curves
		</div>
	{:else}
		<div class="plot-scroll">
		<svg bind:this={svgEl} width={plotWidth} height={plotHeight} style="font-family: var(--font-sans);">
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

				<!-- CI bands (rendered behind curves) -->
				{#each speciesCurves as curve}
					{#if curve.ciUpper && curve.ciLower}
						<path
							d={ciBandPath(curve.ciUpper, curve.ciLower, xScale, yScale)}
							fill={curve.color}
							fill-opacity="0.12"
							stroke="none"
						/>
					{/if}
				{/each}

				<!-- Survival curves -->
				{#each speciesCurves as curve}
					<path
						d={pointsToPath(curve.points, xScale, yScale)}
						fill="none"
						stroke={curve.color}
						stroke-width="2"
						stroke-opacity="0.8"
						class="curve-path"
						onmouseenter={(e) => {
							const rect = (e.target as SVGElement).getBoundingClientRect();
							hoveredCurve = { curve, x: rect.left + rect.width / 2, y: rect.top };
						}}
						onmouseleave={() => hoveredCurve = null}
					/>
				{/each}

				<!-- Legend (right side, inside SVG) -->
				{#if speciesCurves.length >= 1}
					{#each speciesCurves as curve, i}
						{@const legendY = i * 18}
						<line
							x1={innerWidth + 20}
							y1={legendY + 6}
							x2={innerWidth + 32}
							y2={legendY + 6}
							stroke={curve.color}
							stroke-width="2"
						/>
						<text
							x={innerWidth + 36}
							y={legendY + 10}
							class="legend-label"
						>{curve.species} (n={curve.n})</text>
					{/each}
				{/if}
			</g>
		</svg>
		</div>

		<!-- Tooltip -->
		{#if hoveredCurve}
			<div class="tooltip" style="left: {hoveredCurve.x + 10}px; top: {hoveredCurve.y - 10}px;">
				<div class="tooltip-title">{hoveredCurve.curve.species}</div>
				<div class="tooltip-row">n={hoveredCurve.curve.n} entries, mean k₁={formatValue(hoveredCurve.curve.meanK1, 3)}</div>
				{#each sortedLogLevels as level}
					{@const t = logReductionTime(level, fluence, hoveredCurve.curve.meanK1, hoveredCurve.curve.meanK2, hoveredCurve.curve.meanF)}
					<div class="tooltip-row">{LOG_LABELS[level]}: {formatTime(t)}</div>
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

	.plot-controls {
		width: 100%;
		display: flex;
		justify-content: flex-start;
		gap: var(--spacing-sm);
		align-items: center;
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

	.legend-label {
		font-size: 0.65rem;
		fill: var(--color-text-muted);
	}
</style>
