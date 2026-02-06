<script lang="ts">
	import { project, room } from '$lib/stores/project';
	import type { RoomConfig, SurfaceReflectances, SurfaceSpacings, SurfaceNumPointsAll, ReflectanceResolutionMode } from '$lib/types/project';
	import { spacingFromNumPoints, numPointsFromSpacing } from '$lib/utils/calculations';

	let showReflectanceSettings = $state(false);

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

	function handleDimensionChange(dim: 'x' | 'y' | 'z', event: Event) {
		const target = event.target as HTMLInputElement;
		project.updateRoom({ [dim]: parseFloat(target.value) || 0 });
	}

	function handleUnitChange(event: Event) {
		const target = event.target as HTMLSelectElement;
		project.updateRoom({ units: target.value as 'meters' | 'feet' });
	}

	function handleReflectanceToggle(event: Event) {
		const target = event.target as HTMLInputElement;
		const enabled = target.checked;
		project.updateRoom({ enable_reflectance: enabled });
		// Auto-open reflectance settings when enabled
		if (enabled) {
			showReflectanceSettings = true;
		}
	}

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

	// Get display units abbreviation
	$effect(() => {
		// This effect ensures reactive updates when units change
	});
	const unitAbbrev = $derived($room.units === 'meters' ? 'm' : 'ft');
</script>

<div class="room-editor">
	<!-- Dimensions with Units -->
	<div class="form-group">
		<label>Dimensions</label>
		<div class="dimensions-row">
			<div class="dim-inputs">
				<div class="input-with-label">
					<span class="input-label">X</span>
					<input
						type="text"
						inputmode="decimal"
						value={$room.x.toFixed($room.precision)}
						onchange={(e) => handleDimensionChange('x', e)}
					/>
				</div>
				<div class="input-with-label">
					<span class="input-label">Y</span>
					<input
						type="text"
						inputmode="decimal"
						value={$room.y.toFixed($room.precision)}
						onchange={(e) => handleDimensionChange('y', e)}
					/>
				</div>
				<div class="input-with-label">
					<span class="input-label">Z</span>
					<input
						type="text"
						inputmode="decimal"
						value={$room.z.toFixed($room.precision)}
						onchange={(e) => handleDimensionChange('z', e)}
					/>
				</div>
			</div>
			<select class="units-select" value={$room.units} onchange={handleUnitChange}>
				<option value="meters">m</option>
				<option value="feet">ft</option>
			</select>
		</div>
	</div>

	<!-- Reflectance Toggle -->
	<div class="form-group tight-after">
		<label class="checkbox-label">
			<input
				type="checkbox"
				checked={$room.enable_reflectance}
				onchange={handleReflectanceToggle}
			/>
			<span>Enable reflections</span>
		</label>
	</div>

	<!-- Reflectance Settings Dropdown -->
	<button class="toggle-btn" onclick={() => showReflectanceSettings = !showReflectanceSettings}>
		{showReflectanceSettings ? '▼' : '▶'} Reflectance Settings
	</button>

	{#if showReflectanceSettings}
		<div class="dropdown-section">
			<!-- Reflectance Values -->
			<div class="reflectance-quick">
				<span class="hint">Quick set all surfaces:</span>
				<div class="quick-buttons">
					<button class="mini" onclick={() => setAllReflectances(0.078)}>0.078 (222nm)</button>
					<button class="mini" onclick={() => setAllReflectances(0.05)}>0.05 (254nm)</button>
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

			<!-- Reflective Surface Resolution -->
			<div class="spacing-section">
				<div class="resolution-header">
					<span class="section-label">
						{$room.reflectance_resolution_mode === 'spacing'
							? `Reflective Surface Spacing (${unitAbbrev})`
							: 'Reflective Surface Grid Points'}
					</span>
					<button type="button" class="swap-btn" onclick={toggleResolutionMode} title="Switch between spacing and grid points">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M7 16V4M7 4L3 8M7 4l4 4M17 8v12M17 20l4-4M17 20l-4-4"/>
						</svg>
					</button>
				</div>
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
								min="0.01"
								step="0.1"
							/>
							<input
								type="number"
								value={$room.reflectance_spacings[surface].y}
								onchange={(e) => handleSpacingChange(surface, 'y', e)}
								min="0.01"
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

			<!-- Interreflection Settings -->
			<div class="interreflection-section">
				<span class="section-label">Interreflection Settings</span>
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
		</div>
	{/if}
</div>

<style>
	.room-editor {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.form-group.compact {
		gap: 2px;
	}

	.form-group.tight-after {
		margin-bottom: calc(-1 * var(--spacing-xs));
	}

	.form-group.compact label {
		font-size: 0.7rem;
		text-transform: capitalize;
	}

	.form-group.compact input {
		padding: 4px 6px;
		font-size: 0.8rem;
	}

	.form-row {
		display: flex;
		gap: var(--spacing-sm);
	}

	.form-row.halves > * {
		flex: 1;
	}

	/* Dimensions row with units dropdown */
	.dimensions-row {
		display: flex;
		gap: var(--spacing-sm);
		align-items: flex-end;
	}

	.dim-inputs {
		display: flex;
		gap: var(--spacing-xs);
		flex: 1;
	}

	.dim-inputs > * {
		flex: 1;
	}

	.units-select {
		width: 60px;
		flex-shrink: 0;
	}

	.input-with-label {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.input-label {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		font-weight: 500;
	}

	.toggle-btn {
		background: none;
		border: none;
		color: var(--color-text-muted);
		cursor: pointer;
		padding: var(--spacing-xs) 0;
		text-align: left;
		font-size: 0.85rem;
	}

	.toggle-btn:hover {
		color: var(--color-text);
	}

	.dropdown-section {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
		padding-left: var(--spacing-sm);
		border-left: 2px solid var(--color-border);
		margin-left: var(--spacing-xs);
		margin-bottom: var(--spacing-xs);
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		cursor: pointer;
		font-size: 0.875rem;
	}

	.checkbox-label input[type="checkbox"] {
		width: auto;
		margin: 0;
	}

	.reflectance-quick {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.hint {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.quick-buttons {
		display: flex;
		gap: var(--spacing-xs);
	}

	button.mini {
		padding: 2px 8px;
		font-size: 0.7rem;
	}

	.reflectance-grid-2x3 {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: var(--spacing-xs);
	}

	.section-label {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		font-weight: 500;
		margin-top: var(--spacing-sm);
		display: block;
	}

	.spacing-section {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.resolution-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.resolution-header .section-label {
		margin-top: 0;
	}

	.swap-btn {
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: 4px;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-text-muted);
		transition: all 0.15s;
	}

	.swap-btn:hover {
		background: var(--color-bg-secondary);
		color: var(--color-text);
		border-color: var(--color-primary);
	}

	.spacing-header {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr;
		gap: var(--spacing-xs);
		font-size: 0.7rem;
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
		font-size: 0.75rem;
		text-transform: capitalize;
		color: var(--color-text-muted);
	}

	.spacing-row input {
		padding: 4px 6px;
		font-size: 0.8rem;
	}

	.computed-value-row {
		display: grid;
		grid-template-columns: 1fr 2fr;
		gap: var(--spacing-xs);
		margin-top: -2px;
		margin-bottom: var(--spacing-xs);
	}

	.computed-value {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		font-family: var(--font-mono);
		opacity: 0.7;
	}

	.interreflection-section {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	label {
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	input, select {
		width: 100%;
	}
</style>
