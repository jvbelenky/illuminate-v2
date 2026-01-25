<script lang="ts">
	import { Canvas, T } from '@threlte/core';
	import * as THREE from 'three';
	import type { CalcZone, RoomConfig } from '$lib/types/project';
	import { valueToColor } from '$lib/utils/colormaps';
	import { theme } from '$lib/stores/theme';
	import { getSessionZoneExport } from '$lib/api/client';

	interface Props {
		zone: CalcZone;
		zoneName: string;
		room: RoomConfig;
		values: number[][];
		onclose: () => void;
	}

	let { zone, zoneName, room, values, onclose }: Props = $props();

	// Export state
	let exporting = $state(false);

	// Axes toggle
	let showAxes = $state(true);

	async function exportCSV() {
		exporting = true;
		try {
			const blob = await getSessionZoneExport(zone.id);
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `${zoneName}.csv`;
			a.click();
			URL.revokeObjectURL(url);
		} catch (error) {
			console.error('Failed to export zone:', error);
			alert('Failed to export zone. Please try again.');
		} finally {
			exporting = false;
		}
	}

	// Handle backdrop click
	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			onclose();
		}
	}

	// Handle keyboard events
	$effect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				onclose();
			}
		};
		window.addEventListener('keydown', handler);
		return () => window.removeEventListener('keydown', handler);
	});

	// Reference surface determines plane orientation
	const refSurface = $derived(zone.ref_surface || 'xy');
	const units = $derived(room.units === 'feet' ? 'ft' : 'm');

	// Calculate plane bounds based on reference surface
	const bounds = $derived.by(() => {
		const height = zone.height ?? 0;
		switch (refSurface) {
			case 'xz':
				return {
					u1: zone.x1 ?? 0,
					u2: zone.x2 ?? room.x,
					v1: zone.z_min ?? 0,
					v2: zone.z_max ?? room.z,
					fixed: height,
					uLabel: 'X',
					vLabel: 'Z'
				};
			case 'yz':
				return {
					u1: zone.y1 ?? 0,
					u2: zone.y2 ?? room.y,
					v1: zone.z_min ?? 0,
					v2: zone.z_max ?? room.z,
					fixed: height,
					uLabel: 'Y',
					vLabel: 'Z'
				};
			case 'xy':
			default:
				return {
					u1: zone.x1 ?? 0,
					u2: zone.x2 ?? room.x,
					v1: zone.y1 ?? 0,
					v2: zone.y2 ?? room.y,
					fixed: height,
					uLabel: 'X',
					vLabel: 'Y'
				};
		}
	});

	// Generate tick values for an axis
	function generateTicks(min: number, max: number, count: number = 5): number[] {
		const range = max - min;
		const step = range / (count - 1);
		const ticks: number[] = [];
		for (let i = 0; i < count; i++) {
			ticks.push(min + i * step);
		}
		return ticks;
	}

	// Format tick value for display
	function formatTick(value: number): string {
		if (Math.abs(value) < 0.01) return '0';
		if (Math.abs(value) >= 100) return value.toFixed(0);
		if (Math.abs(value) >= 10) return value.toFixed(1);
		return value.toFixed(2);
	}

	// Tick arrays
	const uTicks = $derived(generateTicks(bounds.u1, bounds.u2));
	const vTicks = $derived(generateTicks(bounds.v1, bounds.v2));

	// Calculate tick position as percentage
	function tickPercent(value: number, min: number, max: number): number {
		return ((value - min) / (max - min)) * 100;
	}

	// Value statistics for color legend
	const valueStats = $derived.by(() => {
		const flatValues = values.flat();
		const minVal = Math.min(...flatValues);
		const maxVal = Math.max(...flatValues);
		return { min: minVal, max: maxVal };
	});

	// Format value for legend
	function formatValue(value: number): string {
		if (Math.abs(value) >= 1000) return value.toFixed(0);
		if (Math.abs(value) >= 100) return value.toFixed(1);
		if (Math.abs(value) >= 10) return value.toFixed(2);
		return value.toFixed(3);
	}
</script>

