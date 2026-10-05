<script lang="ts">
	import { Canvas } from '@threlte/core';
	import PhotometricAxisScene from './PhotometricAxisScene.svelte';
	import type { IesAnalysisResponse } from '$lib/api/contract';
	import { toMeters, unitAbbrev, unitFineStep, type LengthUnit } from '$lib/utils/unitConversion';
	import {
		HORIZONTAL_AXES, AXIS_LABELS, axisGroup, bestHorizontal, fixtureBoundsLocal, centeredDepth,
		isPhotometricAxis, type AxisGroup, type PhotometricAxis
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

	// The user picks how the fixture is mounted; the four horizontal IES
	// azimuths collapse into one "sideways" choice, with the file's strongest
	// side chosen automatically and a secondary select to override it.
	const GROUPS: { id: AxisGroup; title: string; caption: string }[] = [
		{ id: 'down', title: 'Down', caption: 'Ceiling or pendant mount, shines down' },
		{ id: 'up', title: 'Up', caption: 'Shines at the ceiling' },
		{ id: 'sideways', title: 'Sideways', caption: 'Wall-mounted, shines across the room' },
	];

	const scores = $derived<Record<string, number>>(analysis?.axis_scores ?? {});
	const group = $derived(axisGroup(axis));
	const suggestedGroup = $derived.by(() => {
		const s = analysis?.suggested_axis;
		return isPhotometricAxis(s) ? axisGroup(s) : null;
	});

	function pickGroup(g: AxisGroup) {
		if (g === 'sideways') onAxisChange(group === 'sideways' ? axis : bestHorizontal(scores));
		else onAxisChange(g);
	}

	function handleAzimuthChange(e: Event) {
		const v = (e.currentTarget as HTMLSelectElement).value;
		if (isPhotometricAxis(v)) onAxisChange(v);
	}

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
	<div class="group-buttons" role="group" aria-label="Which way does this fixture shine?">
		{#each GROUPS as g (g.id)}
			<button
				type="button"
				class="axis-btn"
				data-group={g.id}
				aria-pressed={g.id === group}
				onclick={() => pickGroup(g.id)}
			>
				<span class="group-title">{g.title}</span>
				<span class="group-caption">{g.caption}</span>
				{#if g.id === suggestedGroup}
					<span class="detected">Detected from file</span>
				{/if}
			</button>
		{/each}
	</div>

	{#if group === 'sideways'}
		<div class="azimuth-row">
			<label for="beam-azimuth">Beam side in file</label>
			<select id="beam-azimuth" value={axis} onchange={handleAzimuthChange}>
				{#each HORIZONTAL_AXES as a (a)}
					<option value={a}>{AXIS_LABELS[a]} ({Math.round((scores[a] ?? 0) * 100)}% of power)</option>
				{/each}
			</select>
		</div>
	{/if}

	<div class="axis-canvas">
		{#if analysis}
			<Canvas>
				<PhotometricAxisScene
					vertices={analysis.vertices}
					triangles={analysis.triangles}
					{axis}
					{fixtureBounds}
				/>
			</Canvas>
			<div class="canvas-hint">Preview as mounted: light should leave the open face of the housing. Drag to rotate.</div>
		{:else}
			<div class="canvas-placeholder">Analyzing photometry…</div>
		{/if}
	</div>

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
			<button
				type="button"
				class="secondary small depth-centered"
				disabled={!canCenter}
				title={canCenter ? 'Half the housing height' : 'Needs a housing height'}
				onclick={() => onDepthChange(centeredDepth(housingHeight ?? 0))}
			>Centered</button>
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

	.group-buttons {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: var(--spacing-xs);
	}

	.axis-btn {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		padding: 6px 8px;
		text-align: left;
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

	.group-title {
		font-weight: 600;
	}

	.group-caption {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		line-height: 1.25;
	}

	.detected {
		margin-top: 2px;
		padding: 1px 6px;
		font-size: var(--font-size-sm);
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-primary) 22%, transparent);
		color: var(--color-text);
	}

	.azimuth-row {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
	}

	.azimuth-row label {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	.azimuth-row select {
		flex: 1;
		min-width: 0;
	}

	.axis-canvas {
		position: relative;
		height: 200px;
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
		.group-buttons {
			grid-template-columns: 1fr;
		}
	}
</style>
