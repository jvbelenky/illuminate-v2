<script lang="ts">
	// The project's length unit, bottom-right of the main view (the same setting
	// as the Floorplan part's units select). Named by its title, so the
	// Floorplan part's select stays the one labelled Units.
	import { UNIT_INFO, LENGTH_UNITS, type LengthUnit } from '$lib/utils/unitConversion';

	interface Props {
		units: LengthUnit;
		onchange: (event: Event) => void;
	}

	let { units, onchange }: Props = $props();
</script>

<select class="mv-select units-corner" title="Units" value={units} {onchange}>
	{#each LENGTH_UNITS as u (u)}
		<option value={u}>{UNIT_INFO[u].label}</option>
	{/each}
</select>
