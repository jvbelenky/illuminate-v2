<script lang="ts">
	// Room › Ceiling: the room height.
	import './parts.css';
	import { roundToUnit, unitAbbrev } from '$lib/utils/unitConversion';
	import type { PlanController } from '$lib/plan/planController.svelte';

	let { controller }: { controller: PlanController } = $props();
	const ctl = $derived(controller);

	const scene = $derived(ctl.scene());
	const height = $derived(roundToUnit(scene.room.z, scene.units));

	function commit(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const v = Number(input.value);
		if (!Number.isFinite(v) || v <= 0) {
			input.value = String(height);
			return;
		}
		if (v === height) return;
		ctl.actions.updateRoom({ z: v });
	}
</script>

<div class="ep-part ceiling-part">
	<label class="ep-field" title="Height">
		<span>Height</span>
		<input type="number" aria-label="Height" value={height} onchange={commit} />
		<span>{unitAbbrev(scene.units)}</span>
	</label>
</div>
