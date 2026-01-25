<script lang="ts">
	import { Canvas, T, useThrelte } from '@threlte/core';
	import { OrbitControls } from '@threlte/extras';
	import * as THREE from 'three';
	import type { CalcZone, RoomConfig } from '$lib/types/project';
	import { buildIsosurfaces, getIsosurfaceColor, type IsosurfaceData } from '$lib/utils/isosurface';
	import { theme } from '$lib/stores/theme';
	import { getSessionZoneExport } from '$lib/api/client';

	interface Props {
		zone: CalcZone;
		zoneName: string;
		room: RoomConfig;
		values: number[][][];
		onclose: () => void;
	}

	let { zone, zoneName, room, values, onclose }: Props = $props();

	// Export state
	let exporting = $state(false);

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
</script>

<!-- Isosurface Scene Component - must be inside Canvas -->
{#snippet IsosurfaceScene()}
	{@const colormap = room.colormap || 'plasma'}
	{@const scale = room.units === 'feet' ? 0.3048 : 1}
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
	{@const centerZ = ((bounds.y1 + bounds.y2) / 2) * scale}
	{@const maxDim = Math.max(
		(bounds.x2 - bounds.x1) * scale,
		(bounds.y2 - bounds.y1) * scale,
		(bounds.z2 - bounds.z1) * scale
	)}
	{@const cameraDistance = maxDim * 1.8}

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

	<!-- Axis helper at origin of volume -->
	<T.AxesHelper args={[maxDim * 0.3]} position={[bounds.x1 * scale, bounds.z1 * scale, bounds.y1 * scale]} />
{/snippet}

<!-- Modal backdrop -->
<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={handleBackdropClick}>
	<div class="modal-content" role="dialog" aria-modal="true">
		<div class="modal-header">
			<h3>{zoneName}</h3>
			<span class="volume-badge">3D Volume</span>
			<button type="button" class="close-btn" onclick={onclose} title="Close">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M18 6L6 18M6 6l12 12"/>
				</svg>
			</button>
		</div>

		<div class="modal-body">
			<div class="canvas-container" class:dark={$theme === 'dark'}>
				<Canvas>
					{@render IsosurfaceScene()}
				</Canvas>
			</div>
			<p class="hint">Drag to rotate, scroll to zoom</p>
		</div>

		<div class="modal-footer">
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

	.volume-badge {
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
		justify-content: flex-end;
		flex-shrink: 0;
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
