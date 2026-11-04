<script lang="ts">
	// ▸ Display: what the values are (irradiance / fluence rate, or dose with its
	// exposure time), then per view (2D, 3D) how the zone is drawn and whether its
	// label shows, as lamps split theirs.
	import ValidatedNumberInput from '$lib/components/ValidatedNumberInput.svelte';
	import CalcTypeIllustration from '$lib/components/CalcTypeIllustration.svelte';
	import { MAX_NUMERIC_VOLUME_POINTS } from '$lib/utils/calculations';
	import type { CalcZone, ZoneDisplayMode } from '$lib/types/project';
	import ZoneFold from './ZoneFold.svelte';
	import { valueKind, displayModes, zoneDisplayMode, zoneLabelShown, type ZoneView } from './zoneFields';

	interface Props {
		zone: CalcZone;
		commit: (partial: Partial<CalcZone>) => void;
		kind: 'plane' | 'volume' | 'point';
	}

	let { zone, commit, kind }: Props = $props();
	let open = $state(false);

	const dose = $derived(zone.dose ?? false);
	const hours = $derived(zone.hours ?? 8);
	const minutes = $derived(zone.minutes ?? 0);
	const seconds = $derived(zone.seconds ?? 0);
	// Not a valid exposure; the store holds it back from the backend until it is
	const zeroTime = $derived(hours + minutes + seconds <= 0);

	const VIEWS: ZoneView[] = ['2d', '3d'];
	const MODE_KEY = { '2d': 'display_mode_2d', '3d': 'display_mode' } as const;
	const LABEL_KEY = { '2d': 'show_label_2d', '3d': 'show_label' } as const;

	// Numeric display is unavailable for a volume with too many points
	const volumePoints = $derived(kind === 'volume' ? (zone.num_x ?? 0) * (zone.num_y ?? 0) * (zone.num_z ?? 0) : 0);
	const numericDisabled = $derived(kind === 'volume' && volumePoints > MAX_NUMERIC_VOLUME_POINTS);

	// A finer grid that rules out Numeric falls back to the heatmap (isosurfaces in 3D)
	$effect(() => {
		if (!numericDisabled) return;
		const partial: Partial<CalcZone> = {};
		if (zone.display_mode === 'numeric') partial.display_mode = 'heatmap';
		if (zone.display_mode_2d === 'numeric') partial.display_mode_2d = 'heatmap';
		if (Object.keys(partial).length) commit(partial);
	});

	function setMode(view: ZoneView, next: ZoneDisplayMode) {
		if (next !== zoneDisplayMode(zone, view)) commit({ [MODE_KEY[view]]: next });
	}
</script>

<ZoneFold label="Display" value={valueKind(zone)} bind:open>
	<label class="zp-field">
		<span>Value display</span>
		<select id="value-type" value={dose} onchange={(e) => commit({ dose: e.currentTarget.value === 'true' })}>
			<option value={false}>{valueKind({ ...zone, dose: false }) === 'Fluence rate' ? 'Fluence Rate (µW/cm²)' : 'Irradiance (µW/cm²)'}</option>
			<option value={true}>Dose (mJ/cm²)</option>
		</select>
	</label>

	{#if dose}
		<div class="zp-group">
			<span class="zp-label">Exposure time</span>
			<div class="time-inputs" class:invalid={zeroTime}>
				<label class="time-field">
					<ValidatedNumberInput id="dose-hours" value={hours} oncommit={(v) => { if (v !== hours) commit({ hours: v }); }} min={0} step="any" />
					<span>h</span>
				</label>
				<label class="time-field">
					<ValidatedNumberInput id="dose-minutes" value={minutes} oncommit={(v) => { if (v !== minutes) commit({ minutes: v }); }} min={0} step="any" />
					<span>m</span>
				</label>
				<label class="time-field">
					<ValidatedNumberInput id="dose-seconds" value={seconds} oncommit={(v) => { if (v !== seconds) commit({ seconds: v }); }} min={0} step="any" />
					<span>s</span>
				</label>
			</div>
		</div>
	{/if}

	{#each VIEWS as view (view)}
		{@const VIEW = view.toUpperCase()}
		{@const mode = zoneDisplayMode(zone, view)}
		{@const MODES = kind === 'point' ? [] : displayModes(kind, view)}
		<div class="display-section">
			<span class="display-head">{VIEW}</span>
			{#if MODES.length}
				<div class="glyph-seg" role="group" aria-label="{VIEW} display mode">
					{#each MODES as m (m.value)}
						{@const off = m.value === 'numeric' && numericDisabled}
						<button
							type="button"
							aria-label={m.label}
							aria-pressed={mode === m.value}
							disabled={off}
							title={off ? `${volumePoints.toLocaleString()} points (max ${MAX_NUMERIC_VOLUME_POINTS.toLocaleString()})` : m.title}
							onclick={() => setMode(view, m.value)}
						>
							<CalcTypeIllustration type={m.glyph} size={26} />
							<span>{m.label}</span>
						</button>
					{/each}
				</div>
			{/if}
			<label class="ep-check">
				<input type="checkbox" aria-label="Show label in {VIEW}" checked={zoneLabelShown(zone, view)} onchange={(e) => commit({ [LABEL_KEY[view]]: e.currentTarget.checked })} />
				<span>Show label</span>
			</label>
		</div>
	{/each}
</ZoneFold>
