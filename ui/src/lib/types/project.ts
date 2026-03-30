// Project types - mirrors the .guv file structure and FastAPI schemas

export type LampType = 'krcl_222' | 'lp_254' | 'other';

export interface SurfaceReflectances {
  floor: number;
  ceiling: number;
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface SurfaceSpacing {
  x: number;
  y: number;
}

export interface SurfaceSpacings {
  floor: SurfaceSpacing;
  ceiling: SurfaceSpacing;
  north: SurfaceSpacing;
  south: SurfaceSpacing;
  east: SurfaceSpacing;
  west: SurfaceSpacing;
}

export interface SurfaceNumPoints {
  x: number;
  y: number;
}

export interface SurfaceNumPointsAll {
  floor: SurfaceNumPoints;
  ceiling: SurfaceNumPoints;
  north: SurfaceNumPoints;
  south: SurfaceNumPoints;
  east: SurfaceNumPoints;
  west: SurfaceNumPoints;
}

export type ResolutionMode = 'spacing' | 'num_points';
/** @deprecated Use ResolutionMode instead */
export type ReflectanceResolutionMode = ResolutionMode;

export interface RoomConfig {
  x: number;
  y: number;
  z: number;
  standard: 'ANSI IES RP 27.1-22 (ACGIH Limits)' | 'UL8802 (ACGIH Limits)' | 'IEC 62471-6:2022 (ICNIRP Limits)';
  enable_reflectance: boolean;
  reflectances: SurfaceReflectances;
  reflectance_spacings: SurfaceSpacings;
  reflectance_num_points: SurfaceNumPointsAll;
  reflectance_resolution_mode: ReflectanceResolutionMode;
  reflectance_max_num_passes: number;  // default: 100
  reflectance_threshold: number;       // default: 0.02
  air_changes: number;
  ozone_decay_constant: number;
  colormap: string;
  precision: number;
  useStandardZones: boolean;  // Whether to include the 3 standard zones
  showDimensions: boolean;    // Whether to show dimension tick marks on 3D room
  showPhotometricWebs: boolean; // Whether to show photometric web meshes on lamps
  showGrid: boolean;           // Whether to show the floor grid in 3D scene
  showXYZMarker: boolean;      // Whether to show the XYZ axes marker in 3D scene
  showLampLabels: boolean;     // Whether to show lamp name labels in 3D scene
  showCalcPointLabels: boolean; // Whether to show calcpoint name labels in 3D scene
  globalHeatmapNormalization: boolean; // If true, all heatmaps share the same color scale
}

export interface LampInstance {
  id: string;
  lamp_type: LampType;
  preset_id?: string; // e.g., 'beacon', 'ushio_b1', or 'custom'
  name?: string;
  x: number;
  y: number;
  z: number;
  aimx: number;
  aimy: number;
  aimz: number;
  tilt?: number;        // Bank angle in degrees (0°=down, 90°=horizontal, 180°=up)
  orientation?: number; // Heading angle in degrees (0°-360° compass direction)
  scaling_factor: number;
  enabled: boolean;
  // File upload status (for custom lamps)
  has_ies_file?: boolean;
  has_spectrum_file?: boolean;
  // IES filename (for display purposes)
  ies_filename?: string;
  // Local file references (for pending uploads)
  pending_ies_file?: File;
  pending_spectrum_file?: File;
  pending_spectrum_column_index?: number;
  // Spectrum filename (for display purposes after upload)
  spectrum_filename?: string;

  // Other lamp type fields
  wavelength?: number;
  wavelength_from_spectrum?: boolean;

  // Advanced settings
  intensity_units?: 'mW/sr' | 'uW/cm2';
  source_width?: number;
  source_length?: number;
  source_depth?: number;
  source_density?: number;
  show_label?: boolean;  // Whether to show this lamp's name label in 3D scene
}

// Calculation mode options for planes — mirrors guv_calcs PlaneCalcMode enum
export type PlaneCalcMode =
  | 'fluence_rate'       // All angles, omnidirectional
  | 'planar_normal'      // Horizontal irradiance, directional
  | 'planar_max'         // Maximum irradiance, directional
  | 'vertical'           // Vertical irradiance, omnidirectional
  | 'vertical_dir'       // Vertical irradiance, directional
  | 'eye_worst_case'     // Worst-case eye exposure (fov_vert=80, fov_horiz=120)
  | 'eye_directional'    // Eye exposure with fixed gaze direction
  | 'eye_target'         // Eye exposure looking toward a target point
  | 'custom';            // Flags don't match any named type

export type RefSurface = 'xy' | 'xz' | 'yz';

export type ZoneDisplayMode = 'heatmap' | 'numeric' | 'markers' | 'none';

export interface CalcZone {
  id: string;
  name?: string;
  type: 'plane' | 'volume' | 'point';
  enabled?: boolean;
  isStandard?: boolean;  // True for the 3 standard zones (WholeRoomFluence, EyeLimits, SkinLimits)

