<script lang="ts">
	import { Canvas } from '@threlte/core';
	import PhotometricAxisPicker from './PhotometricAxisPicker.svelte';
	import FixtureScene from './FixtureScene.svelte';
	import type { IesAnalysisResponse, EmitterOffset } from '$lib/api/contract';
	import type { Extents } from '$lib/utils/photometricAxis';
	import { toMeters, unitAbbrev, unitFineStep, type LengthUnit } from '$lib/utils/unitConversion';
	import {
		HOUSING_FACES, FACE_LABELS, centerOffset, nextRoll, photometricDepthOf,
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
	const layoutMeters = $derived<HousingLayout>({
		length: toMeters(dims.length, units), width: toMeters(dims.width, units), height: toMeters(dims.height, units),
		face: value.face, roll: value.roll,
		offset: value.offset.map((v) => toMeters(v, units)) as EmitterOffset,
	});
	const surfaceMeters = $derived({
		length: surface ? toMeters(surface.length, units) : (analysis?.extents_by_axis[value.axis]?.length ?? 0),
		width: surface ? toMeters(surface.width, units) : (analysis?.extents_by_axis[value.axis]?.width ?? 0),
	});
	const web = $derived(analysis ? { vertices: analysis.vertices, triangles: analysis.triangles } : null);
	const depth = $derived(photometricDepthOf(value.face, value.offset));

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
		const offset = [...value.offset] as EmitterOffset;
		offset[i] = v;
		onchange({ ...value, offset });
	}

	const fmt = (v: number) => String(parseFloat(v.toFixed(4)));
</script>

<div class="fixture-editor">
	<section>
		<h4>Beam direction in file</h4>
		<PhotometricAxisPicker {analysis} axis={value.axis} onAxisChange={(axis) => onchange({ ...value, axis })} />
	</section>

	<section>
		<h4>Housing [{abbrev}]</h4>
		<div class="row-3">
			{#each [['housingLength', 'Length (L)', 'length'], ['housingWidth', 'Width (W)', 'width'], ['housingHeight', 'Height (H)', 'height']] as [key, label, fb] (key)}
				<label>
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
	</section>

	<section>
		<h4>Beam leaves through</h4>
		<div class="faces" role="group" aria-label="Housing face the beam leaves through">
			{#each HOUSING_FACES as f (f)}
				<button type="button" data-face={f} aria-pressed={value.face === f} onclick={() => onchange({ ...value, face: f })}>
					{FACE_LABELS[f]}
				</button>
			{/each}
		</div>
		<button type="button" class="secondary small rotate-emitter" onclick={() => onchange({ ...value, roll: nextRoll(value.roll) })}>
			Rotate emitter 90° (now {value.roll}°)
		</button>
	</section>

	<section>
		<h4>Emitter position [{abbrev}]</h4>
		<div class="row-3">
			{#each ['x', 'y', 'z'] as axisName, i (axisName)}
				<label>
					<span>{axisName.toUpperCase()} ({['L', 'W', 'H'][i]})</span>
					<input
						id={`emitter-offset-${axisName}`}
						type="number"
						{step}
						value={value.offset[i]}
						onchange={(e) => setOffset(i as 0 | 1 | 2, e)}
					/>
				</label>
			{/each}
		</div>
		<div class="snap">
			<button type="button" class="secondary small offset-flush" onclick={() => onchange({ ...value, offset: [0, 0, 0] })}>Flush with face</button>
			<button type="button" class="secondary small offset-center" onclick={() => onchange({ ...value, offset: centerOffset(layoutDisplay) })}>Center of housing</button>
		</div>
		<span class="hint">
			Measured from the center of the {FACE_LABELS[value.face].toLowerCase()} face along the housing's L / W / H.
			{#if depth > 0}Recessed {fmt(depth)} {abbrev}.{:else if depth < 0}Protrudes {fmt(-depth)} {abbrev}.{/if}
		</span>
	</section>

	<div class="fixture-canvas">
		<Canvas>
			<FixtureScene layout={layoutMeters} axis={value.axis} surfaceLength={surfaceMeters.length} surfaceWidth={surfaceMeters.width} {web} />
		</Canvas>
		<div class="canvas-hint">{analysis ? 'Housing upright; drag to rotate.' : 'Analyzing photometry…'}</div>
	</div>
</div>

<style>
	.fixture-editor { display: flex; flex-direction: column; gap: var(--spacing-md); }
	section { display: flex; flex-direction: column; gap: var(--spacing-xs); }
	h4 { margin: 0; font-size: var(--font-size-sm); color: var(--color-text-muted); font-weight: 600; }
	.row-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--spacing-xs); }
	.row-3 label { display: flex; flex-direction: column; gap: 2px; font-size: var(--font-size-sm); }
	.row-3 input { min-width: 0; }
	.faces { display: grid; grid-template-columns: repeat(6, 1fr); gap: var(--spacing-xs); }
	.faces button {
		padding: 4px 6px; border: 1px solid var(--color-border); border-radius: var(--radius-sm);
		background: var(--color-bg-secondary); color: var(--color-text); cursor: pointer;
	}
	.faces button[aria-pressed="true"] {
		border-color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 18%, transparent);
	}
	.snap { display: flex; gap: var(--spacing-xs); }
	.secondary.small { width: auto; padding: 4px 8px; font-size: var(--font-size-sm); white-space: nowrap; align-self: flex-start; }
	.hint { font-size: var(--font-size-sm); color: var(--color-text-muted); }
	.fixture-canvas { position: relative; height: 260px; border-radius: var(--radius-md); overflow: hidden; background: var(--color-bg-secondary); }
	.canvas-hint { position: absolute; left: 0; right: 0; bottom: 0; padding: 4px 8px; font-size: var(--font-size-sm); color: var(--color-text-muted); text-align: center; pointer-events: none; }
	@media (max-width: 480px) {
		.faces { grid-template-columns: repeat(3, 1fr); }
	}
</style>
