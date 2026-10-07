<script lang="ts">
	import { Canvas } from '@threlte/core';
	import MountingPicker from './MountingPicker.svelte';
	import FixtureScene from './FixtureScene.svelte';
	import type { IesAnalysisResponse, EmitterOffset } from '$lib/api/contract';
	import {
		HORIZONTAL_AXES, axisForWallSide, isPhotometricAxis, mountingOf, wallSideOf, type Extents
	} from '$lib/utils/photometricAxis';
	import { unitAbbrev, unitFineStep, type LengthUnit } from '$lib/utils/unitConversion';
	import { resolveFixtureView } from '$lib/utils/fixtureView';
	import {
		HOUSING_FACES, FACE_LABELS, centerOffset, frontOffset, mountDistance, nextRoll, offsetAtMountDistance,
		type FixtureDraft
	} from '$lib/utils/housingGeometry';

	interface Props {
		value: FixtureDraft;
		onchange: (next: FixtureDraft) => void;
		analysis: IesAnalysisResponse | null;
		units: LengthUnit;
		fallbackHousing: Extents | null;
		// luminous opening (LM-63 width/length/height, aim frame, display units)
		surface: { width: number; length: number; height?: number } | null;
		color?: string;  // the lamp's wavelength color for the luminous opening and light distribution
	}

	let { value, onchange, analysis, units, fallbackHousing, surface, color }: Props = $props();

	const abbrev = $derived(unitAbbrev(units));
	const step = $derived(unitFineStep(units));

	const view = $derived(resolveFixtureView(value, fallbackHousing, surface, analysis, units));
	const layoutDisplay = $derived(view.layoutDisplay);
	const luminousHeight = $derived(view.luminousHeight);
	// Offset shown in the inputs: the default spot resolved for the current box
	const shownOffset = $derived<EmitterOffset>(value.offset ?? frontOffset(layoutDisplay, luminousHeight));
	// Light center's distance from the mounting surface (LM-63's D1 for a ceiling mount)
	const distance = $derived(mountDistance(layoutDisplay, luminousHeight));
	const surfaceWord = $derived(mountingOf(value.axis));
	const detectedAxis = $derived(isPhotometricAxis(analysis?.suggested_axis) ? analysis?.suggested_axis : null);

	function setMountDistance(e: Event) {
		const d = parse((e.currentTarget as HTMLInputElement).value);
		if (d == null) return;
		onchange({ ...value, offset: offsetAtMountDistance(layoutDisplay, luminousHeight, d) });
	}

	function setWallSide(e: Event) {
		const phi = Number((e.currentTarget as HTMLSelectElement).value);
		if (Number.isFinite(phi)) onchange({ ...value, axis: axisForWallSide(phi) });
	}

	function parse(raw: string): number | undefined {
		if (raw.trim() === '') return undefined;
		const v = Number(raw);
		return Number.isFinite(v) ? v : undefined;
	}

	function setDim(key: 'housingWidth' | 'housingLength' | 'housingHeight', e: Event) {
		const v = parse((e.currentTarget as HTMLInputElement).value);
		if (v != null && v < 0) return;
		onchange({ ...value, [key]: v });
	}

	function setOffset(i: 0 | 1 | 2, e: Event) {
		const v = parse((e.currentTarget as HTMLInputElement).value) ?? 0;
		const offset = [...shownOffset] as EmitterOffset;
		offset[i] = v;
		onchange({ ...value, offset });
	}

	const fmt = (v: number) => String(parseFloat(v.toFixed(4)));
</script>

