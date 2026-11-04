<script lang="ts">
	import * as THREE from 'three';
	import { Canvas } from '@threlte/core';
	import Scene from './Scene.svelte';
	import ViewSnapOverlay, { type ViewPreset } from './ViewSnapOverlay.svelte';
	import type { RoomConfig, LampInstance, CalcZone, ZoneResult, SceneObject } from '$lib/types/project';
	import type { IsoScale } from '$lib/utils/plotScale';
	import type { IsosurfaceData } from '$lib/utils/isosurface';
	import type { CeilingLayout } from '$lib/ceiling/ceilingLayout';
	import ProjectionToggle from './ProjectionToggle.svelte';
	import UnitsSelect from '$lib/workspace/UnitsSelect.svelte';
	import ViewImageActions from '$lib/workspace/ViewImageActions.svelte';
	import { openImageInTab, downloadBlob } from '$lib/utils/viewImage';
	import { userSettings } from '$lib/stores/settings';
	import { theme } from '$lib/stores/theme';
	import { unitLabel, type LengthUnit } from '$lib/utils/unitConversion';
	import { pickMode, activeViewPreset } from '$lib/stores/pickMode';
	import type { SceneCaptureApi, SceneCaptureControls, VisibilityOverride } from '$lib/utils/reportCapture';
	import type { PlanContext } from '$lib/workspace/editorNav';
	import { viewName, planSurface, type Surface } from '$lib/utils/surfaces';
	import { chooseClickTarget, nextSurface, type SceneHover } from './surfacePicking';

	interface Props {
		room: RoomConfig;
		lamps: LampInstance[];
		zones?: CalcZone[];
		objects?: SceneObject[];
		zoneResults?: Record<string, ZoneResult>;
		selectedLampIds?: string[];
		selectedZoneIds?: string[];
		selectedObjectIds?: string[];
		/** The ceiling layout drawn on the ceiling, and the item selected in the Ceiling part */
		ceiling?: CeilingLayout | null;
		selectedCeilingId?: string | null;
		highlightedLampIds?: string[];
		highlightedZoneIds?: string[];
		highlightedObjectIds?: string[];
		visibleLampIds?: string[];
		visibleZoneIds?: string[];
		visibleObjectIds?: string[];
		/** Structures whose name label shows */
		labelledObjectIds?: string[];
		onLampClick?: (lampId: string) => void;
		onZoneClick?: (zoneId: string) => void;
		onObjectClick?: (objectId: string) => void;
		/** A click on a ceiling item: the host opens the ceiling designer on it */
		onCeilingItemClick?: (id: string) => void;
		globalValueRange?: { min: number; max: number } | null;
		isoScaleMap?: Record<string, IsoScale>;
		onIsoGeometryReady?: (zoneId: string, data: { isosurfaces: IsosurfaceData[]; valueRange: { min: number; max: number; range: number } }) => void;
		/** Receives the capture API the PDF report uses (canvas, camera, visibility override). */
		onCaptureApiReady?: (api: SceneCaptureApi) => void;
		/** The docked mini view: no overlays or actions, and clicks select or pick nothing (orbit and zoom stay). */
		mini?: boolean;
		/** The phone's view: touch orbits and the host's Fit resets, so no view pad, projection, units or image buttons. */
		touch?: boolean;
		/** A click on room surfaces, in click order (only when no item of the context is under the cursor) */
		onSurfaceClick?: (surfaces: Surface[]) => void;
		/** What the pointer is over, for the parent (null when it leaves the room) */
		onSurfaceHover?: (hover: SceneHover | null) => void;
		/** The surface the 2D view shows: outlined in 3D, and where click cycling starts from */
		viewedSurface?: Surface | null;
		/** The editor context deciding what a click selects; null (the summary) picks nothing */
		clickContext?: PlanContext | null;
		/** The project's length unit, and the units select bottom-right (the 2D view's same setting) */
		units?: LengthUnit;
		onUnitsChange?: (event: Event) => void;
	}

	let { room, lamps, zones = [], objects = [], zoneResults = {}, selectedLampIds = [], selectedZoneIds = [], selectedObjectIds = [], ceiling = null, selectedCeilingId = null, highlightedLampIds = [], highlightedZoneIds = [], highlightedObjectIds = [], visibleLampIds, visibleZoneIds, visibleObjectIds, labelledObjectIds = [], onLampClick, onZoneClick, onObjectClick, onCeilingItemClick, globalValueRange = null, isoScaleMap = {}, onIsoGeometryReady, onCaptureApiReady, mini = false, touch = false, onSurfaceClick, onSurfaceHover, viewedSurface = null, clickContext = null, units, onUnitsChange }: Props = $props();

	// Drag detection: suppress clicks that follow a drag (orbit/pan). The handlers
	// stay attached in the mini view (Threlte registers them at creation) and do nothing there.
	const DRAG_THRESHOLD = 5; // pixels
	let pointerStart: { x: number; y: number } | null = null;
	let dragDistance = 0;
	// A button is held (orbit or pan): no hover chip meanwhile
	let pointerHeld = $state(false);

	function handlePointerDown(e: PointerEvent) {
		pointerStart = { x: e.clientX, y: e.clientY };
		dragDistance = 0;
		pointerHeld = true;
	}

	function handlePointerUp(e: PointerEvent) {
		pointerHeld = false;
		if (pointerStart) {
			const dx = e.clientX - pointerStart.x;
			const dy = e.clientY - pointerStart.y;
			dragDistance = Math.sqrt(dx * dx + dy * dy);
		}
		pointerStart = null;
	}

	const wrappedLampClick = $derived(
		onLampClick
			? (id: string) => { if (!mini && dragDistance <= DRAG_THRESHOLD) onLampClick(id); }
			: undefined
	);
	const wrappedZoneClick = $derived(
		onZoneClick
			? (id: string) => { if (!mini && dragDistance <= DRAG_THRESHOLD) onZoneClick(id); }
			: undefined
	);
	const wrappedObjectClick = $derived(
		onObjectClick
			? (id: string) => { if (!mini && dragDistance <= DRAG_THRESHOLD) onObjectClick(id); }
			: undefined
	);

	const wrappedCeilingItemClick = $derived(
		onCeilingItemClick
			? (id: string) => { if (!mini && dragDistance <= DRAG_THRESHOLD) onCeilingItemClick(id); }
			: undefined
	);

	const wrappedSurfaceClick = $derived(
		onSurfaceClick
			? (surfaces: Surface[]) => { if (!mini && dragDistance <= DRAG_THRESHOLD) onSurfaceClick(surfaces); }
			: undefined
	);

	// Hover chip: the surface the next click picks, k of n under the cursor
	let hover = $state<SceneHover | null>(null);
	function handleSurfaceHover(h: SceneHover | null) {
		hover = h;
		onSurfaceHover?.(h);
	}
	const chip = $derived.by(() => {
		if (mini || !hover || pointerHeld || $pickMode || !viewerContainer) return null;
		const target = chooseClickTarget(hover.items, hover.surfaces, clickContext);
		if (target?.kind !== 'surface') return null;
		// Over a ceiling item the click opens the ceiling designer, not the next surface
		if (onCeilingItemClick && hover.items.some((i) => i.type === 'ceiling')) return null;
		// The ceiling shows on the 2D plan view, as the floor does
		const order = [...new Set(target.order.map(planSurface))];
		const surface = nextSurface(order, viewedSurface);
		if (!surface) return null;
		const rect = viewerContainer.getBoundingClientRect();
		return {
			surface,
			text: order.length > 1 ? `${viewName(surface)} ${order.indexOf(surface) + 1}/${order.length}` : viewName(surface),
			x: hover.x - rect.left,
			y: hover.y - rect.top,
		};
	});

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

	/** Back to the starting view (the front-left isometric), for the phone's Fit. */
	export function fitView() {
		handleViewChange('iso-front-left');
	}

	function handleUserOrbit() {
		activeView = null;
		activeViewPreset.set(null);
	}

	// Canvas capture for save/preview
	let viewerContainer = $state<HTMLDivElement | undefined>(undefined);
	/** The view's width: under 600 px the units select shows abbreviations, as the 2D view's does. */
	let viewerWidth = $state(0);
	const compactTools = $derived(viewerWidth > 0 && viewerWidth < 600);
	let savingImage = $state(false);
	let captureControls = $state<SceneCaptureControls | null>(null);

	function handleCaptureControlReady(controls: SceneCaptureControls) {
		captureControls = controls;
	}

	function getCanvas(): HTMLCanvasElement | null {
		return viewerContainer?.querySelector('canvas') ?? null;
	}

	// Report captures temporarily override what is visible; null = the user's own choice
	let visibilityOverride = $state<VisibilityOverride | null>(null);
	const effectiveVisibleLampIds = $derived(visibilityOverride?.lampIds ?? visibleLampIds);
	const effectiveVisibleZoneIds = $derived(visibilityOverride?.zoneIds ?? visibleZoneIds);
	const effectiveVisibleObjectIds = $derived(visibilityOverride?.objectIds ?? visibleObjectIds);
	// Reports show the room as it is without a ceiling layout (planning only)
	const effectiveCeiling = $derived(visibilityOverride?.hideCeilingLayout ? null : ceiling);
	const effectiveLamps = $derived(visibilityOverride?.hidePhotometricWebs ? lamps.map((l) => ({ ...l, show_photometric_web: false })) : lamps);
	// Report captures draw volumes at their own isosurface levels; null = the user's settings
	let isoOverride = $state<Record<string, IsoScale> | null>(null);
	const effectiveIsoScaleMap = $derived(isoOverride ? { ...isoScaleMap, ...isoOverride } : isoScaleMap);
	// A volume pictured for the report is drawn as isosurfaces even if the user keeps it
	// as an outline (the standard whole-room zone defaults to display_mode 'none')
	const effectiveZones = $derived(isoOverride ? zones.map((z) => isoOverride?.[z.id] ? { ...z, display_mode: 'heatmap' as const } : z) : zones);

	$effect(() => {
		if (!captureControls) return;
		onCaptureApiReady?.({
			canvas: getCanvas,
			prepare: captureControls.prepare,
			restore: captureControls.restore,
			getCamera: captureControls.getCamera,
			setCamera: captureControls.setCamera,
			setViewImmediate: captureControls.setViewImmediate,
			render: captureControls.render,
			setVisibility: (o) => { visibilityOverride = o; },
			setIsoScales: (o) => { isoOverride = o; },
		});
	});

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
			if (blob) downloadBlob(blob, 'room-3d-view.png');
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
		openImageInTab(offscreen.toDataURL('image/png'), 'Room 3D View');
	}
