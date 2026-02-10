<script lang="ts">
	import { Canvas } from '@threlte/core';
	import { project, room } from '$lib/stores/project';
	import { theme } from '$lib/stores/theme';
	import { autoFocus } from '$lib/actions/autoFocus';
	import type { SurfaceReflectances, SurfaceSpacings, SurfaceNumPointsAll, ReflectanceResolutionMode } from '$lib/types/project';
	import { spacingFromNumPoints, numPointsFromSpacing } from '$lib/utils/calculations';
	import ReflectancePreview3D from './ReflectancePreview3D.svelte';

	interface Props {
		onClose: () => void;
	}

	let { onClose }: Props = $props();

	// Surface list
	const allSurfaces: Array<keyof SurfaceReflectances> = ['floor', 'ceiling', 'south', 'north', 'east', 'west'];

	// Hover/focus tracking for 3D highlight
	let selectedSurface = $state<keyof SurfaceReflectances | null>(null);

	// Computed room dims for preview (always in meters)
	const scale = $derived($room.units === 'feet' ? 0.3048 : 1);
	const roomDims = $derived({ x: $room.x * scale, y: $room.y * scale, z: $room.z * scale });

	function round3(v: number): number {
		return Math.round(v * 1000) / 1000;
	}

	/** Get the physical span dimensions for a reflective surface based on room geometry */
	function getSurfaceSpans(surface: keyof SurfaceSpacings): { x: number; y: number } {
		const r = $room;
		switch (surface) {
			case 'floor':
			case 'ceiling':
				return { x: r.x, y: r.y };
			case 'north':
			case 'south':
				return { x: r.x, y: r.z };
			case 'east':
			case 'west':
				return { x: r.y, y: r.z };
		}
	}

	const unitAbbrev = $derived($room.units === 'meters' ? 'm' : 'ft');

	function handleReflectanceChange(surface: keyof SurfaceReflectances, event: Event) {
		const target = event.target as HTMLInputElement;
		const value = parseFloat(target.value) || 0;
		const newReflectances = { ...$room.reflectances, [surface]: Math.max(0, Math.min(1, value)) };
		project.updateRoom({ reflectances: newReflectances });
	}

	function setAllReflectances(value: number) {
		const newReflectances: SurfaceReflectances = {
			floor: value,
			ceiling: value,
			north: value,
			south: value,
			east: value,
			west: value
		};
		project.updateRoom({ reflectances: newReflectances });
	}

	function handleSpacingChange(surface: keyof SurfaceSpacings, axis: 'x' | 'y', event: Event) {
		const target = event.target as HTMLInputElement;
		const value = parseFloat(target.value) || 0.1;
		const spacing = Math.max(0.01, value);
		const spans = getSurfaceSpans(surface);
		const newSpacings = {
			...$room.reflectance_spacings,
			[surface]: {
				...$room.reflectance_spacings[surface],
				[axis]: spacing
			}
		};
		const newNumPoints = {
			...$room.reflectance_num_points,
			[surface]: {
				...$room.reflectance_num_points[surface],
				[axis]: numPointsFromSpacing(spans[axis], spacing)
			}
		};
		project.updateRoom({ reflectance_spacings: newSpacings, reflectance_num_points: newNumPoints });
	}

	function handleNumPointsChange(surface: keyof SurfaceNumPointsAll, axis: 'x' | 'y', event: Event) {
		const target = event.target as HTMLInputElement;
		const value = parseInt(target.value) || 2;
		const np = Math.max(2, value);
		const spans = getSurfaceSpans(surface);
		const newNumPoints = {
			...$room.reflectance_num_points,
			[surface]: {
				...$room.reflectance_num_points[surface],
				[axis]: np
			}
		};
		const newSpacings = {
			...$room.reflectance_spacings,
			[surface]: {
				...$room.reflectance_spacings[surface],
				[axis]: round3(spacingFromNumPoints(spans[axis], np))
			}
		};
		project.updateRoom({ reflectance_num_points: newNumPoints, reflectance_spacings: newSpacings });
	}

	function toggleResolutionMode() {
		const newMode: ReflectanceResolutionMode =
			$room.reflectance_resolution_mode === 'spacing' ? 'num_points' : 'spacing';
		project.updateRoom({ reflectance_resolution_mode: newMode });
	}

	function handleMaxPassesChange(event: Event) {
		const target = event.target as HTMLInputElement;
		const value = parseInt(target.value) || 100;
		project.updateRoom({ reflectance_max_num_passes: Math.max(0, value) });
	}

	function handleThresholdChange(event: Event) {
		const target = event.target as HTMLInputElement;
		const value = parseFloat(target.value) || 0.02;
		project.updateRoom({ reflectance_threshold: Math.max(0, Math.min(1, value)) });
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			onClose();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			onClose();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={handleBackdropClick}>
	<div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="reflectance-title" use:autoFocus>
		<div class="modal-header">
			<h2 id="reflectance-title">Reflectance Settings</h2>
			<button type="button" class="close-btn" onclick={onClose} title="Close">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M18 6L6 18M6 6l12 12"/>
				</svg>
			</button>
		</div>

		<div class="modal-body">
			<!-- Left: 3D Preview -->
			<div class="preview-column">
				<div class="canvas-container" class:dark={$theme === 'dark'}>
					<Canvas>
						<ReflectancePreview3D {roomDims} numPoints={$room.reflectance_num_points} {selectedSurface} />
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
						<span class="col-value">Refl.</span>
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
							<span class="surface-name">{surface}</span>
							<input
								type="number"
								value={$room.reflectances[surface]}
								onchange={(e) => handleReflectanceChange(surface, e)}
								min="0"
								max="1"
								step="0.01"
							/>
							{#if $room.reflectance_resolution_mode === 'spacing'}
								<input
									type="number"
									value={$room.reflectance_spacings[surface].x}
									onchange={(e) => handleSpacingChange(surface, 'x', e)}
									min="0.1"
									step="0.1"
								/>
								<input
									type="number"
									value={$room.reflectance_spacings[surface].y}
									onchange={(e) => handleSpacingChange(surface, 'y', e)}
									min="0.1"
									step="0.1"
								/>
							{:else}
								<input
									type="number"
									value={$room.reflectance_num_points[surface].x}
									onchange={(e) => handleNumPointsChange(surface, 'x', e)}
									min="2"
									step="1"
								/>
								<input
									type="number"
									value={$room.reflectance_num_points[surface].y}
									onchange={(e) => handleNumPointsChange(surface, 'y', e)}
									min="2"
									step="1"
								/>
							{/if}
						</div>
						<div class="computed-value-row">
							<span></span>
							{#if $room.reflectance_resolution_mode === 'spacing'}
								<span class="computed-value">{$room.reflectance_num_points[surface].x} x {$room.reflectance_num_points[surface].y} pts</span>
							{:else}
								<span class="computed-value">{round3(spacingFromNumPoints(getSurfaceSpans(surface).x, $room.reflectance_num_points[surface].x))} x {round3(spacingFromNumPoints(getSurfaceSpans(surface).y, $room.reflectance_num_points[surface].y))} {unitAbbrev}</span>
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
								<input
									id="max_passes"
									type="number"
									value={$room.reflectance_max_num_passes}
									onchange={handleMaxPassesChange}
									min="0"
									step="1"
								/>
								<span class="field-hint">Maximum reflection passes</span>
							</div>
							<div class="form-group compact">
								<label for="threshold">Threshold</label>
								<input
									id="threshold"
									type="number"
									value={$room.reflectance_threshold}
									onchange={handleThresholdChange}
									min="0"
									max="1"
									step="0.01"
								/>
								<span class="field-hint">Fraction of initial value</span>
							</div>
						</div>
					</div>
				</section>
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
		background: rgba(0, 0, 0, 0.5);
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
		width: min(920px, 95vw);
		max-height: 90vh;
		overflow-y: auto;
		box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
	}

	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--spacing-sm) var(--spacing-md);
		border-bottom: 1px solid var(--color-border);
		position: sticky;
		top: 0;
		background: var(--color-bg);
		z-index: 1;
	}

	.modal-header h2 {
		margin: 0;
		font-size: 1rem;
		color: var(--color-text);
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
		flex-direction: row;
		gap: var(--spacing-md);
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
		grid-template-columns: 90px 1fr 1fr 1fr;
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

	.surface-row {
		display: grid;
		grid-template-columns: 90px 1fr 1fr 1fr;
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

	.surface-row input {
		padding: 4px 6px;
		font-size: var(--font-size-base);
		width: 100%;
	}

	.computed-value-row {
		display: grid;
		grid-template-columns: 90px 1fr;
		gap: var(--spacing-xs);
		margin-top: -2px;
		margin-bottom: var(--spacing-xs);
		padding-left: var(--spacing-xs);
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

	.form-group.compact input {
		padding: 4px 6px;
		font-size: var(--font-size-base);
	}

	label {
		font-size: var(--font-size-base);
		color: var(--color-text-muted);
	}

	input {
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
