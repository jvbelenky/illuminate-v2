<script lang="ts">
	import { onDestroy } from 'svelte';
	import { project } from '$lib/stores/project';
	import { userSettings } from '$lib/stores/settings';
	import { pickMode, pickResult } from '$lib/stores/pickMode';
	import type { CalcZone, RoomConfig, PlaneCalcMode, RefSurface, ZoneDisplayMode } from '$lib/types/project';
	import { spacingFromNumPoints, numPointsFromSpacing, MAX_NUMERIC_VOLUME_POINTS, formatDoseTime } from '$lib/utils/calculations';
	import { displayDimension } from '$lib/utils/formatting';
	import { unitAbbrev, unitLabel } from '$lib/utils/unitConversion';
	import type { IsoSettings, IsoSettingsInput } from './CalcVolPlotModal.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import CalcTypeIllustration from './CalcTypeIllustration.svelte';
	import ValidatedNumberInput from './ValidatedNumberInput.svelte';

	interface Props {
		zone: CalcZone;
		room: RoomConfig;
		onClose: () => void;
		onCopy?: (newId: string) => void;
		isStandard?: boolean;  // If true, only allow editing grid resolution
		isoSettings?: IsoSettings;
		onIsoSettingsChange?: (settings: IsoSettingsInput) => void;
	}

	let { zone, room, onClose, onCopy, isStandard = false, isoSettings, onIsoSettingsChange }: Props = $props();

	let showDeleteConfirm = $state(false);
	let calcModeExpanded = $state(false);
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
	let calc_mode = $state<PlaneCalcMode>(zone?.calc_mode ?? 'planar_normal');
	let ref_surface = $state<RefSurface>(zone?.ref_surface ?? 'xy');
	let direction = $state(zone?.direction ?? 1);
	let fov_vert = $state(zone?.fov_vert ?? 180);
	let fov_horiz = $state(zone?.fov_horiz ?? 360);
	let horiz = $state(zone?.horiz ?? false);
	let vert = $state(zone?.vert ?? false);
	let use_normal = $state(zone?.use_normal ?? false);
	let view_dir_x = $state(zone?.view_direction?.[0] ?? 0);
	let view_dir_y = $state(zone?.view_direction?.[1] ?? 1);
	let view_dir_z = $state(zone?.view_direction?.[2] ?? 0);
	let view_target_x = $state(zone?.view_target?.[0] ?? Math.round(room.x / 2 * 1000) / 1000);
	let view_target_y = $state(zone?.view_target?.[1] ?? Math.round(room.y / 2 * 1000) / 1000);
	let view_target_z = $state(zone?.view_target?.[2] ?? Math.round(room.z / 2 * 1000) / 1000);

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
	let doseHours = $state(zone?.hours ?? 8);
	let doseMinutes = $state(zone?.minutes ?? 0);
	let doseSeconds = $state(zone?.seconds ?? 0);
	let offset = $state(zone?.offset ?? true);

	// Grid resolution settings
	type ResolutionMode = 'num_points' | 'spacing';
	let resolutionMode = $state<ResolutionMode>('num_points');

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

	// Sync local state when zone prop changes (e.g. unit conversion updates store values)
	$effect(() => {
		height = zone?.height ?? 1.0;
		x1 = zone?.x1 ?? 0;
		x2 = zone?.x2 ?? room.x;
		y1 = zone?.y1 ?? 0;
		y2 = zone?.y2 ?? room.y;
		x_min = zone?.x_min ?? 0;
		x_max = zone?.x_max ?? room.x;
		y_min = zone?.y_min ?? 0;
		y_max = zone?.y_max ?? room.y;
		z_min = zone?.z_min ?? 0;
		z_max = zone?.z_max ?? room.z;
		x_spacing = zone?.x_spacing ?? 0.5;
		y_spacing = zone?.y_spacing ?? 0.5;
		z_spacing = zone?.z_spacing ?? 0.5;
		if (zone?.view_direction) {
			view_dir_x = zone.view_direction[0];
			view_dir_y = zone.view_direction[1];
			view_dir_z = zone.view_direction[2];
		}
		if (zone?.view_target) {
			view_target_x = zone.view_target[0];
			view_target_y = zone.view_target[1];
			view_target_z = zone.view_target[2];
		}
	});

	// Calculation type options with descriptions for illustrated selector
	const calcModeDisplayOptions: { value: PlaneCalcMode; title: string; description: string }[] = [
		{ value: 'fluence_rate', title: 'Fluence Rate',
			description: 'Points have no normal. They collect flux from all directions and report the total.' },
		{ value: 'planar_normal', title: 'Planar Normal',
			description: 'Normals are perpendicular to the calculation plane.' },
		{ value: 'planar_max', title: 'Planar Maximum',
			description: 'Calculates the maximum irradiance from any direction at each point.' },
		{ value: 'eye_worst_case', title: 'Eye (Worst Case)',
			description: 'Finds the worst-case eye exposure at each point by searching over all gaze directions within the FOV.' },
		{ value: 'eye_directional', title: 'Eye (Directional)',
			description: 'Eye exposure with all gaze normals pointing in a user-defined direction.' },
		{ value: 'eye_target', title: 'Eye (Target)',
			description: 'Eye exposure with all gaze normals facing toward a user-defined target point.' },
		{ value: 'custom', title: 'Custom',
			description: 'Manually configure all calculation flags: weighting, directionality, and field of view.' },
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

	// Reverse-map primitive fields to a PlaneCalcMode (mirrors CalcPlane3D logic)
	function deriveCalcMode(z: CalcZone): PlaneCalcMode {
		if (z.calc_mode) return z.calc_mode;
		if (z.horiz) return 'planar_normal';
		if (z.vert) return z.direction ? 'vertical_dir' : 'vertical';
		return z.direction ? 'planar_max' : 'fluence_rate';
	}

	function calcModeLabel(ct: PlaneCalcMode): string {
		return calcModeDisplayOptions.find(o => o.value === ct)?.title ?? ct;
	}

	// Update settings from calc_mode change.
	// Direction (normal flip) is an independent geometric property — changing
	// calc_mode should NOT reset the user's direction choice.
	function updateFromCalcMode(ct: PlaneCalcMode) {
		if (ct === 'eye_worst_case' || ct === 'eye_directional' || ct === 'eye_target') {
			fov_vert = 80;
			fov_horiz = 120;
		} else {
			// Non-eye modes (including custom) default to full sphere
			fov_vert = 180;
			fov_horiz = 360;
		}
	}

	// Whether to show FOV inputs — only for eye modes and custom
	const showFOV = $derived(
		calc_mode === 'eye_worst_case' || calc_mode === 'eye_directional' ||
		calc_mode === 'eye_target' || calc_mode === 'custom'
	);

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
	// Always derived from spacing (the authoritative source)
	const volumeGridPoints = $derived.by(() => {
		if (type !== 'volume') return 0;
		return numPointsFromSpacing(span_x, x_spacing) *
			numPointsFromSpacing(span_y, y_spacing) *
			numPointsFromSpacing(span_z, z_spacing);
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
			hours: doseHours,
			minutes: doseMinutes,
			seconds: doseSeconds,
			offset,
			num_x,
			num_y,
			x_spacing,
			y_spacing,
			height,
			calc_mode,
			ref_surface,
			direction,
			horiz,
			vert,
			use_normal,
			fov_vert,
			fov_horiz,
			x1, x2, y1, y2,
			z_min, z_max,
			x_min, x_max, y_min, y_max,
			num_z,
			z_spacing,
			view_dir_x, view_dir_y, view_dir_z,
			view_target_x, view_target_y, view_target_z
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
		if (allValues.dose && allValues.hours !== (zone.hours ?? 8)) data.hours = allValues.hours;
		if (allValues.dose && allValues.minutes !== (zone.minutes ?? 0)) data.minutes = allValues.minutes;
		if (allValues.dose && allValues.seconds !== (zone.seconds ?? 0)) data.seconds = allValues.seconds;
		if (allValues.offset !== zone.offset) data.offset = allValues.offset;

		// Grid parameters — spacing is always authoritative.
		// Only save if user explicitly changed them (prevents mode toggle saves).
		if (userChangedGridFields.has('x_spacing') && allValues.x_spacing !== zone.x_spacing) data.x_spacing = allValues.x_spacing;
		if (userChangedGridFields.has('y_spacing') && allValues.y_spacing !== zone.y_spacing) data.y_spacing = allValues.y_spacing;

		if (allValues.type === 'plane') {
			if (hasChanged(allValues.height, zone.height)) data.height = allValues.height;
			if (allValues.calc_mode !== zone.calc_mode) data.calc_mode = allValues.calc_mode;
			if (allValues.ref_surface !== zone.ref_surface) data.ref_surface = allValues.ref_surface;
			if (allValues.direction !== zone.direction) data.direction = allValues.direction;
			if (allValues.horiz !== zone.horiz) data.horiz = allValues.horiz;
			if (allValues.vert !== zone.vert) data.vert = allValues.vert;
			if (allValues.use_normal !== zone.use_normal) data.use_normal = allValues.use_normal;
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
			// View params for directional/target eye modes
			if (calc_mode === 'eye_directional') {
				const newDir: [number, number, number] = [view_dir_x, view_dir_y, view_dir_z];
				const oldDir = zone.view_direction;
				if (!oldDir || oldDir[0] !== newDir[0] || oldDir[1] !== newDir[1] || oldDir[2] !== newDir[2]) {
					data.view_direction = newDir;
				}
			}
			if (calc_mode === 'eye_target') {
				const newTarget: [number, number, number] = [view_target_x, view_target_y, view_target_z];
				const oldTarget = zone.view_target;
				if (!oldTarget || oldTarget[0] !== newTarget[0] || oldTarget[1] !== newTarget[1] || oldTarget[2] !== newTarget[2]) {
					data.view_target = newTarget;
				}
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
			// Grid z-axis — spacing is authoritative
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

	// Toggle resolution mode — just switch the UI view, no recomputation needed.
	// Spacing is always the source of truth; num_points is derived for display.
	function toggleResolutionMode() {
		if (resolutionMode === 'num_points') {
			resolutionMode = 'spacing';
		} else {
			// Derive num_points from current spacing for display
			num_x = numPointsFromSpacing(span_x, x_spacing);
			num_y = numPointsFromSpacing(span_y, y_spacing);
			if (type === 'volume') {
				num_z = numPointsFromSpacing(span_z, z_spacing);
			}
			resolutionMode = 'num_points';
		}
	}

	// Handle num_x/num_y/num_z input changes — derive spacing (authoritative)
	// via conservative algorithm, then mark spacing as user-changed for save.
	function handleNumPointsChange() {
		x_spacing = spacingFromNumPoints(span_x, num_x);
		y_spacing = spacingFromNumPoints(span_y, num_y);
		if (type === 'volume') {
			z_spacing = spacingFromNumPoints(span_z, num_z);
		}
		// Spacing is authoritative — mark spacing fields as changed
		userChangedGridFields.add('x_spacing');
		userChangedGridFields.add('y_spacing');
		if (type === 'volume') userChangedGridFields.add('z_spacing');
	}

	// Handle spacing input change — derive num_points for display,
	// mark spacing as user-changed for save.
	function handleSpacingChange() {
		num_x = numPointsFromSpacing(span_x, x_spacing);
		num_y = numPointsFromSpacing(span_y, y_spacing);
		if (type === 'volume') {
			num_z = numPointsFromSpacing(span_z, z_spacing);
		}
		userChangedGridFields.add('x_spacing');
		userChangedGridFields.add('y_spacing');
		if (type === 'volume') userChangedGridFields.add('z_spacing');
	}

	// Handle calc_mode change
	function handleCalcModeChange() {
		updateFromCalcMode(calc_mode);
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
		height = 0.75;  // Always meters internally
	}

	function setHeadHeight() {
		height = 1.8;  // Always meters internally
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

	// Show direction selector only for directional calc types.
	// Fluence rate and vertical irradiance are omnidirectional — direction is meaningless.
	const showDirectionSelector = $derived(
		calc_mode !== 'fluence_rate' && calc_mode !== 'vertical' &&
		calc_mode !== 'eye_worst_case' && calc_mode !== 'eye_directional' && calc_mode !== 'eye_target' &&
		calc_mode !== 'custom'
	);

	// Watch for pick results from the 3D scene
	const unsubPickResult = pickResult.subscribe((result) => {
		if (!result) return;
		if (result.type === 'target') {
			view_target_x = Math.round(result.value[0] * 1000) / 1000;
			view_target_y = Math.round(result.value[1] * 1000) / 1000;
			view_target_z = Math.round(result.value[2] * 1000) / 1000;
		} else if (result.type === 'direction') {
			view_dir_x = Math.round(result.value[0] * 1000) / 1000;
			view_dir_y = Math.round(result.value[1] * 1000) / 1000;
			view_dir_z = Math.round(result.value[2] * 1000) / 1000;
		}
		pickResult.set(null);
	});
	onDestroy(unsubPickResult);

	// --- Iso settings helpers ---
	const MAX_SURFACES = 5;
	// Show iso controls when: volume zone, heatmap mode (available even before calculation)
	const showIsoControls = $derived(type === 'volume' && display_mode === 'heatmap');

	function emitIsoSettings(settings: IsoSettingsInput) {
		onIsoSettingsChange?.(settings);
	}

	function ensureIsoSettings(): IsoSettings {
		if (!isoSettings) {
			const defaults: IsoSettingsInput = { surfaceCount: 3, customLevels: null, customColors: [] };
			emitIsoSettings(defaults);
			// Return with placeholder resolvedColors; parent will recompute immediately
			return { ...defaults, resolvedColors: [] };
		}
		return isoSettings;
	}

	function isoAddSurface() {
		const settings = ensureIsoSettings();
		if (settings.surfaceCount >= MAX_SURFACES) return;
		const newCount = settings.surfaceCount + 1;
		if (!settings.customLevels) {
			// All auto — just bump the count
			emitIsoSettings({ surfaceCount: newCount, customLevels: null, customColors: [] });
			return;
		}
		const levels = [...settings.customLevels];
		const colors = [...(settings.customColors || [])];
		// Add a new level above the highest
		const highest = levels.length > 0 ? levels[levels.length - 1] : 1;
		levels.push(highest * 2);
		colors.push(null);
		emitIsoSettings({ surfaceCount: levels.length, customLevels: levels, customColors: colors });
	}

	function isoRemoveSurface() {
		const settings = ensureIsoSettings();
		if (settings.surfaceCount <= 1) return;
		const newCount = settings.surfaceCount - 1;
		if (!settings.customLevels) {
			// All auto — just reduce the count
			emitIsoSettings({ surfaceCount: newCount, customLevels: null, customColors: [] });
			return;
		}
		const levels = [...settings.customLevels];
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
					<span class="param-value">{displayDimension(zone.height ?? 0, room.precision)} {unitAbbrev($userSettings.units)}</span>
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
					<span class="param-value">{calcModeLabel(deriveCalcMode(zone))}</span>
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
					<span class="param-value">{displayDimension(zone.x_min ?? 0, room.precision)} - {displayDimension(zone.x_max ?? room.x, room.precision)} {unitAbbrev($userSettings.units)}</span>
				</div>
				<div class="param-row">
					<span class="param-label">Y Range</span>
					<span class="param-value">{displayDimension(zone.y_min ?? 0, room.precision)} - {displayDimension(zone.y_max ?? room.y, room.precision)} {unitAbbrev($userSettings.units)}</span>
				</div>
				<div class="param-row">
					<span class="param-label">Z Range</span>
					<span class="param-value">{displayDimension(zone.z_min ?? 0, room.precision)} - {displayDimension(zone.z_max ?? room.z, room.precision)} {unitAbbrev($userSettings.units)}</span>
				</div>
			{/if}
			<div class="param-row">
				<span class="param-label">Value Display</span>
				<span class="param-value">
					{zone.dose ? `Dose (${formatDoseTime(zone.hours ?? 8, zone.minutes ?? 0, zone.seconds ?? 0)})` : (zone.type === 'plane' ? 'Irradiance' : 'Fluence Rate')}
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
				onclick={() => calcModeExpanded = !calcModeExpanded}
			>
				<CalcTypeIllustration type={calc_mode} size={24} />
				<span class="summary-title">{calcModeDisplayOptions.find(o => o.value === calc_mode)?.title ?? calc_mode}</span>
				<svg class="chevron" class:expanded={calcModeExpanded} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M6 9l6 6 6-6" />
				</svg>
			</button>
			{#if calcModeExpanded}
				<div class="illustrated-selector-options">
					{#each calcModeDisplayOptions as opt}
						<button
							type="button"
							class="illustrated-option"
							class:selected={calc_mode === opt.value}
							onclick={() => { calc_mode = opt.value; handleCalcModeChange(); calcModeExpanded = false; }}
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

		{#if calc_mode === 'eye_directional'}
			<div class="form-group">
				<label>View Direction</label>
				<div class="vector-row">
					<span class="vector-label">X</span>
					<ValidatedNumberInput value={view_dir_x} oncommit={(v) => { view_dir_x = v; }} step={0.1} />
					<span class="vector-label">Y</span>
					<ValidatedNumberInput value={view_dir_y} oncommit={(v) => { view_dir_y = v; }} step={0.1} />
					<span class="vector-label">Z</span>
					<ValidatedNumberInput value={view_dir_z} oncommit={(v) => { view_dir_z = v; }} step={0.1} />
					<button
						type="button"
						class="pick-btn"
						class:pick-active={$pickMode?.type === 'direction'}
						title={$pickMode?.type === 'direction' ? 'Press Escape to cancel' : 'Click and drag in the 3D view to set direction'}
						onclick={() => {
							if ($pickMode?.type === 'direction') { pickMode.set(null); }
							else { pickResult.set(null); pickMode.set({ type: 'direction' }); }
						}}
					>
						<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
							<path d="M2 14L6 6l4 4-8 4z" fill="currentColor"/>
							<path d="M7 3l2-2m0 0l2 2m-2-2v6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
						</svg>
					</button>
				</div>
				{#if $pickMode?.type === 'direction'}
					<span class="pick-hint">Click and drag in the 3D view to set direction. Press Escape to cancel.</span>
				{:else}
					<span class="help-text">Direction all calculation normals point toward (will be normalized)</span>
				{/if}
			</div>
		{:else if calc_mode === 'eye_target'}
			<div class="form-group">
				<label>Target Point ({unitAbbrev($userSettings.units)})</label>
				<div class="vector-row">
					<span class="vector-label">X</span>
					<ValidatedNumberInput value={view_target_x} oncommit={(v) => { view_target_x = v; }} step={0.1} />
					<span class="vector-label">Y</span>
					<ValidatedNumberInput value={view_target_y} oncommit={(v) => { view_target_y = v; }} step={0.1} />
					<span class="vector-label">Z</span>
					<ValidatedNumberInput value={view_target_z} oncommit={(v) => { view_target_z = v; }} step={0.1} />
					<button
						type="button"
						class="pick-btn"
						class:pick-active={$pickMode?.type === 'target'}
						title={$pickMode?.type === 'target' ? 'Press Escape to cancel' : 'Click in the 3D view to set target point'}
						onclick={() => {
							if ($pickMode?.type === 'target') { pickMode.set(null); }
							else { pickResult.set(null); pickMode.set({ type: 'target' }); }
						}}
					>
						<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
							<circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/>
							<circle cx="8" cy="8" r="2" fill="currentColor"/>
							<path d="M8 1v2m0 10v2M1 8h2m10 0h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
						</svg>
					</button>
				</div>
				{#if $pickMode?.type === 'target'}
					<span class="pick-hint">Click a point in the 3D view. Press Escape to cancel.</span>
				{:else}
					<span class="help-text">Point in space all calculation normals face toward</span>
				{/if}
			</div>
		{/if}

		{#if calc_mode === 'custom'}
			<div class="form-group">
				<label>Custom Flags</label>
				<div class="custom-flags">
					<label class="toggle-row">
						<input type="checkbox" bind:checked={horiz} />
						<span class="toggle-label">cos(&theta;) weighting</span>
						<span class="help-text">Weight by cos(&theta;) from surface normal (horizontal irradiance)</span>
					</label>
					<label class="toggle-row">
						<input type="checkbox" bind:checked={vert} />
						<span class="toggle-label">sin(&theta;) weighting</span>
						<span class="help-text">Weight by sin(&theta;) from surface normal (vertical irradiance)</span>
					</label>
					<label class="toggle-row">
						<input type="checkbox" bind:checked={use_normal} />
						<span class="toggle-label">Block back-hemisphere</span>
						<span class="help-text">Zero out contributions from behind the surface (&theta; &gt; 90&deg;)</span>
					</label>
				</div>
			</div>
		{/if}

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
				{:else if calc_mode === 'eye_worst_case'}
					<div class="illustrated-selector-summary disabled-selector">
						<CalcTypeIllustration type="dir_bidir" size={24} />
						<span class="summary-title">Bidirectional</span>
					</div>
				{:else if calc_mode === 'eye_directional'}
					<div class="illustrated-selector-summary disabled-selector">
						<CalcTypeIllustration type="eye_directional" size={24} />
						<span class="summary-title">User Defined</span>
					</div>
				{:else if calc_mode === 'eye_target'}
					<div class="illustrated-selector-summary disabled-selector">
						<CalcTypeIllustration type="eye_target" size={24} />
						<span class="summary-title">User Defined</span>
					</div>
				{:else if calc_mode === 'custom'}
					<div class="illustrated-selector-summary disabled-selector">
						{#if use_normal}
							<CalcTypeIllustration type={direction === 1 ? directionIcons().positive : directionIcons().negative} size={24} />
							<span class="summary-title">Directional ({direction === 1 ? directionLabels().positiveShort : directionLabels().negativeShort})</span>
						{:else}
							<CalcTypeIllustration type="dir_omni" size={24} />
							<span class="summary-title">Omnidirectional</span>
						{/if}
					</div>
				{:else}
					<div class="illustrated-selector-summary disabled-selector">
						<CalcTypeIllustration type="dir_omni" size={24} />
						<span class="summary-title">Omnidirectional</span>
					</div>
				{/if}
			</div>
		</div>

		{#if showFOV}
		<div class="form-row two-col">
			<div class="form-group">
				<label for="fov-vert">Vertical FOV (deg)</label>
				<ValidatedNumberInput id="fov-vert" value={fov_vert} oncommit={(v) => { fov_vert = v; }} min={0} step={1} />
				<span class="help-text">For eye dose. 80° per ANSI/IES RP 27.1-22</span>
			</div>
			<div class="form-group">
				<label for="fov-horiz">Horizontal FOV (deg)</label>
				<ValidatedNumberInput id="fov-horiz" value={fov_horiz} oncommit={(v) => { fov_horiz = v; }} min={0} step={1} />
				<span class="help-text">In-plane field of view</span>
			</div>
		</div>
		{/if}

		<div class="form-group">
			<label for="plane-height">{axisLabels().height} ({unitAbbrev($userSettings.units)})</label>
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
					<ValidatedNumberInput
						value={num_x}
						oncommit={(v) => { num_x = v; handleNumPointsChange(); }}
						integer
						min={1}
						max={200}
						step={1}
					/>
				</div>
				<span class="input-sep">x</span>
				<div class="grid-input">
					<span class="input-label">{type === 'plane' ? axisLabels().b : 'Y'}</span>
					<ValidatedNumberInput
						value={num_y}
						oncommit={(v) => { num_y = v; handleNumPointsChange(); }}
						integer
						min={1}
						max={200}
						step={1}
					/>
				</div>
				{#if type === 'volume'}
					<span class="input-sep">x</span>
					<div class="grid-input">
						<span class="input-label">Z</span>
						<ValidatedNumberInput
							value={num_z}
							oncommit={(v) => { num_z = v; handleNumPointsChange(); }}
							integer
							min={1}
							max={200}
							step={1}
						/>
					</div>
				{/if}
			</div>
			<div class="computed-value">
				Spacing: {x_spacing.toFixed(2)} x {y_spacing.toFixed(2)}{type === 'volume' ? ` x ${z_spacing.toFixed(2)}` : ''} {unitAbbrev($userSettings.units)}
			</div>
		{:else}
			<div class="grid-inputs">
				<div class="grid-input">
					<span class="input-label">{type === 'plane' ? axisLabels().a : 'X'}</span>
					<ValidatedNumberInput
						value={x_spacing}
						oncommit={(v) => { x_spacing = v; handleSpacingChange(); }}
						validate={(v) => v > 0}
												step="any"
					/>
				</div>
				<span class="input-sep">x</span>
				<div class="grid-input">
					<span class="input-label">{type === 'plane' ? axisLabels().b : 'Y'}</span>
					<ValidatedNumberInput
						value={y_spacing}
						oncommit={(v) => { y_spacing = v; handleSpacingChange(); }}
						validate={(v) => v > 0}
												step="any"
					/>
				</div>
				{#if type === 'volume'}
					<span class="input-sep">x</span>
					<div class="grid-input">
						<span class="input-label">Z</span>
						<ValidatedNumberInput
							value={z_spacing}
							oncommit={(v) => { z_spacing = v; handleSpacingChange(); }}
							validate={(v) => v > 0}
														step="any"
						/>
					</div>
				{/if}
				<span class="input-unit">{unitAbbrev($userSettings.units)}</span>
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
						<ValidatedNumberInput id="dose-hours" value={doseHours} oncommit={(v) => { doseHours = v; }} min={0} step="any" />
						<span class="time-label">h</span>
					</div>
					<div class="time-field">
						<ValidatedNumberInput id="dose-minutes" value={doseMinutes} oncommit={(v) => { doseMinutes = v; }} min={0} step="any" />
						<span class="time-label">m</span>
					</div>
					<div class="time-field">
						<ValidatedNumberInput id="dose-seconds" value={doseSeconds} oncommit={(v) => { doseSeconds = v; }} min={0} step="any" />
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
			<button
				type="button"
				class="zone-type-btn"
				class:active={display_mode === 'none'}
				title="Outline Only"
				onclick={() => display_mode = 'none'}
			>
				<CalcTypeIllustration type="display_none" size={36} />
				<span class="zone-type-label">None</span>
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
									value={isoSettings?.resolvedColors?.[i] ?? '#888888'}
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
		message="Delete this zone?"
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

	.vector-row {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
	}

	.vector-row :global(input) {
		flex: 1;
		min-width: 0;
	}

	.vector-label {
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
		font-weight: 500;
		min-width: 1rem;
		text-align: center;
	}

	.pick-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--spacing-xs);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg-secondary);
		color: var(--color-text-muted);
		cursor: pointer;
		flex-shrink: 0;
	}

	.pick-btn:hover {
		background: var(--color-bg-tertiary);
		color: var(--color-primary);
	}

	.pick-btn.pick-active {
		background: var(--color-primary);
		color: white;
		border-color: var(--color-primary);
		box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.3);
	}

	.pick-hint {
		color: var(--color-primary);
		font-size: var(--font-size-sm);
		font-weight: 500;
		animation: pick-pulse 1.5s ease-in-out infinite;
	}

	@keyframes pick-pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.5; }
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

	.grid-input :global(input) {
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

	.custom-flags {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}

	.toggle-row {
		display: grid;
		grid-template-columns: auto 1fr;
		grid-template-rows: auto auto;
		gap: 0 var(--spacing-sm);
		align-items: center;
		cursor: pointer;
	}

	.toggle-row input[type="checkbox"] {
		grid-row: 1 / 3;
		margin: 0;
	}

	.toggle-label {
		font-size: var(--font-size-sm);
		color: var(--color-text-primary);
	}

	.toggle-row .help-text {
		grid-column: 2;
		margin-top: 0;
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

	.illustrated-selector-summary:hover:not(.disabled-selector) {
		border-color: var(--color-highlight);
	}

	.disabled-selector {
		cursor: default;
		pointer-events: none;
		opacity: 0.55;
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

	.time-field :global(input) {
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
