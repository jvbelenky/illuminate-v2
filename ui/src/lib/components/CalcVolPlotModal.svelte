<script lang="ts">
	import { Canvas, T } from '@threlte/core';
	import { OrbitControls, Text } from '@threlte/extras';
	import * as THREE from 'three';
	import type { CalcZone, RoomConfig, LampInstance } from '$lib/types/project';
	import { buildIsosurfaces, getIsosurfaceColor } from '$lib/utils/isosurface';
	import { theme } from '$lib/stores/theme';
	import { lamps } from '$lib/stores/project';
	import { getSessionZoneExport } from '$lib/api/client';
	import AlertDialog from './AlertDialog.svelte';
	import Modal from './Modal.svelte';
	import BillboardGroup from './BillboardGroup.svelte';
	import { enterToggle } from '$lib/actions/enterToggle';

	interface Props {
		zone: CalcZone;
		zoneName: string;
		room: RoomConfig;
		values: number[][][];
		valueFactor?: number;
		onclose: () => void;
	}

	let { zone, zoneName, room, values, valueFactor = 1, onclose }: Props = $props();

	// Export state
	let exporting = $state(false);
	let savingPlot = $state(false);
	let alertDialog = $state<{ title: string; message: string } | null>(null);

	// Axes, tick marks, tick labels toggles
	let showAxes = $state(true);
	let showTickMarks = $state(true);
	let showTickLabels = $state(true);

	// Lamp labels toggle
	let showLampLabels = $state(false);

	// Canvas container ref for saving plot
	let canvasContainer: HTMLDivElement;

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
			alertDialog = { title: 'Export Failed', message: 'Failed to export zone. Please try again.' };
		} finally {
			exporting = false;
		}
	}

	async function savePlot() {
		savingPlot = true;
		try {
			// Find the canvas element inside the container
			const canvas = canvasContainer?.querySelector('canvas');
			if (!canvas) {
				throw new Error('Canvas not found');
			}

			// Create a high-res version by rendering to a larger canvas
			const scaleFactor = 2; // 2x resolution
			const width = canvas.width * scaleFactor;
			const height = canvas.height * scaleFactor;

			// Create an offscreen canvas
			const offscreen = document.createElement('canvas');
			offscreen.width = width;
			offscreen.height = height;
			const ctx = offscreen.getContext('2d');
			if (!ctx) throw new Error('Could not get 2d context');

			// Draw the WebGL canvas scaled up
			ctx.imageSmoothingEnabled = true;
			ctx.imageSmoothingQuality = 'high';
			ctx.drawImage(canvas, 0, 0, width, height);

			// Convert to blob and download
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
			alertDialog = { title: 'Save Failed', message: 'Failed to save plot. Please try again.' };
		} finally {
			savingPlot = false;
		}
	}

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

	// Format tick value to match room's configured precision
	function formatTick(value: number): string {
		return value.toFixed(room.precision);
	}

	// Enabled lamp positions for 3D rendering
	const enabledLamps = $derived.by((): LampInstance[] => {
		if (!showLampLabels) return [];
		const lampList: LampInstance[] = $lamps;
		return lampList?.filter(l => l.enabled) ?? [];
	});
</script>

