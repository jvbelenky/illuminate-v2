<script lang="ts">
	import { onMount } from 'svelte';
	import { Canvas } from '@threlte/core';
	import { project, room } from '$lib/stores/project';
	import { userSettings } from '$lib/stores/settings';
	import { theme } from '$lib/stores/theme';
	import type { SurfaceReflectances, SurfaceSpacings, SurfaceNumPointsAll, ReflectanceResolutionMode } from '$lib/types/project';
	import { uniformReflectances, ROOM_DEFAULTS } from '$lib/types/project';
	import { surfaceIdsFor, surfaceLabel, roomVertices, wallIdsFor, polygonEdgeLengths } from '$lib/utils/roomGeometry';
	import { formatFloat } from '$lib/utils/formatting';
	import { spacingFromNumPoints, numPointsFromSpacing } from '$lib/utils/calculations';
	import { unitAbbrev as getUnitAbbrev } from '$lib/utils/unitConversion';
	import { getReflectanceSurfaces } from '$lib/api/client';
	import ReflectancePreview3D from './ReflectancePreview3D.svelte';
	import ValidatedNumberInput from './ValidatedNumberInput.svelte';
	import Modal from './Modal.svelte';

	interface Props {
		onClose: () => void;
	}

	let { onClose }: Props = $props();

	// On mount, fetch actual surface info from the backend to populate the modal
	onMount(async () => {
		try {
			const resp = await getReflectanceSurfaces();
			const surfaces = resp.surfaces;
			const newNumPoints: Partial<SurfaceNumPointsAll> = {};
			const newSpacings: Partial<SurfaceSpacings> = {};
			for (const [name, info] of Object.entries(surfaces)) {
				newNumPoints[name as keyof SurfaceNumPointsAll] = { x: info.num_x, y: info.num_y };
				newSpacings[name as keyof SurfaceSpacings] = { x: round3(info.x_spacing), y: round3(info.y_spacing) };
			}
			project.updateRoom({
				reflectance_num_points: newNumPoints as SurfaceNumPointsAll,
				reflectance_spacings: newSpacings as SurfaceSpacings,
			});
		} catch (e) {
			// If backend fetch fails, keep using current store values
			console.warn('[ReflectanceSettingsModal] Failed to fetch surfaces from backend:', e);
		}
	});

	// Surface list: floor, ceiling, then walls in edge order (backend naming)
	const allSurfaces = $derived(surfaceIdsFor($room));
	const outline = $derived(roomVertices($room));
	const wallIds = $derived(wallIdsFor(outline));
	const edgeLengths = $derived(polygonEdgeLengths(outline));

	// Hover/focus tracking for 3D highlight
	let selectedSurface = $state<string | null>(null);

	function round3(v: number): number {
		return Math.round(v * 1000) / 1000;
	}

	/** Get the physical span dimensions for a reflective surface based on room geometry */
	function getSurfaceSpans(surface: string): { x: number; y: number } {
		const r = $room;
		if (surface === 'floor' || surface === 'ceiling') {
			return { x: r.x, y: r.y };
		}
		const edge = wallIds.indexOf(surface);
		return { x: edge >= 0 ? edgeLengths[edge] : r.x, y: r.z };
	}

	// A wall the store hasn't seen yet (the backend echo fills these in right
	// after a shape change) falls back to guv_calcs' 10x10 default.
	const defaultPts = ROOM_DEFAULTS.reflectance_num_points;
	function numPointsFor(surface: string): { x: number; y: number } {
		return $room.reflectance_num_points[surface] ?? { x: defaultPts, y: defaultPts };
	}
	function spacingFor(surface: string): { x: number; y: number } {
		const existing = $room.reflectance_spacings[surface];
		if (existing) return existing;
		const spans = getSurfaceSpans(surface);
		return { x: round3(spans.x / defaultPts), y: round3(spans.y / defaultPts) };
	}
	function reflectanceFor(surface: string): number {
		return $room.reflectances[surface] ?? ROOM_DEFAULTS.reflectance;
	}
	function surfaceTitle(surface: string): string {
		const edge = wallIds.indexOf(surface);
		if (edge < 0) return surfaceLabel(surface);
		const [x1, y1] = outline[edge];
		const [x2, y2] = outline[(edge + 1) % outline.length];
		return `${surfaceLabel(surface)}: (${formatFloat(x1, $room.precision)}, ${formatFloat(y1, $room.precision)}) → (${formatFloat(x2, $room.precision)}, ${formatFloat(y2, $room.precision)}), ${formatFloat(edgeLengths[edge], $room.precision)} ${unitAbbrev}`;
	}

	const unitAbbrev = $derived(getUnitAbbrev($userSettings.units));

	function handleReflectanceChange(surface: keyof SurfaceReflectances, value: number) {
		const newReflectances = { ...$room.reflectances, [surface]: value };
		project.updateRoom({ reflectances: newReflectances });
	}

	function setAllReflectances(value: number) {
		const newReflectances: SurfaceReflectances = uniformReflectances(value, $room);
		project.updateRoom({ reflectances: newReflectances });
	}

	function handleSpacingChange(surface: string, axis: 'x' | 'y', value: number) {
		const spans = getSurfaceSpans(surface);
		const newSpacings: SurfaceSpacings = {
			...$room.reflectance_spacings,
			[surface]: {
				...spacingFor(surface),
				[axis]: value
			}
		};
		const newNumPoints: SurfaceNumPointsAll = {
			...$room.reflectance_num_points,
			[surface]: {
				...numPointsFor(surface),
				[axis]: numPointsFromSpacing(spans[axis], value)
			}
		};
		project.updateRoom({ reflectance_spacings: newSpacings, reflectance_num_points: newNumPoints });
	}

	function handleNumPointsChange(surface: string, axis: 'x' | 'y', value: number) {
		const spans = getSurfaceSpans(surface);
		const newNumPoints: SurfaceNumPointsAll = {
			...$room.reflectance_num_points,
			[surface]: {
				...numPointsFor(surface),
				[axis]: value
			}
		};
		const newSpacings: SurfaceSpacings = {
			...$room.reflectance_spacings,
			[surface]: {
				...spacingFor(surface),
				[axis]: round3(spacingFromNumPoints(spans[axis], value))
			}
		};
		project.updateRoom({ reflectance_num_points: newNumPoints, reflectance_spacings: newSpacings });
	}

	function toggleResolutionMode() {
		const newMode: ReflectanceResolutionMode =
			$room.reflectance_resolution_mode === 'spacing' ? 'num_points' : 'spacing';
		project.updateRoom({ reflectance_resolution_mode: newMode });
	}

	function handleMaxPassesChange(value: number) {
		project.updateRoom({ reflectance_max_num_passes: value });
	}

	function handleThresholdChange(value: number) {
		project.updateRoom({ reflectance_threshold: value });
	}
