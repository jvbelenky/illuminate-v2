<script lang="ts">
	import type {
		SurfaceReflectances,
		SurfaceSpacings,
		SurfaceNumPointsAll,
		ReflectanceResolutionMode
	} from '$lib/types/project';
	import { spacingFromNumPoints, numPointsFromSpacing } from '$lib/utils/calculations';

	interface Props {
		reflectances: SurfaceReflectances;
		spacings: SurfaceSpacings;
		numPoints: SurfaceNumPointsAll;
		resolutionMode: ReflectanceResolutionMode;
		maxPasses: number;
		threshold: number;
		units: string;
		roomDimensions: { x: number; y: number; z: number };
		onReflectanceChange: (surface: keyof SurfaceReflectances, value: number) => void;
		onSetAllReflectances: (value: number) => void;
		onSpacingChange: (surface: keyof SurfaceSpacings, axis: 'x' | 'y', value: number) => void;
		onNumPointsChange: (surface: keyof SurfaceNumPointsAll, axis: 'x' | 'y', value: number) => void;
		onResolutionModeChange: (mode: ReflectanceResolutionMode) => void;
		onMaxPassesChange: (value: number) => void;
		onThresholdChange: (value: number) => void;
	}

	let {
		reflectances,
		spacings,
		numPoints,
		resolutionMode,
		maxPasses,
		threshold,
		units,
		roomDimensions,
		onReflectanceChange,
		onSetAllReflectances,
		onSpacingChange,
		onNumPointsChange,
		onResolutionModeChange,
		onMaxPassesChange,
		onThresholdChange
	}: Props = $props();

	// Surface order for reflectance grid: 2 columns × 3 rows
	const reflectanceSurfaces: Array<[keyof SurfaceReflectances, keyof SurfaceReflectances]> = [
		['floor', 'ceiling'],
		['south', 'north'],
		['east', 'west']
	];

	// Surface list for spacing/num_points table
	const allSurfaces: Array<keyof SurfaceSpacings> = ['floor', 'ceiling', 'south', 'north', 'east', 'west'];

	const unitAbbrev = $derived(units === 'meters' ? 'm' : 'ft');

	function round3(v: number): number {
		return Math.round(v * 1000) / 1000;
	}

	/** Get the physical span dimensions for a reflective surface based on room geometry */
	function getSurfaceSpans(surface: keyof SurfaceSpacings): { x: number; y: number } {
		const r = roomDimensions;
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

	function handleReflectanceInput(surface: keyof SurfaceReflectances, event: Event) {
		const target = event.target as HTMLInputElement;
		const value = Math.max(0, Math.min(1, parseFloat(target.value) || 0));
		onReflectanceChange(surface, value);
	}

	function handleSpacingInput(surface: keyof SurfaceSpacings, axis: 'x' | 'y', event: Event) {
		const target = event.target as HTMLInputElement;
		const value = Math.max(0.01, parseFloat(target.value) || 0.1);
		const spans = getSurfaceSpans(surface);
		onSpacingChange(surface, axis, value);
		onNumPointsChange(surface, axis, numPointsFromSpacing(spans[axis], value));
	}

	function handleNumPointsInput(surface: keyof SurfaceNumPointsAll, axis: 'x' | 'y', event: Event) {
		const target = event.target as HTMLInputElement;
		const value = Math.max(2, parseInt(target.value) || 2);
		const spans = getSurfaceSpans(surface);
		onNumPointsChange(surface, axis, value);
		onSpacingChange(surface, axis, round3(spacingFromNumPoints(spans[axis], value)));
	}

	function handleMaxPassesInput(event: Event) {
		const target = event.target as HTMLInputElement;
		const value = Math.max(0, parseInt(target.value) || 100);
		onMaxPassesChange(value);
	}

	function handleThresholdInput(event: Event) {
		const target = event.target as HTMLInputElement;
		const value = Math.max(0, Math.min(1, parseFloat(target.value) || 0.02));
		onThresholdChange(value);
	}

	function toggleResolutionMode() {
		const newMode: ReflectanceResolutionMode =
			resolutionMode === 'spacing' ? 'num_points' : 'spacing';
		onResolutionModeChange(newMode);
	}
</script>

<div class="reflectance-settings">
	<!-- Reflectance Values -->
	<div class="reflectance-quick">
		<span class="hint">Quick set all surfaces:</span>
		<div class="quick-buttons">
			<button class="mini" onclick={() => onSetAllReflectances(0.078)}>0.078 (222nm)</button>
			<button class="mini" onclick={() => onSetAllReflectances(0.05)}>0.05 (254nm)</button>
		</div>
	</div>

	<div class="reflectance-grid-2x3">
		{#each reflectanceSurfaces as [left, right]}
			<div class="form-group compact">
				<label for="refl_{left}">{left}</label>
				<input
					id="refl_{left}"
					type="number"
					value={reflectances[left]}
					onchange={(e) => handleReflectanceInput(left, e)}
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
					value={reflectances[right]}
					onchange={(e) => handleReflectanceInput(right, e)}
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
				{resolutionMode === 'spacing'
					? 'Reflective Surface Spacing'
					: 'Reflective Surface Grid Points'}
			</span>
			<button type="button" class="mode-switch-btn" onclick={toggleResolutionMode}>
				{resolutionMode === 'num_points' ? 'Set Spacing' : 'Set Num Points'}
			</button>
		</div>
		<div class="spacing-header">
			<span class="surface-col">Surface</span>
			{#if resolutionMode === 'spacing'}
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
				{#if resolutionMode === 'spacing'}
					<input
						type="number"
						value={spacings[surface].x}
						onchange={(e) => handleSpacingInput(surface, 'x', e)}
						min="0.01"
						step="0.1"
					/>
					<input
						type="number"
						value={spacings[surface].y}
						onchange={(e) => handleSpacingInput(surface, 'y', e)}
						min="0.01"
						step="0.1"
					/>
				{:else}
					<input
						type="number"
						value={numPoints[surface].x}
						onchange={(e) => handleNumPointsInput(surface, 'x', e)}
						min="2"
						step="1"
					/>
					<input
						type="number"
						value={numPoints[surface].y}
						onchange={(e) => handleNumPointsInput(surface, 'y', e)}
						min="2"
						step="1"
					/>
				{/if}
			</div>
			<div class="computed-value-row">
				<span></span>
				{#if resolutionMode === 'spacing'}
					<span class="computed-value">{numPoints[surface].x} × {numPoints[surface].y} pts</span>
				{:else}
					<span class="computed-value">{round3(spacingFromNumPoints(getSurfaceSpans(surface).x, numPoints[surface].x))} × {round3(spacingFromNumPoints(getSurfaceSpans(surface).y, numPoints[surface].y))} {unitAbbrev}</span>
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
					value={maxPasses}
					onchange={handleMaxPassesInput}
					min="0"
					step="1"
				/>
			</div>
			<div class="form-group compact">
				<label for="threshold">Threshold</label>
				<input
					id="threshold"
					type="number"
					value={threshold}
					onchange={handleThresholdInput}
					min="0"
					max="1"
					step="0.01"
				/>
			</div>
		</div>
	</div>
</div>

<style>
	.reflectance-settings {
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
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	button.mini:hover {
		background: var(--color-bg-secondary);
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

	.mode-switch-btn {
		padding: 2px var(--spacing-sm);
		font-size: var(--font-size-xs);
		background: var(--color-primary);
		border: 1px solid var(--color-primary);
		border-radius: var(--radius-sm);
		cursor: pointer;
		color: white;
		transition: all 0.15s;
	}

	.mode-switch-btn:hover {
		background: color-mix(in srgb, var(--color-primary) 85%, black);
		border-color: color-mix(in srgb, var(--color-primary) 85%, black);
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

	input {
		width: 100%;
	}
</style>
