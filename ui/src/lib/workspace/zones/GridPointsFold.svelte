<script lang="ts">
	// ▸ Grid points: Points | Spacing, a count or spacing per axis, the value the
	// other mode gives, and Inset | On edge. Each change is sent as it is made;
	// the backend returns the other mode's values.
	import ValidatedNumberInput from '$lib/components/ValidatedNumberInput.svelte';
	import { userSettings } from '$lib/stores/settings';
	import { unitAbbrev, fromMeters } from '$lib/utils/unitConversion';
	import type { CalcZone, RoomConfig } from '$lib/types/project';
	import ZoneFold from './ZoneFold.svelte';
	import { gridSummary, spacingText } from './zoneFields';

	interface Props {
		zone: CalcZone;
		room: RoomConfig;
		commit: (partial: Partial<CalcZone>) => void;
		/** Axis names: X, Y (and Z for a volume), or Across, Up on a wall. */
		axes: string[];
		open?: boolean;
	}

	let { zone, room, commit, axes, open = false }: Props = $props();
	// svelte-ignore state_referenced_locally
	let isOpen = $state(open);

	const unit = $derived(unitAbbrev($userSettings.units));
	const byPoints = $derived((zone.resolution_mode ?? 'num_points') === 'num_points');

	const NUM_KEYS = ['num_x', 'num_y', 'num_z'] as const;
	const SPACING_KEYS = ['x_spacing', 'y_spacing', 'z_spacing'] as const;
	const SPANS = ['x', 'y', 'z'] as const;

	/** About half a metre apart, at least 10, when the zone has no count yet. */
	function numOf(i: number): number {
		return zone[NUM_KEYS[i]] ?? Math.max(10, Math.round(room[SPANS[i]] / 0.5));
	}
	function spacingOf(i: number): number {
		return zone[SPACING_KEYS[i]] ?? fromMeters(0.5, $userSettings.units);
	}
	function setNum(i: number, v: number) {
		if (v !== zone[NUM_KEYS[i]]) commit({ [NUM_KEYS[i]]: v });
	}
	function setSpacing(i: number, v: number) {
		if (v !== zone[SPACING_KEYS[i]]) commit({ [SPACING_KEYS[i]]: v });
	}
	function setMode(mode: 'num_points' | 'spacing') {
		if (mode !== (zone.resolution_mode ?? 'num_points')) commit({ resolution_mode: mode });
	}
	function setOffset(on: boolean) {
		if (on !== (zone.offset ?? true)) commit({ offset: on });
	}
</script>

<ZoneFold label="Grid points" value={gridSummary(zone)} bind:open={isOpen}>
	<div class="seg" role="group" aria-label="Grid resolution">
		<button type="button" aria-pressed={byPoints} onclick={() => setMode('num_points')}>Points</button>
		<button type="button" aria-pressed={!byPoints} onclick={() => setMode('spacing')}>Spacing</button>
	</div>
	<div class="dims grid-dims" class:c2={axes.length === 2} class:c3={axes.length === 3}>
		{#each axes as axis, i (axis)}
			<label class="zp-field">
				<span>{byPoints ? axis : `${axis} (${unit})`}</span>
				{#if byPoints}
					<ValidatedNumberInput value={numOf(i)} oncommit={(v) => setNum(i, v)} integer min={1} max={200} step={1} />
				{:else}
					<ValidatedNumberInput value={spacingOf(i)} precision={room.precision} oncommit={(v) => setSpacing(i, v)} validate={(v) => v > 0} step="any" />
				{/if}
			</label>
		{/each}
	</div>
	<span class="zp-value">{spacingText(zone, unit, room.precision)}</span>
	<div class="seg" role="group" aria-label="Grid offset">
		<button type="button" aria-pressed={zone.offset ?? true} onclick={() => setOffset(true)}>Inset</button>
		<button type="button" aria-pressed={!(zone.offset ?? true)} onclick={() => setOffset(false)}>On edge</button>
	</div>
</ZoneFold>
