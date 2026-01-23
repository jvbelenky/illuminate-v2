<script lang="ts">
	import { project } from '$lib/stores/project';
	import type { CalcZone, RoomConfig, PlaneCalcType, RefSurface } from '$lib/types/project';
	import { spacingFromNumPoints, numPointsFromSpacing } from '$lib/utils/calculations';

	interface Props {
		zone: CalcZone;
		room: RoomConfig;
		onClose: () => void;
		isStandard?: boolean;  // If true, only allow editing grid resolution
	}

	let { zone, room, onClose, isStandard = false }: Props = $props();

	// Local state for editing - initialize from zone
	let name = $state(zone?.name || '');
	let type = $state<'plane' | 'volume'>(zone?.type || 'plane');
	let enabled = $state(zone?.enabled ?? true);
	let show_values = $state(zone?.show_values ?? true);

	// Plane-specific settings
	let height = $state(zone?.height ?? 1.0);
	let calc_type = $state<PlaneCalcType>(zone?.calc_type ?? 'fluence_rate');
	let ref_surface = $state<RefSurface>(zone?.ref_surface ?? 'xy');
	let direction = $state(zone?.direction ?? 0);
	let fov_vert = $state(zone?.fov_vert ?? 80);
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

	// Default num_points based on room size (approx 0.5m spacing)
	function defaultNumPoints(span: number): number {
		return Math.max(2, Math.ceil(span / 0.5) + 1);
	}

	let num_x = $state(zone?.num_x ?? defaultNumPoints(room.x));
	let num_y = $state(zone?.num_y ?? defaultNumPoints(room.y));
	let num_z = $state(zone?.num_z ?? defaultNumPoints(room.z));
	let x_spacing = $state(zone?.x_spacing ?? 0.5);
	let y_spacing = $state(zone?.y_spacing ?? 0.5);
	let z_spacing = $state(zone?.z_spacing ?? 0.5);

	// Calculation type options
	const calcTypeOptions: { value: PlaneCalcType; label: string }[] = [
		{ value: 'planar_normal', label: 'Planar Normal (Horizontal irradiance, directional)' },
		{ value: 'planar_max', label: 'Planar Maximum (All angles, directional)' },
		{ value: 'fluence_rate', label: 'Fluence Rate (All angles)' },
		{ value: 'vertical_dir', label: 'Vertical irradiance (Directional)' },
		{ value: 'vertical', label: 'Vertical irradiance' }
	];

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
			name: name || undefined,
			type,
			enabled,
			show_values,
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
		if (allValues.name !== (zone.name || undefined)) data.name = allValues.name;
		if (allValues.enabled !== zone.enabled) data.enabled = allValues.enabled;
		if (allValues.show_values !== zone.show_values) data.show_values = allValues.show_values;
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
			if (hasChanged(allValues.x_min, zone.x_min)) data.x_min = allValues.x_min;
			if (hasChanged(allValues.x_max, zone.x_max)) data.x_max = allValues.x_max;
			if (hasChanged(allValues.y_min, zone.y_min)) data.y_min = allValues.y_min;
			if (hasChanged(allValues.y_max, zone.y_max)) data.y_max = allValues.y_max;
			if (hasChanged(allValues.z_min, zone.z_min)) data.z_min = allValues.z_min;
			if (hasChanged(allValues.z_max, zone.z_max)) data.z_max = allValues.z_max;
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
		if (confirm('Delete this zone?')) {
			project.removeZone(zone.id);
			onClose();
		}
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
	<div class="editor-header">
		<h3>{isStandard ? 'Standard Zone' : 'Edit Zone'}</h3>
		<div class="header-right">
			{#if isStandard}
				<span class="standard-info">Grid resolution only</span>
			{/if}
			<button type="button" class="close-btn" onclick={onClose} title="Close">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M18 6L6 18M6 6l12 12"/>
				</svg>
			</button>
		</div>
	</div>

	{#if !isStandard}
		<div class="form-group">
			<label for="zone-name">Name</label>
			<input id="zone-name" type="text" bind:value={name} placeholder="Unnamed" />
		</div>

		<div class="form-group">
			<label for="zone-type">Type</label>
			<select id="zone-type" bind:value={type}>
				<option value="plane">Plane (CalcPlane)</option>
				<option value="volume">Volume (CalcVol)</option>
			</select>
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
					<span class="param-label">Direction</span>
					<span class="param-value">
						{#if zone.direction === 1}+1 (Positive)
						{:else if zone.direction === -1}-1 (Negative)
						{:else}Omnidirectional
						{/if}
					</span>
				</div>
				<div class="param-row">
					<span class="param-label">FOV</span>
					<span class="param-value">{zone.fov_vert ?? 80}° vert, {zone.fov_horiz ?? 360}° horiz</span>
				</div>
				<div class="param-row">
					<span class="param-label">Horiz/Vert Components</span>
					<span class="param-value">
						{zone.horiz ? 'Horiz' : ''}{zone.horiz && zone.vert ? ' + ' : ''}{zone.vert ? 'Vert' : ''}{!zone.horiz && !zone.vert ? 'None' : ''}
					</span>
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
			<div class="param-row">
				<span class="param-label">Grid Offset</span>
				<span class="param-value">{zone.offset !== false ? 'Offset from boundary' : 'On boundary'}</span>
			</div>
		</div>
	{/if}

	{#if type === 'plane' && !isStandard}
		<!-- Plane-specific settings -->
		<div class="form-group">
			<label for="calc-type">Calculation Type</label>
			<select id="calc-type" bind:value={calc_type} onchange={handleCalcTypeChange}>
				{#each calcTypeOptions as opt}
					<option value={opt.value}>{opt.label}</option>
				{/each}
			</select>
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
				<label>X Range ({room.units})</label>
				<div class="range-row">
					<input type="text" inputmode="decimal" value={x1.toFixed(room.precision)} onchange={(e) => x1 = parseFloat((e.target as HTMLInputElement).value) || 0} placeholder="Min" />
					<span class="range-sep">to</span>
					<input type="text" inputmode="decimal" value={x2.toFixed(room.precision)} onchange={(e) => x2 = parseFloat((e.target as HTMLInputElement).value) || 0} placeholder="Max" />
				</div>
			</div>
			<div class="form-group">
				<label>Y Range ({room.units})</label>
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
				<label>X Range ({room.units})</label>
				<div class="range-row">
					<input type="text" inputmode="decimal" value={x1.toFixed(room.precision)} onchange={(e) => x1 = parseFloat((e.target as HTMLInputElement).value) || 0} placeholder="Min" />
					<span class="range-sep">to</span>
					<input type="text" inputmode="decimal" value={x2.toFixed(room.precision)} onchange={(e) => x2 = parseFloat((e.target as HTMLInputElement).value) || 0} placeholder="Max" />
				</div>
			</div>
			<div class="form-group">
				<label>Z Range ({room.units})</label>
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
				<label>Y Range ({room.units})</label>
				<div class="range-row">
					<input type="text" inputmode="decimal" value={y1.toFixed(room.precision)} onchange={(e) => y1 = parseFloat((e.target as HTMLInputElement).value) || 0} placeholder="Min" />
					<span class="range-sep">to</span>
					<input type="text" inputmode="decimal" value={y2.toFixed(room.precision)} onchange={(e) => y2 = parseFloat((e.target as HTMLInputElement).value) || 0} placeholder="Max" />
				</div>
			</div>
			<div class="form-group">
				<label>Z Range ({room.units})</label>
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
		<!-- Volume dimensions -->
		<div class="form-group">
			<label>X Range ({room.units})</label>
			<div class="range-row">
				<input type="text" inputmode="decimal" value={x_min.toFixed(room.precision)} onchange={(e) => x_min = parseFloat((e.target as HTMLInputElement).value) || 0} placeholder="Min" />
				<span class="range-sep">to</span>
				<input type="text" inputmode="decimal" value={x_max.toFixed(room.precision)} onchange={(e) => x_max = parseFloat((e.target as HTMLInputElement).value) || 0} placeholder="Max" />
			</div>
		</div>

		<div class="form-group">
			<label>Y Range ({room.units})</label>
			<div class="range-row">
				<input type="text" inputmode="decimal" value={y_min.toFixed(room.precision)} onchange={(e) => y_min = parseFloat((e.target as HTMLInputElement).value) || 0} placeholder="Min" />
				<span class="range-sep">to</span>
				<input type="text" inputmode="decimal" value={y_max.toFixed(room.precision)} onchange={(e) => y_max = parseFloat((e.target as HTMLInputElement).value) || 0} placeholder="Max" />
			</div>
		</div>

		<div class="form-group">
			<label>Z Range ({room.units})</label>
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
			<button type="button" class="swap-btn" onclick={toggleResolutionMode} title="Switch mode">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M7 16V4M7 4L3 8M7 4l4 4M17 8v12M17 20l4-4M17 20l-4-4"/>
				</svg>
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
						oninput={(e) => { x_spacing = parseFloat((e.target as HTMLInputElement).value) || 0.1; handleSpacingChange(); }}
						min="0.01"
						max="10"
						step="0.1"
					/>
				</div>
				<span class="input-sep">x</span>
				<div class="grid-input">
					<span class="input-label">{type === 'plane' ? axisLabels().b : 'Y'}</span>
					<input
						type="number"
						value={y_spacing}
						oninput={(e) => { y_spacing = parseFloat((e.target as HTMLInputElement).value) || 0.1; handleSpacingChange(); }}
						min="0.01"
						max="10"
						step="0.1"
					/>
				</div>
				{#if type === 'volume'}
					<span class="input-sep">x</span>
					<div class="grid-input">
						<span class="input-label">Z</span>
						<input
							type="number"
							value={z_spacing}
							oninput={(e) => { z_spacing = parseFloat((e.target as HTMLInputElement).value) || 0.1; handleSpacingChange(); }}
							min="0.01"
							max="10"
							step="0.1"
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
				<input id="hours" type="number" bind:value={hours} min="0.1" max="24" step="0.5" />
			</div>
		{/if}

		<div class="form-group">
			<label for="offset-mode">Grid Offset</label>
			<select id="offset-mode" bind:value={offset}>
				<option value={false}>On the Boundary</option>
				<option value={true}>Offset from Boundary</option>
			</select>
			<span class="help-text">
				{offset ? 'Points offset from calc zone edges' : 'Points on calc zone edges'}
			</span>
		</div>
	{/if}

	<!-- Checkboxes -->
	<div class="checkbox-row">
		<label class="checkbox-label">
			<input type="checkbox" bind:checked={enabled} />
			Enabled
		</label>
		<label class="checkbox-label">
			<input type="checkbox" bind:checked={show_values} />
			Show Values
		</label>
	</div>

	<div class="editor-actions">
		{#if !isStandard}
			<button class="delete-btn" onclick={remove}>Delete</button>
		{/if}
		<button class="secondary" onclick={onClose}>Close</button>
	</div>
</div>

<style>
	.zone-editor {
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--spacing-md);
		max-height: 80vh;
		overflow-y: auto;
	}

	.editor-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--spacing-md);
	}

	.editor-header h3 {
		margin: 0;
	}

	.header-right {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
	}

	.close-btn {
		background: transparent;
		border: none;
		padding: var(--spacing-xs);
		cursor: pointer;
		color: var(--color-text-muted);
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-sm);
		transition: all 0.15s;
	}

	.close-btn:hover {
		background: var(--color-bg-tertiary);
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
		font-size: 0.875rem;
	}

	.presets {
		display: flex;
		gap: var(--spacing-xs);
		margin-top: var(--spacing-sm);
		flex-wrap: wrap;
	}

	.small {
		padding: var(--spacing-xs) var(--spacing-sm);
		font-size: 0.75rem;
	}

	.editor-actions {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-top: var(--spacing-lg);
		padding-top: var(--spacing-md);
		border-top: 1px solid var(--color-border);
	}

	.delete-btn {
		background: transparent;
		color: #dc2626;
		border: 1px solid #dc2626;
	}

	.delete-btn:hover {
		background: rgba(220, 38, 38, 0.1);
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

	.swap-btn {
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: var(--spacing-xs);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-text-muted);
		transition: all 0.15s;
	}

	.swap-btn:hover {
		background: var(--color-bg-secondary);
		color: var(--color-text);
		border-color: var(--color-primary);
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
		font-size: 0.7rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.input-sep {
		color: var(--color-text-muted);
		font-size: 0.875rem;
		padding-bottom: 8px;
	}

	.input-unit {
		color: var(--color-text-muted);
		font-size: 0.875rem;
		padding-bottom: 8px;
		white-space: nowrap;
	}

	.computed-value {
		margin-top: var(--spacing-sm);
		font-size: 0.75rem;
		color: var(--color-text-muted);
		font-family: var(--font-mono);
	}

	.help-text {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		margin-top: 2px;
	}

	.readonly-value {
		display: block;
		padding: var(--spacing-sm);
		background: var(--color-bg-tertiary);
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		font-size: 0.875rem;
	}

	.checkbox-row {
		display: flex;
		gap: var(--spacing-lg);
		margin-top: var(--spacing-md);
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		cursor: pointer;
		font-size: 0.875rem;
	}

	.checkbox-label input[type="checkbox"] {
		width: auto;
	}

	/* Standard zone styles */
	.standard-zone-editor {
		border-color: var(--color-primary);
	}

	.standard-info {
		font-size: 0.7rem;
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
		font-size: 0.8rem;
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
		font-size: 0.75rem;
	}
</style>
