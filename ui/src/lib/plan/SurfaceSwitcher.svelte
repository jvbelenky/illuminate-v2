<script lang="ts">
	// What the 2D view shows: Plan view (top-down, the floor's and the ceiling's
	// items together), then each wall. Bottom-left of the main view.
	import { viewName, planSurface, type Surface } from '$lib/utils/surfaces';

	interface Props {
		surface: Surface;
		surfaces: Surface[];
		onSelect: (s: Surface) => void;
	}

	let { surface, surfaces, onSelect }: Props = $props();
</script>

<select
	class="mv-select surface-pick"
	aria-label="2D view"
	title="2D view"
	value={planSurface(surface)}
	onchange={(e) => onSelect(e.currentTarget.value as Surface)}
>
	{#each surfaces as s (s)}
		<option value={s}>{viewName(s)}</option>
	{/each}
</select>

<style>
	.surface-pick {
		padding: 0 6px;
		font-size: 13px;
	}
</style>
