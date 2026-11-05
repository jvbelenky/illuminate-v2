<script lang="ts">
	// A point: Position and Aim at (X / Y / Z each), each with its pick beside it
	// as a lamp's (the plan's Move and Aim tools move and aim it too), then
	// Advanced (the custom flags and field of view), then Display.
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

{#snippet pickButton(type: 'point_position' | 'aim_point', label: string, current: [number, number, number])}
	{@const active = $pickMode?.type === type}
	<span class="pick-cell">
		<span class="pick-gap" aria-hidden="true">&nbsp;</span>
		<button type="button" class="pick-btn" class:pick-active={active} aria-pressed={active} aria-label={label} title={active ? 'Press Escape to cancel' : label} onclick={() => togglePick(type, current)}>
			<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
				<circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5" />
				<circle cx="8" cy="8" r="2" fill="currentColor" />
				<path d="M8 1v2m0 10v2M1 8h2m10 0h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
			</svg>
		</button>
	</span>
{/snippet}

<div class="zp-group" role="group" aria-label="Position ({unit})">
	<span class="zp-label">Position ({unit})</span>
	<div class="dims c3 picked">
		{#each AXES as axis, i (axis)}
			<label class="zp-field"><span>{axis}</span><ValidatedNumberInput value={position[i]} precision={room.precision} oncommit={(v) => set(POSITION_KEYS[i], position[i], v)} min={0} max={bounds[i]} step={step} /></label>
		{/each}
		{@render pickButton('point_position', 'Pick position', position)}
	</div>
</div>

<div class="zp-group" role="group" aria-label="Aim at ({unit})">
	<span class="zp-label">Aim at ({unit})</span>
	<div class="dims c3 picked">
		{#each AXES as axis, i (axis)}
			<label class="zp-field"><span>{axis}</span><ValidatedNumberInput value={aim[i]} precision={room.precision} oncommit={(v) => set(AIM_KEYS[i], aim[i], v)} step={step} /></label>
		{/each}
		{@render pickButton('aim_point', 'Pick aim point', aim)}
	</div>
</div>

<ZoneFold label="Advanced">
	<label class="ep-check"><input type="checkbox" checked={zone.horiz ?? false} onchange={(e) => commit({ horiz: e.currentTarget.checked })} /><span>cos(&theta;) weighting</span></label>
	<label class="ep-check"><input type="checkbox" checked={zone.vert ?? false} onchange={(e) => commit({ vert: e.currentTarget.checked })} /><span>sin(&theta;) weighting</span></label>
	<label class="ep-check"><input type="checkbox" checked={zone.use_normal ?? false} onchange={(e) => commit({ use_normal: e.currentTarget.checked })} /><span>Block back-hemisphere</span></label>
	<div class="dims c2">
		<label class="zp-field"><span>Vertical FOV (°)</span><ValidatedNumberInput id="point-fov-vert" value={zone.fov_vert ?? 180} oncommit={(v) => set('fov_vert', zone.fov_vert ?? 180, v)} min={0} step={1} /></label>
		<label class="zp-field"><span>Horizontal FOV (°)</span><ValidatedNumberInput id="point-fov-horiz" value={zone.fov_horiz ?? 360} oncommit={(v) => set('fov_horiz', zone.fov_horiz ?? 360, v)} min={0} step={1} /></label>
	</div>
</ZoneFold>

<DisplayFold {zone} {commit} kind="point" />

<style>
	/* X / Y / Z, then the pick, as in the lamp editor */
	.dims.c3.picked {
		grid-template-columns: repeat(3, minmax(0, 1fr)) 30px;
		align-items: end;
	}
	.pick-cell {
		display: flex;
		flex-direction: column;
		gap: 3px;
		align-self: stretch;
	}
	.pick-gap {
		font-size: var(--font-size-xs);
	}
	.pick-btn {
		display: flex;
		flex: 1;
		align-items: center;
		justify-content: center;
		width: 30px;
		min-height: 30px;
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg-secondary);
		color: var(--color-text-muted);
		cursor: pointer;
	}
	.pick-btn svg {
		width: 16px;
		height: 16px;
		flex-shrink: 0;
	}
	.pick-btn:hover {
		background: var(--color-bg-tertiary);
		color: var(--color-text);
	}
	.pick-btn.pick-active {
		background: var(--color-highlight);
		color: var(--color-on-highlight);
		border-color: var(--color-highlight);
		box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.3);
	}
</style>
