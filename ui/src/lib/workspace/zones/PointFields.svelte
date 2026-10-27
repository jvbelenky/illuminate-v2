<script lang="ts">
	// A point: Position and Aim at (X / Y / Z each), Place and Aim picks, then
	// Display and Advanced (the custom flags and field of view).
	import ValidatedNumberInput from '$lib/components/ValidatedNumberInput.svelte';
	import { userSettings } from '$lib/stores/settings';
	import { pickMode } from '$lib/stores/pickMode';
	import { unitAbbrev, unitStep } from '$lib/utils/unitConversion';
	import type { CalcZone, RoomConfig } from '$lib/types/project';
	import ZoneFold from './ZoneFold.svelte';
	import DisplayFold from './DisplayFold.svelte';
	import { togglePick } from './zonePick';

	interface Props {
		zone: CalcZone;
		room: RoomConfig;
		commit: (partial: Partial<CalcZone>) => void;
	}

	let { zone, room, commit }: Props = $props();

	const unit = $derived(unitAbbrev($userSettings.units));
	const step = $derived(unitStep($userSettings.units));
	const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

	const position = $derived<[number, number, number]>([r6(zone.x ?? room.x / 2), r6(zone.y ?? room.y / 2), r6(zone.z ?? 1)]);
	const aim = $derived<[number, number, number]>([r6(zone.aim_x ?? room.x / 2), r6(zone.aim_y ?? room.y / 2), r6(zone.aim_z ?? 2)]);
	const POSITION_KEYS = ['x', 'y', 'z'] as const;
	const AIM_KEYS = ['aim_x', 'aim_y', 'aim_z'] as const;
	const AXES = ['X', 'Y', 'Z'];
	const bounds = $derived([room.x, room.y, room.z]);

	function set(key: keyof CalcZone, current: number, v: number) {
		if (v !== current) commit({ [key]: v });
	}
</script>

<div class="zp-group" role="group" aria-label="Position ({unit})">
	<span class="zp-label">Position ({unit})</span>
	<div class="dims c3">
		{#each AXES as axis, i (axis)}
			<label class="zp-field"><span>{axis}</span><ValidatedNumberInput value={position[i]} precision={room.precision} oncommit={(v) => set(POSITION_KEYS[i], position[i], v)} min={0} max={bounds[i]} step={step} /></label>
		{/each}
	</div>
</div>

<div class="zp-group" role="group" aria-label="Aim at ({unit})">
	<span class="zp-label">Aim at ({unit})</span>
	<div class="dims c3">
		{#each AXES as axis, i (axis)}
			<label class="zp-field"><span>{axis}</span><ValidatedNumberInput value={aim[i]} precision={room.precision} oncommit={(v) => set(AIM_KEYS[i], aim[i], v)} step={step} /></label>
		{/each}
	</div>
</div>

<div class="plan-actions row">
	<button type="button" class="secondary plan-btn" class:active={$pickMode?.type === 'point_position'} aria-pressed={$pickMode?.type === 'point_position'} onclick={() => togglePick('point_position', position)}>Place</button>
	<button type="button" class="secondary plan-btn" class:active={$pickMode?.type === 'aim_point'} aria-pressed={$pickMode?.type === 'aim_point'} onclick={() => togglePick('aim_point', aim)}>Aim</button>
</div>

<DisplayFold {zone} {commit} kind="point" />

<ZoneFold label="Advanced">
	<label class="ep-check"><input type="checkbox" checked={zone.horiz ?? false} onchange={(e) => commit({ horiz: e.currentTarget.checked })} /><span>cos(&theta;) weighting</span></label>
	<label class="ep-check"><input type="checkbox" checked={zone.vert ?? false} onchange={(e) => commit({ vert: e.currentTarget.checked })} /><span>sin(&theta;) weighting</span></label>
	<label class="ep-check"><input type="checkbox" checked={zone.use_normal ?? false} onchange={(e) => commit({ use_normal: e.currentTarget.checked })} /><span>Block back-hemisphere</span></label>
	<div class="dims c2">
		<label class="zp-field"><span>Vertical FOV (°)</span><ValidatedNumberInput id="point-fov-vert" value={zone.fov_vert ?? 180} oncommit={(v) => set('fov_vert', zone.fov_vert ?? 180, v)} min={0} step={1} /></label>
		<label class="zp-field"><span>Horizontal FOV (°)</span><ValidatedNumberInput id="point-fov-horiz" value={zone.fov_horiz ?? 360} oncommit={(v) => set('fov_horiz', zone.fov_horiz ?? 360, v)} min={0} step={1} /></label>
	</div>
</ZoneFold>
