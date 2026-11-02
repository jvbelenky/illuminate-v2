<script lang="ts">
	// The project's length unit, bottom-right of the main view (the same setting
	// as the Floorplan part's units select). Named by its title, so the
	// Floorplan part's select stays the one labelled Units.
	// `compact` (a narrow main view): the options read m, cm, mm, ft, in, so the
	// select is narrow enough to leave room for the edit strip.
	import { UNIT_INFO, LENGTH_UNITS, type LengthUnit } from '$lib/utils/unitConversion';

	interface Props {
		units: LengthUnit;
		onchange: (event: Event) => void;
		compact?: boolean;
	}

	let { units, onchange, compact = false }: Props = $props();
</script>

<select class="mv-select units-corner" class:compact title="Units" value={units} {onchange}>
	{#each LENGTH_UNITS as u (u)}
		<option value={u}>{compact ? UNIT_INFO[u].abbrev : UNIT_INFO[u].label}</option>
	{/each}
</select>
