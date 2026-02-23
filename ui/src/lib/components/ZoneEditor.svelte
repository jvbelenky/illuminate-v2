<script lang="ts">
	import { onDestroy } from 'svelte';
	import { project } from '$lib/stores/project';
	import type { CalcZone, RoomConfig, PlaneCalcType, RefSurface, ZoneDisplayMode } from '$lib/types/project';
	import { spacingFromNumPoints, numPointsFromSpacing, MAX_NUMERIC_VOLUME_POINTS } from '$lib/utils/calculations';
	import { displayDimension } from '$lib/utils/formatting';
	import { valueToColor } from '$lib/utils/colormaps';
	import type { IsoSettings } from './CalcVolPlotModal.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import CalcTypeIllustration from './CalcTypeIllustration.svelte';

	interface Props {
		zone: CalcZone;
		room: RoomConfig;
		onClose: () => void;
		onCopy?: (newId: string) => void;
		isStandard?: boolean;  // If true, only allow editing grid resolution
		isoSettings?: IsoSettings;
		onIsoSettingsChange?: (settings: IsoSettings) => void;
	}

	let { zone, room, onClose, onCopy, isStandard = false, isoSettings, onIsoSettingsChange }: Props = $props();

	let showDeleteConfirm = $state(false);
	let calcTypeExpanded = $state(false);
	let refSurfaceExpanded = $state(false);
	let directionExpanded = $state(false);
	let offsetExpanded = $state(false);
	let isoExpanded = $state(false);

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
	let doseHours = $state(Math.floor(zone?.hours ?? 8));
	let doseMinutes = $state(Math.floor(((zone?.hours ?? 8) % 1) * 60));
	let doseSeconds = $state(Math.round((((zone?.hours ?? 8) % 1) * 60 % 1) * 60));
	let hours = $derived(doseHours + doseMinutes / 60 + doseSeconds / 3600);
	let offset = $state(zone?.offset ?? true);

	// Grid resolution settings
	type ResolutionMode = 'num_points' | 'spacing';
	let resolutionMode = $state<ResolutionMode>(zone?.x_spacing ? 'spacing' : 'num_points');

	// Default num_points based on room size (approx 0.5m spacing, cell model matches guv_calcs)
	function defaultNumPoints(span: number): number {
		return Math.max(10, Math.round(span / 0.5));
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

	// Reference surface options for illustrated selector
	const refSurfaceOptions: { value: RefSurface; title: string; illustration: 'surface_xy' | 'surface_xz' | 'surface_yz' }[] = [
		{ value: 'xy', title: 'XY', illustration: 'surface_xy' },
		{ value: 'xz', title: 'XZ', illustration: 'surface_xz' },
		{ value: 'yz', title: 'YZ', illustration: 'surface_yz' },
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
	const span_x = $derived(Math.abs(type === 'plane' ? (x2 - x1) : (x_max - x_min)));
	const span_y = $derived(Math.abs(type === 'plane' ? (y2 - y1) : (y_max - y_min)));
	const span_z = $derived(Math.abs(z_max - z_min));

	// Axis labels and height label based on reference surface
	const axisLabels = $derived(() => {
		if (ref_surface === 'xy') return { a: 'X', b: 'Y', height: 'Z Height', heightMax: room.z };
		if (ref_surface === 'xz') return { a: 'X', b: 'Z', height: 'Y Position', heightMax: room.y };
		return { a: 'Y', b: 'Z', height: 'X Position', heightMax: room.x };
	});

	// Direction labels and icons based on reference surface
	const directionLabels = $derived(() => {
		if (ref_surface === 'xy') return { positiveShort: 'Up', negativeShort: 'Down' };
		if (ref_surface === 'xz') return { positiveShort: 'North', negativeShort: 'South' };
		return { positiveShort: 'Right', negativeShort: 'Left' };
	});

	type DirIconType = 'dir_up' | 'dir_down' | 'dir_right' | 'dir_left' | 'dir_north' | 'dir_south';
	const directionIcons = $derived((): { positive: DirIconType; negative: DirIconType } => {
		if (ref_surface === 'xy') return { positive: 'dir_up', negative: 'dir_down' };
		if (ref_surface === 'xz') return { positive: 'dir_north', negative: 'dir_south' };
		return { positive: 'dir_right', negative: 'dir_left' };
	});

	// Whether we need Z bounds for vertical planes (xz or yz)
	const needsZBounds = $derived(type === 'plane' && (ref_surface === 'xz' || ref_surface === 'yz'));

	// Volume grid point count — used to determine if numeric mode is available
	const volumeGridPoints = $derived.by(() => {
		if (type !== 'volume') return 0;
		if (resolutionMode === 'num_points') {
			return num_x * num_y * num_z;
		}
		const nx = Math.max(2, Math.ceil(span_x / (x_spacing || 0.5)) + 1);
		const ny = Math.max(2, Math.ceil(span_y / (y_spacing || 0.5)) + 1);
		const nz = Math.max(2, Math.ceil(span_z / (z_spacing || 0.5)) + 1);
		return nx * ny * nz;
	});

	// Numeric display is disabled for volumes with too many grid points
	const numericDisabled = $derived(type === 'volume' && volumeGridPoints > MAX_NUMERIC_VOLUME_POINTS);

	// Auto-switch away from numeric if it becomes unavailable (e.g. grid resolution increased)
	$effect(() => {
		if (numericDisabled && display_mode === 'numeric') {
			display_mode = 'heatmap';
		}
	});

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
			// Normalize extents so min <= max (use local vars to avoid writing $state in $effect)
			const nx1 = Math.min(x1, x2), nx2 = Math.max(x1, x2);
			const ny1 = Math.min(y1, y2), ny2 = Math.max(y1, y2);
			if (hasChanged(nx1, zone.x1)) data.x1 = nx1;
			if (hasChanged(nx2, zone.x2)) data.x2 = nx2;
			if (hasChanged(ny1, zone.y1)) data.y1 = ny1;
			if (hasChanged(ny2, zone.y2)) data.y2 = ny2;
			if (allValues.ref_surface === 'xz' || allValues.ref_surface === 'yz') {
				const nz1 = Math.min(z_min, z_max), nz2 = Math.max(z_min, z_max);
				if (hasChanged(nz1, zone.z_min)) data.z_min = nz1;
				if (hasChanged(nz2, zone.z_max)) data.z_max = nz2;
			}
		} else {
			// Normalize extents so min <= max (use local vars to avoid writing $state in $effect)
			const nxMin = Math.min(x_min, x_max), nxMax = Math.max(x_min, x_max);
			const nyMin = Math.min(y_min, y_max), nyMax = Math.max(y_min, y_max);
			const nzMin = Math.min(z_min, z_max), nzMax = Math.max(z_min, z_max);
			// Volume dimensions: always save if different from zone value
			// (don't use hasChanged since zone values may be undefined when switching from plane)
			if (nxMin !== zone.x_min) data.x_min = nxMin;
			if (nxMax !== zone.x_max) data.x_max = nxMax;
			if (nyMin !== zone.y_min) data.y_min = nyMin;
			if (nyMax !== zone.y_max) data.y_max = nyMax;
			if (nzMin !== zone.z_min) data.z_min = nzMin;
			if (nzMax !== zone.z_max) data.z_max = nzMax;
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

	async function copy() {
		try {
			const newId = await project.copyZone(zone.id);
			onClose();
			onCopy?.(newId);
		} catch (e) {
			console.error('Failed to copy zone:', e);
		}
	}

	// Quick presets for planes
	function setFloorLevel() {
		height = 0.0;
	}

	function setWorkingHeight() {
		height = room.units === 'meters' ? 0.75 : 2.5;
	}

	function setHeadHeight() {
		height = room.units === 'meters' ? 1.8 : 5.9;
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

	// --- Iso settings helpers ---
	const MAX_SURFACES = 5;
	// Show iso controls when: volume zone, heatmap mode (available even before calculation)
	const showIsoControls = $derived(type === 'volume' && display_mode === 'heatmap');

	/** Derive a hex color from the room's colormap for index i out of count surfaces */
	function colormapDefaultColor(i: number, count: number): string {
		const t = count <= 1 ? 0.5 : i / (count - 1);
		const c = valueToColor(t, room.colormap || 'plasma');
		const r = Math.round(c.r * 255).toString(16).padStart(2, '0');
		const g = Math.round(c.g * 255).toString(16).padStart(2, '0');
		const b = Math.round(c.b * 255).toString(16).padStart(2, '0');
		return `#${r}${g}${b}`;
	}

	function emitIsoSettings(settings: IsoSettings) {
		onIsoSettingsChange?.(settings);
	}

	function ensureIsoSettings(): IsoSettings {
		if (!isoSettings) {
			const defaults: IsoSettings = { surfaceCount: 3, customLevels: null, customColors: [] };
			emitIsoSettings(defaults);
			return defaults;
		}
		return isoSettings;
	}

	function isoAddSurface() {
		const settings = ensureIsoSettings();
		if (settings.surfaceCount >= MAX_SURFACES) return;
		const levels = settings.customLevels ? [...settings.customLevels] : [];
		const colors = [...(settings.customColors || [])];
		// Add a new level above the highest
		const highest = levels.length > 0 ? levels[levels.length - 1] : 1;
		levels.push(highest * 2);
		// New color slot is null (will derive from colormap via colormapDefaultColor)
		colors.push(null);
		emitIsoSettings({ surfaceCount: levels.length, customLevels: levels, customColors: colors });
	}

	function isoRemoveSurface() {
		const settings = ensureIsoSettings();
		if (settings.surfaceCount <= 1) return;
		const levels = settings.customLevels ? [...settings.customLevels] : [];
		const colors = [...(settings.customColors || [])];
		const removeIdx = Math.floor(levels.length / 2);
		levels.splice(removeIdx, 1);
		colors.splice(removeIdx, 1);
		emitIsoSettings({ surfaceCount: levels.length, customLevels: levels, customColors: colors });
	}

	function isoUpdateLevel(index: number, value: number) {
		if (!isoSettings) return;
		const levels = isoSettings.customLevels ? [...isoSettings.customLevels] : [];
		const colors = [...(isoSettings.customColors || [])];
		levels[index] = value;
		// Sort levels and colors together
		const paired = levels.map((l, i) => ({ level: l, color: colors[i] ?? null }));
		paired.sort((a, b) => a.level - b.level);
		emitIsoSettings({
			surfaceCount: isoSettings.surfaceCount,
			customLevels: paired.map(p => p.level),
			customColors: paired.map(p => p.color)
		});
	}

	function isoUpdateColor(index: number, hex: string) {
		const settings = ensureIsoSettings();
		const colors = [...(settings.customColors || [])];
		while (colors.length < settings.surfaceCount) colors.push(null);
		colors[index] = hex;
		emitIsoSettings({ ...settings, customColors: colors });
	}

	function isoSetLevelFromAuto(index: number, value: number) {
		const settings = ensureIsoSettings();
		const count = settings.surfaceCount;
		// Keep nulls for auto slots, only set the user's specific value
		const levels: (number | null)[] = settings.customLevels
			? [...settings.customLevels]
			: new Array(count).fill(null);
		while (levels.length < count) levels.push(null);
		const colors = [...(settings.customColors || [])];
		while (colors.length < count) colors.push(null);
		levels[index] = value;
		emitIsoSettings({
			surfaceCount: count,
			customLevels: levels as number[],
			customColors: colors
		});
	}

	function isoReset() {
		emitIsoSettings({ surfaceCount: 3, customLevels: null, customColors: [] });
	}
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
					{zone.dose ? `Dose (${Math.floor(zone.hours ?? 8)}h${Math.floor(((zone.hours ?? 8) % 1) * 60)}m${Math.round((((zone.hours ?? 8) % 1) * 60 % 1) * 60)}s)` : (zone.type === 'plane' ? 'Irradiance' : 'Fluence Rate')}
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
				<label>Reference Surface</label>
				<button
					type="button"
					class="illustrated-selector-summary"
					onclick={() => refSurfaceExpanded = !refSurfaceExpanded}
				>
					<CalcTypeIllustration type={`surface_${ref_surface}` as 'surface_xy' | 'surface_xz' | 'surface_yz'} size={24} />
					<span class="summary-title">{refSurfaceOptions.find(o => o.value === ref_surface)?.title ?? ref_surface}</span>
					<svg class="chevron" class:expanded={refSurfaceExpanded} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M6 9l6 6 6-6" />
					</svg>
				</button>
				{#if refSurfaceExpanded}
					<div class="illustrated-selector-options">
						{#each refSurfaceOptions as opt}
							<button
								type="button"
								class="illustrated-option"
								class:selected={ref_surface === opt.value}
								onclick={() => { ref_surface = opt.value; handleRefSurfaceChange(); refSurfaceExpanded = false; }}
							>
								<CalcTypeIllustration type={opt.illustration} size={36} />
								<span class="option-title">{opt.title}</span>
							</button>
						{/each}
					</div>
				{/if}
			</div>

			<div class="form-group">
				<label>Normal Direction</label>
				{#if showDirectionSelector}
					<button
						type="button"
						class="illustrated-selector-summary"
						onclick={() => directionExpanded = !directionExpanded}
					>
						<CalcTypeIllustration type={direction === 1 ? directionIcons().positive : directionIcons().negative} size={24} />
						<span class="summary-title">{direction === 1 ? directionLabels().positiveShort : directionLabels().negativeShort}</span>
						<svg class="chevron" class:expanded={directionExpanded} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M6 9l6 6 6-6" />
						</svg>
					</button>
					{#if directionExpanded}
						<div class="illustrated-selector-options">
							<button
								type="button"
								class="illustrated-option"
								class:selected={direction === 1}
								onclick={() => { direction = 1; directionExpanded = false; }}
							>
								<CalcTypeIllustration type={directionIcons().positive} size={36} />
								<span class="option-title">{directionLabels().positiveShort}</span>
							</button>
							<button
								type="button"
								class="illustrated-option"
								class:selected={direction === -1}
								onclick={() => { direction = -1; directionExpanded = false; }}
							>
								<CalcTypeIllustration type={directionIcons().negative} size={36} />
								<span class="option-title">{directionLabels().negativeShort}</span>
							</button>
						</div>
					{/if}
				{:else}
					<div class="illustrated-selector-summary" style="cursor: default; pointer-events: none;">
						<CalcTypeIllustration type="dir_omni" size={24} />
						<span class="summary-title">Omnidirectional</span>
					</div>
				{/if}
			</div>
		</div>

		<div class="form-row two-col">
			<div class="form-group">
				<label for="fov-vert">Vertical FOV (deg)</label>
				<input id="fov-vert" type="number" value={fov_vert} oninput={(e) => { const t = e.target as HTMLInputElement; const v = parseFloat(t.value); if (!isNaN(v) && v >= 0) { fov_vert = v; } else { t.value = String(fov_vert); } }} step="1" />
				<span class="help-text">For eye dose. 80° per ANSI/IES RP 27.1-22</span>
			</div>
			<div class="form-group">
				<label for="fov-horiz">Horizontal FOV (deg)</label>
				<input id="fov-horiz" type="number" value={fov_horiz} oninput={(e) => { const t = e.target as HTMLInputElement; const v = parseFloat(t.value); if (!isNaN(v) && v >= 0) { fov_horiz = v; } else { t.value = String(fov_horiz); } }} step="1" />
				<span class="help-text">In-plane field of view</span>
			</div>
		</div>

		<div class="form-group">
			<label for="plane-height">{axisLabels().height} ({room.units})</label>
			<input id="plane-height" type="text" inputmode="decimal" value={displayDimension(height, room.precision)} onchange={(e) => height = parseFloat((e.target as HTMLInputElement).value) || 0} />
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
					<input type="text" inputmode="decimal" value={displayDimension(x1, room.precision)} onchange={(e) => x1 = parseFloat((e.target as HTMLInputElement).value) || 0} placeholder="Min" />
					<span class="range-sep">to</span>
					<input type="text" inputmode="decimal" value={displayDimension(x2, room.precision)} onchange={(e) => x2 = parseFloat((e.target as HTMLInputElement).value) || 0} placeholder="Max" />
				</div>
			</div>
			<div class="form-group">
				<label>Y Range</label>
				<div class="range-row">
					<input type="text" inputmode="decimal" value={displayDimension(y1, room.precision)} onchange={(e) => y1 = parseFloat((e.target as HTMLInputElement).value) || 0} placeholder="Min" />
					<span class="range-sep">to</span>
					<input type="text" inputmode="decimal" value={displayDimension(y2, room.precision)} onchange={(e) => y2 = parseFloat((e.target as HTMLInputElement).value) || 0} placeholder="Max" />
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
					<input type="text" inputmode="decimal" value={displayDimension(x1, room.precision)} onchange={(e) => x1 = parseFloat((e.target as HTMLInputElement).value) || 0} placeholder="Min" />
					<span class="range-sep">to</span>
					<input type="text" inputmode="decimal" value={displayDimension(x2, room.precision)} onchange={(e) => x2 = parseFloat((e.target as HTMLInputElement).value) || 0} placeholder="Max" />
				</div>
			</div>
			<div class="form-group">
				<label>Z Range</label>
				<div class="range-row">
					<input type="text" inputmode="decimal" value={displayDimension(z_min, room.precision)} onchange={(e) => z_min = parseFloat((e.target as HTMLInputElement).value) || 0} placeholder="Min" />
					<span class="range-sep">to</span>
					<input type="text" inputmode="decimal" value={displayDimension(z_max, room.precision)} onchange={(e) => z_max = parseFloat((e.target as HTMLInputElement).value) || 0} placeholder="Max" />
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
					<input type="text" inputmode="decimal" value={displayDimension(y1, room.precision)} onchange={(e) => y1 = parseFloat((e.target as HTMLInputElement).value) || 0} placeholder="Min" />
					<span class="range-sep">to</span>
					<input type="text" inputmode="decimal" value={displayDimension(y2, room.precision)} onchange={(e) => y2 = parseFloat((e.target as HTMLInputElement).value) || 0} placeholder="Max" />
				</div>
			</div>
			<div class="form-group">
				<label>Z Range</label>
				<div class="range-row">
					<input type="text" inputmode="decimal" value={displayDimension(z_min, room.precision)} onchange={(e) => z_min = parseFloat((e.target as HTMLInputElement).value) || 0} placeholder="Min" />
					<span class="range-sep">to</span>
					<input type="text" inputmode="decimal" value={displayDimension(z_max, room.precision)} onchange={(e) => z_max = parseFloat((e.target as HTMLInputElement).value) || 0} placeholder="Max" />
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
				<input type="text" inputmode="decimal" value={displayDimension(x_min, room.precision)} onchange={(e) => x_min = parseFloat((e.target as HTMLInputElement).value) || 0} placeholder="Min" />
				<span class="range-sep">to</span>
				<input type="text" inputmode="decimal" value={displayDimension(x_max, room.precision)} onchange={(e) => x_max = parseFloat((e.target as HTMLInputElement).value) || 0} placeholder="Max" />
			</div>
		</div>

		<div class="form-group">
			<label>Y Range</label>
			<div class="range-row">
				<input type="text" inputmode="decimal" value={displayDimension(y_min, room.precision)} onchange={(e) => y_min = parseFloat((e.target as HTMLInputElement).value) || 0} placeholder="Min" />
				<span class="range-sep">to</span>
				<input type="text" inputmode="decimal" value={displayDimension(y_max, room.precision)} onchange={(e) => y_max = parseFloat((e.target as HTMLInputElement).value) || 0} placeholder="Max" />
			</div>
		</div>

		<div class="form-group">
			<label>Z Range</label>
			<div class="range-row">
				<input type="text" inputmode="decimal" value={displayDimension(z_min, room.precision)} onchange={(e) => z_min = parseFloat((e.target as HTMLInputElement).value) || 0} placeholder="Min" />
				<span class="range-sep">to</span>
				<input type="text" inputmode="decimal" value={displayDimension(z_max, room.precision)} onchange={(e) => z_max = parseFloat((e.target as HTMLInputElement).value) || 0} placeholder="Max" />
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
						onchange={(e) => { const t = e.target as HTMLInputElement; const v = parseFloat(t.value); if (v > 0) { x_spacing = v; handleSpacingChange(); } else { t.value = String(x_spacing); } }}
						step="any"
					/>
				</div>
				<span class="input-sep">x</span>
				<div class="grid-input">
					<span class="input-label">{type === 'plane' ? axisLabels().b : 'Y'}</span>
					<input
						type="number"
						value={y_spacing}
						onchange={(e) => { const t = e.target as HTMLInputElement; const v = parseFloat(t.value); if (v > 0) { y_spacing = v; handleSpacingChange(); } else { t.value = String(y_spacing); } }}
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
							onchange={(e) => { const t = e.target as HTMLInputElement; const v = parseFloat(t.value); if (v > 0) { z_spacing = v; handleSpacingChange(); } else { t.value = String(z_spacing); } }}
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
				<label>Exposure Time</label>
				<div class="time-inputs">
					<div class="time-field">
						<input id="dose-hours" type="number" value={doseHours} min="0" step="1"
							oninput={(e) => { const t = e.target as HTMLInputElement; const v = parseInt(t.value); if (!isNaN(v) && v >= 0) { doseHours = v; } else { t.value = String(doseHours); } }} />
						<span class="time-label">h</span>
					</div>
					<div class="time-field">
						<input id="dose-minutes" type="number" value={doseMinutes} min="0" max="59" step="1"
							oninput={(e) => { const t = e.target as HTMLInputElement; const v = parseInt(t.value); if (!isNaN(v) && v >= 0 && v <= 59) { doseMinutes = v; } else { t.value = String(doseMinutes); } }} />
						<span class="time-label">m</span>
					</div>
					<div class="time-field">
						<input id="dose-seconds" type="number" value={doseSeconds} min="0" max="59" step="1"
							oninput={(e) => { const t = e.target as HTMLInputElement; const v = parseInt(t.value); if (!isNaN(v) && v >= 0 && v <= 59) { doseSeconds = v; } else { t.value = String(doseSeconds); } }} />
						<span class="time-label">s</span>
					</div>
				</div>
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
				disabled={numericDisabled}
				title={numericDisabled
					? `Numeric display unavailable: volume has ${volumeGridPoints.toLocaleString()} grid points (max ${MAX_NUMERIC_VOLUME_POINTS.toLocaleString()}). Reduce grid resolution to enable.`
					: 'Numeric'}
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

	<!-- Iso Level Controls (volume + heatmap mode) -->
	{#if showIsoControls}
		<div class="form-group">
			<div
				class="iso-toggle"
				role="button"
				tabindex="0"
				onclick={() => { isoExpanded = !isoExpanded; if (isoExpanded) ensureIsoSettings(); }}
				onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); isoExpanded = !isoExpanded; if (isoExpanded) ensureIsoSettings(); } }}
			>
				<svg class="iso-chevron" class:expanded={isoExpanded} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
					<path d="M9 6l6 6-6 6" />
				</svg>
				<span class="iso-toggle-label">Iso Levels</span>
			</div>
			{#if isoExpanded}
				<div class="iso-expanded-content">
					<div class="iso-header">
						<label>Surfaces</label>
						<div class="iso-count-controls">
							<button type="button" class="iso-count-btn" onclick={isoRemoveSurface} disabled={!isoSettings || isoSettings.surfaceCount <= 1} title="Remove level">&minus;</button>
							<span class="iso-count">{isoSettings?.surfaceCount ?? 3}</span>
							<button type="button" class="iso-count-btn" onclick={isoAddSurface} disabled={isoSettings != null && isoSettings.surfaceCount >= MAX_SURFACES} title="Add level">+</button>
							{#if isoSettings?.customLevels || isoSettings?.customColors.some(c => c != null)}
								<button type="button" class="iso-reset-btn" onclick={isoReset} title="Reset to auto">Auto</button>
							{/if}
						</div>
					</div>
					<div class="iso-level-list">
						{#each Array.from({ length: isoSettings?.surfaceCount ?? 3 }) as _, i}
							{@const level = isoSettings?.customLevels?.[i] ?? null}
							{@const color = isoSettings?.customColors?.[i] ?? null}
							{@const count = isoSettings?.surfaceCount ?? 3}
							<div class="iso-level-item">
								<input
									type="color"
									class="iso-color-picker"
									value={color ?? colormapDefaultColor(i, count)}
									oninput={(e) => isoUpdateColor(i, e.currentTarget.value)}
									title="Click to change color"
								/>
								{#if level != null}
									<input
										class="iso-level-input"
										type="number"
										step="any"
										value={parseFloat(level.toPrecision(4))}
										onchange={(e) => {
											const val = parseFloat(e.currentTarget.value);
											if (isFinite(val) && val > 0) isoUpdateLevel(i, val);
										}}
									/>
								{:else}
									<input
										class="iso-level-input iso-level-auto"
										type="number"
										step="any"
										placeholder="Auto"
										onchange={(e) => {
											const val = parseFloat(e.currentTarget.value);
											if (isFinite(val) && val > 0) isoSetLevelFromAuto(i, val);
										}}
									/>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	{/if}

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

	.zone-type-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.zone-type-btn:disabled:hover {
		border-color: var(--color-bg);
		color: var(--color-text-muted);
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

	.time-inputs {
		display: flex;
		gap: 2px;
		align-items: center;
	}

	.time-field {
		display: flex;
		align-items: center;
		gap: 2px;
	}

	.time-field input {
		width: 56px;
		text-align: center;
	}

	.time-label {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		flex-shrink: 0;
	}

	/* Iso level controls */
	.iso-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--spacing-xs);
	}

	.iso-header label {
		margin-bottom: 0;
	}

	.iso-count-controls {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.iso-count-btn {
		width: 20px;
		height: 20px;
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg-tertiary);
		color: var(--color-text);
		font-size: 0.8rem;
		line-height: 1;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.iso-count-btn:hover:not(:disabled) {
		background: var(--color-bg-secondary);
		border-color: var(--color-text-muted);
	}

	.iso-count-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.iso-count {
		font-size: 0.7rem;
		color: var(--color-text);
		min-width: 12px;
		text-align: center;
	}

	.iso-reset-btn {
		font-size: 0.6rem;
		padding: 1px 5px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg-tertiary);
		color: var(--color-text-muted);
		cursor: pointer;
		margin-left: 2px;
	}

	.iso-reset-btn:hover {
		background: var(--color-bg-secondary);
		border-color: var(--color-text-muted);
	}

	.iso-level-list {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.iso-level-item {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.iso-color-picker {
		width: 22px;
		height: 22px;
		padding: 1px;
		border: 1px solid var(--color-border);
		border-radius: 3px;
		background: none;
		cursor: pointer;
		flex-shrink: 0;
	}

	.iso-color-picker::-webkit-color-swatch-wrapper {
		padding: 1px;
	}

	.iso-color-picker::-webkit-color-swatch {
		border: none;
		border-radius: 2px;
	}

	.iso-color-picker::-moz-color-swatch {
		border: none;
		border-radius: 2px;
	}

	.iso-level-input {
		width: 80px;
		padding: 2px 4px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg-secondary);
		color: var(--color-text);
		font-size: 0.75rem;
		text-align: right;
	}

	.iso-level-input:focus {
		outline: none;
		border-color: var(--color-primary, #3b82f6);
	}

	.iso-toggle {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		cursor: pointer;
		user-select: none;
	}

	.iso-toggle:hover .iso-toggle-label {
		color: var(--color-text);
	}

	.iso-toggle-label {
		font-size: var(--font-size-sm);
		font-weight: 500;
		color: var(--color-text-muted);
		transition: color 0.15s;
	}

	.iso-chevron {
		flex-shrink: 0;
		color: var(--color-text-muted);
		transition: transform 0.15s;
	}

	.iso-chevron.expanded {
		transform: rotate(90deg);
	}

	.iso-expanded-content {
		margin-top: var(--spacing-xs);
		padding: var(--spacing-sm);
		padding-left: calc(12px + var(--spacing-xs));
	}

	.iso-level-auto {
		color: var(--color-text-muted);
		font-style: italic;
	}

	.iso-level-auto::placeholder {
		color: var(--color-text-muted);
		font-style: italic;
		opacity: 0.7;
	}
</style>