</script>

<Modal
	title="Reflectance Settings"
	{onClose}
	maxWidth="min(920px, 95vw)"
	titleFontSize="1rem"
>
	{#snippet body()}
		<div class="modal-body">
			<!-- Left: 3D Preview -->
			<div class="preview-column">
				<div class="canvas-container" class:dark={$theme === 'dark'}>
					<Canvas>
						<ReflectancePreview3D room={$room} numPoints={$room.reflectance_num_points} {selectedSurface} />
					</Canvas>
				</div>
				<p class="hint canvas-hint">Drag to rotate, scroll to zoom</p>
			</div>

			<!-- Right: Settings -->
			<div class="settings-column">
				<!-- Quick-set and mode toggle -->
				<div class="controls-bar">
					<div class="reflectance-quick">
						<span class="hint">Quick set:</span>
						<div class="quick-buttons">
							<button type="button" class="mini" onclick={() => setAllReflectances(0.078)}>0.078 (222nm)</button>
							<button type="button" class="mini" onclick={() => setAllReflectances(0.05)}>0.05 (254nm)</button>
						</div>
					</div>
					<button type="button" class="mode-switch-btn" onclick={toggleResolutionMode}>
						{$room.reflectance_resolution_mode === 'num_points' ? 'Set Spacing' : 'Set Num Points'}
					</button>
				</div>

				<!-- Merged surface table -->
				<div class="surface-table">
					<div class="table-header">
						<span class="col-surface">Surface</span>
						<span class="col-value col-refl">Reflectance</span>
						<span class="col-sep"></span>
						{#if $room.reflectance_resolution_mode === 'spacing'}
							<span class="col-value">X Spacing</span>
							<span class="col-value">Y Spacing</span>
						{:else}
							<span class="col-value">X Points</span>
							<span class="col-value">Y Points</span>
						{/if}
					</div>
					{#each allSurfaces as surface}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="surface-row"
							class:highlighted={selectedSurface === surface}
							onmouseenter={() => selectedSurface = surface}
							onmouseleave={() => selectedSurface = null}
							onfocusin={() => selectedSurface = surface}
						>
							<span class="surface-name" title={surfaceTitle(surface)}>{surfaceLabel(surface)}</span>
							<ValidatedNumberInput
								value={reflectanceFor(surface)}
								oncommit={(v) => handleReflectanceChange(surface, v)}
								min={0}
								max={1}
								step={0.01}
							/>
							<span class="col-sep"></span>
							{#if $room.reflectance_resolution_mode === 'spacing'}
								<ValidatedNumberInput
									value={spacingFor(surface).x} precision={$room.precision}
									oncommit={(v) => handleSpacingChange(surface, 'x', v)}
									step={0.1}
									validate={(v) => v > 0 && v < getSurfaceSpans(surface).x}
								/>
								<ValidatedNumberInput
									value={spacingFor(surface).y} precision={$room.precision}
									oncommit={(v) => handleSpacingChange(surface, 'y', v)}
									step={0.1}
									validate={(v) => v > 0 && v < getSurfaceSpans(surface).y}
								/>
							{:else}
								<ValidatedNumberInput
									value={numPointsFor(surface).x}
									oncommit={(v) => handleNumPointsChange(surface, 'x', v)}
									integer
									min={1}
									step={1}
								/>
								<ValidatedNumberInput
									value={numPointsFor(surface).y}
									oncommit={(v) => handleNumPointsChange(surface, 'y', v)}
									integer
									min={1}
									step={1}
								/>
							{/if}
						</div>
						<div class="computed-value-row">
							<span></span>
							<span></span>
							<span></span>
							{#if $room.reflectance_resolution_mode === 'spacing'}
								<span class="computed-value">{numPointsFor(surface).x} x {numPointsFor(surface).y} pts</span>
							{:else}
								<span class="computed-value">{formatFloat(spacingFromNumPoints(getSurfaceSpans(surface).x, numPointsFor(surface).x), $room.precision)} x {formatFloat(spacingFromNumPoints(getSurfaceSpans(surface).y, numPointsFor(surface).y), $room.precision)} {unitAbbrev}</span>
							{/if}
						</div>
					{/each}
				</div>

				<!-- Interreflection -->
				<section class="settings-section">
					<h3>Interreflection</h3>
					<p class="section-description">Calculation stops when contributions fall below threshold &times; initial value, or max iterations is reached, whichever comes first.</p>
					<div class="section-content">
						<div class="form-row halves">
							<div class="form-group compact">
								<label for="max_passes">Max iterations</label>
								<ValidatedNumberInput
									id="max_passes"
									value={$room.reflectance_max_num_passes}
									oncommit={handleMaxPassesChange}
									integer
									min={1}
									step={1}
								/>
								<span class="field-hint">Maximum reflection passes</span>
							</div>
							<div class="form-group compact">
								<label for="threshold">Threshold</label>
								<ValidatedNumberInput
									id="threshold"
									value={$room.reflectance_threshold}
									oncommit={handleThresholdChange}
									min={0}
									max={1}
									step={0.01}
								/>
								<span class="field-hint">Fraction of initial value</span>
							</div>
						</div>
					</div>
				</section>
			</div>
		</div>
	{/snippet}
</Modal>

<style>
	.modal-body {
		padding: var(--spacing-md);
		display: flex;
		flex-direction: row;
		gap: var(--spacing-md);
		overflow-y: auto;
	}

	/* Left: 3D preview */
	.preview-column {
		flex: 0 0 380px;
		display: flex;
		flex-direction: column;
	}

	.canvas-container {
		width: 100%;
		height: 380px;
		border-radius: var(--radius-md);
		overflow: hidden;
		background: #d0d7de;
	}

	.canvas-container.dark {
		background: #1a1a2e;
	}

	.canvas-hint {
		text-align: center;
		margin-top: var(--spacing-xs);
	}

	/* Right: settings */
	.settings-column {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
		min-width: 0;
	}

	/* Controls bar: quick-set + mode toggle */
	.controls-bar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--spacing-sm);
		flex-wrap: wrap;
	}

	.reflectance-quick {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
	}

	.hint {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}

	.quick-buttons {
		display: flex;
		gap: var(--spacing-xs);
	}

	button.mini {
		padding: 2px 8px;
		font-size: var(--font-size-xs);
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		cursor: pointer;
		color: var(--color-text);
		transition: all 0.15s;
	}

	button.mini:hover {
		background: var(--color-border);
	}

	.mode-switch-btn {
		padding: 2px var(--spacing-sm);
		font-size: var(--font-size-xs);
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		cursor: pointer;
		color: var(--color-text);
		transition: all 0.15s;
		white-space: nowrap;
	}

	.mode-switch-btn:hover {
		background: var(--color-border);
		border-color: var(--color-text-muted);
	}

	/* Merged surface table */
	.surface-table {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--spacing-sm);
	}

	.table-header {
		display: grid;
		grid-template-columns: 90px 2fr 1px 1fr 1fr;
		gap: var(--spacing-xs);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		padding-bottom: var(--spacing-xs);
		border-bottom: 1px solid var(--color-border);
	}

	.table-header .col-surface {
		text-align: left;
	}

	.table-header .col-value {
		text-align: center;
	}

	.col-sep {
		background: var(--color-border);
		align-self: stretch;
	}

	.surface-row {
		display: grid;
		grid-template-columns: 90px 2fr 1px 1fr 1fr;
		gap: var(--spacing-xs);
		align-items: center;
		padding: 3px var(--spacing-xs);
		margin: 0 calc(-1 * var(--spacing-xs));
		border-radius: var(--radius-sm);
		transition: background 0.1s;
	}

	.surface-row.highlighted {
		background: rgba(34, 211, 238, 0.08);
	}

	.surface-name {
		font-size: var(--font-size-sm);
		text-transform: capitalize;
		color: var(--color-text-muted);
	}

	.surface-row :global(input) {
		padding: 4px 6px;
		font-size: var(--font-size-base);
		width: 100%;
	}

	.computed-value-row {
		display: grid;
		grid-template-columns: 90px 2fr 1px 1fr 1fr;
		gap: var(--spacing-xs);
		margin-top: -2px;
		margin-bottom: var(--spacing-xs);
		padding-left: var(--spacing-xs);
	}

	.computed-value-row .computed-value {
		grid-column: span 2;
	}

	.computed-value {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		font-family: var(--font-mono);
		opacity: 0.7;
	}

	/* Interreflection section */
	.settings-section {
		display: flex;
		flex-direction: column;
	}

	.settings-section h3 {
		margin: 0 0 var(--spacing-xs) 0;
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
	}

	.section-description {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		margin: 0 0 var(--spacing-xs) 0;
		opacity: 0.8;
	}

	.field-hint {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		opacity: 0.7;
	}

	.section-content {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--spacing-md);
	}

	.form-row {
		display: flex;
		gap: var(--spacing-sm);
	}

	.form-row.halves > * {
		flex: 1;
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.form-group.compact {
		gap: 2px;
	}

	.form-group.compact label {
		font-size: var(--font-size-xs);
		text-transform: capitalize;
	}

	.form-group.compact :global(input) {
		padding: 4px 6px;
		font-size: var(--font-size-base);
	}

	label {
		font-size: var(--font-size-base);
		color: var(--color-text-muted);
	}

	:global(input) {
		width: 100%;
	}

	/* Responsive: stack vertically on narrow viewports */
	@media (max-width: 700px) {
		.modal-body {
			flex-direction: column;
		}

		.preview-column {
			flex: none;
		}

		.canvas-container {
			height: 250px;
		}
	}
</style>
