<script lang="ts">
	// A plane: its Surface, Calculation, its distance from its surface with Flip,
	// Fit to room and Draw outline, then Geometry, Grid points and Display folded
	// away. A vertical plane parallel to no wall (legacy) shows its geometry read-only.
	import ValidatedNumberInput from '$lib/components/ValidatedNumberInput.svelte';
	import { userSettings } from '$lib/stores/settings';
	import { pickMode } from '$lib/stores/pickMode';
	import { unitAbbrev, unitStep } from '$lib/utils/unitConversion';
	import { allSurfaces, parseSurface, surfaceName, wallIndex, zoneSurface, type Surface } from '$lib/utils/surfaces';
	import { planeWall, wallPlaneOutline } from '$lib/utils/planeWorld';
	import { footprintGeometry, rectangleCorners } from '$lib/utils/zoneFootprint';
	import { roomVertices, type Vertex } from '$lib/utils/roomGeometry';
	import type { CalcZone, PlaneCalcMode, RoomConfig } from '$lib/types/project';
	import type { PlanController } from '$lib/plan/planController.svelte';
	import ZoneFold from './ZoneFold.svelte';
	import ZoneGeometry from './ZoneGeometry.svelte';
	import GridPointsFold from './GridPointsFold.svelte';
	import DisplayFold from './DisplayFold.svelte';
	import { togglePick } from './zonePick';
	import {
		CALC_MODES, DEFAULT_CUSTOM_FLAGS, calcModeFlags, showsFov, isLegacyPlane,
		distanceLabel, distanceOf, distancePartial, flipPartial, type CustomFlags,
		surfaceChoice, surfacePartial, fitPartial, rangePartial, shownFootprint, type Ranges,
	} from './zoneFields';

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
	const surface = $derived(zoneSurface(zone, room.z));
	const onWall = $derived(wallIndex(surface) !== null);
	const legacy = $derived(isLegacyPlane(zone));
	const mode = $derived<PlaneCalcMode>(zone.calc_mode ?? 'planar_normal');

	// --- Surface
	const surfaces = $derived(allSurfaces(roomVertices(room)));
	const choice = $derived(surfaceChoice(zone, room.z));

	/** Move the plane to fill another surface; the 2D view follows, the plane still selected. */
	function chooseSurface(value: string) {
		const next = parseSurface(value);
		if (!next || next === choice) return;
		const id = zone.id;
		commit(surfacePartial(next as Surface, room, $userSettings.units));
		ctl.setSurface(next);
		ctl.selectZone(id);
	}

	// --- Calculation
	// Custom's flags, remembered while the panel is open so a trip to another mode brings them back
	// svelte-ignore state_referenced_locally
	let savedCustom = $state<CustomFlags>(zone.calc_mode === 'custom' ? currentFlags() : { ...DEFAULT_CUSTOM_FLAGS });

	function currentFlags(): CustomFlags {
		return {
			horiz: zone.horiz ?? false, vert: zone.vert ?? false, use_normal: zone.use_normal ?? false,
			fov_vert: zone.fov_vert ?? 180, fov_horiz: zone.fov_horiz ?? 360,
		};
	}

	const centre = $derived<[number, number, number]>([room.x / 2, room.y / 2, room.z / 2].map((v) => Math.round(v * 1000) / 1000) as [number, number, number]);
	const viewDirection = $derived<[number, number, number]>(zone.view_direction ?? [0, 1, 0]);
	const viewTarget = $derived<[number, number, number]>(zone.view_target ?? centre);

	function setCalcMode(next: PlaneCalcMode) {
		if (next === mode) return;
		if (mode === 'custom') savedCustom = currentFlags();
		const partial: Partial<CalcZone> = { calc_mode: next, ...calcModeFlags(next, savedCustom) };
		if (next === 'eye_directional' && !zone.view_direction) partial.view_direction = viewDirection;
		if (next === 'eye_target' && !zone.view_target) partial.view_target = viewTarget;
		commit(partial);
	}

	function setVector(key: 'view_direction' | 'view_target', current: [number, number, number], i: number, v: number) {
		if (v === current[i]) return;
		const next = [...current] as [number, number, number];
		next[i] = v;
		commit({ [key]: next });
	}

	// --- Distance, Flip, Fit, Draw
	const distance = $derived(distanceOf(zone, surface, room.z));
	const drawing = $derived(ctl.drawing && ctl.drawKind === 'plane');

	function setDistance(v: number) {
		if (v !== distance) commit(distancePartial(zone, surface, room.z, v));
	}

	// --- Geometry
	const wall = $derived(onWall ? planeWall(zone, room) : null);

	const geometry = $derived.by((): { vertices: Vertex[]; axes: [string, string] } | null => {
		if (legacy) {
			const xz = zone.ref_surface === 'xz';
			const [a1, a2] = xz ? [zone.x1 ?? 0, zone.x2 ?? room.x] : [zone.y1 ?? 0, zone.y2 ?? room.y];
			const [z1, z2] = [zone.z_min ?? 0, zone.z_max ?? room.z];
			return {
				vertices: rectangleCorners(Math.min(a1, a2), Math.max(a1, a2), Math.min(z1, z2), Math.max(z1, z2)),
				axes: xz ? ['X', 'Z'] : ['Y', 'Z'],
			};
		}
		if (onWall) return wall ? { vertices: wallPlaneOutline(zone, wall, room.z), axes: ['Along', 'Up'] } : null;
		return { vertices: shownFootprint(zone, room), axes: ['X', 'Y'] };
	});

	function setRanges(r: Ranges) {
		if (!legacy) commit(rangePartial(onWall ? 'wall' : 'plane', r));
	}

	function setCorners(next: Vertex[]) {
		if (legacy) return;
		if (onWall) commit({ wall_vertices: next.map(([a, u]) => [a, u] as [number, number]), fit_room: false });
		else commit({ ...footprintGeometry('plane', next), fit_room: false });
	}

	const gridAxes = $derived(
		onWall ? ['Across', 'Up'] : legacy ? (zone.ref_surface === 'xz' ? ['X', 'Z'] : ['Y', 'Z']) : ['X', 'Y']
	);
