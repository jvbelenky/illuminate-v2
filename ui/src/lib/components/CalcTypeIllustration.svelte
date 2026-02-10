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
		<!-- Horizontal surface with dots; in-plane arrows going BOTH left and right (no normal, both sides) -->
		<line x1="6" y1="24" x2="42" y2="24" stroke-width="2" />
		<circle cx="14" cy="24" r="2" fill="currentColor" stroke="none" />
		<circle cx="24" cy="24" r="2" fill="currentColor" stroke="none" />
		<circle cx="34" cy="24" r="2" fill="currentColor" stroke="none" />
		<!-- Leftward arrows (in-plane) -->
		<line x1="11" y1="24" x2="3" y2="24" />
		<line x1="3" y1="24" x2="6" y2="22" />
		<line x1="3" y1="24" x2="6" y2="26" />

		<line x1="21" y1="24" x2="16" y2="24" />
		<line x1="16" y1="24" x2="18" y2="22.5" />
		<line x1="16" y1="24" x2="18" y2="25.5" />

		<!-- Rightward arrows (in-plane) -->
		<line x1="37" y1="24" x2="45" y2="24" />
		<line x1="45" y1="24" x2="42" y2="22" />
		<line x1="45" y1="24" x2="42" y2="26" />

		<line x1="27" y1="24" x2="32" y2="24" />
		<line x1="32" y1="24" x2="30" y2="22.5" />
		<line x1="32" y1="24" x2="30" y2="25.5" />
	{:else if type === 'vertical_dir'}
		<!-- Horizontal surface with dots; in-plane arrows going ONE direction only (has normal) -->
		<line x1="6" y1="24" x2="42" y2="24" stroke-width="2" />
		<circle cx="10" cy="24" r="2" fill="currentColor" stroke="none" />
		<circle cx="20" cy="24" r="2" fill="currentColor" stroke="none" />
		<circle cx="30" cy="24" r="2" fill="currentColor" stroke="none" />
		<!-- Rightward arrows only (single direction, has normal) -->
		<line x1="13" y1="24" x2="18" y2="24" />
		<line x1="18" y1="24" x2="16" y2="22.5" />
		<line x1="18" y1="24" x2="16" y2="25.5" />

		<line x1="23" y1="24" x2="28" y2="24" />
		<line x1="28" y1="24" x2="26" y2="22.5" />
		<line x1="28" y1="24" x2="26" y2="25.5" />

		<line x1="33" y1="24" x2="42" y2="24" />
		<line x1="42" y1="24" x2="39" y2="22" />
		<line x1="42" y1="24" x2="39" y2="26" />
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
