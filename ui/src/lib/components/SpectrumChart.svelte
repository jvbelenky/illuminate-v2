<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import {
		Chart,
		LineController,
		LineElement,
		PointElement,
		LinearScale,
		LogarithmicScale,
		CategoryScale,
		Tooltip,
		Filler,
	} from 'chart.js';
	import zoomPlugin from 'chartjs-plugin-zoom';

	Chart.register(
		LineController,
		LineElement,
		PointElement,
		LinearScale,
		LogarithmicScale,
		CategoryScale,
		Tooltip,
		Filler,
		zoomPlugin
	);

	interface SeriesData {
		label: string;
		intensities: number[];
		color?: string;
		visible?: boolean;
	}

	interface Props {
		wavelengths: number[];
		series: SeriesData[];
		yscale?: 'linear' | 'log';
		height?: string;
		interactive?: boolean;
	}

	let { wavelengths, series, yscale = 'linear', height = '300px', interactive = true }: Props = $props();

	const COLORS = [
		'#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899',
		'#06b6d4', '#f97316', '#14b8a6', '#a855f7', '#64748b', '#84cc16',
	];

	let canvas: HTMLCanvasElement;
	let chart: Chart | null = null;

	function buildChartConfig() {
		// Chart.js linear x-axis requires {x, y} point format
		const datasets = series.map((s, i) => ({
			label: s.label,
			data: wavelengths.map((wl, j) => ({ x: wl, y: s.intensities[j] })),
			borderColor: s.color || COLORS[i % COLORS.length],
			backgroundColor: 'transparent',
			borderWidth: 1.5,
			pointRadius: 0,
			pointHitRadius: 4,
			hidden: s.visible === false,
			tension: 0,
		}));

		return {
			type: 'line' as const,
			data: { datasets },
			options: {
				responsive: true,
				maintainAspectRatio: false,
				animation: false as const,
				interaction: {
					mode: 'nearest' as const,
					axis: 'x' as const,
					intersect: false,
				},
				scales: {
					x: {
						type: 'linear' as const,
						min: wavelengths.length > 0 ? wavelengths[0] : 200,
						max: wavelengths.length > 0 ? wavelengths[wavelengths.length - 1] : 400,
						title: { display: true, text: 'Wavelength (nm)', color: '#9ca3af' },
						ticks: { color: '#9ca3af' },
						grid: { color: 'rgba(156, 163, 175, 0.15)' },
					},
					y: {
						type: yscale === 'log' ? 'logarithmic' as const : 'linear' as const,
						min: 0,
						title: { display: true, text: 'Intensity', color: '#9ca3af' },
						ticks: { color: '#9ca3af' },
						grid: { color: 'rgba(156, 163, 175, 0.15)' },
					},
				},
				plugins: {
					tooltip: {
						callbacks: {
							title: (items: any[]) => {
								if (items.length > 0) {
									return `${items[0].parsed.x} nm`;
								}
								return '';
							},
						},
					},
					zoom: interactive ? {
						pan: { enabled: true, mode: 'x' as const },
						zoom: {
							wheel: { enabled: true },
							pinch: { enabled: true },
							mode: 'x' as const,
						},
						limits: {
							x: {
								min: wavelengths.length > 0 ? wavelengths[0] : 200,
								max: wavelengths.length > 0 ? wavelengths[wavelengths.length - 1] : 400,
							},
						},
					} : undefined,
				},
			},
		};
	}

	onMount(() => {
		chart = new Chart(canvas, buildChartConfig());
	});

	onDestroy(() => {
		chart?.destroy();
		chart = null;
	});

	// React to series/yscale changes
	$effect(() => {
		if (!chart) return;
		// Access reactive deps
		const _series = series;
		const _yscale = yscale;
		const _wavelengths = wavelengths;

		const config = buildChartConfig();
		chart.data = config.data;
		chart.options = config.options as any;
		chart.update('none');
	});

	export function resetZoom() {
		chart?.resetZoom();
	}
</script>

<div class="chart-container" style="height: {height}">
	<canvas bind:this={canvas}></canvas>
</div>

<style>
	.chart-container {
		position: relative;
		width: 100%;
	}
</style>
