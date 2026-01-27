<script lang="ts">
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
	let savingPlot = $state(false);

	// Axes toggle
	let showAxes = $state(true);

	// Canvas ref
	let canvas: HTMLCanvasElement;

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

	async function savePlot() {
		savingPlot = true;
		try {
			// Create a high-res version at 2x display size
			const hiResWidth = Math.round(displayDims.width * 2);
			const hiResHeight = Math.round(displayDims.height * 2);

			const offscreen = document.createElement('canvas');
			offscreen.width = hiResWidth;
			offscreen.height = hiResHeight;
			const ctx = offscreen.getContext('2d');
			if (!ctx) throw new Error('Could not get 2d context');

			// Re-render the heatmap at high resolution
			const numU = values.length;
			const numV = values[0]?.length || 0;
			const { min: minVal, max: maxVal } = valueStats;
			const range = maxVal - minVal || 1;

			// Calculate cell size at high-res
			const cellWidth = hiResWidth / numU;
			const cellHeight = hiResHeight / numV;

			// Draw each cell as a filled rectangle
			for (let i = 0; i < numU; i++) {
				for (let j = 0; j < numV; j++) {
					const val = values[i][j];
					const t = (val - minVal) / range;
					const color = valueToColor(t, colormap);

					ctx.fillStyle = `rgb(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)})`;
					// Flip when v points in positive direction
					const x = i * cellWidth;
					const canvasJ = shouldFlipV ? (numV - 1 - j) : j;
					const y = canvasJ * cellHeight;
					ctx.fillRect(x, y, Math.ceil(cellWidth), Math.ceil(cellHeight));
				}
			}

			offscreen.toBlob((blob) => {
				if (!blob) return;
				const url = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				a.download = `${zoneName}.png`;
				a.click();
				URL.revokeObjectURL(url);
			}, 'image/png');
		} catch (error) {
			console.error('Failed to save plot:', error);
			alert('Failed to save plot. Please try again.');
		} finally {
			savingPlot = false;
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
	const colormap = $derived(room.colormap || 'plasma');

	// Value units depend on whether this is a dose calculation
	const valueUnits = $derived(zone.dose ? 'mJ/cm²' : 'µW/cm²');

	// Determine if V axis should be flipped (when v points in positive direction)
	// Use v_positive_direction from geometry if available, otherwise compute from ref_surface/direction
	const shouldFlipV = $derived.by(() => {
		// Prefer the computed value from backend geometry
		if (zone.v_positive_direction !== undefined) {
			return zone.v_positive_direction;
		}
		// Fallback: compute from ref_surface and direction (for axis-aligned planes)
		const direction = zone.direction ?? 1;
		if (refSurface === 'xz') {
			// XZ: v points +Z when direction=-1, -Z when direction=1
			return direction < 0;
		}
		// XY and YZ: v points positive when direction=1
		return direction > 0;
	});

	// Calculate plane bounds based on reference surface
	// For each plane type, the "fixed" axis is the perpendicular one:
	// XY plane: Z is fixed, XZ plane: Y is fixed, YZ plane: X is fixed
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
					vLabel: 'Z',
					fixedLabel: 'Y'
				};
			case 'yz':
				return {
					u1: zone.y1 ?? 0,
					u2: zone.y2 ?? room.y,
					v1: zone.z_min ?? 0,
					v2: zone.z_max ?? room.z,
					fixed: height,
					uLabel: 'Y',
					vLabel: 'Z',
					fixedLabel: 'X'
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
					vLabel: 'Y',
					fixedLabel: 'Z'
				};
		}
	});

	// Aspect ratio from physical dimensions (width / height)
	const physicalWidth = $derived(bounds.u2 - bounds.u1);
	const physicalHeight = $derived(bounds.v2 - bounds.v1);
	const aspectRatio = $derived(physicalWidth / physicalHeight);

	// Calculate display dimensions to fit within max bounds while maintaining aspect ratio
	const maxDisplayWidth = 550;
	const maxDisplayHeight = 400;
	const displayDims = $derived.by(() => {
		let width = maxDisplayWidth;
		let height = width / aspectRatio;

		if (height > maxDisplayHeight) {
			height = maxDisplayHeight;
			width = height * aspectRatio;
		}

		return { width, height };
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

	// Draw heatmap on canvas
	$effect(() => {
		if (!canvas) return;

		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		const numU = values.length;
		const numV = values[0]?.length || 0;
		if (numU < 1 || numV < 1) return;

		// Set canvas size to match data dimensions for crisp pixels
		canvas.width = numU;
		canvas.height = numV;

		// Find value range
		const { min: minVal, max: maxVal } = valueStats;
		const range = maxVal - minVal || 1;

		// Draw each cell
		const imageData = ctx.createImageData(numU, numV);
		for (let i = 0; i < numU; i++) {
			for (let j = 0; j < numV; j++) {
				const val = values[i][j];
				const t = (val - minVal) / range;
				const color = valueToColor(t, colormap);

				// Canvas Y=0 is at top. Flip when v points in positive direction
				// so that positive world coordinates appear at top of image.
				const canvasJ = shouldFlipV ? (numV - 1 - j) : j;
				const pixelIndex = (canvasJ * numU + i) * 4;
				imageData.data[pixelIndex] = Math.round(color.r * 255);
				imageData.data[pixelIndex + 1] = Math.round(color.g * 255);
				imageData.data[pixelIndex + 2] = Math.round(color.b * 255);
				imageData.data[pixelIndex + 3] = 255;
			}
		}
		ctx.putImageData(imageData, 0, 0);
	});

	// Generate legend gradient stops
	const legendGradient = $derived.by(() => {
		const stops = [];
		for (let i = 0; i <= 10; i++) {
			const t = i / 10;
			const c = valueToColor(t, colormap);
			stops.push(`rgb(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}) ${t * 100}%`);
		}
		return stops.join(', ');
	});
</script>

<!-- Modal backdrop -->
<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={handleBackdropClick}>
	<div class="modal-content" role="dialog" aria-modal="true">
		<div class="modal-header">
			<h3>{zoneName}</h3>
			<span class="plane-badge">2D Plane @ {bounds.fixedLabel}={formatTick(bounds.fixed)} {units}</span>
			<button type="button" class="close-btn" onclick={onclose} title="Close">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M18 6L6 18M6 6l12 12"/>
				</svg>
			</button>
		</div>

		<div class="modal-body">
			<div class="plot-wrapper">
				<!-- Y axis label (rotated) -->
				{#if showAxes}
					<div class="y-label" style="height: {displayDims.height}px;">{bounds.vLabel} ({units})</div>
				{/if}

				<!-- Y axis ticks -->
				{#if showAxes}
					<div class="y-axis" style="height: {displayDims.height}px;">
						{#each vTicks as tick}
							<div class="y-tick" style="bottom: {tickPercent(tick, bounds.v1, bounds.v2)}%">
								<span class="tick-label">{formatTick(tick)}</span>
								<span class="tick-mark"></span>
							</div>
						{/each}
					</div>
				{/if}

				<!-- Center column: canvas + x-axis -->
				<div class="center-column">
					<div class="canvas-container" style="width: {displayDims.width}px; height: {displayDims.height}px;">
						<canvas bind:this={canvas}></canvas>
					</div>

					{#if showAxes}
						<div class="x-axis" style="width: {displayDims.width}px;">
							{#each uTicks as tick}
								<div class="x-tick" style="left: {tickPercent(tick, bounds.u1, bounds.u2)}%">
									<span class="tick-mark"></span>
									<span class="tick-label">{formatTick(tick)}</span>
								</div>
							{/each}
						</div>
						<div class="x-label">{bounds.uLabel} ({units})</div>
					{/if}
				</div>

				<!-- Color legend -->
				<div class="legend-column">
					<div class="legend-content" style="height: {displayDims.height}px;">
						<div class="legend-bar" style="background: linear-gradient(to top, {legendGradient})"></div>
						<div class="legend-labels">
							<span class="legend-label-top">{formatValue(valueStats.max)}</span>
							<span class="legend-label-mid">{formatValue((valueStats.min + valueStats.max) / 2)}</span>
							<span class="legend-label-bot">{formatValue(valueStats.min)}</span>
						</div>
					</div>
					<div class="legend-unit">{valueUnits}</div>
				</div>
			</div>
		</div>

		<div class="modal-footer">
			<label class="checkbox-label">
				<input type="checkbox" bind:checked={showAxes} />
				<span>Show axes</span>
			</label>
			<div class="footer-buttons">
				<button class="export-btn" onclick={savePlot} disabled={savingPlot}>
					{savingPlot ? 'Saving...' : 'Save Plot'}
				</button>
				<button class="export-btn" onclick={exportCSV} disabled={exporting}>
					{exporting ? 'Exporting...' : 'Export CSV'}
				</button>
			</div>
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
		width: min(750px, 95vw);
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
		justify-content: center;
		align-items: center;
		min-height: 0;
		flex: 1;
		overflow: auto;
	}

	.plot-wrapper {
		display: flex;
		align-items: flex-start;
		gap: 8px;
	}

	.y-label {
		writing-mode: vertical-rl;
		transform: rotate(180deg);
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--color-text);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.y-axis {
		width: 45px;
		position: relative;
		flex-shrink: 0;
	}

	.y-tick {
		position: absolute;
		right: 0;
		transform: translateY(50%);
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.y-tick .tick-label {
		font-size: 0.8rem;
		color: var(--color-text);
		font-family: var(--font-mono);
		text-align: right;
	}

	.y-tick .tick-mark {
		width: 6px;
		height: 1px;
		background: var(--color-text-muted);
	}

	.center-column {
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.canvas-container {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		overflow: hidden;
		background: var(--color-bg-secondary);
	}

	.canvas-container canvas {
		width: 100%;
		height: 100%;
		display: block;
		image-rendering: pixelated;
		image-rendering: crisp-edges;
	}

	.x-axis {
		position: relative;
		height: 28px;
		margin-top: 4px;
	}

	.x-tick {
		position: absolute;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
	}

	.x-tick .tick-mark {
		width: 1px;
		height: 6px;
		background: var(--color-text-muted);
	}

	.x-tick .tick-label {
		font-size: 0.8rem;
		color: var(--color-text);
		font-family: var(--font-mono);
	}

	.x-label {
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--color-text);
		text-align: center;
		margin-top: 4px;
	}

	.legend-column {
		display: flex;
		flex-direction: column;
		align-items: center;
		margin-left: 12px;
	}

	.legend-content {
		display: flex;
		gap: 6px;
	}

	.legend-bar {
		width: 16px;
		height: 100%;
		border-radius: 2px;
		border: 1px solid var(--color-border);
	}

	.legend-labels {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		height: 100%;
	}

	.legend-labels span {
		font-size: 0.75rem;
		color: var(--color-text);
		font-family: var(--font-mono);
		line-height: 1;
	}

	.legend-label-top {
		align-self: flex-start;
	}

	.legend-label-mid {
		align-self: center;
	}

	.legend-label-bot {
		align-self: flex-end;
	}

	.legend-unit {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		margin-top: 4px;
		text-align: center;
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
		font-size: 0.8rem;
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
		font-size: 0.8rem;
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

	.footer-buttons {
		display: flex;
		gap: var(--spacing-sm);
	}
</style>
