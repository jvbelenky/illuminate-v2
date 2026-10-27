<script lang="ts">
	// ▸ Display: what the values are (irradiance / fluence rate, or dose with its
	// exposure time), how the zone is drawn, and its label.
	import ValidatedNumberInput from '$lib/components/ValidatedNumberInput.svelte';
	import { MAX_NUMERIC_VOLUME_POINTS } from '$lib/utils/calculations';
	import type { CalcZone, ZoneDisplayMode } from '$lib/types/project';
	import ZoneFold from './ZoneFold.svelte';
	import { valueKind } from './zoneFields';

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

	const MODES: { value: ZoneDisplayMode; label: string }[] = $derived(
		kind === 'volume'
			? [{ value: 'heatmap', label: 'Iso' }, { value: 'numeric', label: 'Numeric' }, { value: 'markers', label: 'Markers' }, { value: 'none', label: 'None' }]
			: [{ value: 'heatmap', label: 'Heatmap' }, { value: 'numeric', label: 'Numeric' }, { value: 'contours', label: 'Contours' }, { value: 'markers', label: 'Markers' }, { value: 'none', label: 'None' }]
	);

	const stored = $derived<ZoneDisplayMode>(zone.display_mode ?? (zone.show_values === false ? 'markers' : 'heatmap'));
	// Contours are a plane view; a volume shows them as isosurfaces
	const mode = $derived(kind === 'volume' && stored === 'contours' ? 'heatmap' : stored);

	// Numeric display is unavailable for a volume with too many points
	const volumePoints = $derived(kind === 'volume' ? (zone.num_x ?? 0) * (zone.num_y ?? 0) * (zone.num_z ?? 0) : 0);
	const numericDisabled = $derived(kind === 'volume' && volumePoints > MAX_NUMERIC_VOLUME_POINTS);

	// A finer grid that rules out Numeric falls back to isosurfaces
	$effect(() => {
		if (numericDisabled && stored === 'numeric') commit({ display_mode: 'heatmap' });
	});

	function setMode(next: ZoneDisplayMode) {
		if (next !== stored) commit({ display_mode: next });
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

	{#if kind !== 'point'}
		<div class="seg" class:seg-five={MODES.length === 5} role="group" aria-label="Display mode">
			{#each MODES as m (m.value)}
				<button
					type="button"
					aria-pressed={mode === m.value}
					disabled={m.value === 'numeric' && numericDisabled}
					title={m.value === 'numeric' && numericDisabled ? `${volumePoints.toLocaleString()} points (max ${MAX_NUMERIC_VOLUME_POINTS.toLocaleString()})` : undefined}
					onclick={() => setMode(m.value)}
				>{m.label}</button>
			{/each}
		</div>
	{/if}

	<!-- The 3D view labels calc points only -->
	{#if kind === 'point'}
		<label class="ep-check">
			<input type="checkbox" checked={zone.show_label ?? false} onchange={(e) => commit({ show_label: e.currentTarget.checked })} />
			<span>Show label</span>
		</label>
	{/if}
</ZoneFold>
