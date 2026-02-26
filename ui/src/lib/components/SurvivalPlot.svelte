<script lang="ts">
	import { survivalCurvePoints, type SurvivalPoint } from '$lib/utils/survival-math';
	import type { SpeciesKinetics } from '$lib/utils/survival-math';
	import { formatValue } from '$lib/utils/formatting';

	interface Props {
		speciesData: SpeciesKinetics[];
		fluence: number;
	}

	let { speciesData, fluence }: Props = $props();

	// matplotlib tab20 palette (even indices = dark variants)
	const TAB20_COLORS = [
		'#1f77b4', '#aec7e8', '#ff7f0e', '#ffbb78', '#2ca02c', '#98df8a',
		'#d62728', '#ff9896', '#9467bd', '#c5b0d5', '#8c564b', '#c49c94',
		'#e377c2', '#f7b6d2', '#7f7f7f', '#c7c7c7', '#bcbd22', '#dbdb8d',
		'#17becf', '#9edae5',
	];

	function getSpeciesColor(index: number): string {
		const colorIndex = (index * 2) % TAB20_COLORS.length;
		return TAB20_COLORS[colorIndex];
	}

	interface CurveData {
		species: string;
		color: string;
		points: SurvivalPoint[];
		ciUpper: SurvivalPoint[] | null;
		ciLower: SurvivalPoint[] | null;
	}

	// Generate curve data for each species (500 points, 2-log max) with 95% CI bands
	const curves = $derived.by((): CurveData[] => {
		return speciesData.map((sp, i) => {
			const points = survivalCurvePoints(fluence, sp.k1, sp.k2, sp.f, 500, 2);
			let ciUpper: SurvivalPoint[] | null = null;
			let ciLower: SurvivalPoint[] | null = null;

			if (sp.k1Sem > 0) {
				const k1Lo = Math.max(0.0001, sp.k1 - 1.96 * sp.k1Sem);
				const k1Hi = sp.k1 + 1.96 * sp.k1Sem;
				ciUpper = survivalCurvePoints(fluence, k1Lo, sp.k2, sp.f, 500, 2);
				ciLower = survivalCurvePoints(fluence, k1Hi, sp.k2, sp.f, 500, 2);
			}

			return {
				species: sp.species,
				color: getSpeciesColor(i),
				points,
				ciUpper,
				ciLower,
			};
		});
	});

	// Determine time range from main curves only (not CI bands) + 10% padding
	const tMax = $derived.by(() => {
		let max = 0;
		for (const curve of curves) {
			for (const p of curve.points) {
				if (isFinite(p.t) && p.t > max) max = p.t;
			}
		}
		return max > 0 ? max * 1.1 : 60;
	});

	// Plot dimensions — roughly square, scales to fill container width via viewBox
	const plotPadding = { top: 60, right: 20, bottom: 55, left: 70 };
	const plotWidth = 500;
	const plotHeight = 450;
	const innerWidth = plotWidth - plotPadding.left - plotPadding.right;
	const innerHeight = plotHeight - plotPadding.top - plotPadding.bottom;

	// Linear Y scale: 0 to 1
	function yScale(S: number): number {
		return innerHeight - S * innerHeight;
	}

	function xScale(t: number): number {
		return (t / tMax) * innerWidth;
	}

	// Build SVG path for a curve
	function buildPath(points: SurvivalPoint[]): string {
		if (points.length === 0) return '';
		const parts: string[] = [];
		for (let i = 0; i < points.length; i++) {
			const x = xScale(points[i].t);
			const y = yScale(points[i].S);
			parts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`);
		}
		return parts.join(' ');
	}

	// Build closed CI band path (upper forward, lower reversed)
	function ciBandPath(upper: SurvivalPoint[], lower: SurvivalPoint[]): string {
		if (upper.length === 0 || lower.length === 0) return '';
		let d = upper.map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(p.t).toFixed(2)},${yScale(p.S).toFixed(2)}`).join(' ');
		for (let i = lower.length - 1; i >= 0; i--) {
			d += ` L${xScale(lower[i].t).toFixed(2)},${yScale(lower[i].S).toFixed(2)}`;
		}
		d += ' Z';
		return d;
	}

	// X-axis: auto-scale time units (match backend: <100→s, <6000→min, else→hr)
	const timeUnit = $derived.by(() => {
		if (tMax < 100) return 'seconds' as const;
		if (tMax < 6000) return 'minutes' as const;
		return 'hours' as const;
	});
	const xLabel = $derived(
		timeUnit === 'seconds' ? 'Time (s)' : timeUnit === 'minutes' ? 'Time (min)' : 'Time (hr)'
	);
	const xTickFactor = $derived(
		timeUnit === 'seconds' ? 1 : timeUnit === 'minutes' ? 60 : 3600
	);

	// X-axis ticks
	const xTicks = $derived.by(() => {
		const displayMax = tMax / xTickFactor;
		const rawStep = displayMax / 5;
		const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
		const niceSteps = [1, 2, 5, 10];
		let step = niceSteps.find(s => s * magnitude >= rawStep)! * magnitude;
		if (!step || step <= 0) step = displayMax / 5;

		const ticks: { value: number; x: number; label: string }[] = [];
		for (let v = 0; v <= displayMax * 1.01; v += step) {
			ticks.push({
				value: v * xTickFactor,
				x: xScale(v * xTickFactor),
				label: Number.isInteger(v) ? String(v) : v.toFixed(1),
			});
		}
		return ticks;
	});

	// Y-axis ticks (linear: 0.0, 0.2, 0.4, 0.6, 0.8, 1.0)
	const yTicks = [0, 0.2, 0.4, 0.6, 0.8, 1.0].map(S => ({
		S,
		y: yScale(S),
		label: S.toFixed(1),
	}));

	// Title: match backend "Estimated reduction\nat X.XX µW/cm²"
	const titleLine1 = 'Estimated reduction';
	const titleLine2 = $derived(`at ${formatValue(fluence, 2)} µW/cm²`);

	// Save and open logic
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
			const fontMono = styles.getPropertyValue('--font-mono').trim() || 'monospace';
			const fontSans = styles.getPropertyValue('--font-sans').trim() || '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

			const clone = svgEl.cloneNode(true) as SVGSVGElement;
			clone.setAttribute('width', String(plotWidth));
			clone.setAttribute('height', String(plotHeight));
			clone.setAttribute('style', `font-family: ${fontSans}`);

			for (const el of clone.querySelectorAll('.tick-label')) {
				(el as SVGElement).setAttribute('fill', textMuted);
				(el as SVGElement).setAttribute('font-family', fontMono);
				(el as SVGElement).setAttribute('font-size', '14px');
			}
			for (const el of clone.querySelectorAll('.axis-label')) {
				(el as SVGElement).setAttribute('fill', textColor);
				(el as SVGElement).setAttribute('font-family', fontSans);
				(el as SVGElement).setAttribute('font-size', '16px');
			}
			for (const el of clone.querySelectorAll('.axis-line, .tick-line')) {
				(el as SVGElement).setAttribute('stroke', textMuted);
			}
			for (const el of clone.querySelectorAll('.grid-line')) {
				(el as SVGElement).setAttribute('stroke', textMuted);
				(el as SVGElement).setAttribute('opacity', '0.7');
			}
			for (const el of clone.querySelectorAll('.plot-title')) {
				(el as SVGElement).setAttribute('fill', textColor);
				(el as SVGElement).setAttribute('font-family', fontSans);
				(el as SVGElement).setAttribute('font-size', '18px');
			}
			for (const el of clone.querySelectorAll('.legend-label')) {
				(el as SVGElement).setAttribute('fill', textColor);
				(el as SVGElement).setAttribute('font-family', fontSans);
				(el as SVGElement).setAttribute('font-size', '14px');
			}

			const canvasW = plotWidth * scale;
			const canvasH = plotHeight * scale;
			const offscreen = document.createElement('canvas');
			offscreen.width = canvasW;
			offscreen.height = canvasH;
			const ctx = offscreen.getContext('2d');
			if (!ctx) throw new Error('Could not get 2d context');

			ctx.fillStyle = bgColor;
			ctx.fillRect(0, 0, canvasW, canvasH);

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

			offscreen.toBlob((blob) => {
				if (!blob) return;
				const url = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				a.download = 'survival-plot.png';
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
		const fontMono = styles.getPropertyValue('--font-mono').trim() || 'monospace';
		const fontSans = styles.getPropertyValue('--font-sans').trim() || '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

		const svgStr = new XMLSerializer().serializeToString(clone);

		const popup = window.open('', '_blank', `width=${plotWidth * 2 + 40},height=${plotHeight * 2 + 40}`);
		if (!popup) return;
		popup.document.write(`<!DOCTYPE html><html><head><title>Survival Plot</title>
			<style>
				body { margin: 20px; background: ${bgColor}; font-family: ${fontSans}; display: flex; flex-direction: column; align-items: center; }
				svg { max-width: 100%; height: auto; font-family: ${fontSans}; }
				svg .tick-label { font-family: ${fontMono}; font-size: 14px; fill: ${textMuted}; }
				svg .axis-label { font-size: 16px; fill: ${textColor}; font-family: ${fontSans}; }
				svg .axis-line, svg .tick-line { stroke: ${textMuted}; stroke-width: 1; }
				svg .grid-line { stroke: ${textMuted}; stroke-width: 1; stroke-dasharray: 4,3; opacity: 0.7; }
				svg .plot-title { font-size: 18px; fill: ${textColor}; font-weight: 600; }
				svg .legend-label { font-size: 14px; fill: ${textColor}; }
			</style></head><body>${svgStr}</body></html>`);
		popup.document.close();
	}
</script>

<div class="plot-container">
	<div class="plot-controls">
		<button class="popup-btn" onclick={savePlot} disabled={savingPlot || speciesData.length === 0} title="Save plot as PNG">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
				<polyline points="7 10 12 15 17 10"/>
				<line x1="12" y1="15" x2="12" y2="3"/>
			</svg>
			Save
		</button>
		<button class="popup-btn" onclick={openHiRes} disabled={speciesData.length === 0} title="Open hi-res in new window">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
				<polyline points="15 3 21 3 21 9"/>
				<line x1="10" y1="14" x2="21" y2="3"/>
			</svg>
			Open
		</button>
	</div>

	<svg bind:this={svgEl} width="100%" viewBox="0 0 {plotWidth} {plotHeight}" style="font-family: var(--font-sans);">
		<g transform="translate({plotPadding.left}, {plotPadding.top})">
			<!-- Title (two lines) -->
			<text x={innerWidth / 2} y="-28" class="plot-title" text-anchor="middle">
				<tspan x={innerWidth / 2} dy="0">{titleLine1}</tspan>
				<tspan x={innerWidth / 2} dy="20">{titleLine2}</tspan>
			</text>

			<!-- Y-axis -->
			<line x1="0" y1="0" x2="0" y2={innerHeight} class="axis-line" />
			{#each yTicks as tick}
				<g transform="translate(0, {tick.y})">
					<line x1="-4" y1="0" x2="0" y2="0" class="tick-line" />
					<text x="-10" y="5" class="tick-label" text-anchor="end">{tick.label}</text>
					<line x1="0" y1="0" x2={innerWidth} y2="0" class="grid-line" />
				</g>
			{/each}
			<text x="-50" y={innerHeight / 2} class="axis-label" text-anchor="middle" transform="rotate(-90, -50, {innerHeight / 2})">Survival fraction</text>

			<!-- X-axis -->
			<line x1="0" y1={innerHeight} x2={innerWidth} y2={innerHeight} class="axis-line" />
			{#each xTicks as tick}
				<g transform="translate({tick.x}, {innerHeight})">
					<line x1="0" y1="0" x2="0" y2="4" class="tick-line" />
					<text x="0" y="20" class="tick-label" text-anchor="middle">{tick.label}</text>
				</g>
			{/each}
			<text x={innerWidth / 2} y={innerHeight + 42} class="axis-label" text-anchor="middle">{xLabel}</text>

			<!-- 95% CI bands (behind curves) -->
			{#each curves as curve}
				{#if curve.ciUpper && curve.ciLower}
					<path
						d={ciBandPath(curve.ciUpper, curve.ciLower)}
						fill={curve.color}
						fill-opacity="0.2"
						stroke="none"
					/>
				{/if}
			{/each}

			<!-- Survival curves -->
			{#each curves as curve}
				<path
					d={buildPath(curve.points)}
					fill="none"
					stroke={curve.color}
					stroke-width="2.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			{/each}

			<!-- Legend (upper right, inside plot area) -->
			{#each curves as curve, i}
				{@const lx = innerWidth - 8}
				{@const ly = 10 + i * 20}
				<line x1={lx - 16} y1={ly} x2={lx} y2={ly} stroke={curve.color} stroke-width="2.5" />
				<text x={lx - 20} y={ly + 5} class="legend-label" font-style="italic" text-anchor="end">{curve.species}</text>
			{/each}
		</g>
	</svg>
</div>

<style>
	.plot-container {
		position: relative;
		width: 100%;
	}

	.plot-controls {
		width: 100%;
		display: flex;
		gap: var(--spacing-sm);
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

	svg {
		display: block;
		max-width: 100%;
		height: auto;
	}

	.axis-line, .tick-line {
		stroke: var(--color-text-muted);
		stroke-width: 1;
	}

	.grid-line {
		stroke: var(--color-text-muted);
		stroke-width: 1;
		stroke-dasharray: 4,3;
		opacity: 0.7;
	}

	.tick-label {
		font-size: 14px;
		fill: var(--color-text-muted);
		font-family: var(--font-mono);
	}

	.axis-label {
		font-size: 16px;
		fill: var(--color-text);
	}

	.plot-title {
		font-size: 18px;
		fill: var(--color-text);
		font-weight: 600;
	}

	.legend-label {
		font-size: 14px;
		fill: var(--color-text);
	}
</style>
