<script lang="ts">
	interface Props {
		type: 'fluence_rate' | 'planar_normal' | 'planar_max' | 'vertical' | 'vertical_dir' | 'eye_worst_case' | 'eye_directional' | 'eye_target' | 'custom' | 'offset_on' | 'offset_off' | 'calc_plane' | 'calc_vol' | 'calc_point' | 'display_heatmap' | 'display_numeric' | 'display_markers' | 'display_none' | 'surface_xy' | 'surface_xz' | 'surface_yz' | 'dir_up' | 'dir_down' | 'dir_right' | 'dir_left' | 'dir_north' | 'dir_south' | 'dir_omni' | 'dir_bidir';
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
		<!-- Horizontal surface, in-plane arrows both directions + slight angular spread above and below -->
		<line x1="4" y1="30" x2="44" y2="30" stroke-width="2" />
		<circle cx="12" cy="30" r="2" fill="currentColor" stroke="none" />
		<circle cx="24" cy="30" r="2" fill="currentColor" stroke="none" />
		<circle cx="36" cy="30" r="2" fill="currentColor" stroke="none" />
		<!-- Leftward horizontal arrow -->
		<line x1="9" y1="30" x2="2" y2="30" />
		<line x1="2" y1="30" x2="4.5" y2="28.5" />
		<line x1="2" y1="30" x2="4.5" y2="31.5" />
		<!-- Rightward horizontal arrow -->
		<line x1="39" y1="30" x2="46" y2="30" />
		<line x1="46" y1="30" x2="43.5" y2="28.5" />
		<line x1="46" y1="30" x2="43.5" y2="31.5" />
		<!-- Center: ~20° above-right -->
		<line x1="27" y1="29" x2="38" y2="25" />
		<line x1="38" y1="25" x2="36" y2="24.5" />
		<line x1="38" y1="25" x2="36.5" y2="27" />
		<!-- Center: ~20° above-left -->
		<line x1="21" y1="29" x2="10" y2="25" />
		<line x1="10" y1="25" x2="12" y2="24.5" />
		<line x1="10" y1="25" x2="11.5" y2="27" />
		<!-- Center: ~20° below-right -->
		<line x1="27" y1="31" x2="38" y2="35" />
		<line x1="38" y1="35" x2="36.5" y2="33" />
		<line x1="38" y1="35" x2="36" y2="35.5" />
		<!-- Center: ~20° below-left -->
		<line x1="21" y1="31" x2="10" y2="35" />
		<line x1="10" y1="35" x2="11.5" y2="33" />
		<line x1="10" y1="35" x2="12" y2="35.5" />
	{:else if type === 'vertical_dir'}
		<!-- Horizontal surface, in-plane arrows + slight angular spread above only (has normal) -->
		<line x1="4" y1="30" x2="44" y2="30" stroke-width="2" />
		<circle cx="12" cy="30" r="2" fill="currentColor" stroke="none" />
		<circle cx="24" cy="30" r="2" fill="currentColor" stroke="none" />
		<circle cx="36" cy="30" r="2" fill="currentColor" stroke="none" />
		<!-- Leftward horizontal arrow -->
		<line x1="9" y1="30" x2="2" y2="30" />
		<line x1="2" y1="30" x2="4.5" y2="28.5" />
		<line x1="2" y1="30" x2="4.5" y2="31.5" />
		<!-- Rightward horizontal arrow -->
		<line x1="39" y1="30" x2="46" y2="30" />
		<line x1="46" y1="30" x2="43.5" y2="28.5" />
		<line x1="46" y1="30" x2="43.5" y2="31.5" />
		<!-- Center: ~20° above-right -->
		<line x1="27" y1="29" x2="38" y2="25" />
		<line x1="38" y1="25" x2="36" y2="24.5" />
		<line x1="38" y1="25" x2="36.5" y2="27" />
		<!-- Center: ~20° above-left -->
		<line x1="21" y1="29" x2="10" y2="25" />
		<line x1="10" y1="25" x2="12" y2="24.5" />
		<line x1="10" y1="25" x2="11.5" y2="27" />
	{:else if type === 'eye_worst_case'}
		<!-- Eye worst-case: profile eye on left, fan of arrows searching directions -->
		<!-- Eye in profile: <) looking right -->
		<path d="M14 14 L4 24 L14 34 Q24 24 14 14 Z" fill="none" stroke-width="2" />
		<circle cx="17" cy="24" r="3" fill="currentColor" stroke="none" />
		<!-- Fan of arrows from eye -->
		<line x1="23" y1="24" x2="44" y2="24" />
		<line x1="44" y1="24" x2="40" y2="21.5" />
		<line x1="44" y1="24" x2="40" y2="26.5" />
		<line x1="23" y1="22" x2="42" y2="12" />
		<line x1="42" y1="12" x2="38.5" y2="13" />
		<line x1="42" y1="12" x2="40.5" y2="15" />
		<line x1="23" y1="26" x2="42" y2="36" />
		<line x1="42" y1="36" x2="40.5" y2="33" />
		<line x1="42" y1="36" x2="38.5" y2="35" />
	{:else if type === 'eye_directional'}
		<!-- Directional: profile eye on left, parallel arrows at an angle -->
		<!-- Eye in profile: <) looking right -->
		<path d="M14 14 L4 24 L14 34 Q24 24 14 14 Z" fill="none" stroke-width="2" />
		<circle cx="17" cy="24" r="3" fill="currentColor" stroke="none" />
		<!-- Parallel arrows (from eye, angled slightly up-right) -->
		<line x1="26" y1="16" x2="44" y2="10" />
		<line x1="44" y1="10" x2="40" y2="9" />
		<line x1="44" y1="10" x2="41" y2="13" />
		<line x1="26" y1="24" x2="44" y2="18" />
		<line x1="44" y1="18" x2="40" y2="17" />
		<line x1="44" y1="18" x2="41" y2="21" />
		<line x1="26" y1="32" x2="44" y2="26" />
		<line x1="44" y1="26" x2="40" y2="25" />
		<line x1="44" y1="26" x2="41" y2="29" />
	{:else if type === 'eye_target'}
		<!-- Target: profile eye on left, converging arrows -->
		<!-- Eye in profile: <) looking right -->
		<path d="M14 14 L4 24 L14 34 Q24 24 14 14 Z" fill="none" stroke-width="2" />
		<circle cx="17" cy="24" r="3" fill="currentColor" stroke="none" />
		<!-- Converging arrows meeting at a point -->
		<line x1="26" y1="14" x2="42" y2="23" />
		<line x1="42" y1="23" x2="39" y2="20.5" />
		<line x1="42" y1="23" x2="39" y2="24" />
		<line x1="26" y1="24" x2="42" y2="24" />
		<line x1="42" y1="24" x2="39" y2="21.5" />
		<line x1="42" y1="24" x2="39" y2="26.5" />
		<line x1="26" y1="34" x2="42" y2="25" />
		<line x1="42" y1="25" x2="39" y2="24" />
		<line x1="42" y1="25" x2="39" y2="27.5" />
		<!-- Convergence point dot -->
		<circle cx="42" cy="24" r="2" fill="currentColor" stroke="none" />
	{:else if type === 'custom'}
		<!-- Custom: three horizontal sliders representing manual configuration -->
		<!-- Slider 1 (top) -->
		<line x1="8" y1="14" x2="40" y2="14" stroke-width="1.5" opacity="0.4" />
		<circle cx="28" cy="14" r="3.5" fill="currentColor" stroke="none" />
		<!-- Slider 2 (middle) -->
		<line x1="8" y1="24" x2="40" y2="24" stroke-width="1.5" opacity="0.4" />
		<circle cx="16" cy="24" r="3.5" fill="currentColor" stroke="none" />
		<!-- Slider 3 (bottom) -->
		<line x1="8" y1="34" x2="40" y2="34" stroke-width="1.5" opacity="0.4" />
		<circle cx="34" cy="34" r="3.5" fill="currentColor" stroke="none" />
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
	{:else if type === 'calc_plane'}
		<!-- Square with dots (2D plane) -->
		<rect x="6" y="6" width="36" height="36" rx="2" />
		{#each [14, 24, 34] as cx}
			{#each [14, 24, 34] as cy}
				<circle {cx} {cy} r="2" fill="currentColor" stroke="none" />
			{/each}
		{/each}
	{:else if type === 'calc_vol'}
		<!-- Isometric cube with dots (3D volume) -->
		<!-- Front face -->
		<path d="M8 18 L24 10 L40 18 L40 36 L24 44 L8 36 Z" />
		<!-- Top-to-back edge -->
		<line x1="24" y1="10" x2="24" y2="27" />
		<!-- Left-to-back edge -->
		<line x1="8" y1="18" x2="24" y2="27" />
		<!-- Right-to-back edge -->
		<line x1="40" y1="18" x2="24" y2="27" />
		<!-- Dots inside volume -->
		<circle cx="16" cy="28" r="2" fill="currentColor" stroke="none" />
		<circle cx="24" cy="35" r="2" fill="currentColor" stroke="none" />
		<circle cx="32" cy="28" r="2" fill="currentColor" stroke="none" />
		<circle cx="24" cy="20" r="2" fill="currentColor" stroke="none" />
	{:else if type === 'calc_point'}
		<!-- Single point with upward normal arrow -->
		<circle cx="24" cy="30" r="4" fill="currentColor" stroke="none" />
		<!-- Normal arrow pointing up -->
		<line x1="24" y1="26" x2="24" y2="10" stroke-width="2" />
		<line x1="24" y1="10" x2="20" y2="15" stroke-width="2" />
		<line x1="24" y1="10" x2="28" y2="15" stroke-width="2" />
	{:else if type === 'display_heatmap'}
		<!-- Grid of cells with varying fill to suggest heatmap -->
		<rect x="6" y="6" width="36" height="36" rx="2" />
		<rect x="6" y="6" width="12" height="12" fill="currentColor" opacity="0.2" stroke="none" />
		<rect x="18" y="6" width="12" height="12" fill="currentColor" opacity="0.5" stroke="none" />
		<rect x="30" y="6" width="12" height="12" fill="currentColor" opacity="0.3" stroke="none" />
		<rect x="6" y="18" width="12" height="12" fill="currentColor" opacity="0.4" stroke="none" />
		<rect x="18" y="18" width="12" height="12" fill="currentColor" opacity="0.9" stroke="none" />
		<rect x="30" y="18" width="12" height="12" fill="currentColor" opacity="0.6" stroke="none" />
		<rect x="6" y="30" width="12" height="12" fill="currentColor" opacity="0.15" stroke="none" />
		<rect x="18" y="30" width="12" height="12" fill="currentColor" opacity="0.5" stroke="none" />
		<rect x="30" y="30" width="12" height="12" fill="currentColor" opacity="0.25" stroke="none" />
		<!-- Grid lines -->
		<line x1="18" y1="6" x2="18" y2="42" opacity="0.3" />
		<line x1="30" y1="6" x2="30" y2="42" opacity="0.3" />
		<line x1="6" y1="18" x2="42" y2="18" opacity="0.3" />
		<line x1="6" y1="30" x2="42" y2="30" opacity="0.3" />
	{:else if type === 'display_numeric'}
		<!-- Grid with numbers -->
		<rect x="6" y="6" width="36" height="36" rx="2" />
		<line x1="18" y1="6" x2="18" y2="42" opacity="0.3" />
		<line x1="30" y1="6" x2="30" y2="42" opacity="0.3" />
		<line x1="6" y1="18" x2="42" y2="18" opacity="0.3" />
		<line x1="6" y1="30" x2="42" y2="30" opacity="0.3" />
		<!-- Numbers in cells -->
		<text x="12" y="15" font-size="7" fill="currentColor" stroke="none" text-anchor="middle" font-family="sans-serif">3.2</text>
		<text x="24" y="15" font-size="7" fill="currentColor" stroke="none" text-anchor="middle" font-family="sans-serif">5.1</text>
		<text x="36" y="15" font-size="7" fill="currentColor" stroke="none" text-anchor="middle" font-family="sans-serif">2.8</text>
		<text x="12" y="27" font-size="7" fill="currentColor" stroke="none" text-anchor="middle" font-family="sans-serif">4.7</text>
		<text x="24" y="27" font-size="7" fill="currentColor" stroke="none" text-anchor="middle" font-family="sans-serif">8.3</text>
		<text x="36" y="27" font-size="7" fill="currentColor" stroke="none" text-anchor="middle" font-family="sans-serif">6.1</text>
		<text x="12" y="39" font-size="7" fill="currentColor" stroke="none" text-anchor="middle" font-family="sans-serif">1.5</text>
		<text x="24" y="39" font-size="7" fill="currentColor" stroke="none" text-anchor="middle" font-family="sans-serif">4.9</text>
		<text x="36" y="39" font-size="7" fill="currentColor" stroke="none" text-anchor="middle" font-family="sans-serif">2.2</text>
	{:else if type === 'display_markers'}
		<!-- Just dots, no grid -->
		<rect x="6" y="6" width="36" height="36" rx="2" stroke-dasharray="3 2" />
		{#each [14, 24, 34] as cx}
			{#each [14, 24, 34] as cy}
				<circle {cx} {cy} r="2.5" fill="currentColor" stroke="none" />
			{/each}
		{/each}
	{:else if type === 'display_none'}
		<!-- Dashed outline only, no content -->
		<rect x="6" y="6" width="36" height="36" rx="2" stroke-dasharray="3 2" />
	{:else if type === 'surface_xy' || type === 'surface_xz' || type === 'surface_yz'}
		<!-- Three intersecting planes in isometric view, selected plane highlighted -->
		<!-- XY plane (horizontal / floor) -->
		<path d="M6 30 L24 38 L42 30 L24 22 Z"
			fill="currentColor" opacity={type === 'surface_xy' ? 0.25 : 0.06}
			stroke="currentColor" stroke-width={type === 'surface_xy' ? 2 : 1}
			stroke-opacity={type === 'surface_xy' ? 1 : 0.3} />
		<!-- XZ plane (vertical, left-right) -->
		<path d="M6 30 L6 14 L24 6 L24 22 Z"
			fill="currentColor" opacity={type === 'surface_xz' ? 0.25 : 0.06}
			stroke="currentColor" stroke-width={type === 'surface_xz' ? 2 : 1}
			stroke-opacity={type === 'surface_xz' ? 1 : 0.3} />
		<!-- YZ plane (vertical, front-back) -->
		<path d="M42 30 L42 14 L24 6 L24 22 Z"
			fill="currentColor" opacity={type === 'surface_yz' ? 0.25 : 0.06}
			stroke="currentColor" stroke-width={type === 'surface_yz' ? 2 : 1}
			stroke-opacity={type === 'surface_yz' ? 1 : 0.3} />
	{:else if type === 'dir_up'}
		<!-- Upward arrow -->
		<line x1="24" y1="40" x2="24" y2="12" stroke-width="2.5" />
		<line x1="24" y1="12" x2="17" y2="20" stroke-width="2.5" />
		<line x1="24" y1="12" x2="31" y2="20" stroke-width="2.5" />
	{:else if type === 'dir_down'}
		<!-- Downward arrow -->
		<line x1="24" y1="8" x2="24" y2="36" stroke-width="2.5" />
		<line x1="24" y1="36" x2="17" y2="28" stroke-width="2.5" />
		<line x1="24" y1="36" x2="31" y2="28" stroke-width="2.5" />
	{:else if type === 'dir_right'}
		<!-- Rightward arrow -->
		<line x1="8" y1="24" x2="36" y2="24" stroke-width="2.5" />
		<line x1="36" y1="24" x2="28" y2="17" stroke-width="2.5" />
		<line x1="36" y1="24" x2="28" y2="31" stroke-width="2.5" />
	{:else if type === 'dir_left'}
		<!-- Leftward arrow -->
		<line x1="40" y1="24" x2="12" y2="24" stroke-width="2.5" />
		<line x1="12" y1="24" x2="20" y2="17" stroke-width="2.5" />
		<line x1="12" y1="24" x2="20" y2="31" stroke-width="2.5" />
	{:else if type === 'dir_north'}
		<!-- Arrow pointing "north" (into screen / +Y) - arrow going up-right at angle -->
		<line x1="16" y1="36" x2="34" y2="14" stroke-width="2.5" />
		<line x1="34" y1="14" x2="26" y2="16" stroke-width="2.5" />
		<line x1="34" y1="14" x2="32" y2="22" stroke-width="2.5" />
	{:else if type === 'dir_south'}
		<!-- Arrow pointing "south" (out of screen / -Y) - arrow going down-left -->
		<line x1="34" y1="14" x2="16" y2="36" stroke-width="2.5" />
		<line x1="16" y1="36" x2="18" y2="28" stroke-width="2.5" />
		<line x1="16" y1="36" x2="24" y2="34" stroke-width="2.5" />
	{:else if type === 'dir_omni'}
		<!-- Omnidirectional - radiating arrows from center -->
		<circle cx="24" cy="24" r="3" fill="currentColor" stroke="none" />
		<line x1="24" y1="19" x2="24" y2="8" stroke-width="2" />
		<line x1="24" y1="8" x2="21" y2="12" stroke-width="2" />
		<line x1="24" y1="8" x2="27" y2="12" stroke-width="2" />
		<line x1="24" y1="29" x2="24" y2="40" stroke-width="2" />
		<line x1="24" y1="40" x2="21" y2="36" stroke-width="2" />
		<line x1="24" y1="40" x2="27" y2="36" stroke-width="2" />
		<line x1="29" y1="24" x2="40" y2="24" stroke-width="2" />
		<line x1="40" y1="24" x2="36" y2="21" stroke-width="2" />
		<line x1="40" y1="24" x2="36" y2="27" stroke-width="2" />
		<line x1="19" y1="24" x2="8" y2="24" stroke-width="2" />
		<line x1="8" y1="24" x2="12" y2="21" stroke-width="2" />
		<line x1="8" y1="24" x2="12" y2="27" stroke-width="2" />
	{:else if type === 'dir_bidir'}
		<!-- Bidirectional - two arrows pointing away from center -->
		<circle cx="24" cy="24" r="3" fill="currentColor" stroke="none" />
		<line x1="24" y1="19" x2="24" y2="8" stroke-width="2.5" />
		<line x1="24" y1="8" x2="20" y2="13" stroke-width="2.5" />
		<line x1="24" y1="8" x2="28" y2="13" stroke-width="2.5" />
		<line x1="24" y1="29" x2="24" y2="40" stroke-width="2.5" />
		<line x1="24" y1="40" x2="20" y2="35" stroke-width="2.5" />
		<line x1="24" y1="40" x2="28" y2="35" stroke-width="2.5" />
	{/if}
</svg>
