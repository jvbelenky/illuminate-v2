// Project types - mirrors the .guv file structure and FastAPI schemas

import { numPointsFromSpacing } from '$lib/utils/calculations';

export type LampType = 'krcl_222' | 'lp_254';

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

export type ReflectanceResolutionMode = 'spacing' | 'num_points';

export interface RoomConfig {
  x: number;
  y: number;
  z: number;
  units: 'meters' | 'feet';
  standard: 'ACGIH' | 'ACGIH-UL8802' | 'ICNIRP';
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

  // Advanced settings
  intensity_units?: 'mW/sr' | 'uW/cm2';
  source_width?: number;
  source_length?: number;
  source_depth?: number;
  source_density?: number;
}

// Calculation type options for planes
export type PlaneCalcType =
  | 'planar_normal'      // Horizontal irradiance, directional (horiz=true, vert=false, direction=1)
  | 'planar_max'         // All angles, directional (horiz=false, vert=false, direction=1)
  | 'fluence_rate'       // All angles (horiz=false, vert=false, direction=0)
  | 'vertical_dir'       // Vertical irradiance, directional (horiz=false, vert=true, direction=1)
  | 'vertical';          // Vertical irradiance (horiz=false, vert=true, direction=0)

export type RefSurface = 'xy' | 'xz' | 'yz';

export type ZoneDisplayMode = 'heatmap' | 'numeric' | 'markers';

export interface CalcZone {
  id: string;
  name?: string;
  type: 'plane' | 'volume';
  enabled?: boolean;
  isStandard?: boolean;  // True for the 3 standard zones (WholeRoomFluence, EyeLimits, SkinLimits)

  // Value display settings
  dose?: boolean;        // If true, show dose (mJ/cm²); if false, show irradiance/fluence rate (µW/cm²)
  hours?: number;        // Exposure time for dose calculation

  // Grid resolution (applies to both plane and volume)
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
  calc_type?: PlaneCalcType;  // Calculation type for planes
  ref_surface?: RefSurface;   // Reference surface (xy, xz, yz)
  direction?: number;         // Normal direction (1, -1, or 0 for omnidirectional)
  horiz?: boolean;            // Include horizontal component
  vert?: boolean;             // Include vertical component
  fov_vert?: number;          // Vertical field of view (degrees)
  fov_horiz?: number;         // Horizontal/in-plane field of view (degrees)
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

  // Display options
  show_values?: boolean;  // deprecated, use display_mode
  display_mode?: ZoneDisplayMode;
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
  skin_dimming_for_compliance?: number;
  eye_dimming_for_compliance?: number;
}

// Structured calculation state for granular staleness detection
export interface LampCalcState {
  x: number;
  y: number;
  z: number;
  aimx: number;
  aimy: number;
  aimz: number;
  angle: number;
  scaling_factor: number;
  lamp_type: string;
  preset_id?: string;
  has_ies_file?: boolean;
}

export interface ZoneCalcState {
  id: string;
  type: string;
  height?: number;
  num_x?: number;
  num_y?: number;
  num_z?: number;
  x_spacing?: number;
  y_spacing?: number;
  z_spacing?: number;
  x_min?: number;
  x_max?: number;
  y_min?: number;
  y_max?: number;
  z_min?: number;
  z_max?: number;
  isStandard?: boolean;
}

export interface RoomCalcState {
  x: number;
  y: number;
  z: number;
  units: string;
  enable_reflectance: boolean;
  reflectances?: SurfaceReflectances;
  reflectance_spacings?: SurfaceSpacings;
  reflectance_num_points?: SurfaceNumPointsAll;
  reflectance_resolution_mode?: ReflectanceResolutionMode;
  reflectance_max_num_passes?: number;
  reflectance_threshold?: number;
}

export interface CalcState {
  lamps: LampCalcState[];
  safetyZones: ZoneCalcState[];
  otherZones: ZoneCalcState[];
  room: RoomCalcState;
}

export interface SimulationResults {
  calculatedAt: string;
  lastRequestState?: string;  // Snapshot of API request parameters when results were computed
  lastCalcState?: CalcState;  // Structured state for granular staleness comparison
  zones: Record<string, ZoneResult>;
  safety?: SafetyResult;
  efficacy?: EfficacyResult;
  checkLamps?: CheckLampsResult;  // Comprehensive safety compliance check
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
  units?: string;
  num_points?: number[];  // [num_x, num_y] or [num_x, num_y, num_z]
  values?: number[][] | number[][][];  // 2D array for planes, 3D for volumes
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
  units: 'meters' as const,
  standard: 'ACGIH' as const,
  enable_reflectance: false,
  reflectance: 0.078,
  reflectance_spacing: 0.5,
  reflectance_num_points: 10,
  reflectance_resolution_mode: 'spacing' as const,
  reflectance_max_num_passes: 100,
  reflectance_threshold: 0.02,
  air_changes: 1.0,
  ozone_decay_constant: 2.7,
  colormap: 'plasma',
  precision: 1,
  useStandardZones: true,
  showDimensions: true,
} as const;