</script>

<div class="viewer-container" class:mini bind:this={viewerContainer} bind:clientWidth={viewerWidth} onpointerdown={handlePointerDown} onpointerup={handlePointerUp} onpointerleave={() => { hover = null; pointerHeld = false; }}>
	{#if !mini && !touch}
	<ViewSnapOverlay onViewChange={handleViewChange} {activeView} />
	<ProjectionToggle isOrtho={useOrtho} onclick={handleToggleProjection} />
	<div class="viewer-actions">
		{#if units && onUnitsChange}<UnitsSelect {units} onchange={onUnitsChange} compact={compactTools} />{/if}
		<ViewImageActions onOpen={previewImage} onSave={saveImage} saving={savingImage} />
	</div>
	{/if}
	<Canvas createRenderer={(canvas) => new THREE.WebGLRenderer({ canvas, preserveDrawingBuffer: true, antialias: true, alpha: true })}>
		<Scene {room} ceiling={effectiveCeiling} {selectedCeilingId} lamps={effectiveLamps} zones={effectiveZones} {objects} {zoneResults} {selectedLampIds} {selectedZoneIds} {selectedObjectIds} {highlightedLampIds} {highlightedZoneIds} {highlightedObjectIds} visibleLampIds={effectiveVisibleLampIds} visibleZoneIds={effectiveVisibleZoneIds} visibleObjectIds={effectiveVisibleObjectIds} {labelledObjectIds} {globalValueRange} isoScaleMap={effectiveIsoScaleMap} {onIsoGeometryReady} onViewControlReady={handleViewControlReady} onProjectionControlReady={handleProjectionControlReady} onCaptureControlReady={handleCaptureControlReady} onUserOrbit={handleUserOrbit} interactive={!mini} onLampClick={wrappedLampClick} onZoneClick={wrappedZoneClick} onObjectClick={wrappedObjectClick} onCeilingItemClick={wrappedCeilingItemClick} onSurfaceClick={wrappedSurfaceClick} onSurfaceHover={handleSurfaceHover} viewedSurface={visibilityOverride ? null : viewedSurface} hoveredSurface={chip?.surface ?? null} />
	</Canvas>
	{#if chip}
		<div class="surface-chip" style="left: {chip.x + 14}px; top: {chip.y + 14}px">{chip.text}</div>
	{/if}
	{#if $pickMode && !mini}
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

	.viewer-container.mini {
		min-height: 0;
		border-radius: 0;
	}

	@media (max-width: 767px) {
		.viewer-container {
			min-height: 0;
		}
	}

	/* Units, Open in new tab and Save as image: bottom right, on the main view's 8 px inset */
	.viewer-actions {
		position: absolute;
		bottom: 8px;
		right: 8px;
		z-index: 10;
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.surface-chip {
		position: absolute;
		z-index: 20;
		padding: 2px 6px;
		background: color-mix(in srgb, var(--color-bg-secondary) 90%, transparent);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm, 4px);
		color: var(--color-text);
		font-size: 0.75rem;
		white-space: nowrap;
		pointer-events: none;
	}

	.pick-banner {
		position: absolute;
		/* Above the 2D | 3D switch, bottom-middle */
		bottom: 56px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 20;
		padding: var(--spacing-xs) var(--spacing-md);
		background: color-mix(in srgb, var(--color-highlight) 90%, transparent);
		color: var(--color-on-highlight);
		border-radius: var(--radius-md);
		font-size: var(--font-size-sm);
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