</script>

{#if !legacy}
	<label class="zp-field">
		<span>Surface</span>
		<select value={choice} onchange={(e) => chooseSurface(e.currentTarget.value)}>
			{#if choice === ''}
				<option value="" disabled>—</option>
			{/if}
			{#each surfaces as s (s)}
				<option value={s}>{surfaceName(s)}</option>
			{/each}
		</select>
	</label>
{/if}

<label class="zp-field">
	<span>Calculation</span>
	<select value={mode} onchange={(e) => setCalcMode(e.currentTarget.value as PlaneCalcMode)}>
		{#each CALC_MODES as m (m.value)}
			<option value={m.value}>{m.title}</option>
		{/each}
		{#if !CALC_MODES.some((m) => m.value === mode)}
			<option value={mode}>{mode}</option>
		{/if}
	</select>
</label>

{#if mode === 'eye_directional'}
	<div class="zp-group" role="group" aria-label="View direction">
		<span class="zp-label">View direction</span>
		<div class="hrow">
			<div class="dims c3">
				{#each ['X', 'Y', 'Z'] as axis, i (axis)}
					<label class="zp-field"><span>{axis}</span><ValidatedNumberInput value={viewDirection[i]} precision={room.precision} oncommit={(v) => setVector('view_direction', viewDirection, i, v)} step={0.1} /></label>
				{/each}
			</div>
			<button type="button" class="secondary pick-btn" class:active={$pickMode?.type === 'direction'} aria-pressed={$pickMode?.type === 'direction'} onclick={() => togglePick('direction')}>Pick</button>
		</div>
	</div>
{:else if mode === 'eye_target'}
	<div class="zp-group" role="group" aria-label="Target">
		<span class="zp-label">Target ({unit})</span>
		<div class="hrow">
			<div class="dims c3">
				{#each ['X', 'Y', 'Z'] as axis, i (axis)}
					<label class="zp-field"><span>{axis}</span><ValidatedNumberInput value={viewTarget[i]} precision={room.precision} oncommit={(v) => setVector('view_target', viewTarget, i, v)} step={step} /></label>
				{/each}
			</div>
			<button type="button" class="secondary pick-btn" class:active={$pickMode?.type === 'target'} aria-pressed={$pickMode?.type === 'target'} onclick={() => togglePick('target', viewTarget)}>Pick</button>
		</div>
	</div>
{/if}

{#if mode === 'custom'}
	<div class="zp-group">
		<label class="ep-check"><input type="checkbox" checked={zone.horiz ?? false} onchange={(e) => commit({ horiz: e.currentTarget.checked })} /><span>cos(&theta;) weighting</span></label>
		<label class="ep-check"><input type="checkbox" checked={zone.vert ?? false} onchange={(e) => commit({ vert: e.currentTarget.checked })} /><span>sin(&theta;) weighting</span></label>
		<label class="ep-check"><input type="checkbox" checked={zone.use_normal ?? false} onchange={(e) => commit({ use_normal: e.currentTarget.checked })} /><span>Block back-hemisphere</span></label>
	</div>
{/if}

{#if showsFov(mode)}
	<div class="dims c2">
		<label class="zp-field"><span>Vertical FOV (°)</span><ValidatedNumberInput id="fov-vert" value={zone.fov_vert ?? 180} oncommit={(v) => { if (v !== zone.fov_vert) commit({ fov_vert: v }); }} min={0} step={1} /></label>
		<label class="zp-field"><span>Horizontal FOV (°)</span><ValidatedNumberInput id="fov-horiz" value={zone.fov_horiz ?? 360} oncommit={(v) => { if (v !== zone.fov_horiz) commit({ fov_horiz: v }); }} min={0} step={1} /></label>
	</div>
{/if}

{#if !legacy}
	<div class="hrow">
		<label class="zp-field">
			<span>{distanceLabel(surface)} ({unit})</span>
			<ValidatedNumberInput id="plane-distance" value={distance} precision={room.precision} oncommit={setDistance} min={0} max={onWall ? undefined : room.z} step={step} />
		</label>
		<button type="button" class="secondary flip-btn" aria-label="Flip" onclick={() => commit(flipPartial(zone, surface))}>⇅ Flip</button>
	</div>

	<div class="plan-actions">
		<label class="zp-switch">
			<span>{onWall ? 'Fit to wall' : 'Fit to room'}</span>
			<input type="checkbox" role="switch" checked={zone.fit_room ?? false} onchange={(e) => commit(fitPartial(zone, room, e.currentTarget.checked))} />
		</label>
		<button type="button" class="secondary plan-btn" class:active={drawing} aria-pressed={drawing} onclick={() => ctl.startZoneDraw('plane')}>Draw outline</button>
	</div>
{/if}

{#if geometry}
	<ZoneFold label="Geometry">
		<ZoneGeometry
			vertices={geometry.vertices}
			axes={geometry.axes}
			precision={room.precision}
			{step}
			ranges={legacy}
			readonly={legacy}
			onRanges={setRanges}
			onCorners={setCorners}
		/>
	</ZoneFold>
{/if}

<GridPointsFold {zone} {room} {commit} axes={gridAxes} />
<DisplayFold {zone} {commit} kind="plane" />