export function defaultSurfaceSpacings(): SurfaceSpacings {
  const s = ROOM_DEFAULTS.reflectance_spacing;
  return {
    floor: { x: s, y: s },
    ceiling: { x: s, y: s },
    north: { x: s, y: s },
    south: { x: s, y: s },
    east: { x: s, y: s },
    west: { x: s, y: s }
  };
}

export function defaultSurfaceNumPoints(
  roomX = ROOM_DEFAULTS.x,
  roomY = ROOM_DEFAULTS.y,
  roomZ = ROOM_DEFAULTS.z,
  spacing = ROOM_DEFAULTS.reflectance_spacing
): SurfaceNumPointsAll {
  const np = numPointsFromSpacing;
  return {
    floor:   { x: np(roomX, spacing), y: np(roomY, spacing) },
    ceiling: { x: np(roomX, spacing), y: np(roomY, spacing) },
    north:   { x: np(roomX, spacing), y: np(roomZ, spacing) },
    south:   { x: np(roomX, spacing), y: np(roomZ, spacing) },
    east:    { x: np(roomY, spacing), y: np(roomZ, spacing) },
    west:    { x: np(roomY, spacing), y: np(roomZ, spacing) },
  };
}

export function defaultRoom(): RoomConfig {
  const d = ROOM_DEFAULTS;
  const r = d.reflectance;
  return {
    x: d.x,
    y: d.y,
    z: d.z,
    units: d.units,
    standard: d.standard,
    enable_reflectance: d.enable_reflectance,
    reflectances: {
      floor: r,
      ceiling: r,
      north: r,
      south: r,
      east: r,
      west: r
    },
    reflectance_spacings: defaultSurfaceSpacings(),
    reflectance_num_points: defaultSurfaceNumPoints(),
    reflectance_resolution_mode: d.reflectance_resolution_mode,
    reflectance_max_num_passes: d.reflectance_max_num_passes,
    reflectance_threshold: d.reflectance_threshold,
    air_changes: d.air_changes,
    ozone_decay_constant: d.ozone_decay_constant,
    colormap: d.colormap,
    precision: d.precision,
    useStandardZones: d.useStandardZones,
    showDimensions: d.showDimensions
  };
}

// Import lamp placement algorithm from utilities
import { getDownlightPlacement } from '$lib/utils/lampPlacement';

export function defaultLamp(room: RoomConfig, existingLamps: LampInstance[] = []): Omit<LampInstance, 'id'> {
  const placement = getDownlightPlacement(room, existingLamps);
  return {
    lamp_type: 'krcl_222',
    preset_id: undefined, // Will need to select
    name: undefined,
    x: placement.x,
    y: placement.y,
    z: placement.z,
    angle: 0,
    // Aim point defaults to directly below the lamp (at floor level)
    aimx: placement.aimx,
    aimy: placement.aimy,
    aimz: placement.aimz,
    scaling_factor: 1.0,
    enabled: true,
    has_ies_file: false,
    has_spectrum_file: false
  };
}

export function defaultZone(room: RoomConfig, zoneCount: number): Omit<CalcZone, 'id'> {
  // Default to a horizontal plane at working height
  const defaultSpacing = 0.5;
  const num_x = Math.max(2, Math.ceil(room.x / defaultSpacing) + 1);
  const num_y = Math.max(2, Math.ceil(room.y / defaultSpacing) + 1);

  return {
    name: `CalcZone ${zoneCount + 1}`,
    type: 'plane',
    enabled: true,
    // Plane defaults
    height: room.units === 'meters' ? 0.75 : 2.5, // Working height
    calc_type: 'fluence_rate',
    ref_surface: 'xy',
    direction: 0,
    horiz: false,
    vert: false,
    fov_vert: 80,
    fov_horiz: 360,
    x1: 0,
    x2: room.x,
    y1: 0,
    y2: room.y,
    // Grid settings
    num_x,
    num_y,
    x_spacing: defaultSpacing,
    y_spacing: defaultSpacing,
    // Value display
    dose: false,
    hours: 8,
    offset: true,
    display_mode: 'heatmap' as ZoneDisplayMode
  };
}

export function defaultProject(): Project {
  return {
    version: '1.0',
    name: 'untitled_project',
    room: defaultRoom(),
    lamps: [],
    zones: [],
    lastModified: new Date().toISOString()
  };
}