  // Value display settings
  dose?: boolean;        // If true, show dose (mJ/cm²); if false, show irradiance/fluence rate (µW/cm²)
  hours?: number;        // Hours for dose calculation
  minutes?: number;      // Minutes for dose calculation
  seconds?: number;      // Seconds for dose calculation

  // Grid resolution (applies to both plane and volume)
  resolution_mode?: ResolutionMode;  // Which mode the user chose; drives what gets sent to backend
  num_x?: number;
  num_y?: number;
  num_z?: number;        // Volume only
  x_spacing?: number;    // Alternative to num_x
  y_spacing?: number;    // Alternative to num_y
  z_spacing?: number;    // Volume only, alternative to num_z

  // Offset option
  offset?: boolean;      // If true, points offset from boundary; if false, on boundary

  // Plane-specific settings
  height?: number;
  calc_mode?: PlaneCalcMode;  // Calculation mode for planes
  ref_surface?: RefSurface;   // Reference surface (xy, xz, yz)
  direction?: number;         // Normal direction (1, -1, or 0 for omnidirectional)
  horiz?: boolean;            // Include horizontal component
  vert?: boolean;             // Include vertical component
  use_normal?: boolean;       // Block back-hemisphere (theta > 90°)
  fov_vert?: number;          // Vertical field of view (degrees)
  fov_horiz?: number;         // Horizontal/in-plane field of view (degrees)
  view_direction?: [number, number, number];  // Fixed gaze direction vector (eye_directional)
  view_target?: [number, number, number];     // Target point to look at (eye_target)
  v_positive_direction?: boolean;  // True if v_hat points in positive direction of its dominant axis

  // Plane dimensions (if not full room)
  x1?: number;
  x2?: number;
  y1?: number;
  y2?: number;

  // Volume-specific dimensions
  x_min?: number;
  x_max?: number;
  y_min?: number;
  y_max?: number;
  z_min?: number;
  z_max?: number;

  // Point-specific (position and aim point)
  x?: number;
  y?: number;
  z?: number;
  aim_x?: number;
  aim_y?: number;
  aim_z?: number;

