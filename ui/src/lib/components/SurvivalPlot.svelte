<script lang="ts">
	import { survivalCurvePoints, type SurvivalPoint } from '$lib/utils/survival-math';
	import type { SpeciesKinetics } from '$lib/utils/survival-math';
	import { formatValue } from '$lib/utils/formatting';

	interface Props {
		speciesData: SpeciesKinetics[];
		fluence: number;
	}

	let { speciesData, fluence }: Props = $props();

	// Species color palette
	const SPECIES_COLORS = [
		'#e94560', // red
		'#4ade80', // green
		'#60a5fa', // blue
		'#fbbf24', // amber
		'#a855f7', // purple
		'#14b8a6', // teal
		'#f97316', // orange
		'#ec4899', // pink
	];

	function getSpeciesColor(index: number): string {
		return SPECIES_COLORS[index % SPECIES_COLORS.length];
	}

	// Reference lines at 90%, 99%, 99.9% survival
	const refLines = [
		{ S: 0.1, label: '90%' },
		{ S: 0.01, label: '99%' },
		{ S: 0.001, label: '99.9%' },
	];

	// Generate curve data for each species
	const curves = $derived.by(() => {
		return speciesData.map((sp, i) => ({
			species: sp.species,
			color: getSpeciesColor(i),
			points: survivalCurvePoints(fluence, sp.k1, sp.k2, sp.f, 200, 4),
		}));
	});

	// Determine time range (max t across all curves)
	const tMax = $derived.by(() => {
		let max = 0;
		for (const curve of curves) {
			for (const p of curve.points) {
				if (isFinite(p.t) && p.t > max) max = p.t;
			}
		}
		return max > 0 ? max : 60;
	});

	// Use log scale for Y (survival fraction)
	const plotPadding = { top: 40, right: 20, bottom: 45, left: 55 };
	const plotWidth = 420;
	const plotHeight = 280;
	const innerWidth = plotWidth - plotPadding.left - plotPadding.right;
	const innerHeight = plotHeight - plotPadding.top - plotPadding.bottom;

	// Log scale for Y: from 1e-4 to 1
	const yLogMin = -4;
	const yLogMax = 0;
	const yLogRange = yLogMax - yLogMin;

	function yScale(S: number): number {
		if (S <= 0) return innerHeight;
		const logS = Math.log10(Math.max(S, 1e-5));
		return innerHeight - ((logS - yLogMin) / yLogRange) * innerHeight;
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

	// X-axis: auto-scale time units
	const useMinutes = $derived(tMax > 300);
	const xLabel = $derived(useMinutes ? 'Time (min)' : 'Time (s)');
	const xTickFactor = $derived(useMinutes ? 60 : 1);

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

	// Y-axis ticks (log scale)
	const yTicks = $derived.by(() => {
		const ticks: { S: number; y: number; label: string }[] = [];
		for (let exp = yLogMin; exp <= yLogMax; exp++) {
			const S = Math.pow(10, exp);
			ticks.push({
				S,
				y: yScale(S),
				label: exp === 0 ? '1' : `10${superscript(exp)}`,
			});
		}
		return ticks;
	});

	function superscript(n: number): string {
		const map: Record<string, string> = {
			'-': '\u207B', '0': '\u2070', '1': '\u00B9', '2': '\u00B2',
			'3': '\u00B3', '4': '\u2074', '5': '\u2075', '6': '\u2076',
			'7': '\u2077', '8': '\u2078', '9': '\u2079'
		};
		return String(n).split('').map(c => map[c] ?? c).join('');
	}

	// Title
	const title = $derived(`Pathogen survival at ${formatValue(fluence, 2)} µW/cm²`);

	// Legend dimensions
	const legendHeight = $derived(speciesData.length > 0 ? 20 : 0);

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
				(el as SVGElement).setAttribute('font-size', '0.65rem');
			}
			for (const el of clone.querySelectorAll('.axis-label')) {
				(el as SVGElement).setAttribute('fill', textColor);
				(el as SVGElement).setAttribute('font-family', fontSans);
				(el as SVGElement).setAttribute('font-size', '0.7rem');
			}
			for (const el of clone.querySelectorAll('.axis-line, .tick-line')) {
				(el as SVGElement).setAttribute('stroke', textMuted);
			}
			for (const el of clone.querySelectorAll('.grid-line')) {
				(el as SVGElement).setAttribute('stroke', textMuted);
				(el as SVGElement).setAttribute('opacity', '0.2');
			}
			for (const el of clone.querySelectorAll('.ref-line')) {
				(el as SVGElement).setAttribute('stroke', textMuted);
				(el as SVGElement).setAttribute('opacity', '0.4');
			}
			for (const el of clone.querySelectorAll('.ref-label')) {
				(el as SVGElement).setAttribute('fill', textMuted);
				(el as SVGElement).setAttribute('font-family', fontMono);
				(el as SVGElement).setAttribute('font-size', '0.6rem');
			}
			for (const el of clone.querySelectorAll('.plot-title')) {
				(el as SVGElement).setAttribute('fill', textColor);
				(el as SVGElement).setAttribute('font-family', fontSans);
				(el as SVGElement).setAttribute('font-size', '0.8rem');
			}
			for (const el of clone.querySelectorAll('.legend-label')) {
				(el as SVGElement).setAttribute('fill', textColor);
				(el as SVGElement).setAttribute('font-family', fontSans);
				(el as SVGElement).setAttribute('font-size', '0.65rem');
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
				svg .tick-label { font-family: ${fontMono}; font-size: 0.65rem; fill: ${textMuted}; }
				svg .axis-label { font-size: 0.7rem; fill: ${textColor}; font-family: ${fontSans}; }
				svg .axis-line, svg .tick-line { stroke: ${textMuted}; stroke-width: 1; }
				svg .grid-line { stroke: ${textMuted}; stroke-width: 1; stroke-dasharray: 4,3; opacity: 0.2; }
				svg .ref-line { stroke: ${textMuted}; stroke-width: 1; stroke-dasharray: 6,3; opacity: 0.4; }
				svg .ref-label { font-size: 0.6rem; fill: ${textMuted}; font-family: ${fontMono}; }
				svg .plot-title { font-size: 0.8rem; fill: ${textColor}; font-weight: 600; }
				svg .legend-label { font-size: 0.65rem; fill: ${textColor}; }
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

	<svg bind:this={svgEl} width={plotWidth} height={plotHeight} style="font-family: var(--font-sans);">
		<g transform="translate({plotPadding.left}, {plotPadding.top})">
			<!-- Title -->
			<text x={innerWidth / 2} y="-12" class="plot-title" text-anchor="middle">{title}</text>

			<!-- Y-axis -->
			<line x1="0" y1="0" x2="0" y2={innerHeight} class="axis-line" />
			{#each yTicks as tick}
				<g transform="translate(0, {tick.y})">
					<line x1="-4" y1="0" x2="0" y2="0" class="tick-line" />
					<text x="-8" y="4" class="tick-label" text-anchor="end">{tick.label}</text>
					<line x1="0" y1="0" x2={innerWidth} y2="0" class="grid-line" />
				</g>
			{/each}
			<text x="-40" y={innerHeight / 2} class="axis-label" text-anchor="middle" transform="rotate(-90, -40, {innerHeight / 2})">Survival fraction</text>

			<!-- X-axis -->
			<line x1="0" y1={innerHeight} x2={innerWidth} y2={innerHeight} class="axis-line" />
			{#each xTicks as tick}
				<g transform="translate({tick.x}, {innerHeight})">
					<line x1="0" y1="0" x2="0" y2="4" class="tick-line" />
					<text x="0" y="16" class="tick-label" text-anchor="middle">{tick.label}</text>
				</g>
			{/each}
			<text x={innerWidth / 2} y={innerHeight + 36} class="axis-label" text-anchor="middle">{xLabel}</text>

			<!-- Reference lines (90%, 99%, 99.9%) -->
			{#each refLines as ref}
				{@const ry = yScale(ref.S)}
				{#if ry >= 0 && ry <= innerHeight}
					<line x1="0" y1={ry} x2={innerWidth} y2={ry} class="ref-line" />
					<text x={innerWidth + 4} y={ry + 3} class="ref-label" text-anchor="start">{ref.label}</text>
				{/if}
			{/each}

			<!-- Survival curves -->
			{#each curves as curve}
				<path
					d={buildPath(curve.points)}
					fill="none"
					stroke={curve.color}
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			{/each}

			<!-- Legend -->
			{#each curves as curve, i}
				{@const lx = 8}
				{@const ly = 8 + i * 16}
				<line x1={lx} y1={ly} x2={lx + 14} y2={ly} stroke={curve.color} stroke-width="2" />
				<text x={lx + 18} y={ly + 4} class="legend-label" font-style="italic">{curve.species}</text>
			{/each}
		</g>
	</svg>
</div>

<style>
	.plot-container {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
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
		opacity: 0.2;
	}

	.ref-line {
		stroke: var(--color-text-muted);
		stroke-width: 1;
		stroke-dasharray: 6,3;
		opacity: 0.4;
	}

	.tick-label {
		font-size: 0.65rem;
		fill: var(--color-text-muted);
		font-family: var(--font-mono);
	}

	.axis-label {
		font-size: 0.7rem;
		fill: var(--color-text);
	}

	.ref-label {
		font-size: 0.6rem;
		fill: var(--color-text-muted);
		font-family: var(--font-mono);
	}

	.plot-title {
		font-size: 0.8rem;
		fill: var(--color-text);
		font-weight: 600;
	}

	.legend-label {
		font-size: 0.65rem;
		fill: var(--color-text);
	}
</style>