<!-- 2D Heatmap Scene -->
{#snippet HeatmapScene()}
	{@const colormap = room.colormap || 'plasma'}

	<!-- Build surface geometry -->
	{@const surfaceGeometry = (() => {
		const numU = values.length;
		const numV = values[0]?.length || 0;
		if (numU < 2 || numV < 2) return null;

		const geometry = new THREE.BufferGeometry();
		const positions: number[] = [];
		const colors: number[] = [];
		const indices: number[] = [];

		// Find value range for color mapping
		const flatValues = values.flat();
		const minVal = Math.min(...flatValues);
		const maxVal = Math.max(...flatValues);
		const range = maxVal - minVal || 1;

		// Create vertices in normalized 0-1 space (will be scaled by camera)
		for (let i = 0; i < numU; i++) {
			for (let j = 0; j < numV; j++) {
				const u = i / (numU - 1);
				const v = j / (numV - 1);
				positions.push(u, v, 0);

				const val = values[i][j];
				const t = (val - minVal) / range;
				const color = valueToColor(t, colormap);
				colors.push(color.r, color.g, color.b);
			}
		}

		// Create triangle indices
		for (let i = 0; i < numU - 1; i++) {
			for (let j = 0; j < numV - 1; j++) {
				const a = i * numV + j;
				const b = i * numV + (j + 1);
				const c = (i + 1) * numV + j;
				const d = (i + 1) * numV + (j + 1);
				indices.push(a, b, c);
				indices.push(b, d, c);
			}
		}

		geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
		geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
		geometry.setIndex(indices);
		geometry.computeBoundingBox();

		return geometry;
	})()}

	<!-- Orthographic camera looking straight down -->
	<T.OrthographicCamera
		makeDefault
		position={[0.5, 0.5, 1]}
		left={0}
		right={1}
		top={1}
		bottom={0}
		near={0.1}
		far={10}
	/>

	<!-- Simple ambient light -->
	<T.AmbientLight intensity={1} />

	<!-- Heatmap surface -->
	{#if surfaceGeometry}
		<T.Mesh geometry={surfaceGeometry}>
			<T.MeshBasicMaterial vertexColors side={THREE.DoubleSide} />
		</T.Mesh>
	{/if}
{/snippet}

<!-- Modal backdrop -->
<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={handleBackdropClick}>
	<div class="modal-content" role="dialog" aria-modal="true">
		<div class="modal-header">
			<h3>{zoneName}</h3>
			<span class="plane-badge">2D Plane</span>
			<button type="button" class="close-btn" onclick={onclose} title="Close">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M18 6L6 18M6 6l12 12"/>
				</svg>
			</button>
		</div>

		<div class="modal-body">
			<div class="plot-container">
				<!-- Y axis label -->
				{#if showAxes}
					<div class="y-axis-label">{bounds.vLabel} ({units})</div>
				{/if}

				<div class="plot-area">
					<!-- Y axis ticks -->
					{#if showAxes}
						<div class="y-axis">
							{#each vTicks as tick}
								<div class="tick" style="bottom: {tickPercent(tick, bounds.v1, bounds.v2)}%">
									<span class="tick-label">{formatTick(tick)}</span>
									<span class="tick-mark"></span>
								</div>
							{/each}
						</div>
					{/if}

					<!-- Canvas -->
					<div class="canvas-wrapper" class:dark={$theme === 'dark'}>
						<Canvas>
							{@render HeatmapScene()}
						</Canvas>
					</div>

					<!-- Color legend -->
					<div class="color-legend">
						<div class="legend-bar" style="background: linear-gradient(to top,
							{(() => {
								const colormap = room.colormap || 'plasma';
								const stops = [];
								for (let i = 0; i <= 10; i++) {
									const t = i / 10;
									const c = valueToColor(t, colormap);
									stops.push(`rgb(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}) ${t * 100}%`);
								}
								return stops.join(', ');
							})()})"></div>
						<div class="legend-labels">
							<span class="legend-max">{formatValue(valueStats.max)}</span>
							<span class="legend-mid">{formatValue((valueStats.min + valueStats.max) / 2)}</span>
							<span class="legend-min">{formatValue(valueStats.min)}</span>
						</div>
						<div class="legend-unit">µW/cm²</div>
					</div>
				</div>

				<!-- X axis ticks -->
				{#if showAxes}
					<div class="x-axis">
						{#each uTicks as tick}
							<div class="tick" style="left: {tickPercent(tick, bounds.u1, bounds.u2)}%">
								<span class="tick-mark"></span>
								<span class="tick-label">{formatTick(tick)}</span>
							</div>
						{/each}
					</div>

					<!-- X axis label -->
					<div class="x-axis-label">{bounds.uLabel} ({units})</div>
				{/if}
			</div>
		</div>

		<div class="modal-footer">
			<label class="checkbox-label">
				<input type="checkbox" bind:checked={showAxes} />
				<span>Show axes</span>
			</label>
			<button class="export-btn" onclick={exportCSV} disabled={exporting}>
				{exporting ? 'Exporting...' : 'Export CSV'}
			</button>
		</div>
	</div>
</div>

<style>
	.modal-backdrop {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: var(--spacing-md);
	}

	.modal-content {
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		width: min(700px, 95vw);
		max-height: 95vh;
		display: flex;
		flex-direction: column;
		box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
	}

	.modal-header {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		padding: var(--spacing-sm) var(--spacing-md);
		border-bottom: 1px solid var(--color-border);
		flex-shrink: 0;
	}

	.modal-header h3 {
		margin: 0;
		font-size: 1rem;
		color: var(--color-text);
		flex: 1;
	}

	.plane-badge {
		font-size: 0.65rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		background: var(--color-bg-tertiary);
		padding: 2px 8px;
		border-radius: var(--radius-sm);
	}

	.close-btn {
		background: transparent;
		border: none;
		padding: var(--spacing-xs);
		cursor: pointer;
		color: var(--color-text-muted);
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-sm);
		transition: all 0.15s;
	}

	.close-btn:hover {
		background: var(--color-bg-tertiary);
		color: var(--color-text);
	}

	.modal-body {
		padding: var(--spacing-md);
		display: flex;
		flex-direction: column;
		align-items: center;
		min-height: 0;
		flex: 1;
	}

	.plot-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		width: 100%;
	}

	.y-axis-label {
		writing-mode: vertical-rl;
		transform: rotate(180deg);
		font-size: 0.75rem;
		color: var(--color-text);
		position: absolute;
		left: 0;
		top: 50%;
		transform: rotate(180deg) translateY(50%);
	}

	.plot-area {
		display: flex;
		align-items: stretch;
		width: 100%;
		position: relative;
		padding-left: 24px;
	}

	.y-axis {
		width: 45px;
		position: relative;
		flex-shrink: 0;
	}

	.y-axis .tick {
		position: absolute;
		right: 0;
		transform: translateY(50%);
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.y-axis .tick-label {
		font-size: 0.65rem;
		color: var(--color-text-muted);
		font-family: var(--font-mono);
		text-align: right;
		min-width: 35px;
	}

	.y-axis .tick-mark {
		width: 4px;
		height: 1px;
		background: var(--color-border);
	}

	.canvas-wrapper {
		flex: 1;
		aspect-ratio: 1;
		max-height: 450px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		overflow: hidden;
		background: #d0d7de;
	}

	.canvas-wrapper.dark {
		background: #1a1a2e;
	}

	.color-legend {
		width: 60px;
		display: flex;
		flex-direction: column;
		align-items: center;
		padding-left: var(--spacing-sm);
		flex-shrink: 0;
	}

	.legend-bar {
		width: 16px;
		flex: 1;
		border-radius: 2px;
		border: 1px solid var(--color-border);
	}

	.legend-labels {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		height: 100%;
		position: absolute;
		right: 20px;
		top: 0;
		bottom: 0;
		padding: 2px 0;
	}

	.color-legend {
		position: relative;
		height: 450px;
	}

	.legend-labels span {
		font-size: 0.6rem;
		color: var(--color-text-muted);
		font-family: var(--font-mono);
	}

	.legend-unit {
		font-size: 0.6rem;
		color: var(--color-text-muted);
		margin-top: 4px;
		text-align: center;
	}

	.x-axis {
		position: relative;
		height: 20px;
		margin-left: 69px;
		margin-right: 60px;
	}

	.x-axis .tick {
		position: absolute;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
	}

	.x-axis .tick-mark {
		width: 1px;
		height: 4px;
		background: var(--color-border);
	}

	.x-axis .tick-label {
		font-size: 0.65rem;
		color: var(--color-text-muted);
		font-family: var(--font-mono);
	}

	.x-axis-label {
		font-size: 0.75rem;
		color: var(--color-text);
		margin-top: 4px;
	}

	.modal-footer {
		padding: var(--spacing-xs) var(--spacing-md);
		border-top: 1px solid var(--color-border);
		display: flex;
		justify-content: space-between;
		align-items: center;
		flex-shrink: 0;
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		font-size: 0.75rem;
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.checkbox-label input[type="checkbox"] {
		width: auto;
		margin: 0;
	}

	.export-btn {
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: var(--spacing-xs) var(--spacing-sm);
		font-size: 0.75rem;
		color: var(--color-text);
		cursor: pointer;
		transition: all 0.15s;
	}

	.export-btn:hover {
		background: var(--color-bg-secondary);
		border-color: var(--color-text-muted);
	}

	.export-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
</style>
