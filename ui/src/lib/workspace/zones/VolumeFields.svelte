<script lang="ts">
	// A volume: Bottom and Top like a structure, Fit to room (the room outline,
	// floor to ceiling) and Draw outline, then Geometry, Grid points and Display.
	import ValidatedNumberInput from '$lib/components/ValidatedNumberInput.svelte';
	import { userSettings } from '$lib/stores/settings';
	import { unitAbbrev, unitStep } from '$lib/utils/unitConversion';
	import { footprintGeometry } from '$lib/utils/zoneFootprint';
	import type { Vertex } from '$lib/utils/roomGeometry';
	import type { CalcZone, RoomConfig } from '$lib/types/project';
	import type { PlanController } from '$lib/plan/planController.svelte';
	import ZoneFold from './ZoneFold.svelte';
	import ZoneGeometry from './ZoneGeometry.svelte';
	import GridPointsFold from './GridPointsFold.svelte';
	import DisplayFold from './DisplayFold.svelte';
	import { fitPartial, rangePartial, shownFootprint } from './zoneFields';

	interface Props {
		zone: CalcZone;
		room: RoomConfig;
		controller: PlanController;
		commit: (partial: Partial<CalcZone>) => void;
	}

	let { zone, room, controller, commit }: Props = $props();
	const ctl = $derived(controller);

	const unit = $derived(unitAbbrev($userSettings.units));
	const step = $derived(unitStep($userSettings.units));
	const bottom = $derived(Math.min(zone.z_min ?? 0, zone.z_max ?? room.z));
	const top = $derived(Math.max(zone.z_min ?? 0, zone.z_max ?? room.z));
	const drawing = $derived(ctl.drawing && ctl.drawKind === 'volume');

	/** A new bottom or top; the two swap rather than cross. */
	function setRange(which: 'bottom' | 'top', v: number) {
		const other = which === 'bottom' ? top : bottom;
		if (v === (which === 'bottom' ? bottom : top)) return;
		commit({ z_min: Math.min(v, other), z_max: Math.max(v, other) });
	}

	const footprint = $derived<Vertex[]>(shownFootprint(zone, room));
</script>

<div class="dims c2">
	<label class="zp-field">
		<span>Bottom ({unit})</span>
		<ValidatedNumberInput id="volume-bottom" value={bottom} precision={room.precision} oncommit={(v) => setRange('bottom', v)} min={0} max={room.z} step={step} />
	</label>
	<label class="zp-field">
		<span>Top ({unit})</span>
		<ValidatedNumberInput id="volume-top" value={top} precision={room.precision} oncommit={(v) => setRange('top', v)} min={0} max={room.z} step={step} />
	</label>
</div>

<div class="plan-actions">
	<label class="zp-switch">
		<span>Fit to room</span>
		<input type="checkbox" role="switch" checked={zone.fit_room ?? false} onchange={(e) => commit(fitPartial(zone, room, e.currentTarget.checked))} />
	</label>
	<button type="button" class="secondary plan-btn" class:active={drawing} aria-pressed={drawing} onclick={() => ctl.startZoneDraw('volume')}>Draw outline</button>
</div>

<ZoneFold label="Geometry">
	<ZoneGeometry
		vertices={footprint}
		axes={['X', 'Y']}
		precision={room.precision}
		{step}
		onRanges={(r) => commit(rangePartial('volume', r))}
		onCorners={(next) => commit({ ...footprintGeometry('volume', next), fit_room: false })}
	/>
</ZoneFold>

<GridPointsFold {zone} {room} {commit} axes={['X', 'Y', 'Z']} />
<DisplayFold {zone} {commit} kind="volume" />
