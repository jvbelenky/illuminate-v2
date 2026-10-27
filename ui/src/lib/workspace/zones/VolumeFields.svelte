<script lang="ts">
	// A volume: Bottom and Top like a structure, Draw on floor and Fit to room
	// (Fit fills the room floor to ceiling), then Geometry, Grid points and Display.
	import ValidatedNumberInput from '$lib/components/ValidatedNumberInput.svelte';
	import ShapeGeometryFields from '$lib/workspace/parts/ShapeGeometryFields.svelte';
	import type { ReferenceMode } from '$lib/workspace/parts/shapeGeometry';
	import { userSettings } from '$lib/stores/settings';
	import { unitAbbrev, unitStep } from '$lib/utils/unitConversion';
	import { footprintGeometry, roomFillGeometry, roomFootprint, zoneFootprint } from '$lib/utils/zoneFootprint';
	import type { Vertex } from '$lib/utils/roomGeometry';
	import type { CalcZone, RoomConfig } from '$lib/types/project';
	import type { PlanController } from '$lib/plan/planController.svelte';
	import ZoneFold from './ZoneFold.svelte';
	import GridPointsFold from './GridPointsFold.svelte';
	import DisplayFold from './DisplayFold.svelte';

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

	let reference = $state<ReferenceMode>('centre');
	const footprint = $derived<Vertex[]>(
		!(zone.vertices && zone.vertices.length >= 3) && zone.x_min == null && zone.fit_room ? roomFootprint(room) : zoneFootprint(zone)
	);
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
	<button type="button" class="secondary plan-btn" class:active={drawing} aria-pressed={drawing} onclick={() => ctl.startZoneDraw('volume')}>Draw on floor</button>
	<button type="button" class="secondary plan-btn" onclick={() => commit({ fit_room: true, ...roomFillGeometry('volume', room), z_min: 0, z_max: room.z })}>Fit to room</button>
</div>

<ZoneFold label="Geometry">
	<ShapeGeometryFields
		vertices={footprint}
		yaw={0}
		{reference}
		units={$userSettings.units}
		onChange={(next) => commit({ ...footprintGeometry('volume', next), fit_room: false })}
		onReferenceChange={(m) => (reference = m)}
		rotatable={false}
	/>
</ZoneFold>

<GridPointsFold {zone} {room} {commit} axes={['X', 'Y', 'Z']} />
<DisplayFold {zone} {commit} kind="volume" />
