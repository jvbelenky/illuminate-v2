<script lang="ts">
	import { onDestroy } from 'svelte';
	import { project } from '$lib/stores/project';
	import type { CalcZone, RoomConfig, PlaneCalcType, RefSurface, ZoneDisplayMode } from '$lib/types/project';
	import { spacingFromNumPoints, numPointsFromSpacing } from '$lib/utils/calculations';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import CalcTypeIllustration from './CalcTypeIllustration.svelte';

	interface Props {
		zone: CalcZone;
		room: RoomConfig;
		onClose: () => void;
		onCopy?: (newId: string) => void;
		isStandard?: boolean;  // If true, only allow editing grid resolution
	}

	let { zone, room, onClose, onCopy, isStandard = false }: Props = $props();

	let showDeleteConfirm = $state(false);
	let calcTypeExpanded = $state(false);
	let offsetExpanded = $state(false);

	// Local state for editing - initialize from zone
	let type = $state<'plane' | 'volume'>(zone?.type || 'plane');
	// Migrate from legacy show_values boolean to display_mode
	let display_mode = $state<ZoneDisplayMode>(
		zone?.display_mode ?? (zone?.show_values === false ? 'markers' : 'heatmap')
	);

	// Plane-specific settings
	let height = $state(zone?.height ?? 1.0);
	let calc_type = $state<PlaneCalcType>(zone?.calc_type ?? 'planar_normal');
	let ref_surface = $state<RefSurface>(zone?.ref_surface ?? 'xy');
	let direction = $state(zone?.direction ?? 1);
	let fov_vert = $state(zone?.fov_vert ?? 180);
	let fov_horiz = $state(zone?.fov_horiz ?? 360);

	// Plane dimensions
	let x1 = $state(zone?.x1 ?? 0);
	let x2 = $state(zone?.x2 ?? room.x);
	let y1 = $state(zone?.y1 ?? 0);
	let y2 = $state(zone?.y2 ?? room.y);

	// Volume settings
	let x_min = $state(zone?.x_min ?? 0);
	let x_max = $state(zone?.x_max ?? room.x);
	let y_min = $state(zone?.y_min ?? 0);
	let y_max = $state(zone?.y_max ?? room.y);
	let z_min = $state(zone?.z_min ?? 0);
	let z_max = $state(zone?.z_max ?? room.z);

	// Value display settings
	let dose = $state(zone?.dose ?? false);
	let hours = $state(zone?.hours ?? 8);
	let offset = $state(zone?.offset ?? true);

	// Grid resolution settings
	type ResolutionMode = 'num_points' | 'spacing';
	let resolutionMode = $state<ResolutionMode>(zone?.x_spacing ? 'spacing' : 'num_points');

	// Default num_points based on room size (approx 0.5m spacing, cell model matches guv_calcs)
	function defaultNumPoints(span: number): number {
		return Math.max(2, Math.round(span / 0.5));
	}

	let num_x = $state(zone?.num_x ?? defaultNumPoints(room.x));
	let num_y = $state(zone?.num_y ?? defaultNumPoints(room.y));
	let num_z = $state(zone?.num_z ?? defaultNumPoints(room.z));
	let x_spacing = $state(zone?.x_spacing ?? 0.5);
	let y_spacing = $state(zone?.y_spacing ?? 0.5);
	let z_spacing = $state(zone?.z_spacing ?? 0.5);

	// Calculation type options with descriptions for illustrated selector
	const calcTypeDisplayOptions: { value: PlaneCalcType; title: string; description: string }[] = [
		{ value: 'fluence_rate', title: 'Fluence Rate',
			description: 'Points have no normal. They collect flux from all directions and report the total.' },
		{ value: 'planar_normal', title: 'Planar Normal',
			description: 'Normals are perpendicular to the calculation plane.' },
		{ value: 'planar_max', title: 'Planar Maximum',
			description: 'Calculates the maximum irradiance from any direction at each point.' },
		{ value: 'vertical', title: 'Vertical Irradiance',
			description: 'Values are collected in-plane with no normal, from both above and below the plane. Useful for eye dose (suggested FOV: 80° vert, 180° horiz).' },
		{ value: 'vertical_dir', title: 'Vertical (Directional)',
			description: 'Points have a defined normal direction. Values are only collected relative to that normal.' },
	];

	// Grid offset options with descriptions for illustrated selector
	const offsetDisplayOptions: { value: boolean; title: string; description: string; illustration: 'offset_on' | 'offset_off' }[] = [
		{ value: true, title: 'Offset from Boundary',
			description: 'Points are inset from the edges of the calc zone.',
			illustration: 'offset_on' },
		{ value: false, title: 'On the Boundary',
			description: 'Points lie on the edges and corners of the calc zone.',
			illustration: 'offset_off' },
	];

	// Reverse-map primitive fields to a PlaneCalcType (mirrors CalcPlane3D logic)
	function deriveCalcType(z: CalcZone): PlaneCalcType {
		if (z.calc_type) return z.calc_type;
		if (z.horiz) return 'planar_normal';
		if (z.vert) return z.direction ? 'vertical_dir' : 'vertical';
		return z.direction ? 'planar_max' : 'fluence_rate';
	}

	function calcTypeLabel(ct: PlaneCalcType): string {
		return calcTypeDisplayOptions.find(o => o.value === ct)?.title ?? ct;
	}

	// Derive horiz, vert, direction from calc_type
	function updateFromCalcType(ct: PlaneCalcType) {
		switch (ct) {
			case 'planar_normal':
				direction = 1;
				break;
			case 'planar_max':
				direction = 1;
				break;
			case 'fluence_rate':
				direction = 0;
				break;
			case 'vertical_dir':
				direction = 1;
				break;
			case 'vertical':
				direction = 0;
				break;
		}
	}

	// Computed spans for current zone type
	const span_x = $derived(type === 'plane' ? (x2 - x1) : (x_max - x_min));
	const span_y = $derived(type === 'plane' ? (y2 - y1) : (y_max - y_min));
	const span_z = $derived(z_max - z_min);

	// Axis labels and height label based on reference surface
	const axisLabels = $derived(() => {
		if (ref_surface === 'xy') return { a: 'X', b: 'Y', height: 'Z Height', heightMax: room.z };
		if (ref_surface === 'xz') return { a: 'X', b: 'Z', height: 'Y Position', heightMax: room.y };
		return { a: 'Y', b: 'Z', height: 'X Position', heightMax: room.x };
	});

	// Whether we need Z bounds for vertical planes (xz or yz)
	const needsZBounds = $derived(type === 'plane' && (ref_surface === 'xz' || ref_surface === 'yz'));

	// Auto-save when any field changes (debounced to prevent cascading updates)
	let saveTimeout: ReturnType<typeof setTimeout>;
	let isInitialized = false;

	// Track which grid fields were explicitly changed by user (not computed from mode toggle)
	// This prevents mode toggles from triggering unnecessary saves
	let userChangedGridFields = new Set<string>();

	// Helper to check if a value has changed from the original zone
	function hasChanged<T>(current: T, original: T | undefined): boolean {
		if (original === undefined) return false; // Don't consider "setting a default" as a change
		return current !== original;
	}

	$effect(() => {
		// Read all values to track them (this creates dependencies for reactivity)
		const allValues = {
			type,
			display_mode,
			dose,
			hours,
			offset,
			num_x,
			num_y,
			x_spacing,
			y_spacing,
			height,
			calc_type,
			ref_surface,
			direction,
			fov_vert,
			fov_horiz,
			x1, x2, y1, y2,
			z_min, z_max,
			x_min, x_max, y_min, y_max,
			num_z,
			z_spacing
		};

		// Skip the initial run
		if (!isInitialized) {
			isInitialized = true;
			return;
		}

		// Only include fields that have actually changed from the zone prop
		// This prevents clearing results when non-grid fields change
		const data: Partial<CalcZone> = {};

		// Always include these display-only fields (they don't affect calculations)
		if (allValues.type !== zone.type) data.type = allValues.type;
		if (allValues.display_mode !== zone.display_mode) data.display_mode = allValues.display_mode;
		if (allValues.dose !== zone.dose) data.dose = allValues.dose;
		if (allValues.dose && allValues.hours !== zone.hours) data.hours = allValues.hours;
		if (allValues.offset !== zone.offset) data.offset = allValues.offset;

		// Grid parameters - only save if user explicitly changed them
		// This prevents mode toggles from triggering unnecessary saves/recalculations
		// (toggling modes just computes complementary values, the effective grid stays the same)
		if (userChangedGridFields.has('num_x') && allValues.num_x !== zone.num_x) data.num_x = allValues.num_x;
		if (userChangedGridFields.has('num_y') && allValues.num_y !== zone.num_y) data.num_y = allValues.num_y;
		if (userChangedGridFields.has('x_spacing') && allValues.x_spacing !== zone.x_spacing) data.x_spacing = allValues.x_spacing;
		if (userChangedGridFields.has('y_spacing') && allValues.y_spacing !== zone.y_spacing) data.y_spacing = allValues.y_spacing;

		if (allValues.type === 'plane') {
			if (hasChanged(allValues.height, zone.height)) data.height = allValues.height;
			if (allValues.calc_type !== zone.calc_type) data.calc_type = allValues.calc_type;
			if (allValues.ref_surface !== zone.ref_surface) data.ref_surface = allValues.ref_surface;
			if (allValues.direction !== zone.direction) data.direction = allValues.direction;
			if (allValues.fov_vert !== zone.fov_vert) data.fov_vert = allValues.fov_vert;
			if (allValues.fov_horiz !== zone.fov_horiz) data.fov_horiz = allValues.fov_horiz;
			if (hasChanged(allValues.x1, zone.x1)) data.x1 = allValues.x1;
			if (hasChanged(allValues.x2, zone.x2)) data.x2 = allValues.x2;
			if (hasChanged(allValues.y1, zone.y1)) data.y1 = allValues.y1;
			if (hasChanged(allValues.y2, zone.y2)) data.y2 = allValues.y2;
			if (allValues.ref_surface === 'xz' || allValues.ref_surface === 'yz') {
				if (hasChanged(allValues.z_min, zone.z_min)) data.z_min = allValues.z_min;
				if (hasChanged(allValues.z_max, zone.z_max)) data.z_max = allValues.z_max;
			}
		} else {
			// Volume dimensions: always save if different from zone value
			// (don't use hasChanged since zone values may be undefined when switching from plane)
			if (allValues.x_min !== zone.x_min) data.x_min = allValues.x_min;
			if (allValues.x_max !== zone.x_max) data.x_max = allValues.x_max;
			if (allValues.y_min !== zone.y_min) data.y_min = allValues.y_min;
			if (allValues.y_max !== zone.y_max) data.y_max = allValues.y_max;
			if (allValues.z_min !== zone.z_min) data.z_min = allValues.z_min;
			if (allValues.z_max !== zone.z_max) data.z_max = allValues.z_max;
			// Grid z-axis - only save if user explicitly changed
			if (userChangedGridFields.has('num_z') && allValues.num_z !== zone.num_z) data.num_z = allValues.num_z;
			if (userChangedGridFields.has('z_spacing') && allValues.z_spacing !== zone.z_spacing) data.z_spacing = allValues.z_spacing;
		}

		// Only update if there are actual changes
		if (Object.keys(data).length === 0) return;

		// Debounce updates to prevent cascading re-renders
		clearTimeout(saveTimeout);
		saveTimeout = setTimeout(() => {
			project.updateZone(zone.id, data);
			// Clear the user-changed flags after save
			userChangedGridFields.clear();
		}, 100);
	});

	// Cleanup timer on unmount to prevent memory leaks
	onDestroy(() => {
		clearTimeout(saveTimeout);
	});

	// Round to 3 decimal places
	function round3(val: number): number {
		return Math.round(val * 1000) / 1000;
	}

	// Update spacing when num_points changes (if in num_points mode)
	function updateSpacingFromNumPoints() {
		x_spacing = round3(spacingFromNumPoints(span_x, num_x));
		y_spacing = round3(spacingFromNumPoints(span_y, num_y));
		if (type === 'volume') {
			z_spacing = round3(spacingFromNumPoints(span_z, num_z));
		}
	}

	// Update num_points when spacing changes (if in spacing mode)
	function updateNumPointsFromSpacing() {
		num_x = numPointsFromSpacing(span_x, x_spacing);
		num_y = numPointsFromSpacing(span_y, y_spacing);
		if (type === 'volume') {
			num_z = numPointsFromSpacing(span_z, z_spacing);
		}
	}

	// Toggle resolution mode
	function toggleResolutionMode() {
		if (resolutionMode === 'num_points') {
			updateSpacingFromNumPoints();
			resolutionMode = 'spacing';
		} else {
			updateNumPointsFromSpacing();
			resolutionMode = 'num_points';
		}
	}

	// Handle num_x/num_y/num_z input changes
	function handleNumPointsChange() {
		// Mark as user-changed so the effect will save them
		userChangedGridFields.add('num_x');
		userChangedGridFields.add('num_y');
		if (type === 'volume') userChangedGridFields.add('num_z');
		if (resolutionMode === 'num_points') {
			updateSpacingFromNumPoints();
		}
	}

	// Handle spacing input change
	function handleSpacingChange() {
		// Mark as user-changed so the effect will save them
		userChangedGridFields.add('x_spacing');
		userChangedGridFields.add('y_spacing');
		if (type === 'volume') userChangedGridFields.add('z_spacing');
		if (resolutionMode === 'spacing') {
			updateNumPointsFromSpacing();
		}
	}

	// Handle calc_type change
	function handleCalcTypeChange() {
		updateFromCalcType(calc_type);
	}

	// Handle ref_surface change - reset dimensions to match new surface
	function handleRefSurfaceChange() {
		if (ref_surface === 'xy') {
			// Horizontal plane: x1/x2 = X range, y1/y2 = Y range, height = Z position
			x1 = 0; x2 = room.x;
			y1 = 0; y2 = room.y;
			// Cap height to room.z
			if (height > room.z) height = room.z / 2;
		} else if (ref_surface === 'xz') {
			// Vertical plane facing Y: x1/x2 = X range, z_min/z_max = Z range, height = Y position
			x1 = 0; x2 = room.x;
			z_min = 0; z_max = room.z;
			// Cap height to room.y
			if (height > room.y) height = room.y / 2;
		} else {
			// Vertical plane facing X: y1/y2 = Y range, z_min/z_max = Z range, height = X position
			y1 = 0; y2 = room.y;
			z_min = 0; z_max = room.z;
			// Cap height to room.x
			if (height > room.x) height = room.x / 2;
		}
	}

	function remove() {
		showDeleteConfirm = true;
	}

	function copy() {
		const newId = project.copyZone(zone.id);
		onClose();
		onCopy?.(newId);
	}

	// Quick presets for planes
	function setFloorLevel() {
		height = 0.1;
	}

	function setWorkingHeight() {
		height = room.units === 'meters' ? 0.75 : 2.5;
	}

	function setHeadHeight() {
		height = room.units === 'meters' ? 1.7 : 5.5;
	}

	// Preset for whole room volume
	function setWholeRoom() {
		x_min = 0; x_max = room.x;
		y_min = 0; y_max = room.y;
		z_min = 0; z_max = room.z;
	}

	// Set plane to full room extent
	function setFullExtent() {
		if (ref_surface === 'xy') {
			x1 = 0; x2 = room.x;
			y1 = 0; y2 = room.y;
		} else if (ref_surface === 'xz') {
			x1 = 0; x2 = room.x;
			z_min = 0; z_max = room.z;
		} else {
			y1 = 0; y2 = room.y;
			z_min = 0; z_max = room.z;
		}
	}

	// Need to show direction selector?
	const showDirectionSelector = $derived(direction !== 0);
