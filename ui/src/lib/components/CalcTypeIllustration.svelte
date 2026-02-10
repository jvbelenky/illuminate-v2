<script lang="ts">
	interface Props {
		type: 'fluence_rate' | 'planar_normal' | 'planar_max' | 'vertical' | 'vertical_dir' | 'offset_on' | 'offset_off';
		size?: number;
	}

	let { type, size = 48 }: Props = $props();
</script>

<svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
	{#if type === 'fluence_rate'}
		<!-- Center dot with arrows radiating in all directions (omnidirectional) -->
		<circle cx="24" cy="28" r="2.5" fill="currentColor" stroke="none" />
		<!-- Up -->
		<line x1="24" y1="24" x2="24" y2="10" />
		<line x1="24" y1="10" x2="21" y2="14" />
		<line x1="24" y1="10" x2="27" y2="14" />
		<!-- Down -->
		<line x1="24" y1="32" x2="24" y2="44" />
		<line x1="24" y1="44" x2="21" y2="40" />
		<line x1="24" y1="44" x2="27" y2="40" />
		<!-- Right -->
		<line x1="28" y1="28" x2="40" y2="28" />
		<line x1="40" y1="28" x2="36" y2="25" />
		<line x1="40" y1="28" x2="36" y2="31" />
		<!-- Left -->
		<line x1="20" y1="28" x2="8" y2="28" />
		<line x1="8" y1="28" x2="12" y2="25" />
		<line x1="8" y1="28" x2="12" y2="31" />
		<!-- Up-right -->
		<line x1="27" y1="25" x2="36" y2="16" />
		<line x1="36" y1="16" x2="33" y2="17.5" />
		<line x1="36" y1="16" x2="34.5" y2="19" />
		<!-- Up-left -->
		<line x1="21" y1="25" x2="12" y2="16" />
		<line x1="12" y1="16" x2="15" y2="17.5" />
		<line x1="12" y1="16" x2="13.5" y2="19" />
		<!-- Down-right -->
		<line x1="27" y1="31" x2="36" y2="40" />
		<line x1="36" y1="40" x2="33" y2="38.5" />
		<line x1="36" y1="40" x2="34.5" y2="37" />
		<!-- Down-left -->
		<line x1="21" y1="31" x2="12" y2="40" />
		<line x1="12" y1="40" x2="15" y2="38.5" />
		<line x1="12" y1="40" x2="13.5" y2="37" />
	{:else if type === 'planar_normal'}
		<!-- Horizontal surface with dots; single upward arrow from each dot -->
		<line x1="6" y1="38" x2="42" y2="38" stroke-width="2" />
		<circle cx="14" cy="38" r="2" fill="currentColor" stroke="none" />
		<circle cx="24" cy="38" r="2" fill="currentColor" stroke="none" />
		<circle cx="34" cy="38" r="2" fill="currentColor" stroke="none" />
		<!-- Upward arrows (perpendicular to plane) -->
		<line x1="14" y1="34" x2="14" y2="18" />
		<line x1="14" y1="18" x2="11" y2="22" />
		<line x1="14" y1="18" x2="17" y2="22" />

		<line x1="24" y1="34" x2="24" y2="18" />
		<line x1="24" y1="18" x2="21" y2="22" />
		<line x1="24" y1="18" x2="27" y2="22" />

		<line x1="34" y1="34" x2="34" y2="18" />
		<line x1="34" y1="18" x2="31" y2="22" />
		<line x1="34" y1="18" x2="37" y2="22" />
	{:else if type === 'planar_max'}
		<!-- Horizontal surface with dots; fan of upward arrows in hemisphere -->
		<line x1="6" y1="38" x2="42" y2="38" stroke-width="2" />
		<circle cx="24" cy="38" r="2" fill="currentColor" stroke="none" />
		<!-- Fan of arrows from center dot -->
		<line x1="24" y1="34" x2="24" y2="14" />
		<line x1="24" y1="14" x2="21" y2="18" />
		<line x1="24" y1="14" x2="27" y2="18" />

		<line x1="24" y1="35" x2="14" y2="17" />
		<line x1="14" y1="17" x2="14" y2="21" />
		<line x1="14" y1="17" x2="17.5" y2="18.5" />

		<line x1="24" y1="35" x2="34" y2="17" />
		<line x1="34" y1="17" x2="34" y2="21" />
		<line x1="34" y1="17" x2="30.5" y2="18.5" />

		<line x1="24" y1="36" x2="8" y2="26" />
		<line x1="8" y1="26" x2="9.5" y2="29.5" />
		<line x1="8" y1="26" x2="11.5" y2="25.5" />

		<line x1="24" y1="36" x2="40" y2="26" />
		<line x1="40" y1="26" x2="38.5" y2="29.5" />
		<line x1="40" y1="26" x2="36.5" y2="25.5" />
	{:else if type === 'vertical'}
		<!-- Vertical surface with dots; single horizontal arrow from each dot (no normal) -->
		<line x1="10" y1="6" x2="10" y2="42" stroke-width="2" />
		<circle cx="10" cy="14" r="2" fill="currentColor" stroke="none" />
		<circle cx="10" cy="24" r="2" fill="currentColor" stroke="none" />
		<circle cx="10" cy="34" r="2" fill="currentColor" stroke="none" />
		<!-- Rightward arrows -->
		<line x1="14" y1="14" x2="38" y2="14" />
		<line x1="38" y1="14" x2="34" y2="11" />
		<line x1="38" y1="14" x2="34" y2="17" />

		<line x1="14" y1="24" x2="38" y2="24" />
		<line x1="38" y1="24" x2="34" y2="21" />
		<line x1="38" y1="24" x2="34" y2="27" />

		<line x1="14" y1="34" x2="38" y2="34" />
		<line x1="38" y1="34" x2="34" y2="31" />
		<line x1="38" y1="34" x2="34" y2="37" />
	{:else if type === 'vertical_dir'}
		<!-- Vertical surface with dot; fan of arrows in one direction (hemisphere around normal) -->
		<line x1="10" y1="6" x2="10" y2="42" stroke-width="2" />
		<circle cx="10" cy="24" r="2.5" fill="currentColor" stroke="none" />
		<!-- Normal arrow (horizontal, rightward) -->
		<line x1="14" y1="24" x2="38" y2="24" />
		<line x1="38" y1="24" x2="34" y2="21" />
		<line x1="38" y1="24" x2="34" y2="27" />
		<!-- Angled arrows fanning above and below normal -->
		<line x1="13" y1="22" x2="34" y2="12" />
		<line x1="34" y1="12" x2="30.5" y2="13" />
		<line x1="34" y1="12" x2="33" y2="15.5" />

		<line x1="13" y1="26" x2="34" y2="36" />
		<line x1="34" y1="36" x2="33" y2="32.5" />
		<line x1="34" y1="36" x2="30.5" y2="35" />

		<line x1="12" y1="21" x2="22" y2="8" />
		<line x1="22" y1="8" x2="19.5" y2="10" />
		<line x1="22" y1="8" x2="22" y2="11.5" />

		<line x1="12" y1="27" x2="22" y2="40" />
		<line x1="22" y1="40" x2="22" y2="36.5" />
		<line x1="22" y1="40" x2="19.5" y2="38" />
	{:else if type === 'offset_on'}
		<!-- Square boundary; 3x3 grid of dots inset from edges -->
		<rect x="6" y="6" width="36" height="36" rx="1" />
		{#each [16, 24, 32] as cx}
			{#each [16, 24, 32] as cy}
				<circle {cx} {cy} r="2.5" fill="currentColor" stroke="none" />
			{/each}
		{/each}
	{:else if type === 'offset_off'}
		<!-- Square boundary; dots on edges and corners -->
		<rect x="6" y="6" width="36" height="36" rx="1" />
		{#each [6, 24, 42] as cx}
			{#each [6, 24, 42] as cy}
				<circle {cx} {cy} r="2.5" fill="currentColor" stroke="none" />
			{/each}
		{/each}
	{/if}
</svg>