<div class="fixture-editor">
	<div class="layout">
		<div class="controls">
			<div class="row">
				<span class="row-label">Mounted on</span>
				<MountingPicker {analysis} axis={value.axis} onAxisChange={(axis) => onchange({ ...value, axis })} />
			</div>

			<div class="row" title="Physical housing size; starts as the file's luminous opening, which it must contain">
				<span class="row-label">Housing [{abbrev}]</span>
				<div class="triple">
					{#each [['housingLength', 'L', 'length'], ['housingWidth', 'W', 'width'], ['housingHeight', 'H', 'height']] as [key, label, fb] (key)}
						<label class="field">
							<span>{label}</span>
							<input
								id={`housing-${fb}`}
								type="number"
								min="0"
								{step}
								value={value[key as 'housingWidth'] ?? ''}
								placeholder={fallbackHousing ? fmt(fallbackHousing[fb as keyof Extents]) : '0'}
								onchange={(e) => setDim(key as 'housingWidth', e)}
							/>
						</label>
					{/each}
				</div>
			</div>

			<div class="row" title="Distance from the mounting surface to the photometric center">
				<label class="row-label" for="mount-distance">Light center</label>
				<div class="distance-row">
					<input id="mount-distance" type="number" {step} value={fmt(distance)} onchange={setMountDistance} />
					<span class="unit">{abbrev} from the {surfaceWord}</span>
					<button type="button" class="link offset-center" onclick={() => onchange({ ...value, offset: centerOffset(layoutDisplay) })}>Center in housing</button>
					{#if value.offset != null}
						<button type="button" class="link offset-front" title="Back to the default: luminous opening flush with the front of the housing" onclick={() => onchange({ ...value, offset: null })}>Reset</button>
					{/if}
				</div>
			</div>

			<details class="adjust">
				<summary>Adjust: wall side, mounting face, rotation, sideways offset</summary>
				<div class="adjust-body">
					{#if surfaceWord === 'wall'}
						<div class="row" title="Which side of the IES file's frame faces the wall">
							<label class="row-label" for="wall-side">Wall side</label>
							<select id="wall-side" value={String(wallSideOf(value.axis))} onchange={setWallSide}>
								{#each HORIZONTAL_AXES as a (a)}
									<option value={String(wallSideOf(a))}>{wallSideOf(a)}° side against the wall{a === detectedAxis ? ' (detected)' : ''}</option>
								{/each}
							</select>
						</div>
					{/if}
					<div class="row">
						<span class="row-label">Mounting face</span>
						<div class="faces-block">
							<div class="faces" role="group" aria-label="Housing face against the wall or ceiling">
								{#each HOUSING_FACES as f (f)}
									<button type="button" data-face={f} aria-pressed={value.face === f} onclick={() => onchange({ ...value, face: f })}>
										{FACE_LABELS[f]}
									</button>
								{/each}
							</div>
							<button
								type="button"
								class="secondary small rotate-emitter"
								title="Rotate the housing 90° about the mounting direction"
								onclick={() => onchange({ ...value, roll: nextRoll(value.roll) })}
							>⟳ Rotate fixture ({value.roll}°)</button>
						</div>
					</div>
					<div class="row" title="Light center position from the mounting point (center of the mounting face), along the housing's L / W / H">
						<span class="row-label">Offset [{abbrev}]</span>
						<div class="triple">
							{#each ['x', 'y', 'z'] as axisName, i (axisName)}
								<label class="field">
									<span>{axisName.toUpperCase()}</span>
									<input
										id={`emitter-offset-${axisName}`}
										type="number"
										{step}
										value={fmt(shownOffset[i])}
										onchange={(e) => setOffset(i as 0 | 1 | 2, e)}
									/>
								</label>
							{/each}
						</div>
					</div>
				</div>
			</details>
		</div>

		<div class="fixture-canvas">
			<Canvas>
				<FixtureScene layout={view.layoutMeters} axis={value.axis} surfaceLength={view.surfaceMeters.length} surfaceWidth={view.surfaceMeters.width} surfaceHeight={view.surfaceMeters.height} web={view.web} {color} />
			</Canvas>
			<div class="canvas-hint">{analysis ? 'Drag to rotate' : 'Analyzing photometry…'}</div>
		</div>
	</div>
</div>

<style>
	/* Container query: side by side when the editor has room, stacked otherwise */
	.fixture-editor {
		container-type: inline-size;
	}

	.layout {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--spacing-sm);
	}

	.controls {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
		min-width: 0;
	}

	.row {
		display: grid;
		grid-template-columns: 6.5rem minmax(0, 1fr);
		align-items: start;
		gap: var(--spacing-xs);
	}

	.row-label {
		padding-top: 5px;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		font-weight: 600;
		white-space: nowrap;
	}

	.triple {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--spacing-xs);
	}

	.field {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}

	.field input {
		min-width: 0;
		width: 100%;
	}

	.faces-block {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
		min-width: 0;
	}

	.faces {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 3px;
	}

	.faces button {
		padding: 3px 4px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg-secondary);
		color: var(--color-text);
		font-size: var(--font-size-sm);
		cursor: pointer;
	}

	.faces button[aria-pressed="true"] {
		border-color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 22%, transparent);
		font-weight: 600;
	}

	.secondary.small {
		width: auto;
		padding: 3px 8px;
		font-size: var(--font-size-sm);
		white-space: nowrap;
		align-self: flex-start;
	}

	.distance-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px var(--spacing-sm);
	}

	.distance-row input {
		width: 6rem;
	}

	.unit {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}

	.link {
		padding: 0;
		border: none;
		background: none;
		color: var(--color-accent);
		font-size: var(--font-size-sm);
		cursor: pointer;
		text-decoration: underline;
		width: auto;
	}

	.adjust {
		border-top: 1px solid var(--color-border);
		padding-top: var(--spacing-xs);
	}

	.adjust summary {
		cursor: pointer;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}

	.adjust-body {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
		padding-top: var(--spacing-sm);
	}

	.fixture-canvas {
		position: relative;
		order: -1;
		height: 200px;
		border-radius: var(--radius-md);
		overflow: hidden;
		background: var(--color-bg-secondary);
	}

	.canvas-hint {
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

	@container (min-width: 640px) {
		.layout {
			grid-template-columns: minmax(340px, 400px) minmax(0, 1fr);
			gap: var(--spacing-md);
		}

		.fixture-canvas {
			order: 0;
			height: auto;
			min-height: 280px;
		}
	}
</style>
