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
		HOUSING_FACES, FACE_LABELS, aimAxisOf, centerOffset, faceNormal, frontOffset, mountDistance, nextRoll,
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

	const abbrev = $derived(unitAbbrev(displayUnits));
	const step = $derived(unitFineStep(displayUnits));

	const view = $derived(resolveFixtureView(value, analysis, units));
	const layout = $derived(view.layoutDisplay);
	// Photometric center position from the mounting point, resolved for the current box
	const shownOffset = $derived<EmitterOffset>(value.offset ?? frontOffset(layout, view.luminousHeight));
	const distance = $derived(mountDistance(layout, view.luminousHeight));
	const normal = $derived(faceNormal(value.face));
	// the two housing axes along the mounting surface carry the sideways offset
	const sidewaysAxes = $derived([0, 1, 2].filter((i) => normal[i] === 0) as (0 | 1 | 2)[]);
	const detectedAxis = $derived(isPhotometricAxis(analysis?.suggested_axis) ? analysis?.suggested_axis : null);

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
				<div class="mount-row">
					<MountingPicker {analysis} axis={value.axis} onAxisChange={(axis) => onchange({ ...value, axis })} />
					<select id="fixture-units" aria-label="Units for fixture dimensions" value={displayUnits} onchange={(e) => (shownUnits = (e.currentTarget as HTMLSelectElement).value as LengthUnit)}>
						{#each LENGTH_UNITS as u (u)}
							<option value={u}>{unitAbbrev(u)}</option>
						{/each}
					</select>
				</div>
			</div>

			<div class="row" title="Light-emitting opening (IES LM-63 length / width / height); the housing must be at least this large">
				<span class="row-label">Luminous opening</span>
				<div class="triple">
					{#each openingFields as f (f.id)}
						<label class="field">
							<span>{f.label}</span>
							<input
								id={`surface-${f.id}`}
								type="number"
								min="0"
								{step}
								value={shown(value[f.key])}
								placeholder={fmt(toShown(f.fileValue))}
								onchange={(e) => setDim(f.key, e)}
							/>
						</label>
					{/each}
				</div>
			</div>

			<div class="row" title="Physical housing size; starts as the luminous opening">
				<span class="row-label">Luminaire housing</span>
				<div class="triple">
					{#each HOUSING_FIELDS as [key, label, dim] (key)}
						<label class="field">
							<span>{label}</span>
							<input
								id={`housing-${dim}`}
								type="number"
								min="0"
								{step}
								value={shown(value[key])}
								placeholder={fmt(toShown(view.fallbackHousing[dim]))}
								onchange={(e) => setDim(key, e)}
							/>
						</label>
					{/each}
				</div>
			</div>

			<details class="adjust">
				<summary>Advanced</summary>
				<div class="adjust-body">
					{#if mountingOf(value.axis) === 'wall'}
						<div class="row" title="Which horizontal angle (C-plane) of the IES photometry points away from the wall, into the room">
							<label class="row-label" for="room-direction">Into the room</label>
							<select id="room-direction" value={value.axis} onchange={setRoomDirection}>
								{#each HORIZONTAL_AXES as a (a)}
									<option value={a}>{a.split('_')[1]}° horizontal angle{a === detectedAxis ? ' (detected)' : ''}</option>
								{/each}
							</select>
						</div>
					{/if}
					<div class="row" title="Which face of the housing sits against the wall or ceiling">
						<span class="row-label">Mounted by its</span>
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
								class="small-btn rotate-emitter"
								title="Rotate the housing 90° about the mounting direction"
								onclick={() => onchange({ ...value, roll: nextRoll(value.roll) })}
							>⟳ Rotate housing 90° (now {value.roll}°)</button>
						</div>
					</div>
					<div class="row" title="Where the photometric center sits relative to the mounting point (the center of the mounted side)">
						<span class="row-label">Offset from mounting point</span>
						<div class="offset-block">
							<div class="distance-row">
								<label class="field" title="Distance straight out from the mounting surface">
									<span>Out</span>
									<input id="mount-distance" type="number" {step} value={fmt(toShown(distance))} onchange={setMountDistance} />
								</label>
								<span class="unit">{abbrev} from mounting point</span>
							</div>
							<div class="pair" title="Shift along the mounting surface">
								{#each sidewaysAxes as i (i)}
									<label class="field">
										<span>{AXIS_LETTERS[i]}</span>
										<input
											id={`emitter-offset-${AXIS_IDS[i]}`}
											type="number"
											{step}
											value={fmt(toShown(shownOffset[i]))}
											onchange={(e) => setSideways(i, e)}
										/>
									</label>
								{/each}
							</div>
							<span class="snap">
								<button type="button" class="small-btn offset-center" onclick={() => onchange({ ...value, offset: centerOffset(layout) })}>Center in housing</button>
								{#if value.offset != null}
									<button type="button" class="small-btn offset-front" title="Back to the default: luminous opening flush with the front of the housing" onclick={() => onchange({ ...value, offset: null })}>Reset</button>
								{/if}
							</span>
						</div>
					</div>
				</div>
			</details>
		</div>

		{#if showPreview}
		<div class="fixture-canvas">
			<Canvas>
				<FixtureScene layout={view.layoutMeters} axis={value.axis} surfaceLength={view.surfaceMeters.length} surfaceWidth={view.surfaceMeters.width} surfaceHeight={view.surfaceMeters.height} web={view.web} {color} />
			</Canvas>
			<div class="canvas-hint">{analysis ? 'Drag to rotate' : 'Analyzing photometry…'}</div>
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
		grid-template-columns: 8.5rem minmax(0, 1fr);
		align-items: start;
		gap: var(--spacing-xs);
	}

	.row-label {
		padding-top: 5px;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		font-weight: 600;
		line-height: 1.25;
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

	.distance-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px var(--spacing-sm);
	}

	.distance-row .field input {
		width: 6rem;
	}

	.offset-block {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
		min-width: 0;
	}

	.mount-row {
		display: flex;
		gap: var(--spacing-xs);
		min-width: 0;
	}

	.mount-row :global(.mounting-picker) {
		flex: 1;
	}

	#fixture-units {
		width: auto;
		font-size: var(--font-size-sm);
	}

	.pair {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--spacing-xs);
	}

	.snap {
		display: inline-flex;
		gap: 4px;
	}

	/* compact, quiet buttons for snaps and rotation */
	.small-btn {
		width: auto;
		padding: 3px 10px;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		background: var(--color-bg-secondary);
		color: var(--color-text);
		font-size: var(--font-size-sm);
		white-space: nowrap;
		cursor: pointer;
		align-self: flex-start;
	}

	.small-btn:hover {
		border-color: var(--color-accent);
	}

	.unit {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
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
