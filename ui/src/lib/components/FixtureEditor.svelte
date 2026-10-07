<script lang="ts">
	import { Canvas } from '@threlte/core';
	import MountingPicker from './MountingPicker.svelte';
	import FixtureScene from './FixtureScene.svelte';
	import type { IesAnalysisResponse, EmitterOffset } from '$lib/api/contract';
	import type { Extents } from '$lib/utils/photometricAxis';
	import { toMeters, unitAbbrev, unitFineStep, type LengthUnit } from '$lib/utils/unitConversion';
	import {
		HOUSING_FACES, FACE_LABELS, centerOffset, frontOffset, nextRoll, photometricDepthOf,
		type FixtureDraft, type HousingLayout
	} from '$lib/utils/housingGeometry';

	interface Props {
		value: FixtureDraft;
		onchange: (next: FixtureDraft) => void;
		analysis: IesAnalysisResponse | null;
		units: LengthUnit;
		fallbackHousing: Extents | null;
		surface: { width: number; length: number } | null;
	}

	let { value, onchange, analysis, units, fallbackHousing, surface }: Props = $props();

	const abbrev = $derived(unitAbbrev(units));
	const step = $derived(unitFineStep(units));

	// Effective dims (display units): typed value, else the fallback, else 0
	const dims = $derived({
		length: value.housingLength ?? fallbackHousing?.length ?? 0,
		width: value.housingWidth ?? fallbackHousing?.width ?? 0,
		height: value.housingHeight ?? fallbackHousing?.height ?? 0,
	});

	const layoutDisplay = $derived<HousingLayout>({ ...dims, face: value.face, roll: value.roll, offset: value.offset });
	// Offset shown in the inputs: the default (front face) resolved for the current box
	const shownOffset = $derived<EmitterOffset>(value.offset ?? frontOffset(layoutDisplay));
	const layoutMeters = $derived<HousingLayout>({
		length: toMeters(dims.length, units), width: toMeters(dims.width, units), height: toMeters(dims.height, units),
		face: value.face, roll: value.roll,
		offset: value.offset ? (value.offset.map((v) => toMeters(v, units)) as EmitterOffset) : null,
	});
	const surfaceMeters = $derived({
		length: surface ? toMeters(surface.length, units) : (analysis?.extents_by_axis[value.axis]?.length ?? 0),
		width: surface ? toMeters(surface.width, units) : (analysis?.extents_by_axis[value.axis]?.width ?? 0),
	});
	const web = $derived(analysis ? { vertices: analysis.vertices, triangles: analysis.triangles } : null);
	const depth = $derived(photometricDepthOf(layoutDisplay));

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

			<div class="row">
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

			<div class="row">
				<span class="row-label">Emitter [{abbrev}]</span>
				<div class="emitter-block">
					<div class="triple">
						{#each ['x', 'y', 'z'] as axisName, i (axisName)}
							<label class="field" title={`From the mounting point along the housing ${['length', 'width', 'height'][i]}`}>
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
					<div class="snap">
						<button type="button" class="secondary small offset-front" onclick={() => onchange({ ...value, offset: null })}>Front face</button>
						<button type="button" class="secondary small offset-center" onclick={() => onchange({ ...value, offset: centerOffset(layoutDisplay) })}>Center</button>
						<span class="hint">
							From the mounting point (center of the {FACE_LABELS[value.face].toLowerCase()} face).
							{#if value.offset == null}On the front face.{:else if depth > 0}Recessed {fmt(depth)} {abbrev}.{:else if depth < 0}Protrudes {fmt(-depth)} {abbrev}.{:else}On the front face.{/if}
						</span>
					</div>
				</div>
			</div>
		</div>

		<div class="fixture-canvas">
			<Canvas>
				<FixtureScene layout={layoutMeters} axis={value.axis} surfaceLength={surfaceMeters.length} surfaceWidth={surfaceMeters.width} {web} />
			</Canvas>
			<div class="canvas-hint">{analysis ? 'Mounting surface shaded; drag to rotate.' : 'Analyzing photometry…'}</div>
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

	.faces-block,
	.emitter-block {
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

	.snap {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--spacing-xs);
	}

	.secondary.small {
		width: auto;
		padding: 3px 8px;
		font-size: var(--font-size-sm);
		white-space: nowrap;
		align-self: flex-start;
	}

	.hint {
		flex: 1 1 10rem;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		line-height: 1.3;
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
