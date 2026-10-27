<script lang="ts">
	// The open zone's editor, in its row: the fields for its type, each change
	// sent to the store as it is made. It reads the zone prop directly (no
	// mirrored local state), so a change made elsewhere shows at once. Copy,
	// Delete and closing belong to the plan toolbar, the keys and the row header.
	import { onDestroy } from 'svelte';
	import { project } from '$lib/stores/project';
	import { pickResult } from '$lib/stores/pickMode';
	import type { CalcZone, RoomConfig } from '$lib/types/project';
	import type { PlanController } from '$lib/plan/planController.svelte';
	import PlaneFields from './PlaneFields.svelte';
	import VolumeFields from './VolumeFields.svelte';
	import PointFields from './PointFields.svelte';
	import GridPointsFold from './GridPointsFold.svelte';
	import { pickPartial } from './zonePick';
	import '$lib/workspace/parts/parts.css';
	import './zones.css';

	interface Props {
		zone: CalcZone;
		room: RoomConfig;
		/** Standard zones: grid points only. */
		isStandard: boolean;
		controller: PlanController;
	}

	let { zone, room, isStandard, controller }: Props = $props();

	function commit(partial: Partial<CalcZone>) {
		project.updateZone(zone.id, partial);
	}

	// A point picked in the 3D view for Place, Aim, View direction or Target
	const unsubscribe = pickResult.subscribe((result) => {
		const partial = pickPartial(result);
		if (!partial) return;
		pickResult.set(null);
		commit(partial);
	});
	onDestroy(unsubscribe);

	const axes = $derived(zone.type === 'volume' ? ['X', 'Y', 'Z'] : ['X', 'Y']);
</script>

<div class="zone-panel" data-testid="zone-panel">
	{#if isStandard}
		<GridPointsFold {zone} {room} {commit} {axes} open />
	{:else if zone.type === 'plane'}
		<PlaneFields {zone} {room} {controller} {commit} />
	{:else if zone.type === 'volume'}
		<VolumeFields {zone} {room} {controller} {commit} />
	{:else}
		<PointFields {zone} {room} {commit} />
	{/if}
</div>
