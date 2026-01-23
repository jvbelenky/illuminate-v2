<script lang="ts">
	import { spacingFromNumPoints, numPointsFromSpacing } from '$lib/utils/calculations';

	type ResolutionMode = 'num_points' | 'spacing';

	interface Props {
		/** Current resolution mode */
		mode: ResolutionMode;
		/** Units for display (e.g., 'meters', 'feet') */
		units: string;
		/** Whether this is a 3D (volume) grid */
		isVolume?: boolean;
		/** Axis labels (defaults to X, Y, Z) */
		axisLabels?: { a: string; b: string; c?: string };
		/** Span dimensions */
		span: { x: number; y: number; z?: number };
		/** Number of points */
		numPoints: { x: number; y: number; z?: number };
		/** Spacing values */
		spacing: { x: number; y: number; z?: number };
		/** Callback when mode changes */
		onModeChange?: (mode: ResolutionMode) => void;
		/** Callback when num_points change */
		onNumPointsChange?: (axis: 'x' | 'y' | 'z', value: number) => void;
		/** Callback when spacing changes */
		onSpacingChange?: (axis: 'x' | 'y' | 'z', value: number) => void;
	}

	let {
		mode,
		units,
		isVolume = false,
		axisLabels = { a: 'X', b: 'Y', c: 'Z' },
		span,
		numPoints,
		spacing,
		onModeChange,
		onNumPointsChange,
		onSpacingChange
	}: Props = $props();

	function round3(val: number): number {
		return Math.round(val * 1000) / 1000;
	}

	function toggleMode() {
		const newMode: ResolutionMode = mode === 'num_points' ? 'spacing' : 'num_points';
		onModeChange?.(newMode);
	}

	function handleNumPointsInput(axis: 'x' | 'y' | 'z', event: Event) {
		const target = event.target as HTMLInputElement;
		const value = Math.max(2, parseInt(target.value) || 2);
		onNumPointsChange?.(axis, value);
	}

	function handleSpacingInput(axis: 'x' | 'y' | 'z', event: Event) {
		const target = event.target as HTMLInputElement;
		const value = Math.max(0.01, parseFloat(target.value) || 0.1);
		onSpacingChange?.(axis, value);
	}

	// Compute display values
	const displaySpacing = $derived({
		x: round3(spacingFromNumPoints(span.x, numPoints.x)),
		y: round3(spacingFromNumPoints(span.y, numPoints.y)),
		z: span.z ? round3(spacingFromNumPoints(span.z, numPoints.z || 2)) : 0
	});

	const displayNumPoints = $derived({
		x: numPointsFromSpacing(span.x, spacing.x),
		y: numPointsFromSpacing(span.y, spacing.y),
		z: span.z ? numPointsFromSpacing(span.z, spacing.z || 0.5) : 0
	});
</script>

<div class="grid-resolution">
	<div class="resolution-header">
		<label>{mode === 'num_points' ? 'Grid Points' : 'Spacing'}</label>
		<button type="button" class="swap-btn" onclick={toggleMode} title="Switch mode">
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M7 16V4M7 4L3 8M7 4l4 4M17 8v12M17 20l4-4M17 20l-4-4"/>
			</svg>
		</button>
	</div>

	{#if mode === 'num_points'}
		<div class="grid-inputs">
			<div class="grid-input">
				<span class="input-label">{axisLabels.a}</span>
				<input
					type="number"
					value={numPoints.x}
					oninput={(e) => handleNumPointsInput('x', e)}
					min="2"
					max="200"
					step="1"
				/>
			</div>
			<span class="input-sep">x</span>
			<div class="grid-input">
				<span class="input-label">{axisLabels.b}</span>
				<input
					type="number"
					value={numPoints.y}
					oninput={(e) => handleNumPointsInput('y', e)}
					min="2"
					max="200"
					step="1"
				/>
			</div>
			{#if isVolume}
				<span class="input-sep">x</span>
				<div class="grid-input">
					<span class="input-label">{axisLabels.c || 'Z'}</span>
					<input
						type="number"
						value={numPoints.z}
						oninput={(e) => handleNumPointsInput('z', e)}
						min="2"
						max="200"
						step="1"
					/>
				</div>
			{/if}
		</div>
		<div class="computed-value">
			Spacing: {displaySpacing.x.toFixed(2)} x {displaySpacing.y.toFixed(2)}{isVolume && span.z ? ` x ${displaySpacing.z.toFixed(2)}` : ''} {units}
		</div>
	{:else}
		<div class="grid-inputs">
			<div class="grid-input">
				<span class="input-label">{axisLabels.a}</span>
				<input
					type="number"
					value={spacing.x}
					oninput={(e) => handleSpacingInput('x', e)}
					min="0.01"
					max="10"
					step="0.1"
				/>
			</div>
			<span class="input-sep">x</span>
			<div class="grid-input">
				<span class="input-label">{axisLabels.b}</span>
				<input
					type="number"
					value={spacing.y}
					oninput={(e) => handleSpacingInput('y', e)}
					min="0.01"
					max="10"
					step="0.1"
				/>
			</div>
			{#if isVolume}
				<span class="input-sep">x</span>
				<div class="grid-input">
					<span class="input-label">{axisLabels.c || 'Z'}</span>
					<input
						type="number"
						value={spacing.z}
						oninput={(e) => handleSpacingInput('z', e)}
						min="0.01"
						max="10"
						step="0.1"
					/>
				</div>
			{/if}
			<span class="input-unit">{units}</span>
		</div>
		<div class="computed-value">
			Grid: {displayNumPoints.x} x {displayNumPoints.y}{isVolume && span.z ? ` x ${displayNumPoints.z}` : ''} points
		</div>
	{/if}
</div>

<style>
	.grid-resolution {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}

	.resolution-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.resolution-header label {
		margin-bottom: 0;
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	.swap-btn {
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: var(--spacing-xs);
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

	.grid-inputs {
		display: flex;
		align-items: flex-end;
		gap: var(--spacing-sm);
	}

	.grid-input {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.grid-input input {
		width: 100%;
	}

	.input-label {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.input-sep {
		color: var(--color-text-muted);
		font-size: 0.875rem;
		padding-bottom: 8px;
	}

	.input-unit {
		color: var(--color-text-muted);
		font-size: 0.875rem;
		padding-bottom: 8px;
		white-space: nowrap;
	}

	.computed-value {
		margin-top: var(--spacing-xs);
		font-size: 0.75rem;
		color: var(--color-text-muted);
		font-family: var(--font-mono);
	}
</style>
