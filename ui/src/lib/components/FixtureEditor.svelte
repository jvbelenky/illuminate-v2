<script lang="ts">
	import { Canvas } from '@threlte/core';
	import MountingPicker from './MountingPicker.svelte';
	import FixtureScene from './FixtureScene.svelte';
	import type { IesAnalysisResponse, EmitterOffset } from '$lib/api/contract';
	import {
		HORIZONTAL_AXES, isPhotometricAxis, mountingOf
	} from '$lib/utils/photometricAxis';
	import {
		LENGTH_UNITS, convertLength, unitAbbrev, unitFineStep, type LengthUnit
	} from '$lib/utils/unitConversion';
	import { resolveFixtureView } from '$lib/utils/fixtureView';
	import {
		HOUSING_FACES, HOUSING_ROLLS, FACE_LABELS, aimAxisOf, faceNormal, frontOffset, mountDistance,
		offsetAtMountDistance, type FixtureDraft
	} from '$lib/utils/housingGeometry';

	interface Props {
		value: FixtureDraft;           // lengths in `units`
		onchange: (next: FixtureDraft) => void;
		analysis: IesAnalysisResponse | null;
		units: LengthUnit;             // units the draft is stored in
		color?: string;                // lamp's wavelength color for the light
		showPreview?: boolean;         // false when the host shows the 3D preview itself
	}

	let { value, onchange, analysis, units, color, showPreview = true }: Props = $props();

	// Units the values are shown and typed in; edits convert back to `units`.
	// A view preference, not a copy of the draft.
	let shownUnits = $state<LengthUnit | null>(null);
	const displayUnits = $derived<LengthUnit>(shownUnits ?? units);
	const toShown = (v: number) => convertLength(v, units, displayUnits);
	const fromShown = (v: number) => convertLength(v, displayUnits, units);

	const step = $derived(unitFineStep(displayUnits));

	const view = $derived(resolveFixtureView(value, analysis, units));
	const layout = $derived(view.layoutDisplay);
	// Photometric center position from the mounting point, resolved for the current box
	const shownOffset = $derived<EmitterOffset>(value.offset ?? frontOffset(layout, view.luminousHeight));
	const distance = $derived(mountDistance(layout, view.luminousHeight));
	const normal = $derived(faceNormal(value.face));
	// the housing axis along the mounting direction holds the distance out from
	// the mount; the other two hold the sideways offset along the mounting surface
	const outAxis = $derived(([0, 1, 2] as const).find((i) => normal[i] !== 0) ?? 2);

	const AXIS_IDS = ['x', 'y', 'z'] as const;
	const AXIS_LETTERS = ['L', 'W', 'H'] as const;

	const fmt = (v: number) => String(parseFloat(v.toFixed(4)));
	const shown = (v: number | undefined) => (v == null ? '' : fmt(toShown(v)));

	function parse(raw: string): number | undefined {
		if (raw.trim() === '') return undefined;
		const v = Number(raw);
		return Number.isFinite(v) ? v : undefined;
	}

	type DimKey = 'housingLength' | 'housingWidth' | 'housingHeight' | 'surfaceLength' | 'surfaceWidth' | 'surfaceHeight';

	function setDim(key: DimKey, e: Event) {
		const v = parse((e.currentTarget as HTMLInputElement).value);
		if (v != null && v < 0) return;
		onchange({ ...value, [key]: v == null ? undefined : fromShown(v) });
	}

	function setMountDistance(e: Event) {
		const d = parse((e.currentTarget as HTMLInputElement).value);
		if (d == null) return;
		onchange({ ...value, offset: offsetAtMountDistance(layout, view.luminousHeight, fromShown(d)) });
	}

	function setSideways(i: 0 | 1 | 2, e: Event) {
		const v = parse((e.currentTarget as HTMLInputElement).value) ?? 0;
		const offset = [...shownOffset] as EmitterOffset;
		offset[i] = fromShown(v);
		onchange({ ...value, offset });
	}

	function setRoomDirection(e: Event) {
		const axis = (e.currentTarget as HTMLSelectElement).value;
		if (isPhotometricAxis(axis)) onchange({ ...value, axis });
	}

	// The opening is stored in the aim frame (as the IES file and the API have it)
	// but shown along the housing's L / W / H so the two rows line up.
	const AIM_KEYS = ['surfaceLength', 'surfaceWidth', 'surfaceHeight'] as const;
	const DIMS = ['length', 'width', 'height'] as const;
	const openingFields = $derived(
		([0, 1, 2] as const).map((i) => {
			const j = aimAxisOf(value.face, value.roll, i);
			return { key: AIM_KEYS[j] as DimKey, label: AXIS_LETTERS[i], id: DIMS[i], fileValue: view.luminousFromFile[DIMS[j]] };
		})
	);
	const HOUSING_FIELDS: [DimKey, string, 'length' | 'width' | 'height'][] = [
		['housingLength', 'L', 'length'], ['housingWidth', 'W', 'width'], ['housingHeight', 'H', 'height'],
	];
</script>

