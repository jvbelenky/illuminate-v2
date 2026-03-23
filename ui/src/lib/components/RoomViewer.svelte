<script lang="ts">
	import * as THREE from 'three';
	import { Canvas } from '@threlte/core';
	import Scene from './Scene.svelte';
	import ViewSnapOverlay, { type ViewPreset } from './ViewSnapOverlay.svelte';
	import type { RoomConfig, LampInstance, CalcZone, ZoneResult } from '$lib/types/project';
	import type { IsoSettings } from './CalcVolPlotModal.svelte';
	import type { IsosurfaceData } from '$lib/utils/isosurface';
	import ProjectionToggle from './ProjectionToggle.svelte';
	import { userSettings } from '$lib/stores/settings';
	import { theme } from '$lib/stores/theme';
	import { unitLabel } from '$lib/utils/unitConversion';
	import { pickMode, activeViewPreset } from '$lib/stores/pickMode';

	interface Props {
		room: RoomConfig;
		lamps: LampInstance[];
		zones?: CalcZone[];
		zoneResults?: Record<string, ZoneResult>;
		selectedLampIds?: string[];
		selectedZoneIds?: string[];
		highlightedLampIds?: string[];
		highlightedZoneIds?: string[];
		visibleLampIds?: string[];
		visibleZoneIds?: string[];
		onLampClick?: (lampId: string) => void;
		onZoneClick?: (zoneId: string) => void;
		globalValueRange?: { min: number; max: number } | null;
		isoSettingsMap?: Record<string, IsoSettings>;
		onIsoGeometryReady?: (zoneId: string, data: { isosurfaces: IsosurfaceData[]; valueRange: { min: number; max: number; range: number } }) => void;
	}

	let { room, lamps, zones = [], zoneResults = {}, selectedLampIds = [], selectedZoneIds = [], highlightedLampIds = [], highlightedZoneIds = [], visibleLampIds, visibleZoneIds, onLampClick, onZoneClick, globalValueRange = null, isoSettingsMap = {}, onIsoGeometryReady }: Props = $props();

	// Drag detection: suppress clicks that follow a drag (orbit/pan)
	const DRAG_THRESHOLD = 5; // pixels
	let pointerStart: { x: number; y: number } | null = null;
	let dragDistance = 0;

	function handlePointerDown(e: PointerEvent) {
		pointerStart = { x: e.clientX, y: e.clientY };
		dragDistance = 0;
	}

	function handlePointerUp(e: PointerEvent) {
		if (pointerStart) {
			const dx = e.clientX - pointerStart.x;
			const dy = e.clientY - pointerStart.y;
			dragDistance = Math.sqrt(dx * dx + dy * dy);
		}
		pointerStart = null;
	}

	const wrappedLampClick = $derived(
		onLampClick
			? (id: string) => { if (dragDistance <= DRAG_THRESHOLD) onLampClick(id); }
			: undefined
	);
	const wrappedZoneClick = $derived(
		onZoneClick
			? (id: string) => { if (dragDistance <= DRAG_THRESHOLD) onZoneClick(id); }
			: undefined
	);

	// Projection mode (Scene manages state, we mirror it for the icon)
	let useOrtho = $state(false);
	let toggleProjectionFn = $state<(() => boolean) | null>(null);

	function handleProjectionControlReady(toggle: () => boolean) {
		toggleProjectionFn = toggle;
	}

	function handleToggleProjection() {
		if (toggleProjectionFn) {
			useOrtho = toggleProjectionFn();
		}
	}

	// View control function from Scene
	let setViewFn = $state<((view: ViewPreset) => void) | null>(null);
	let activeView = $state<ViewPreset | null>(null);

	function handleViewControlReady(setView: (view: ViewPreset) => void) {
		setViewFn = setView;
	}

	function handleViewChange(view: ViewPreset) {
		if (setViewFn) {
			setViewFn(view);
			activeView = view;
			activeViewPreset.set(view);
		}
	}

	function handleUserOrbit() {
		activeView = null;
		activeViewPreset.set(null);
	}

	// Canvas capture for save/preview
	let viewerContainer: HTMLDivElement;
	let savingImage = $state(false);
	let captureControls = $state<{ prepare: () => void; restore: () => void } | null>(null);

	function handleCaptureControlReady(controls: { prepare: () => void; restore: () => void }) {
		captureControls = controls;
	}

	function getCanvas(): HTMLCanvasElement | null {
		return viewerContainer?.querySelector('canvas') ?? null;
	}

	/** Draw units label onto a 2D canvas context */
	function drawUnitsLabel(ctx: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number, scale: number = 1) {
		const label = `Units: ${unitLabel($userSettings.units)}`;
		const isDark = $theme === 'dark';
		const fontSize = Math.round(14 * scale);
		ctx.font = `bold ${fontSize}px sans-serif`;
		ctx.lineJoin = 'round';
		ctx.textBaseline = 'bottom';
		ctx.strokeStyle = isDark ? 'rgba(0, 0, 0, 0.7)' : 'rgba(255, 255, 255, 0.7)';
		ctx.lineWidth = Math.round(3 * scale);
		ctx.strokeText(label, 12 * scale, canvasHeight - 12 * scale);
		ctx.fillStyle = isDark ? 'rgba(230, 230, 230, 1)' : 'rgba(40, 40, 40, 1)';
		ctx.fillText(label, 12 * scale, canvasHeight - 12 * scale);
	}

	function captureToBlob(scaleFactor: number): Promise<Blob | null> {
		return new Promise((resolve) => {
			const canvas = getCanvas();
			if (!canvas) { resolve(null); return; }

			captureControls?.prepare();

			const width = canvas.width * scaleFactor;
			const height = canvas.height * scaleFactor;
			const offscreen = document.createElement('canvas');
			offscreen.width = width;
			offscreen.height = height;
			const ctx = offscreen.getContext('2d');
			if (!ctx) { captureControls?.restore(); resolve(null); return; }

			ctx.imageSmoothingEnabled = true;
			ctx.imageSmoothingQuality = 'high';
			ctx.drawImage(canvas, 0, 0, width, height);
			drawUnitsLabel(ctx, width, height, scaleFactor);

			captureControls?.restore();

			offscreen.toBlob((blob) => resolve(blob), 'image/png');
		});
	}

	async function saveImage() {
		savingImage = true;
		try {
			const blob = await captureToBlob(4);
			if (!blob) return;
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = 'room-3d-view.png';
			a.click();
			URL.revokeObjectURL(url);
		} catch (error) {
			console.error('Failed to save 3D view:', error);
		} finally {
			savingImage = false;
		}
	}

	function previewImage() {
		const canvas = getCanvas();
		if (!canvas) return;

		captureControls?.prepare();

		// Draw to offscreen canvas so we can add units label
		const offscreen = document.createElement('canvas');
		offscreen.width = canvas.width;
		offscreen.height = canvas.height;
		const ctx2 = offscreen.getContext('2d');
		if (!ctx2) { captureControls?.restore(); return; }
		ctx2.drawImage(canvas, 0, 0);
		drawUnitsLabel(ctx2, canvas.width, canvas.height);

		captureControls?.restore();
		const dataUrl = offscreen.toDataURL('image/png');
		const win = window.open('', '_blank');
		if (!win) return;
		win.document.title = 'Room 3D View';
		win.document.body.style.margin = '0';
		win.document.body.style.background = '#1a1a1a';
		win.document.body.style.display = 'flex';
		win.document.body.style.alignItems = 'center';
		win.document.body.style.justifyContent = 'center';
		win.document.body.style.height = '100vh';
		const img = win.document.createElement('img');
		img.src = dataUrl;
		img.style.maxWidth = '100%';
		img.style.maxHeight = '100%';
		win.document.body.appendChild(img);
	}