  // Display options
  show_values?: boolean;  // deprecated, use display_mode
  display_mode?: ZoneDisplayMode;
  show_label?: boolean;   // Whether to show this zone's name label in 3D scene
}

// Compliance check types (from check_lamps)
export type ComplianceStatus =
  | 'compliant'
  | 'non_compliant'
  | 'compliant_with_dimming'
  | 'non_compliant_even_with_dimming';

export type WarningLevel = 'info' | 'warning' | 'error';

export interface LampComplianceResult {
  lamp_id: string;
  lamp_name: string;
  skin_dose_max: number;
  eye_dose_max: number;
  skin_tlv: number;
  eye_tlv: number;
  skin_dimming_required: number;  // 1.0 = no dimming, <1 = dimming required
  eye_dimming_required: number;
  is_skin_compliant: boolean;
  is_eye_compliant: boolean;
  skin_near_limit: boolean;
  eye_near_limit: boolean;
  missing_spectrum: boolean;
}

export interface SafetyWarning {
  level: WarningLevel;
  message: string;
  lamp_id?: string;
}

export interface CheckLampsResult {
  status: ComplianceStatus;
  lamp_results: Record<string, LampComplianceResult>;
  warnings: SafetyWarning[];
  max_skin_dose: number;
  max_eye_dose: number;
  is_skin_compliant: boolean;
  is_eye_compliant: boolean;
  skin_near_limit: boolean;
  eye_near_limit: boolean;
  skin_dimming_for_compliance?: number;
  eye_dimming_for_compliance?: number;
}

// State hashes from backend (room.get_calc_state() / room.get_update_state())
// Used for staleness detection — comparing current vs last-calculated hashes.
export interface StateHashes {
  calc_state: {
    lamps: number;
    calc_zones: Record<string, number>;
    reflectance: number;
  };
  update_state: {
    lamps: number;
    calc_zones: Record<string, number>;
    reflectance: number;
  };
}

export interface EfficacyExploreData {
  categories: string[];
  mediums: string[];
  wavelengths: number[];
  table: {
    columns: string[];
    rows: unknown[][];
    count: number;
  };
}

export interface DisinfectionRow {
  species: string;
  seconds_to_90: number | null;
  seconds_to_99: number | null;
  seconds_to_99_9: number | null;
}

export interface DisinfectionTableData {
  rows: DisinfectionRow[];
  air_changes: number;
  fluence: number;
}

export interface SimulationResults {
  calculatedAt: string;
  lastStateHashes?: StateHashes;  // Backend state hashes at time of last calculation
  zones: Record<string, ZoneResult>;
  safety?: SafetyResult;
  efficacy?: EfficacyResult;
  checkLamps?: CheckLampsResult;  // Comprehensive safety compliance check
  exploreData?: EfficacyExploreData;  // Prefetched explore data for client-side table/plot
  ozoneIncreasePpb?: number | null;  // Steady-state ozone increase from backend
  fluenceByWavelength?: Record<number, number> | null;  // Per-wavelength mean fluence (nm → µW/cm²)
}

/** Snapshot of zone dimensions at calculation time, used to hide stale 3D values */
export interface ZoneDimensionSnapshot {
  // Plane dimensions
  x1?: number;
  x2?: number;
  y1?: number;
  y2?: number;
  height?: number;
  ref_surface?: RefSurface;
  direction?: number;
  // Volume dimensions
  x_min?: number;
  x_max?: number;
  y_min?: number;
  y_max?: number;
  z_min?: number;
  z_max?: number;
  // Point dimensions
  x?: number;
  y?: number;
  z?: number;
  aim_x?: number;
  aim_y?: number;
  aim_z?: number;
  // Grid resolution
  num_x?: number;
  num_y?: number;
  num_z?: number;
  // Calculation parameters that affect results without changing geometry
  calc_mode?: PlaneCalcMode;
  horiz?: boolean;
  vert?: boolean;
  use_normal?: boolean;
  fov_vert?: number;
  fov_horiz?: number;
  view_direction?: [number, number, number];
  view_target?: [number, number, number];
}

export interface ZoneResult {
  zone_id: string;
  zone_name?: string;
  zone_type: string;
  statistics: {
    min?: number;
    max?: number;
    mean?: number;
    std?: number;
  };
  value_units?: string;
  num_points?: number[];  // [num_x, num_y] or [num_x, num_y, num_z]
  values?: number[][] | number[][][];  // 2D array for planes, 3D for volumes
  dimensionSnapshot?: ZoneDimensionSnapshot;
  doseAtCalcTime?: boolean;   // Whether dose mode was active when results were calculated
  hoursAtCalcTime?: number;   // Hours value used at calculation time
}

/** Shared interface for skin/eye dose results */
export interface DoseResult {
  max_dose?: number;
  tlv?: number;
  hours_to_limit?: number;
  compliant?: boolean;
}

export interface SafetyResult {
  standard: string;
  skin_dose: DoseResult;
  eye_dose: DoseResult;
  overall_compliant: boolean;
}

export interface EfficacyResult {
  average_fluence: number;
  fluence_units: string;
  wavelength?: number | null;
  each_uv_median: number;
  each_uv_min: number;
  each_uv_max: number;
  pathogen_count: number;
  /** @deprecated Use each_uv_median instead */
  each_uv?: number;
}

export interface Project {
  version: string;
  name: string;
  room: RoomConfig;
  lamps: LampInstance[];
  zones: CalcZone[];
  results?: SimulationResults;
  lastModified: string;
}

// Lamp preset info from API
export interface LampPresetInfo {
  id: string;
  name: string;
  lamp_type: string;
  wavelength: number;
  has_ies: boolean;
  has_spectrum: boolean;
  default_placement_mode?: string;
}

export interface LampTypeInfo {
  id: string;
  name: string;
  wavelength: number;
  requires_custom_ies: boolean;
  has_presets: boolean;
}

export interface LampSelectionOptions {
  lamp_types: LampTypeInfo[];
  presets_222nm: LampPresetInfo[];
}

// Centralized default values - use these instead of hardcoding
export const ROOM_DEFAULTS = {
  x: 4,
  y: 6,
  z: 2.7,
  standard: 'ANSI IES RP 27.1-22 (ACGIH Limits)' as const,
  enable_reflectance: false,
  reflectance: 0.078,
  reflectance_spacing: 0.5,
  reflectance_num_points: 10,
  reflectance_resolution_mode: 'num_points' as const,
  reflectance_max_num_passes: 100,
  reflectance_threshold: 0.02,
  air_changes: 1.0,
  ozone_decay_constant: 2.7,
  colormap: 'plasma',
  precision: 1,
  useStandardZones: true,
  showDimensions: true,
  showPhotometricWebs: true,
  showGrid: true,
  showXYZMarker: true,
  showLampLabels: false,
  showCalcPointLabels: false,
  globalHeatmapNormalization: false,
} as const;

export function defaultSurfaceSpacings(
  roomX = ROOM_DEFAULTS.x,
  roomY = ROOM_DEFAULTS.y,
  roomZ = ROOM_DEFAULTS.z,
): SurfaceSpacings {
  // Derive spacings from room dimensions / 10 to match guv_calcs 10x10 default
  const n = ROOM_DEFAULTS.reflectance_num_points;
  return {
    floor:   { x: roomX / n, y: roomY / n },
    ceiling: { x: roomX / n, y: roomY / n },
    north:   { x: roomX / n, y: roomZ / n },
    south:   { x: roomX / n, y: roomZ / n },
    east:    { x: roomY / n, y: roomZ / n },
    west:    { x: roomY / n, y: roomZ / n },
  };
}

export function defaultSurfaceNumPoints(): SurfaceNumPointsAll {
  // Always 10x10 per surface — matches guv_calcs default
  const n = ROOM_DEFAULTS.reflectance_num_points;
  return {
    floor:   { x: n, y: n },
    ceiling: { x: n, y: n },
    north:   { x: n, y: n },
    south:   { x: n, y: n },
    east:    { x: n, y: n },
    west:    { x: n, y: n },
  };
}

export interface RoomOverrides {
  x?: number;
  y?: number;
  z?: number;
  standard?: 'ANSI IES RP 27.1-22 (ACGIH Limits)' | 'UL8802 (ACGIH Limits)' | 'IEC 62471-6:2022 (ICNIRP Limits)';
  reflectance?: number;
  air_changes?: number;
  enable_reflectance?: boolean;
  useStandardZones?: boolean;
  colormap?: string;
  precision?: number;
  showDimensions?: boolean;
  showGrid?: boolean;
  showPhotometricWebs?: boolean;
  showXYZMarker?: boolean;
  showLampLabels?: boolean;
  showCalcPointLabels?: boolean;
  globalHeatmapNormalization?: boolean;
}

export function defaultRoom(overrides?: RoomOverrides): RoomConfig {
  const d = ROOM_DEFAULTS;
  const r = overrides?.reflectance ?? d.reflectance;
  const x = overrides?.x ?? d.x;
  const y = overrides?.y ?? d.y;
  const z = overrides?.z ?? d.z;
  return {
    x,
    y,
    z,
    standard: overrides?.standard ?? d.standard,
    enable_reflectance: overrides?.enable_reflectance ?? d.enable_reflectance,
    reflectances: {
      floor: r,
      ceiling: r,
      north: r,
      south: r,
      east: r,
      west: r
    },
    reflectance_spacings: defaultSurfaceSpacings(x, y, z),
    reflectance_num_points: defaultSurfaceNumPoints(),
    reflectance_resolution_mode: d.reflectance_resolution_mode,
    reflectance_max_num_passes: d.reflectance_max_num_passes,
    reflectance_threshold: d.reflectance_threshold,
    air_changes: overrides?.air_changes ?? d.air_changes,
    ozone_decay_constant: d.ozone_decay_constant,
    colormap: overrides?.colormap ?? d.colormap,
    precision: overrides?.precision ?? d.precision,
    useStandardZones: overrides?.useStandardZones ?? d.useStandardZones,
    showDimensions: overrides?.showDimensions ?? d.showDimensions,
    showPhotometricWebs: overrides?.showPhotometricWebs ?? d.showPhotometricWebs,
    showGrid: overrides?.showGrid ?? d.showGrid,
    showXYZMarker: overrides?.showXYZMarker ?? d.showXYZMarker,
    showLampLabels: overrides?.showLampLabels ?? d.showLampLabels,
    showCalcPointLabels: overrides?.showCalcPointLabels ?? d.showCalcPointLabels,
    globalHeatmapNormalization: overrides?.globalHeatmapNormalization ?? d.globalHeatmapNormalization
  };
}

// Import lamp placement algorithms from utilities
import { getDownlightPlacement, getCornerPlacement, getEdgePlacement, type PlacementMode } from '$lib/utils/lampPlacement';

function getPlacement(mode: PlacementMode, room: RoomConfig, existingLamps: LampInstance[]) {
  switch (mode) {
    case 'corner': return getCornerPlacement(room, existingLamps);
    case 'edge': return getEdgePlacement(room, existingLamps);
    case 'horizontal': {
      const edge = getEdgePlacement(room, existingLamps);
      return { ...edge, aimz: edge.z }; // Aim horizontally
    }
    default: return getDownlightPlacement(room, existingLamps);
  }
}

export function defaultLamp(room: RoomConfig, existingLamps: LampInstance[] = [], placementMode?: PlacementMode): Omit<LampInstance, 'id'> {
  const placement = getPlacement(placementMode ?? 'downlight', room, existingLamps);
  return {
    lamp_type: 'krcl_222',
    preset_id: undefined, // Will need to select
    name: undefined,
    x: placement.x,
    y: placement.y,
    z: placement.z,
    angle: 0,
    // Aim point from placement algorithm
    aimx: placement.aimx,
    aimy: placement.aimy,
    aimz: placement.aimz,
    scaling_factor: 1.0,
    enabled: true,
    has_ies_file: false,
    has_spectrum_file: false,
    show_label: room.showLampLabels,
  };
}

export interface ZoneOverrides {
  type?: 'plane' | 'volume' | 'point';
  display_mode?: ZoneDisplayMode;
  offset?: boolean;
  calc_mode?: PlaneCalcMode;
  dose?: boolean;
  hours?: number;
}

export function defaultZone(room: RoomConfig, zoneCount: number, overrides?: ZoneOverrides): Omit<CalcZone, 'id'> {
  const zoneType = overrides?.type ?? 'plane';
  const MIN_POINTS = 10;
  const defaultSpacing = 0.5;
  const num_x = Math.max(MIN_POINTS, Math.round(room.x / defaultSpacing));  // cell model (matches guv_calcs)
  const num_y = Math.max(MIN_POINTS, Math.round(room.y / defaultSpacing));  // cell model (matches guv_calcs)

  const base = {
    name: `CalcZone${zoneCount + 1}`,
    type: zoneType,
    enabled: true,
    dose: overrides?.dose ?? false,
    hours: overrides?.hours ?? 8,
    offset: overrides?.offset ?? true,
    resolution_mode: 'num_points' as ResolutionMode,
    display_mode: (overrides?.display_mode ?? 'heatmap') as ZoneDisplayMode,
  };

  if (zoneType === 'point') {
    const px = room.x / 2, py = room.y / 2, pz = 1.0;
    return {
      ...base,
      x: px,
      y: py,
      z: pz,
      aim_x: px,
      aim_y: py,
      aim_z: pz + 1,
      horiz: true,
      vert: false,
      use_normal: true,
      fov_vert: 180,
      fov_horiz: 360,
      calc_mode: 'planar_normal' as PlaneCalcMode,
      show_label: room.showCalcPointLabels,
    };
  }

  if (zoneType === 'volume') {
    const num_z = Math.max(MIN_POINTS, Math.round(room.z / defaultSpacing));
    return {
      ...base,
      x_min: 0,
      x_max: room.x,
      y_min: 0,
      y_max: room.y,
      z_min: 0,
      z_max: room.z,
      num_x,
      num_y,
      num_z,
    };
  }

  // Derive direction/horiz/vert from calc_mode
  const calc_mode = overrides?.calc_mode ?? 'planar_normal';
  let direction = 1;
  let horiz = true;
  let vert = false;
  if (calc_mode === 'planar_normal') { horiz = true; vert = false; direction = 1; }
  else if (calc_mode === 'planar_max') { horiz = false; vert = false; direction = 1; }
  else if (calc_mode === 'fluence_rate') { horiz = false; vert = false; direction = 0; }
  else if (calc_mode === 'vertical_dir') { horiz = false; vert = true; direction = 1; }
  else if (calc_mode === 'vertical') { horiz = false; vert = true; direction = 0; }

  return {
    ...base,
    // Plane defaults — height=0 places the plane at the reference surface
    height: 0,
    calc_mode,
    ref_surface: 'xy',
    direction,
    horiz,
    vert,
    fov_vert: 180,
    fov_horiz: 360,
    x1: 0,
    x2: room.x,
    y1: 0,
    y2: room.y,
    // Grid settings — only send num_points (not spacing) to avoid Axis1D conflicts
    num_x,
    num_y,
  };
}

export function defaultProject(roomOverrides?: RoomOverrides): Project {
  return {
    version: '1.0',
    name: 'untitled_project',
    room: defaultRoom(roomOverrides),
    lamps: [],
    zones: [],
    lastModified: new Date().toISOString()
  };
}