</script>

<div class="zone-editor" class:standard-zone-editor={isStandard}>
	<button class="close-x" onclick={onClose} title="Close">&times;</button>
	{#if isStandard}
		<div class="standard-zone-header">
			<span class="standard-info">Grid resolution only</span>
		</div>
	{/if}

	{#if !isStandard}
		<div class="form-group">
			<label>Type</label>
			<div class="zone-type-buttons">
				<button
					type="button"
					class="zone-type-btn"
					class:active={type === 'plane'}
					title="CalcPlane"
					onclick={() => type = 'plane'}
				>
					<CalcTypeIllustration type="calc_plane" size={48} />
					<span class="zone-type-label">Plane</span>
				</button>
				<button
					type="button"
					class="zone-type-btn"
					class:active={type === 'volume'}
					title="CalcVol"
					onclick={() => type = 'volume'}
				>
					<CalcTypeIllustration type="calc_vol" size={48} />
					<span class="zone-type-label">Volume</span>
				</button>
			</div>
		</div>
	{:else}
		<!-- Standard zone: display all parameters read-only -->
		<div class="standard-zone-params">
			<div class="param-row">
				<span class="param-label">Name</span>
				<span class="param-value">{zone.name || zone.id}</span>
			</div>
			<div class="param-row">
				<span class="param-label">Type</span>
				<span class="param-value">{zone.type === 'plane' ? 'Plane (CalcPlane)' : 'Volume (CalcVol)'}</span>
			</div>
			{#if zone.type === 'plane'}
				<div class="param-row">
					<span class="param-label">{axisLabels().height}</span>
					<span class="param-value">{zone.height} {room.units}</span>
				</div>
				<div class="param-row">
					<span class="param-label">Reference Surface</span>
					<span class="param-value">
						{#if zone.ref_surface === 'xz'}XZ (Vertical)
						{:else if zone.ref_surface === 'yz'}YZ (Vertical)
						{:else}XY (Horizontal)
						{/if}
					</span>
				</div>
				<div class="param-row">
					<span class="param-label">Dose Type</span>
					<span class="param-value">{calcTypeLabel(deriveCalcType(zone))}</span>
				</div>
				<div class="param-row">
					<span class="param-label">FOV</span>
					<span class="param-value">{zone.fov_vert ?? 80}° vert, {zone.fov_horiz ?? 360}° horiz</span>
				</div>
				<div class="param-row">
					<span class="param-label">Bounds</span>
					<span class="param-value">
						{#if zone.ref_surface === 'xz'}
							X: {zone.x1 ?? 0} - {zone.x2 ?? room.x}, Z: {zone.z_min ?? 0} - {zone.z_max ?? room.z}
						{:else if zone.ref_surface === 'yz'}
							Y: {zone.y1 ?? 0} - {zone.y2 ?? room.y}, Z: {zone.z_min ?? 0} - {zone.z_max ?? room.z}
						{:else}
							X: {zone.x1 ?? 0} - {zone.x2 ?? room.x}, Y: {zone.y1 ?? 0} - {zone.y2 ?? room.y}
						{/if}
					</span>
				</div>
			{:else}
				<!-- Volume bounds -->
				<div class="param-row">
					<span class="param-label">X Range</span>
					<span class="param-value">{zone.x_min ?? 0} - {zone.x_max ?? room.x} {room.units}</span>
				</div>
				<div class="param-row">
					<span class="param-label">Y Range</span>
					<span class="param-value">{zone.y_min ?? 0} - {zone.y_max ?? room.y} {room.units}</span>
				</div>
				<div class="param-row">
					<span class="param-label">Z Range</span>
					<span class="param-value">{zone.z_min ?? 0} - {zone.z_max ?? room.z} {room.units}</span>
				</div>
			{/if}
			<div class="param-row">
				<span class="param-label">Value Display</span>
				<span class="param-value">
					{zone.dose ? `Dose (${zone.hours ?? 8}h)` : (zone.type === 'plane' ? 'Irradiance' : 'Fluence Rate')}
				</span>
			</div>
		</div>
	{/if}

	{#if type === 'plane' && !isStandard}
		<!-- Plane-specific settings -->
		<div class="form-group">
			<label>Calculation Type</label>
			<button
				type="button"
				class="illustrated-selector-summary"
				onclick={() => calcTypeExpanded = !calcTypeExpanded}
			>
				<CalcTypeIllustration type={calc_type} size={24} />
				<span class="summary-title">{calcTypeDisplayOptions.find(o => o.value === calc_type)?.title ?? calc_type}</span>
				<svg class="chevron" class:expanded={calcTypeExpanded} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M6 9l6 6 6-6" />
				</svg>
			</button>
			{#if calcTypeExpanded}
				<div class="illustrated-selector-options">
					{#each calcTypeDisplayOptions as opt}
						<button
							type="button"
							class="illustrated-option"
							class:selected={calc_type === opt.value}
							onclick={() => { calc_type = opt.value; handleCalcTypeChange(); calcTypeExpanded = false; }}
						>
							<CalcTypeIllustration type={opt.value} size={48} />
							<div class="option-text">
								<span class="option-title">{opt.title}</span>
								<span class="option-description">{opt.description}</span>
							</div>
						</button>
					{/each}
				</div>
			{/if}
		</div>

		<div class="form-row two-col">
			<div class="form-group">
				<label for="ref-surface">Reference Surface</label>
				<select id="ref-surface" bind:value={ref_surface} onchange={handleRefSurfaceChange}>
					<option value="xy">XY (Horizontal)</option>
					<option value="xz">XZ (Vertical, along X)</option>
					<option value="yz">YZ (Vertical, along Y)</option>
				</select>
			</div>

			{#if showDirectionSelector}
				<div class="form-group">
					<label for="direction">Normal Direction</label>
					<select id="direction" bind:value={direction}>
						<option value={1}>+1 (Up/Positive)</option>
						<option value={-1}>-1 (Down/Negative)</option>
					</select>
				</div>
			{:else}
				<div class="form-group">
					<label>Normal Direction</label>
					<span class="readonly-value">Omnidirectional</span>
				</div>
			{/if}
		</div>

		<div class="form-row two-col">
			<div class="form-group">
				<label for="fov-vert">Vertical FOV (deg)</label>
				<input id="fov-vert" type="number" bind:value={fov_vert} min="0" max="180" step="1" />
				<span class="help-text">For eye dose. 80° per ANSI/IES RP 27.1-22</span>
			</div>
			<div class="form-group">
				<label for="fov-horiz">Horizontal FOV (deg)</label>
				<input id="fov-horiz" type="number" bind:value={fov_horiz} min="0" max="360" step="1" />
				<span class="help-text">In-plane field of view</span>
			</div>
		</div>

		<div class="form-group">
			<label for="plane-height">{axisLabels().height} ({room.units})</label>
			<input id="plane-height" type="text" inputmode="decimal" value={height.toFixed(room.precision)} onchange={(e) => height = parseFloat((e.target as HTMLInputElement).value) || 0} />
			{#if ref_surface === 'xy'}
				<div class="presets">
					<button type="button" class="secondary small" onclick={setFloorLevel}>Floor</button>
					<button type="button" class="secondary small" onclick={setWorkingHeight}>Work Surface</button>
					<button type="button" class="secondary small" onclick={setHeadHeight}>Head Height</button>
				</div>
			{/if}
		</div>

		<!-- Plane dimensions - varies by ref_surface -->
		{#if ref_surface === 'xy'}
			<!-- Horizontal plane: X and Y ranges -->
			<div class="form-group">
				<label>X Range</label>
				<div class="range-row">
					<input type="text" inputmode="decimal" value={x1.toFixed(room.precision)} onchange={(e) => x1 = parseFloat((e.target as HTMLInputElement).value) || 0} placeholder="Min" />
					<span class="range-sep">to</span>
					<input type="text" inputmode="decimal" value={x2.toFixed(room.precision)} onchange={(e) => x2 = parseFloat((e.target as HTMLInputElement).value) || 0} placeholder="Max" />
				</div>
			</div>
			<div class="form-group">
				<label>Y Range</label>
				<div class="range-row">
					<input type="text" inputmode="decimal" value={y1.toFixed(room.precision)} onchange={(e) => y1 = parseFloat((e.target as HTMLInputElement).value) || 0} placeholder="Min" />
					<span class="range-sep">to</span>
					<input type="text" inputmode="decimal" value={y2.toFixed(room.precision)} onchange={(e) => y2 = parseFloat((e.target as HTMLInputElement).value) || 0} placeholder="Max" />
				</div>
				<div class="presets">
					<button type="button" class="secondary small" onclick={setFullExtent}>Full Room</button>
				</div>
			</div>
		{:else if ref_surface === 'xz'}
			<!-- Vertical plane (XZ): X and Z ranges -->
			<div class="form-group">
				<label>X Range</label>
				<div class="range-row">
					<input type="text" inputmode="decimal" value={x1.toFixed(room.precision)} onchange={(e) => x1 = parseFloat((e.target as HTMLInputElement).value) || 0} placeholder="Min" />
					<span class="range-sep">to</span>
					<input type="text" inputmode="decimal" value={x2.toFixed(room.precision)} onchange={(e) => x2 = parseFloat((e.target as HTMLInputElement).value) || 0} placeholder="Max" />
				</div>
			</div>
			<div class="form-group">
				<label>Z Range</label>
				<div class="range-row">
					<input type="text" inputmode="decimal" value={z_min.toFixed(room.precision)} onchange={(e) => z_min = parseFloat((e.target as HTMLInputElement).value) || 0} placeholder="Min" />
					<span class="range-sep">to</span>
					<input type="text" inputmode="decimal" value={z_max.toFixed(room.precision)} onchange={(e) => z_max = parseFloat((e.target as HTMLInputElement).value) || 0} placeholder="Max" />
				</div>
				<div class="presets">
					<button type="button" class="secondary small" onclick={setFullExtent}>Full Room</button>
				</div>
			</div>
		{:else}
			<!-- Vertical plane (YZ): Y and Z ranges -->
			<div class="form-group">
				<label>Y Range</label>
				<div class="range-row">
					<input type="text" inputmode="decimal" value={y1.toFixed(room.precision)} onchange={(e) => y1 = parseFloat((e.target as HTMLInputElement).value) || 0} placeholder="Min" />
					<span class="range-sep">to</span>
					<input type="text" inputmode="decimal" value={y2.toFixed(room.precision)} onchange={(e) => y2 = parseFloat((e.target as HTMLInputElement).value) || 0} placeholder="Max" />
				</div>
			</div>
			<div class="form-group">
				<label>Z Range</label>
				<div class="range-row">
					<input type="text" inputmode="decimal" value={z_min.toFixed(room.precision)} onchange={(e) => z_min = parseFloat((e.target as HTMLInputElement).value) || 0} placeholder="Min" />
					<span class="range-sep">to</span>
					<input type="text" inputmode="decimal" value={z_max.toFixed(room.precision)} onchange={(e) => z_max = parseFloat((e.target as HTMLInputElement).value) || 0} placeholder="Max" />
				</div>
				<div class="presets">
					<button type="button" class="secondary small" onclick={setFullExtent}>Full Room</button>
				</div>
			</div>
		{/if}
	{/if}

	{#if type === 'volume' && !isStandard}
		<div class="form-group">
			<label>Calculation Type</label>
			<span class="readonly-value">Fluence Rate</span>
		</div>
		<!-- Volume dimensions -->
		<div class="form-group">
			<label>X Range</label>
			<div class="range-row">
				<input type="text" inputmode="decimal" value={x_min.toFixed(room.precision)} onchange={(e) => x_min = parseFloat((e.target as HTMLInputElement).value) || 0} placeholder="Min" />
				<span class="range-sep">to</span>
				<input type="text" inputmode="decimal" value={x_max.toFixed(room.precision)} onchange={(e) => x_max = parseFloat((e.target as HTMLInputElement).value) || 0} placeholder="Max" />
			</div>
		</div>

		<div class="form-group">
			<label>Y Range</label>
			<div class="range-row">
				<input type="text" inputmode="decimal" value={y_min.toFixed(room.precision)} onchange={(e) => y_min = parseFloat((e.target as HTMLInputElement).value) || 0} placeholder="Min" />
				<span class="range-sep">to</span>
				<input type="text" inputmode="decimal" value={y_max.toFixed(room.precision)} onchange={(e) => y_max = parseFloat((e.target as HTMLInputElement).value) || 0} placeholder="Max" />
			</div>
		</div>

		<div class="form-group">
			<label>Z Range</label>
			<div class="range-row">
				<input type="text" inputmode="decimal" value={z_min.toFixed(room.precision)} onchange={(e) => z_min = parseFloat((e.target as HTMLInputElement).value) || 0} placeholder="Min" />
				<span class="range-sep">to</span>
				<input type="text" inputmode="decimal" value={z_max.toFixed(room.precision)} onchange={(e) => z_max = parseFloat((e.target as HTMLInputElement).value) || 0} placeholder="Max" />
			</div>
			<div class="presets">
				<button type="button" class="secondary small" onclick={setWholeRoom}>Whole Room</button>
			</div>
		</div>
	{/if}

	<!-- Grid Resolution -->
	<div class="form-group">
		<div class="resolution-header">
			<label>{resolutionMode === 'num_points' ? 'Grid Points' : 'Spacing'}</label>
			<button type="button" class="mode-switch-btn" onclick={toggleResolutionMode}>
				{resolutionMode === 'num_points' ? 'Set Spacing' : 'Set Num Points'}
			</button>
		</div>

		{#if resolutionMode === 'num_points'}
			<div class="grid-inputs">
				<div class="grid-input">
					<span class="input-label">{type === 'plane' ? axisLabels().a : 'X'}</span>
					<input
						type="number"
						value={num_x}
						oninput={(e) => { num_x = parseInt((e.target as HTMLInputElement).value) || 2; handleNumPointsChange(); }}
						min="2"
						max="200"
						step="1"
					/>
				</div>
				<span class="input-sep">x</span>
				<div class="grid-input">
					<span class="input-label">{type === 'plane' ? axisLabels().b : 'Y'}</span>
					<input
						type="number"
						value={num_y}
						oninput={(e) => { num_y = parseInt((e.target as HTMLInputElement).value) || 2; handleNumPointsChange(); }}
						min="2"
						max="200"
						step="1"
					/>
				</div>
				{#if type === 'volume'}
					<span class="input-sep">x</span>
					<div class="grid-input">
						<span class="input-label">Z</span>
						<input
							type="number"
							value={num_z}
							oninput={(e) => { num_z = parseInt((e.target as HTMLInputElement).value) || 2; handleNumPointsChange(); }}
							min="2"
							max="200"
							step="1"
						/>
					</div>
				{/if}
			</div>
			<div class="computed-value">
				Spacing: {x_spacing.toFixed(2)} x {y_spacing.toFixed(2)}{type === 'volume' ? ` x ${z_spacing.toFixed(2)}` : ''} {room.units}
			</div>
		{:else}
			<div class="grid-inputs">
				<div class="grid-input">
					<span class="input-label">{type === 'plane' ? axisLabels().a : 'X'}</span>
					<input
						type="number"
						value={x_spacing}
						oninput={(e) => { const v = parseFloat((e.target as HTMLInputElement).value); if (v > 0) { x_spacing = v; handleSpacingChange(); } }}
						step="any"
					/>
				</div>
				<span class="input-sep">x</span>
				<div class="grid-input">
					<span class="input-label">{type === 'plane' ? axisLabels().b : 'Y'}</span>
					<input
						type="number"
						value={y_spacing}
						oninput={(e) => { const v = parseFloat((e.target as HTMLInputElement).value); if (v > 0) { y_spacing = v; handleSpacingChange(); } }}
						step="any"
					/>
				</div>
				{#if type === 'volume'}
					<span class="input-sep">x</span>
					<div class="grid-input">
						<span class="input-label">Z</span>
						<input
							type="number"
							value={z_spacing}
							oninput={(e) => { const v = parseFloat((e.target as HTMLInputElement).value); if (v > 0) { z_spacing = v; handleSpacingChange(); } }}
							step="any"
						/>
					</div>
				{/if}
				<span class="input-unit">{room.units}</span>
			</div>
			<div class="computed-value">
				Grid: {num_x} x {num_y}{type === 'volume' ? ` x ${num_z}` : ''} points
			</div>
		{/if}
	</div>

	<!-- Value Display Options -->
	{#if !isStandard}
		<div class="form-group">
			<label for="value-type">Value Display</label>
			<select id="value-type" bind:value={dose}>
				<option value={false}>{type === 'plane' ? 'Irradiance (µW/cm²)' : 'Fluence Rate (µW/cm²)'}</option>
				<option value={true}>Dose (mJ/cm²)</option>
			</select>
		</div>

		{#if dose}
			<div class="form-group">
				<label for="hours">Exposure Time (hours)</label>
				<input id="hours" type="number" bind:value={hours} step="any" />
			</div>
		{/if}
	{/if}

	<div class="form-group">
		<label>Grid Offset</label>
		<button
			type="button"
			class="illustrated-selector-summary"
			onclick={() => offsetExpanded = !offsetExpanded}
		>
			<CalcTypeIllustration type={offset ? 'offset_on' : 'offset_off'} size={24} />
			<span class="summary-title">{offsetDisplayOptions.find(o => o.value === offset)?.title}</span>
			<svg class="chevron" class:expanded={offsetExpanded} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M6 9l6 6 6-6" />
			</svg>
		</button>
		{#if offsetExpanded}
			<div class="illustrated-selector-options">
				{#each offsetDisplayOptions as opt}
					<button
						type="button"
						class="illustrated-option"
						class:selected={offset === opt.value}
						onclick={() => { offset = opt.value; offsetExpanded = false; }}
					>
						<CalcTypeIllustration type={opt.illustration} size={48} />
						<div class="option-text">
							<span class="option-title">{opt.title}</span>
							<span class="option-description">{opt.description}</span>
						</div>
					</button>
				{/each}
			</div>
		{/if}
	</div>

	<div class="form-group">
		<label>Display</label>
		<div class="zone-type-buttons">
			<button
				type="button"
				class="zone-type-btn"
				class:active={display_mode === 'heatmap'}
				title={type === 'volume' ? 'Isoirradiance' : 'Heatmap'}
				onclick={() => display_mode = 'heatmap'}
			>
				<CalcTypeIllustration type="display_heatmap" size={36} />
				<span class="zone-type-label">{type === 'volume' ? 'Iso' : 'Heatmap'}</span>
			</button>
			<button
				type="button"
				class="zone-type-btn"
				class:active={display_mode === 'numeric'}
				title="Numeric"
				onclick={() => display_mode = 'numeric'}
			>
				<CalcTypeIllustration type="display_numeric" size={36} />
				<span class="zone-type-label">Numeric</span>
			</button>
			<button
				type="button"
				class="zone-type-btn"
				class:active={display_mode === 'markers'}
				title="Markers Only"
				onclick={() => display_mode = 'markers'}
			>
				<CalcTypeIllustration type="display_markers" size={36} />
				<span class="zone-type-label">Markers</span>
			</button>
		</div>
	</div>

	<div class="editor-actions">
		{#if !isStandard}
			<button class="delete-btn" onclick={remove}>Delete</button>
		{/if}
		<button class="secondary" onclick={copy}>Copy</button>
		<button class="secondary" onclick={onClose}>Close</button>
	</div>
</div>

{#if showDeleteConfirm}
	<ConfirmDialog
		title="Delete Zone"
		message="Delete this zone? This action cannot be undone."
		confirmLabel="Delete"
		variant="danger"
		onConfirm={() => { showDeleteConfirm = false; project.removeZone(zone.id); onClose(); }}
		onCancel={() => showDeleteConfirm = false}
	/>
{/if}

<style>
	.zone-editor {
		position: relative;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--spacing-md);
	}

	.close-x {
		position: absolute;
		top: var(--spacing-xs);
		right: var(--spacing-xs);
		background: none;
		border: none;
		font-size: 1.25rem;
		line-height: 1;
		color: var(--color-text-muted);
		cursor: pointer;
		padding: 2px 6px;
		border-radius: var(--radius-sm);
	}

	.close-x:hover {
		color: var(--color-text);
		background: var(--color-bg-tertiary);
	}

	.standard-zone-header {
		margin-bottom: var(--spacing-sm);
	}

	.zone-type-buttons {
		display: flex;
		gap: var(--spacing-sm);
	}

	.zone-type-btn {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--spacing-xs);
		width: 80px;
		padding: var(--spacing-sm);
		background: var(--color-bg);
		border: 2px solid var(--color-bg);
		border-radius: var(--radius-sm);
		cursor: pointer;
		color: var(--color-text-muted);
		transition: all 0.15s;
	}

	.zone-type-label {
		font-size: var(--font-size-xs);
		font-weight: 500;
	}

	.zone-type-btn:hover:not(.active) {
		border-color: var(--color-border);
		color: var(--color-text);
	}

	.zone-type-btn.active {
		background: var(--color-bg-tertiary);
		border-color: var(--color-highlight);
		color: var(--color-text);
	}

	.form-row {
		display: flex;
		gap: var(--spacing-md);
	}

	.form-row.two-col > .form-group {
		flex: 1;
	}

	.range-row {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
	}

	.range-row input {
		flex: 1;
	}

	.range-sep {
		color: var(--color-text-muted);
		font-size: var(--font-size-base);
	}

	.presets {
		display: flex;
		gap: var(--spacing-xs);
		margin-top: var(--spacing-sm);
		flex-wrap: wrap;
	}

	.small {
		padding: var(--spacing-xs) var(--spacing-sm);
		font-size: var(--font-size-sm);
	}

	.editor-actions {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(0, 1fr));
		margin-top: var(--spacing-lg);
		padding-top: var(--spacing-md);
		border-top: 1px solid var(--color-border);
		gap: var(--spacing-sm);
	}

	.editor-actions button {
		border-radius: var(--radius-lg, 8px);
	}

	.delete-btn {
		background: transparent;
		color: var(--color-error);
		border: 1px solid var(--color-error);
	}

	.delete-btn:hover {
		background: color-mix(in srgb, var(--color-error) 10%, transparent);
	}

	.resolution-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--spacing-sm);
	}

	.resolution-header label {
		margin-bottom: 0;
	}

	.mode-switch-btn {
		padding: 2px var(--spacing-sm);
		font-size: var(--font-size-xs);
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		cursor: pointer;
		color: var(--color-text);
		transition: all 0.15s;
	}

	.mode-switch-btn:hover {
		background: var(--color-border);
		border-color: var(--color-text-muted);
	}

	.grid-inputs {
		display: flex;
		align-items: flex-end;
		gap: var(--spacing-sm);
	}

	.grid-input {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.grid-input input {
		width: 100%;
	}

	.input-label {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.input-sep {
		color: var(--color-text-muted);
		font-size: var(--font-size-base);
		padding-bottom: 8px;
	}

	.input-unit {
		color: var(--color-text-muted);
		font-size: var(--font-size-base);
		padding-bottom: 8px;
		white-space: nowrap;
	}

	.computed-value {
		margin-top: var(--spacing-sm);
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		font-family: var(--font-mono);
	}

	.help-text {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		margin-top: 2px;
	}

	.readonly-value {
		display: block;
		padding: var(--spacing-sm);
		background: var(--color-bg-tertiary);
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		font-size: var(--font-size-base);
	}

	/* Standard zone styles */
	.standard-zone-editor {
		border-color: var(--color-highlight);
	}

	.standard-info {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		font-style: italic;
	}

	.standard-zone-params {
		background: var(--color-bg-tertiary);
		border-radius: var(--radius-sm);
		padding: var(--spacing-sm);
		margin-bottom: var(--spacing-md);
	}

	.param-row {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		padding: var(--spacing-xs) 0;
		border-bottom: 1px solid var(--color-border);
		font-size: var(--font-size-base);
	}

	.param-row:last-child {
		border-bottom: none;
	}

	.param-label {
		color: var(--color-text-muted);
		font-weight: 500;
		flex-shrink: 0;
		margin-right: var(--spacing-sm);
	}

	.param-value {
		color: var(--color-text);
		text-align: right;
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}

	/* Illustrated selector styles */
	.illustrated-selector-summary {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		width: 100%;
		padding: var(--spacing-sm);
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		cursor: pointer;
		color: var(--color-text);
		font-size: var(--font-size-base);
		text-align: left;
		transition: border-color 0.15s;
	}

	.illustrated-selector-summary:hover {
		border-color: var(--color-highlight);
	}

	.summary-title {
		flex: 1;
		font-weight: 500;
	}

	.chevron {
		flex-shrink: 0;
		color: var(--color-text-muted);
		transition: transform 0.15s;
	}

	.chevron.expanded {
		transform: rotate(180deg);
	}

	.illustrated-selector-options {
		display: flex;
		flex-direction: column;
		gap: 1px;
		margin-top: var(--spacing-xs);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}

	.illustrated-option {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		padding: var(--spacing-sm);
		background: var(--color-bg);
		border: none;
		border-left: 3px solid transparent;
		cursor: pointer;
		color: var(--color-text);
		text-align: left;
		transition: all 0.15s;
	}

	.illustrated-option:hover {
		background: var(--color-bg-secondary);
	}

	.illustrated-option.selected {
		background: color-mix(in srgb, var(--color-highlight) 8%, var(--color-bg));
		border-left-color: var(--color-highlight);
	}

	.option-text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		flex: 1;
	}

	.option-title {
		font-weight: 500;
		font-size: var(--font-size-base);
	}

	.option-description {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		line-height: 1.3;
	}
</style>