<!-- Isosurface Scene Component - must be inside Canvas -->
{#snippet IsosurfaceScene(axisLabelsVisible: boolean, tickMarksVisible: boolean, tickLabelsVisible: boolean, lampLabelsVisible: boolean)}
	{@const colormap = room.colormap || 'plasma'}
	{@const scale = room.units === 'feet' ? 0.3048 : 1}
	{@const units = room.units === 'feet' ? 'ft' : 'm'}
	{@const bounds = {
		x1: zone.x_min ?? 0,
		x2: zone.x_max ?? room.x,
		y1: zone.y_min ?? 0,
		y2: zone.y_max ?? room.y,
		z1: zone.z_min ?? 0,
		z2: zone.z_max ?? room.z
	}}
	{@const isosurfaces = buildIsosurfaces(values, bounds, scale, colormap, 3)}
	{@const opacityLevels = [0.35, 0.25, 0.2]}

	{@const centerX = ((bounds.x1 + bounds.x2) / 2) * scale}
	{@const centerY = ((bounds.z1 + bounds.z2) / 2) * scale}
	{@const centerZ = -((bounds.y1 + bounds.y2) / 2) * scale}
	{@const maxDim = Math.max(
		(bounds.x2 - bounds.x1) * scale,
		(bounds.y2 - bounds.y1) * scale,
		(bounds.z2 - bounds.z1) * scale
	)}
	{@const cameraDistance = maxDim * 1.8}

	<!-- Text styling -->
	{@const textColor = $theme === 'dark' ? '#cccccc' : '#333333'}
	{@const axisColor = $theme === 'dark' ? '#888888' : '#666666'}
	{@const fontSize = maxDim * 0.06}
	{@const tickSize = maxDim * 0.02}

	<!-- Camera with orbit controls -->
	<T.PerspectiveCamera
		makeDefault
		position={[centerX + cameraDistance, centerY + cameraDistance * 0.6, centerZ + cameraDistance]}
		fov={50}
	>
		<OrbitControls
			enableDamping
			dampingFactor={0.1}
			target={[centerX, centerY, centerZ]}
		/>
	</T.PerspectiveCamera>

	<!-- Lighting -->
	<T.AmbientLight intensity={0.5} />
	<T.DirectionalLight position={[10, 20, 10]} intensity={0.7} />
	<T.DirectionalLight position={[-10, 10, -10]} intensity={0.3} />

	<!-- Isosurface shells -->
	{#each isosurfaces as iso, index}
		{@const color = getIsosurfaceColor(iso.normalizedLevel, colormap)}
		{@const opacity = opacityLevels[index] ?? 0.2}
		<T.Mesh geometry={iso.geometry}>
			<T.MeshBasicMaterial
				color={new THREE.Color(color.r, color.g, color.b)}
				transparent
				opacity={opacity}
				side={THREE.DoubleSide}
				depthWrite={false}
			/>
		</T.Mesh>
	{/each}

	<!-- Bounding box wireframe -->
	{@const boxWidth = (bounds.x2 - bounds.x1) * scale}
	{@const boxHeight = (bounds.z2 - bounds.z1) * scale}
	{@const boxDepth = (bounds.y2 - bounds.y1) * scale}
	<T.LineSegments position={[centerX, centerY, centerZ]}>
		<T.EdgesGeometry args={[new THREE.BoxGeometry(boxWidth, boxHeight, boxDepth)]} />
		<T.LineBasicMaterial color="#666666" opacity={0.5} transparent />
	</T.LineSegments>

	<!-- Axes, tick marks, and tick labels -->
	{@const xTicks = generateTicks(bounds.x1, bounds.x2)}
	{@const yTicks = generateTicks(bounds.y1, bounds.y2)}
	{@const zTicks = generateTicks(bounds.z1, bounds.z2)}

	<!-- X axis (room X) -->
	{#if tickMarksVisible}
		<T.Line>
			<T.BufferGeometry>
				<T.BufferAttribute
					attach="attributes-position"
					args={[new Float32Array([
						bounds.x1 * scale, bounds.z1 * scale - tickSize, -bounds.y1 * scale,
						bounds.x2 * scale, bounds.z1 * scale - tickSize, -bounds.y1 * scale
					]), 3]}
				/>
			</T.BufferGeometry>
			<T.LineBasicMaterial color={axisColor} />
		</T.Line>
		{#each xTicks as tick}
			{@const xPos = tick * scale}
			<T.Line>
				<T.BufferGeometry>
					<T.BufferAttribute
						attach="attributes-position"
						args={[new Float32Array([
							xPos, bounds.z1 * scale - tickSize, -bounds.y1 * scale,
							xPos, bounds.z1 * scale - tickSize * 2, -bounds.y1 * scale
						]), 3]}
					/>
				</T.BufferGeometry>
				<T.LineBasicMaterial color={axisColor} />
			</T.Line>
		{/each}
	{/if}

	<!-- Y axis (room Y, Three.js Z) -->
	{#if tickMarksVisible}
		<T.Line>
			<T.BufferGeometry>
				<T.BufferAttribute
					attach="attributes-position"
					args={[new Float32Array([
						bounds.x1 * scale - tickSize, bounds.z1 * scale - tickSize, -bounds.y1 * scale,
						bounds.x1 * scale - tickSize, bounds.z1 * scale - tickSize, -bounds.y2 * scale
					]), 3]}
				/>
			</T.BufferGeometry>
			<T.LineBasicMaterial color={axisColor} />
		</T.Line>
		{#each yTicks as tick}
			{@const zPos = tick * scale}
			<T.Line>
				<T.BufferGeometry>
					<T.BufferAttribute
						attach="attributes-position"
						args={[new Float32Array([
							bounds.x1 * scale - tickSize, bounds.z1 * scale - tickSize, -zPos,
							bounds.x1 * scale - tickSize * 2, bounds.z1 * scale - tickSize, -zPos
						]), 3]}
					/>
				</T.BufferGeometry>
				<T.LineBasicMaterial color={axisColor} />
			</T.Line>
		{/each}
	{/if}

	<!-- Z axis (room Z, Three.js Y - height) -->
	{#if tickMarksVisible}
		<T.Line>
			<T.BufferGeometry>
				<T.BufferAttribute
					attach="attributes-position"
					args={[new Float32Array([
						bounds.x1 * scale - tickSize, bounds.z1 * scale, -bounds.y1 * scale + tickSize,
						bounds.x1 * scale - tickSize, bounds.z2 * scale, -bounds.y1 * scale + tickSize
					]), 3]}
				/>
			</T.BufferGeometry>
			<T.LineBasicMaterial color={axisColor} />
		</T.Line>
		{#each zTicks as tick}
			{@const yPos = tick * scale}
			<T.Line>
				<T.BufferGeometry>
					<T.BufferAttribute
						attach="attributes-position"
						args={[new Float32Array([
							bounds.x1 * scale - tickSize, yPos, -bounds.y1 * scale + tickSize,
							bounds.x1 * scale - tickSize * 2, yPos, -bounds.y1 * scale + tickSize
						]), 3]}
					/>
				</T.BufferGeometry>
				<T.LineBasicMaterial color={axisColor} />
			</T.Line>
		{/each}
	{/if}

	<!-- All text labels (billboarded - always face camera) -->
	<BillboardGroup>
		<!-- Lamp labels -->
		{#if lampLabelsVisible}
			{#each enabledLamps as lamp}
				{@const lx = lamp.x * scale}
				{@const ly = lamp.z * scale}
				{@const lz = -lamp.y * scale}
				<Text
					text={lamp.name || lamp.id}
					fontSize={fontSize * 0.6}
					color="#ffffff"
					outlineColor="#000000"
					outlineWidth={fontSize * 0.06}
					position={[lx, ly, lz]}
					anchorX="center"
					anchorY="middle"
				/>
			{/each}
		{/if}

		<!-- Axis labels -->
		{#if axisLabelsVisible}
			<Text
				text={`X (${units})`}
				fontSize={fontSize}
				color={textColor}
				position={[centerX, bounds.z1 * scale - tickSize * 4, -bounds.y1 * scale + tickSize]}
				anchorX="center"
				anchorY="middle"
			/>
			<Text
				text={`Y (${units})`}
				fontSize={fontSize}
				color={textColor}
				position={[bounds.x1 * scale - tickSize * 4, bounds.z1 * scale - tickSize, centerZ]}
				anchorX="center"
				anchorY="middle"
			/>
			<Text
				text={`Z (${units})`}
				fontSize={fontSize}
				color={textColor}
				position={[bounds.x1 * scale - tickSize * 4, centerY, -bounds.y1 * scale + tickSize]}
				anchorX="center"
				anchorY="middle"
			/>
		{/if}

		<!-- Tick labels -->
		{#if tickLabelsVisible}
			{#each xTicks as tick}
				<Text
					text={formatTick(tick)}
					fontSize={fontSize * 0.7}
					color={textColor}
					position={[tick * scale, bounds.z1 * scale - tickSize * 3, -bounds.y1 * scale]}
					anchorX="center"
					anchorY="middle"
				/>
			{/each}
			{#each yTicks as tick}
				<Text
					text={formatTick(tick)}
					fontSize={fontSize * 0.7}
					color={textColor}
					position={[bounds.x1 * scale - tickSize * 3, bounds.z1 * scale - tickSize, -tick * scale]}
					anchorX="center"
					anchorY="middle"
				/>
			{/each}
			{#each zTicks as tick}
				<Text
					text={formatTick(tick)}
					fontSize={fontSize * 0.7}
					color={textColor}
					position={[bounds.x1 * scale - tickSize * 3, tick * scale, -bounds.y1 * scale + tickSize]}
					anchorX="center"
					anchorY="middle"
				/>
			{/each}
		{/if}
	</BillboardGroup>
{/snippet}

<Modal title={zoneName} onClose={onclose} maxWidth="min(800px, 95vw)" maxHeight="95vh" titleFontSize="1rem">
	{#snippet headerExtra()}
		<span class="volume-badge">3D Volume</span>
	{/snippet}
	{#snippet body()}
		<div class="modal-body">
			<div class="canvas-container" class:dark={$theme === 'dark'} bind:this={canvasContainer}>
				<Canvas>
					{@render IsosurfaceScene(showAxes, showTickMarks, showTickLabels, showLampLabels)}
				</Canvas>
			</div>
			<p class="hint">Drag to rotate, scroll to zoom</p>
		</div>
	{/snippet}
	{#snippet footer()}
		<div class="modal-footer">
			<div class="footer-controls">
				<label class="checkbox-label">
					<input type="checkbox" bind:checked={showAxes} use:enterToggle />
					<span>Show axes</span>
				</label>
				<label class="checkbox-label">
					<input type="checkbox" bind:checked={showTickMarks} use:enterToggle />
					<span>Tick marks</span>
				</label>
				<label class="checkbox-label">
					<input type="checkbox" bind:checked={showTickLabels} use:enterToggle />
					<span>Tick labels</span>
				</label>
				<label class="checkbox-label">
					<input type="checkbox" bind:checked={showLampLabels} use:enterToggle />
					<span>Show lamps</span>
				</label>
			</div>
			<div class="footer-buttons">
				<button class="export-btn" onclick={savePlot} disabled={savingPlot}>
					{savingPlot ? 'Saving...' : 'Save Plot'}
				</button>
				<button class="export-btn" onclick={exportCSV} disabled={exporting}>
					{exporting ? 'Exporting...' : 'Export CSV'}
				</button>
			</div>
		</div>
	{/snippet}
</Modal>

{#if alertDialog}
	<AlertDialog
		title={alertDialog.title}
		message={alertDialog.message}
		onDismiss={() => alertDialog = null}
	/>
{/if}

<style>
	.volume-badge {
		font-size: 0.65rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		background: var(--color-bg-tertiary);
		padding: 2px 8px;
		border-radius: var(--radius-sm);
	}

	.modal-body {
		padding: var(--spacing-sm);
		display: flex;
		flex-direction: column;
		align-items: center;
		min-height: 0;
		flex: 1;
	}

	.canvas-container {
		width: 100%;
		height: 500px;
		border-radius: var(--radius-md);
		overflow: hidden;
		background: #d0d7de;
	}

	.canvas-container.dark {
		background: #1a1a2e;
	}

	.hint {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		margin: var(--spacing-xs) 0 0 0;
		text-align: center;
	}

	.modal-footer {
		padding: var(--spacing-xs) var(--spacing-md);
		border-top: 1px solid var(--color-border);
		display: flex;
		justify-content: space-between;
		align-items: center;
		flex-shrink: 0;
		gap: var(--spacing-sm);
	}

	.footer-controls {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		flex-wrap: wrap;
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

	.footer-buttons {
		display: flex;
		gap: var(--spacing-sm);
		flex-shrink: 0;
	}
</style>
