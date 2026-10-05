<script lang="ts">
	import { Canvas } from '@threlte/core';
	import PhotometricAxisScene from './PhotometricAxisScene.svelte';
	import type { IesAnalysisResponse } from '$lib/api/contract';
	import { toMeters, unitAbbrev, unitFineStep, type LengthUnit } from '$lib/utils/unitConversion';
	import {
		PHOTOMETRIC_AXES, AXIS_LABELS, axisReadout, fixtureBoundsLocal, centeredDepth, type PhotometricAxis
	} from '$lib/utils/photometricAxis';

	interface Props {
		analysis: IesAnalysisResponse | null;
		axis: PhotometricAxis;
		depth: number | undefined;
		housingWidth: number | undefined;
		housingLength: number | undefined;
		housingHeight: number | undefined;
		units: LengthUnit;
		onAxisChange: (axis: PhotometricAxis) => void;
		onDepthChange: (depth: number | undefined) => void;
	}

	let { analysis, axis, depth, housingWidth, housingLength, housingHeight, units, onAxisChange, onDepthChange }: Props = $props();

	const scores = $derived<Record<string, number>>(analysis?.axis_scores ?? {});

	// Housing box in the aim frame, scaled for the scene. Housing dims default
	// to the permuted surface extents for the chosen axis; the box is sized
	// so its largest extent reads well next to the unit-radius web.
	const fixtureBounds = $derived.by(() => {
		if (!analysis) return null;
		const ext = analysis.extents_by_axis[axis];
		if (!ext) return null;
		const toM = (v: number | undefined, fallbackM: number) => (v == null ? fallbackM : toMeters(v, units));
		const w = toM(housingWidth, ext.width);
		const l = toM(housingLength, ext.length);
		const h = toM(housingHeight, 0);
		const d = toM(depth, 0);
		const largest = Math.max(w, l, h, ext.height);
		if (largest <= 0) return null;
		const scale = 0.5 / largest;
		return fixtureBoundsLocal({
			housingWidth: w, housingLength: l, housingHeight: h, surfaceHeight: ext.height, depth: d
		}).map((c) => c.map((v) => v * scale));
	});

	const readout = $derived(axisReadout(axis));
	const canCenter = $derived(housingHeight != null && housingHeight > 0);

	function handleDepthInput(e: Event) {
		const raw = (e.currentTarget as HTMLInputElement).value;
		if (raw === '') {
			onDepthChange(undefined);
			return;
		}
		const v = Number(raw);
		if (Number.isFinite(v) && v >= 0) onDepthChange(v);
	}
</script>

<div class="axis-picker">
	<div class="axis-canvas">
		{#if analysis}
			<Canvas>
				<PhotometricAxisScene
					vertices={analysis.vertices}
					triangles={analysis.triangles}
					{axis}
					{scores}
					{fixtureBounds}
					onPick={onAxisChange}
				/>
			</Canvas>
			<div class="canvas-hint">Click the beam or a handle to say where the light goes. Drag to rotate.</div>
		{:else}
			<div class="canvas-placeholder">Analyzing photometry…</div>
		{/if}
	</div>

	<div class="axis-buttons" role="group" aria-label="Beam direction in file">
		{#each PHOTOMETRIC_AXES as a (a)}
			<button
				type="button"
				class="axis-btn"
				class:dim={(scores[a] ?? 0) < 0.05 && a !== axis}
				data-axis={a}
				aria-pressed={a === axis}
				title={`${Math.round((scores[a] ?? 0) * 100)}% of power within 45° of this direction`}
				onclick={() => onAxisChange(a)}
			>{AXIS_LABELS[a]}</button>
		{/each}
	</div>

	<p class="axis-readout">{readout}</p>

	<div class="depth-row">
		<label for="photometric-depth">Photometric center depth [{unitAbbrev(units)}]</label>
		<div class="depth-controls">
			<input
				id="photometric-depth"
				type="number"
				min="0"
				step={unitFineStep(units)}
				value={depth ?? ''}
				placeholder="0"
				oninput={handleDepthInput}
			/>
			<button type="button" class="secondary small depth-face" onclick={() => onDepthChange(0)}>At emitting face</button>
			<button type="button" class="secondary small depth-centered" disabled={!canCenter} onclick={() => onDepthChange(centeredDepth(housingHeight ?? 0))}>Centered</button>
		</div>
		<span class="hint">How far behind the emitting face the photometric center sits. Centered = half the housing height.</span>
	</div>
</div>

<style>
	.axis-picker {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}

	.axis-canvas {
		position: relative;
		height: 260px;
		border-radius: var(--radius-md);
		overflow: hidden;
		background: var(--color-bg-secondary);
	}

	.canvas-hint,
	.canvas-placeholder {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		padding: 4px 8px;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		text-align: center;
		pointer-events: none;
	}

	.canvas-placeholder {
		top: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.axis-buttons {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: var(--spacing-xs);
	}

	.axis-btn {
		padding: 4px 0;
		font-size: var(--font-size-sm);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg-secondary);
		color: var(--color-text);
		cursor: pointer;
	}

	.axis-btn[aria-pressed="true"] {
		border-color: var(--color-primary);
		background: color-mix(in srgb, var(--color-primary) 18%, transparent);
	}

	.axis-btn.dim {
		opacity: 0.45;
	}

	.axis-readout {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}

	.depth-row {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.depth-controls {
		display: flex;
		gap: var(--spacing-xs);
		align-items: center;
	}

	.depth-controls input {
		flex: 1;
		min-width: 0;
	}

	.depth-controls .secondary.small {
		width: auto;
		padding: 4px 8px;
		font-size: var(--font-size-sm);
		white-space: nowrap;
	}

	.hint {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}

	@media (max-width: 480px) {
		.axis-buttons {
			grid-template-columns: repeat(3, 1fr);
		}
	}
</style>
