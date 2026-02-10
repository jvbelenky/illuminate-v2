<script lang="ts">
	import { project, room } from '$lib/stores/project';
	import { autoFocus } from '$lib/actions/autoFocus';
	import type { SurfaceReflectances, SurfaceSpacings, SurfaceNumPointsAll, ReflectanceResolutionMode } from '$lib/types/project';
	import { spacingFromNumPoints, numPointsFromSpacing } from '$lib/utils/calculations';

	interface Props {
		onClose: () => void;
	}

	let { onClose }: Props = $props();

	// Surface order for reflectance grid: 2 columns × 3 rows
	const reflectanceSurfaces: Array<[keyof SurfaceReflectances, keyof SurfaceReflectances]> = [
		['floor', 'ceiling'],
		['south', 'north'],
		['east', 'west']
	];

	// Surface list for spacing/num_points table
	const allSurfaces: Array<keyof SurfaceSpacings> = ['floor', 'ceiling', 'south', 'north', 'east', 'west'];

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
			<!-- Surface Reflectances -->
			<section class="settings-section">
				<h3>Surface Reflectances</h3>
				<div class="section-content">
					<div class="reflectance-quick">
						<span class="hint">Quick set all surfaces:</span>
						<div class="quick-buttons">
							<button type="button" class="mini" onclick={() => setAllReflectances(0.078)}>0.078 (222nm)</button>
							<button type="button" class="mini" onclick={() => setAllReflectances(0.05)}>0.05 (254nm)</button>
						</div>
					</div>

					<div class="reflectance-grid-2x3">
						{#each reflectanceSurfaces as [left, right]}
							<div class="form-group compact">
								<label for="refl_{left}">{left}</label>
								<input
									id="refl_{left}"
									type="number"
									value={$room.reflectances[left]}
									onchange={(e) => handleReflectanceChange(left, e)}
									min="0"
									max="1"
									step="0.01"
								/>
							</div>
							<div class="form-group compact">
								<label for="refl_{right}">{right}</label>
								<input
									id="refl_{right}"
									type="number"
									value={$room.reflectances[right]}
									onchange={(e) => handleReflectanceChange(right, e)}
									min="0"
									max="1"
									step="0.01"
								/>
							</div>
						{/each}
					</div>
				</div>
			</section>

			<!-- Surface Resolution -->
			<section class="settings-section">
				<div class="section-header-row">
					<h3>Surface Resolution</h3>
					<button type="button" class="mode-switch-btn" onclick={toggleResolutionMode}>
						{$room.reflectance_resolution_mode === 'num_points' ? 'Set Spacing' : 'Set Num Points'}
					</button>
				</div>
				<div class="section-content">
					<div class="spacing-header">
						<span class="surface-col">Surface</span>
						{#if $room.reflectance_resolution_mode === 'spacing'}
							<span class="spacing-col">X Spacing</span>
							<span class="spacing-col">Y Spacing</span>
						{:else}
							<span class="spacing-col">X Points</span>
							<span class="spacing-col">Y Points</span>
						{/if}
					</div>
					{#each allSurfaces as surface}
						<div class="spacing-row">
							<span class="surface-name">{surface}</span>
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
								<span class="computed-value">{$room.reflectance_num_points[surface].x} × {$room.reflectance_num_points[surface].y} pts</span>
							{:else}
								<span class="computed-value">{round3(spacingFromNumPoints(getSurfaceSpans(surface).x, $room.reflectance_num_points[surface].x))} × {round3(spacingFromNumPoints(getSurfaceSpans(surface).y, $room.reflectance_num_points[surface].y))} {unitAbbrev}</span>
							{/if}
						</div>
					{/each}
				</div>
			</section>

			<!-- Interreflection -->
			<section class="settings-section">
				<h3>Interreflection</h3>
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
						</div>
					</div>
				</div>
			</section>
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
		width: 460px;
		max-width: 90%;
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
		flex-direction: column;
		gap: var(--spacing-md);
	}

	/* Sections */
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

	.section-header-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--spacing-xs);
	}

	.section-header-row h3 {
		margin-bottom: 0;
	}

	.section-content {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--spacing-md);
	}

	/* Reflectance quick-set */
	.reflectance-quick {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
		margin-bottom: var(--spacing-sm);
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

	/* Reflectance grid */
	.reflectance-grid-2x3 {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: var(--spacing-xs);
	}

	/* Form elements */
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

	.form-row {
		display: flex;
		gap: var(--spacing-sm);
	}

	.form-row.halves > * {
		flex: 1;
	}

	/* Mode switch */
	.mode-switch-btn {
		padding: 2px var(--spacing-sm);
		font-size: var(--font-size-xs);
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		cursor: pointer;
		color: var(--color-text);
		transition: all 0.15s;
	}

	.mode-switch-btn:hover {
		background: var(--color-border);
		border-color: var(--color-text-muted);
	}

	/* Spacing table */
	.spacing-header {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr;
		gap: var(--spacing-xs);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		padding-bottom: 2px;
		border-bottom: 1px solid var(--color-border);
	}

	.spacing-header .surface-col {
		text-align: left;
	}

	.spacing-header .spacing-col {
		text-align: center;
	}

	.spacing-row {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr;
		gap: var(--spacing-xs);
		align-items: center;
	}

	.spacing-row .surface-name {
		font-size: var(--font-size-sm);
		text-transform: capitalize;
		color: var(--color-text-muted);
	}

	.spacing-row input {
		padding: 4px 6px;
		font-size: var(--font-size-base);
	}

	.computed-value-row {
		display: grid;
		grid-template-columns: 1fr 2fr;
		gap: var(--spacing-xs);
		margin-top: -2px;
		margin-bottom: var(--spacing-xs);
	}

	.computed-value {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		font-family: var(--font-mono);
		opacity: 0.7;
	}

	label {
		font-size: var(--font-size-base);
		color: var(--color-text-muted);
	}

	input {
		width: 100%;
	}
</style>