</script>

<div class="viewer-container" bind:this={viewerContainer} onpointerdown={handlePointerDown} onpointerup={handlePointerUp}>
	<ViewSnapOverlay onViewChange={handleViewChange} {activeView} />
	<ProjectionToggle isOrtho={useOrtho} onclick={handleToggleProjection} />
	<span class="units-label">Units: {unitLabel($userSettings.units)}</span>
	<div class="viewer-actions">
		<button class="viewer-action-btn" title="Open in new window" onclick={previewImage}>
			<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
				<path d="M11 3h6v6" />
				<path d="M17 3L9 11" />
				<path d="M15 11v5a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1h5" />
			</svg>
		</button>
		<button class="viewer-action-btn" title="Save as image" onclick={saveImage} disabled={savingImage}>
			{#if savingImage}
				<svg class="spinner" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2">
					<circle cx="10" cy="10" r="7" stroke-dasharray="30 14" />
				</svg>
			{:else}
				<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
					<path d="M10 3v10" />
					<path d="M6 9l4 4 4-4" />
					<path d="M3 14v2a1 1 0 001 1h12a1 1 0 001-1v-2" />
				</svg>
			{/if}
		</button>
	</div>
	<Canvas createRenderer={(canvas) => new THREE.WebGLRenderer({ canvas, preserveDrawingBuffer: true, antialias: true, alpha: true })}>
		<Scene {room} {lamps} {zones} {zoneResults} {selectedLampIds} {selectedZoneIds} {highlightedLampIds} {highlightedZoneIds} {visibleLampIds} {visibleZoneIds} {globalValueRange} {isoSettingsMap} {onIsoGeometryReady} onViewControlReady={handleViewControlReady} onProjectionControlReady={handleProjectionControlReady} onCaptureControlReady={handleCaptureControlReady} onUserOrbit={handleUserOrbit} onLampClick={wrappedLampClick} onZoneClick={wrappedZoneClick} />
	</Canvas>
	{#if $pickMode}
		<div class="pick-banner">
			Click a point on the room surface{$pickMode.type === 'direction' ? ' and drag' : ''}. Press <kbd>Esc</kbd> to cancel.
		</div>
	{/if}
</div>

<style>
	.viewer-container {
		position: relative;
		width: 100%;
		height: 100%;
		min-height: 500px;
		background: var(--color-bg-secondary);
		border-radius: var(--radius-lg);
		overflow: hidden;
	}

	@media (max-width: 767px) {
		.viewer-container {
			min-height: 0;
		}
	}

	.units-label {
		position: absolute;
		bottom: var(--spacing-md);
		left: calc(var(--spacing-sm) + 124px);
		z-index: 10;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		line-height: 1;
	}

	@media (max-width: 767px) {
		.units-label {
			left: calc(var(--spacing-sm) + 132px);
		}
	}

	.viewer-actions {
		position: absolute;
		bottom: var(--spacing-sm);
		right: var(--spacing-sm);
		z-index: 10;
		display: flex;
		gap: 4px;
	}

	.viewer-action-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		padding: 6px;
		background: color-mix(in srgb, var(--color-bg-secondary) 85%, transparent);
		backdrop-filter: blur(4px);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-muted);
		cursor: pointer;
		transition: all 0.15s;
	}

	.viewer-action-btn:hover {
		background: var(--color-bg-secondary);
		border-color: var(--color-accent);
		color: var(--color-text);
	}

	.viewer-action-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.viewer-action-btn svg {
		width: 20px;
		height: 20px;
	}

	.viewer-action-btn .spinner {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.pick-banner {
		position: absolute;
		bottom: var(--spacing-lg);
		left: 50%;
		transform: translateX(-50%);
		z-index: 20;
		padding: var(--spacing-xs) var(--spacing-md);
		background: color-mix(in srgb, var(--color-accent) 90%, transparent);
		color: #fff;
		border-radius: var(--radius-md);
		font-size: 0.8rem;
		font-weight: 500;
		pointer-events: none;
		animation: pick-pulse 1.5s ease-in-out infinite;
	}

	.pick-banner kbd {
		display: inline-block;
		padding: 0 4px;
		background: rgba(255, 255, 255, 0.2);
		border-radius: 3px;
		font-size: 0.75rem;
		font-family: inherit;
	}

	@keyframes pick-pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.7; }
	}
</style>
