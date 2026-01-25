<script lang="ts">
	import { Canvas, T } from '@threlte/core';
	import { OrbitControls, Text } from '@threlte/extras';
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
</script>

<!-- Heatmap Scene Component - must be inside Canvas -->
{#snippet HeatmapScene(showAxisLabels: boolean)}
	{@const colormap = room.colormap || 'plasma'}
	{@const scale = room.units === 'feet' ? 0.3048 : 1}
	{@const units = room.units === 'feet' ? 'ft' : 'm'}

	<!-- Calculate plane bounds based on reference surface -->
	{@const bounds = (() => {
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
	})()}

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

		// Convert plane coordinates to Three.js world coordinates
		function planeToWorld(u: number, v: number, fixed: number): [number, number, number] {
			switch (refSurface) {
				case 'xz':
					return [u * scale, v * scale, fixed * scale];
				case 'yz':
					return [fixed * scale, v * scale, u * scale];
				case 'xy':
				default:
					return [u * scale, fixed * scale, v * scale];
			}
		}

		// Create vertices with colors based on values
		for (let i = 0; i < numU; i++) {
			for (let j = 0; j < numV; j++) {
				const u = bounds.u1 + (i / (numU - 1)) * (bounds.u2 - bounds.u1);
				const v = bounds.v1 + (j / (numV - 1)) * (bounds.v2 - bounds.v1);
				const [wx, wy, wz] = planeToWorld(u, v, bounds.fixed);
				positions.push(wx, wy, wz);

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
		geometry.computeVertexNormals();
		geometry.computeBoundingBox();
		geometry.computeBoundingSphere();

		return geometry;
	})()}

	<!-- Calculate camera position -->
	{@const centerU = ((bounds.u1 + bounds.u2) / 2) * scale}
	{@const centerV = ((bounds.v1 + bounds.v2) / 2) * scale}
	{@const fixedScaled = bounds.fixed * scale}
	{@const uSize = (bounds.u2 - bounds.u1) * scale}
	{@const vSize = (bounds.v2 - bounds.v1) * scale}
	{@const maxDim = Math.max(uSize, vSize)}
	{@const cameraDistance = maxDim * 1.5}

	<!-- Text styling -->
	{@const textColor = $theme === 'dark' ? '#cccccc' : '#333333'}
	{@const axisColor = $theme === 'dark' ? '#888888' : '#666666'}
	{@const fontSize = maxDim * 0.06}
	{@const tickSize = maxDim * 0.02}

	<!-- Camera position depends on plane orientation -->
	{@const cameraPos = (() => {
		switch (refSurface) {
			case 'xz':
				// Looking from +Y direction at XZ plane
				return [centerU, fixedScaled, centerV + cameraDistance] as [number, number, number];
			case 'yz':
				// Looking from +X direction at YZ plane
				return [fixedScaled + cameraDistance, centerV, centerU] as [number, number, number];
			case 'xy':
			default:
				// Looking from above at XY plane
				return [centerU, fixedScaled + cameraDistance, centerV] as [number, number, number];
		}
	})()}
	{@const targetPos = (() => {
		switch (refSurface) {
			case 'xz':
				return [centerU, fixedScaled, centerV] as [number, number, number];
			case 'yz':
				return [fixedScaled, centerV, centerU] as [number, number, number];
			case 'xy':
			default:
				return [centerU, fixedScaled, centerV] as [number, number, number];
		}
	})()}

	<!-- Camera with orbit controls -->
	<T.PerspectiveCamera
		makeDefault
		position={cameraPos}
		fov={50}
	>
		<OrbitControls
			enableDamping
			dampingFactor={0.1}
			target={targetPos}
		/>
	</T.PerspectiveCamera>

	<!-- Lighting -->
	<T.AmbientLight intensity={0.6} />
	<T.DirectionalLight position={[10, 20, 10]} intensity={0.5} />

	<!-- Heatmap surface -->
	{#if surfaceGeometry}
		<T.Mesh geometry={surfaceGeometry}>
			<T.MeshBasicMaterial
				vertexColors
				transparent
				opacity={0.9}
				side={THREE.DoubleSide}
				depthWrite={false}
			/>
		</T.Mesh>
	{/if}

	<!-- Axis labels and ticks -->
	{#if showAxisLabels}
		{@const uTicks = generateTicks(bounds.u1, bounds.u2)}
		{@const vTicks = generateTicks(bounds.v1, bounds.v2)}

		{#if refSurface === 'xy'}
			<!-- XY plane: X along Three.js X, Y along Three.js Z, at fixed Three.js Y -->
			<!-- U axis (X) -->
			<T.Group>
				<T.Line>
					<T.BufferGeometry>
						<T.BufferAttribute
							attach="attributes-position"
							args={[new Float32Array([
								bounds.u1 * scale, fixedScaled - tickSize * 0.5, bounds.v1 * scale - tickSize,
								bounds.u2 * scale, fixedScaled - tickSize * 0.5, bounds.v1 * scale - tickSize
							]), 3]}
						/>
					</T.BufferGeometry>
					<T.LineBasicMaterial color={axisColor} />
				</T.Line>
				<Text
					text={`${bounds.uLabel} (${units})`}
					fontSize={fontSize}
					color={textColor}
					position={[centerU, fixedScaled - tickSize, bounds.v1 * scale - tickSize * 4]}
					anchorX="center"
					anchorY="middle"
				/>
				{#each uTicks as tick}
					{@const pos = tick * scale}
					<T.Line>
						<T.BufferGeometry>
							<T.BufferAttribute
								attach="attributes-position"
								args={[new Float32Array([
									pos, fixedScaled - tickSize * 0.5, bounds.v1 * scale - tickSize,
									pos, fixedScaled - tickSize * 0.5, bounds.v1 * scale - tickSize * 2
								]), 3]}
							/>
						</T.BufferGeometry>
						<T.LineBasicMaterial color={axisColor} />
					</T.Line>
					<Text
						text={formatTick(tick)}
						fontSize={fontSize * 0.7}
						color={textColor}
						position={[pos, fixedScaled - tickSize * 0.5, bounds.v1 * scale - tickSize * 2.5]}
						anchorX="center"
						anchorY="top"
					/>
				{/each}
			</T.Group>

			<!-- V axis (Y) -->
			<T.Group>
				<T.Line>
					<T.BufferGeometry>
						<T.BufferAttribute
							attach="attributes-position"
							args={[new Float32Array([
								bounds.u1 * scale - tickSize, fixedScaled - tickSize * 0.5, bounds.v1 * scale,
								bounds.u1 * scale - tickSize, fixedScaled - tickSize * 0.5, bounds.v2 * scale
							]), 3]}
						/>
					</T.BufferGeometry>
					<T.LineBasicMaterial color={axisColor} />
				</T.Line>
				<Text
					text={`${bounds.vLabel} (${units})`}
					fontSize={fontSize}
					color={textColor}
					position={[bounds.u1 * scale - tickSize * 4, fixedScaled - tickSize, centerV]}
					anchorX="center"
					anchorY="middle"
					rotation={[0, Math.PI / 2, 0]}
				/>
				{#each vTicks as tick}
					{@const pos = tick * scale}
					<T.Line>
						<T.BufferGeometry>
							<T.BufferAttribute
								attach="attributes-position"
								args={[new Float32Array([
									bounds.u1 * scale - tickSize, fixedScaled - tickSize * 0.5, pos,
									bounds.u1 * scale - tickSize * 2, fixedScaled - tickSize * 0.5, pos
								]), 3]}
							/>
						</T.BufferGeometry>
						<T.LineBasicMaterial color={axisColor} />
					</T.Line>
					<Text
						text={formatTick(tick)}
						fontSize={fontSize * 0.7}
						color={textColor}
						position={[bounds.u1 * scale - tickSize * 2.5, fixedScaled - tickSize * 0.5, pos]}
						anchorX="right"
						anchorY="middle"
					/>
				{/each}
			</T.Group>
		{:else if refSurface === 'xz'}
			<!-- XZ plane: X along Three.js X, Z along Three.js Y, at fixed Three.js Z -->
			<!-- U axis (X) -->
			<T.Group>
				<T.Line>
					<T.BufferGeometry>
						<T.BufferAttribute
							attach="attributes-position"
							args={[new Float32Array([
								bounds.u1 * scale, bounds.v1 * scale - tickSize, fixedScaled,
								bounds.u2 * scale, bounds.v1 * scale - tickSize, fixedScaled
							]), 3]}
						/>
					</T.BufferGeometry>
					<T.LineBasicMaterial color={axisColor} />
				</T.Line>
				<Text
					text={`${bounds.uLabel} (${units})`}
					fontSize={fontSize}
					color={textColor}
					position={[centerU, bounds.v1 * scale - tickSize * 4, fixedScaled]}
					anchorX="center"
					anchorY="middle"
				/>
				{#each uTicks as tick}
					{@const pos = tick * scale}
					<T.Line>
						<T.BufferGeometry>
							<T.BufferAttribute
								attach="attributes-position"
								args={[new Float32Array([
									pos, bounds.v1 * scale - tickSize, fixedScaled,
									pos, bounds.v1 * scale - tickSize * 2, fixedScaled
								]), 3]}
							/>
						</T.BufferGeometry>
						<T.LineBasicMaterial color={axisColor} />
					</T.Line>
					<Text
						text={formatTick(tick)}
						fontSize={fontSize * 0.7}
						color={textColor}
						position={[pos, bounds.v1 * scale - tickSize * 2.5, fixedScaled]}
						anchorX="center"
						anchorY="top"
					/>
				{/each}
			</T.Group>

			<!-- V axis (Z - height) -->
			<T.Group>
				<T.Line>
					<T.BufferGeometry>
						<T.BufferAttribute
							attach="attributes-position"
							args={[new Float32Array([
								bounds.u1 * scale - tickSize, bounds.v1 * scale, fixedScaled,
								bounds.u1 * scale - tickSize, bounds.v2 * scale, fixedScaled
							]), 3]}
						/>
					</T.BufferGeometry>
					<T.LineBasicMaterial color={axisColor} />
				</T.Line>
				<Text
					text={`${bounds.vLabel} (${units})`}
					fontSize={fontSize}
					color={textColor}
					position={[bounds.u1 * scale - tickSize * 4, centerV, fixedScaled]}
					anchorX="center"
					anchorY="middle"
					rotation={[0, 0, Math.PI / 2]}
				/>
				{#each vTicks as tick}
					{@const pos = tick * scale}
					<T.Line>
						<T.BufferGeometry>
							<T.BufferAttribute
								attach="attributes-position"
								args={[new Float32Array([
									bounds.u1 * scale - tickSize, pos, fixedScaled,
									bounds.u1 * scale - tickSize * 2, pos, fixedScaled
								]), 3]}
							/>
						</T.BufferGeometry>
						<T.LineBasicMaterial color={axisColor} />
					</T.Line>
					<Text
						text={formatTick(tick)}
						fontSize={fontSize * 0.7}
						color={textColor}
						position={[bounds.u1 * scale - tickSize * 2.5, pos, fixedScaled]}
						anchorX="right"
						anchorY="middle"
					/>
				{/each}
			</T.Group>
		{:else}
			<!-- YZ plane: Y along Three.js Z, Z along Three.js Y, at fixed Three.js X -->
			<!-- U axis (Y) -->
			<T.Group>
				<T.Line>
					<T.BufferGeometry>
						<T.BufferAttribute
							attach="attributes-position"
							args={[new Float32Array([
								fixedScaled, bounds.v1 * scale - tickSize, bounds.u1 * scale,
								fixedScaled, bounds.v1 * scale - tickSize, bounds.u2 * scale
							]), 3]}
						/>
					</T.BufferGeometry>
					<T.LineBasicMaterial color={axisColor} />
				</T.Line>
				<Text
					text={`${bounds.uLabel} (${units})`}
					fontSize={fontSize}
					color={textColor}
					position={[fixedScaled, bounds.v1 * scale - tickSize * 4, centerU]}
					anchorX="center"
					anchorY="middle"
					rotation={[0, Math.PI / 2, 0]}
				/>
				{#each uTicks as tick}
					{@const pos = tick * scale}
					<T.Line>
						<T.BufferGeometry>
							<T.BufferAttribute
								attach="attributes-position"
								args={[new Float32Array([
									fixedScaled, bounds.v1 * scale - tickSize, pos,
									fixedScaled, bounds.v1 * scale - tickSize * 2, pos
								]), 3]}
							/>
						</T.BufferGeometry>
						<T.LineBasicMaterial color={axisColor} />
					</T.Line>
					<Text
						text={formatTick(tick)}
						fontSize={fontSize * 0.7}
						color={textColor}
						position={[fixedScaled, bounds.v1 * scale - tickSize * 2.5, pos]}
						anchorX="center"
						anchorY="top"
					/>
				{/each}
			</T.Group>

			<!-- V axis (Z - height) -->
			<T.Group>
				<T.Line>
					<T.BufferGeometry>
						<T.BufferAttribute
							attach="attributes-position"
							args={[new Float32Array([
								fixedScaled, bounds.v1 * scale, bounds.u1 * scale - tickSize,
								fixedScaled, bounds.v2 * scale, bounds.u1 * scale - tickSize
							]), 3]}
						/>
					</T.BufferGeometry>
					<T.LineBasicMaterial color={axisColor} />
				</T.Line>
				<Text
					text={`${bounds.vLabel} (${units})`}
					fontSize={fontSize}
					color={textColor}
					position={[fixedScaled, centerV, bounds.u1 * scale - tickSize * 4]}
					anchorX="center"
					anchorY="middle"
					rotation={[0, 0, Math.PI / 2]}
				/>
				{#each vTicks as tick}
					{@const pos = tick * scale}
					<T.Line>
						<T.BufferGeometry>
							<T.BufferAttribute
								attach="attributes-position"
								args={[new Float32Array([
									fixedScaled, pos, bounds.u1 * scale - tickSize,
									fixedScaled, pos, bounds.u1 * scale - tickSize * 2
								]), 3]}
							/>
						</T.BufferGeometry>
						<T.LineBasicMaterial color={axisColor} />
					</T.Line>
					<Text
						text={formatTick(tick)}
						fontSize={fontSize * 0.7}
						color={textColor}
						position={[fixedScaled, pos, bounds.u1 * scale - tickSize * 2.5]}
						anchorX="right"
						anchorY="middle"
					/>
				{/each}
			</T.Group>
		{/if}
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
			<div class="canvas-container" class:dark={$theme === 'dark'}>
				<Canvas>
					{@render HeatmapScene(showAxes)}
				</Canvas>
			</div>
			<p class="hint">Drag to rotate, scroll to zoom</p>
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
		width: min(800px, 95vw);
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