<div class="fixture-editor">
	<div class="layout" class:no-preview={!showPreview}>
		<div class="controls">
			<div class="row">
				<span class="row-label">Mounted on</span>
				<MountingPicker {analysis} axis={value.axis} onAxisChange={(axis) => onchange({ ...value, axis })} />
			</div>

			{#if mountingOf(value.axis) === 'wall'}
				<div class="row" title="Which horizontal angle (C-plane) of the IES photometry points away from the wall, into the room">
					<label class="row-label" for="room-direction">Into the room</label>
					<select id="room-direction" value={value.axis} onchange={setRoomDirection}>
						{#each HORIZONTAL_AXES as a (a)}
							<option value={a}>{a.split('_')[1]}° horizontal angle</option>
						{/each}
					</select>
				</div>
			{/if}

			<div class="row" title="Which face of the housing sits against the wall or ceiling">
				<span class="row-label">Mounted by its</span>
				<div class="seg seg-3" role="group" aria-label="Housing face against the wall or ceiling">
					{#each HOUSING_FACES as f (f)}
						<button type="button" data-face={f} aria-pressed={value.face === f} onclick={() => onchange({ ...value, face: f })}>
							{FACE_LABELS[f]}
						</button>
					{/each}
				</div>
			</div>

			<div class="row" title="Turn of the housing about the mounting direction">
				<span class="row-label">Rotation</span>
				<div class="seg seg-4" role="group" aria-label="Housing rotation">
					{#each HOUSING_ROLLS as r (r)}
						<button type="button" data-roll={r} aria-pressed={value.roll === r} onclick={() => onchange({ ...value, roll: r })}>{r}°</button>
					{/each}
				</div>
			</div>

			<!-- one L / W / H grid for the opening, the housing and the offset -->
			<div class="dims">
				<span class="units-cell">
					<label class="row-label" for="fixture-units">Units</label>
					<select id="fixture-units" value={displayUnits} onchange={(e) => (shownUnits = (e.currentTarget as HTMLSelectElement).value as LengthUnit)}>
						{#each LENGTH_UNITS as u (u)}
							<option value={u}>{unitAbbrev(u)}</option>
						{/each}
					</select>
				</span>
				{#each AXIS_LETTERS as l (l)}
					<span class="axis-head">{l}</span>
				{/each}

				<span class="row-label" title="Light-emitting opening (IES LM-63 length / width / height); the housing must be at least this large">Luminous opening</span>
				{#each openingFields as f (f.id)}
					<input
						id={`surface-${f.id}`}
						type="number"
						min="0"
						{step}
						aria-label={`Luminous opening ${f.label}`}
						value={shown(value[f.key])}
						placeholder={fmt(toShown(f.fileValue))}
						onchange={(e) => setDim(f.key, e)}
					/>
				{/each}

				<span class="row-label" title="Physical housing size; starts as the luminous opening">Luminaire housing</span>
				{#each HOUSING_FIELDS as [key, label, dim] (key)}
					<input
						id={`housing-${dim}`}
						type="number"
						min="0"
						{step}
						aria-label={`Luminaire housing ${label}`}
						value={shown(value[key])}
						placeholder={fmt(toShown(view.fallbackHousing[dim]))}
						onchange={(e) => setDim(key, e)}
					/>
				{/each}

				<span class="row-label" title="Where the photometric center sits relative to the mounting point (the center of the mounted side)">Offset from mounting point</span>
				{#each [0, 1, 2] as const as i (i)}
					{#if i === outAxis}
						<input id="mount-distance" type="number" {step} aria-label={`Offset ${AXIS_LETTERS[i]}, out from the mount`} value={fmt(toShown(distance))} onchange={setMountDistance} />
					{:else}
						<input
							id={`emitter-offset-${AXIS_IDS[i]}`}
							type="number"
							{step}
							aria-label={`Offset ${AXIS_LETTERS[i]}`}
							value={fmt(toShown(shownOffset[i]))}
							onchange={(e) => setSideways(i, e)}
						/>
					{/if}
				{/each}
			</div>
		</div>

		{#if showPreview}
		<div class="fixture-canvas">
			<Canvas>
				<FixtureScene layout={view.layoutMeters} axis={value.axis} surfaceLength={view.surfaceMeters.length} surfaceWidth={view.surfaceMeters.width} surfaceHeight={view.surfaceMeters.height} web={view.web} {color} />
			</Canvas>
			{#if !analysis}
				<div class="canvas-hint">Analyzing photometry…</div>
			{/if}
		</div>
		{/if}
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
		grid-template-columns: 12rem minmax(0, 1fr);
		align-items: center;
		gap: var(--spacing-sm);
	}

	.row-label {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		font-weight: 600;
		line-height: 1.25;
		white-space: nowrap;
	}

	/* segmented buttons, equal widths, shared borders */
	.seg {
		display: grid;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}

	.seg-3 {
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}

	.seg-4 {
		grid-template-columns: repeat(4, minmax(0, 1fr));
	}

	.seg button {
		padding: 4px 6px;
		border: 0;
		border-radius: 0;
		background: var(--color-bg-secondary);
		color: var(--color-text);
		font-size: var(--font-size-sm);
		cursor: pointer;
	}

	.seg-3 button:not(:nth-child(3n + 1)),
	.seg-4 button:not(:first-child) {
		border-left: 1px solid var(--color-border);
	}

	.seg-3 button:nth-child(n + 4) {
		border-top: 1px solid var(--color-border);
	}

	.seg button[aria-pressed="true"] {
		background: color-mix(in srgb, var(--color-accent) 22%, transparent);
		font-weight: 600;
	}

	.dims {
		display: grid;
		grid-template-columns: 12rem repeat(3, minmax(0, 1fr));
		align-items: center;
		gap: var(--spacing-xs) var(--spacing-sm);
	}

	.dims input {
		min-width: 0;
		width: 100%;
		text-align: center;
	}

	.units-cell {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
	}

	#fixture-units {
		width: auto;
		font-size: var(--font-size-sm);
	}

	.axis-head {
		text-align: center;
		font-size: var(--font-size-sm);
		font-weight: 600;
		color: var(--color-text-muted);
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
		.layout.no-preview {
			grid-template-columns: minmax(0, 1fr);
		}

		.layout {
			grid-template-columns: minmax(360px, 430px) minmax(0, 1fr);
			gap: var(--spacing-md);
		}

		.fixture-canvas {
			order: 0;
			height: auto;
			min-height: 280px;
		}
	}
</style>
