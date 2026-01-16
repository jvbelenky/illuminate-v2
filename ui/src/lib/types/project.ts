// Project types - mirrors the .guv file structure and FastAPI schemas

export type LampType = 'krcl_222' | 'lp_254';

export interface RoomConfig {
  x: number;
  y: number;
  z: number;
  units: 'meters' | 'feet';
  standard: 'ACGIH' | 'ACGIH-UL8802' | 'ICNIRP';
  enable_reflectance: boolean;
  air_changes: number;
  ozone_decay_constant: number;
  colormap: string;
  precision: number;
  useStandardZones: boolean;  // Whether to include the 3 standard zones
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
  // Local file references (for pending uploads)
  pending_ies_file?: File;
  pending_spectrum_file?: File;
}

// Calculation type options for planes
export type PlaneCalcType =
  | 'planar_normal'      // Horizontal irradiance, directional (horiz=true, vert=false, direction=1)
  | 'planar_max'         // All angles, directional (horiz=false, vert=false, direction=1)
  | 'fluence_rate'       // All angles (horiz=false, vert=false, direction=0)
  | 'vertical_dir'       // Vertical irradiance, directional (horiz=false, vert=true, direction=1)
  | 'vertical';          // Vertical irradiance (horiz=false, vert=true, direction=0)

export type RefSurface = 'xy' | 'xz' | 'yz';

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
  show_values?: boolean;
}

export interface SimulationResults {
  calculatedAt: string;
  lastRequestState?: string;  // Snapshot of API request parameters when results were computed
  zones: Record<string, ZoneResult>;
  safety?: SafetyResult;
  efficacy?: EfficacyResult;
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

export interface SafetyResult {
  standard: string;
  skin_dose: {
    max_dose?: number;
    tlv?: number;
    hours_to_limit?: number;
    compliant?: boolean;
  };
  eye_dose: {
    max_dose?: number;
    tlv?: number;
    hours_to_limit?: number;
    compliant?: boolean;
  };
  overall_compliant: boolean;
}

export interface EfficacyResult {
  average_fluence: number;
  each_uv: number;
  fluence_units: string;
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

export function defaultRoom(): RoomConfig {
  return {
    x: 4,
    y: 6,
    z: 2.7,
    units: 'meters',
    standard: 'ACGIH',
    enable_reflectance: false,
    air_changes: 6.0,
    ozone_decay_constant: 0.15,
    colormap: 'plasma',
    precision: 1,
    useStandardZones: true
  };
}

// Calculate optimal lamp position using algorithm from guv-calcs
// Uses a grid-based approach where distances are calculated in grid units
// This ensures consistent behavior regardless of room aspect ratio
function findOptimalLampPosition(room: RoomConfig, existingLamps: LampInstance[]): { x: number; y: number } {
  // If no existing lamps, place in center
  if (existingLamps.length === 0) {
    return { x: room.x / 2, y: room.y / 2 };
  }

  // Use a fixed 100x100 grid like guv-calcs
  const M = 100;
  const N = 100;

  // Convert existing lamp positions to grid coordinates
  const lampGridPositions = existingLamps.map(lamp => ({
    gx: (lamp.x / room.x) * (M - 1),
    gy: (lamp.y / room.y) * (N - 1)
  }));

  let bestGx = M / 2;
  let bestGy = N / 2;
  let maxMinDist = -1;

  for (let gx = 0; gx < M; gx++) {
    for (let gy = 0; gy < N; gy++) {
      // Calculate minimum distance to existing lamps (in grid units)
      let minLampDist = Infinity;
      for (const pos of lampGridPositions) {
        const dist = Math.sqrt((gx - pos.gx) ** 2 + (gy - pos.gy) ** 2);
        minLampDist = Math.min(minLampDist, dist);
      }

      // Calculate minimum distance to grid boundaries (in grid units)
      const minBoundaryDist = Math.min(gx, M - 1 - gx, gy, N - 1 - gy);

      // Overall minimum distance (to lamps or walls)
      const minDist = Math.min(minLampDist, minBoundaryDist);

      // Track the position with maximum minimum distance
      if (minDist > maxMinDist) {
        maxMinDist = minDist;
        bestGx = gx;
        bestGy = gy;
      }
    }
  }

  // Convert back to room coordinates
  return {
    x: (bestGx / (M - 1)) * room.x,
    y: (bestGy / (N - 1)) * room.y
  };
}

export function defaultLamp(room: RoomConfig, existingLamps: LampInstance[] = []): Omit<LampInstance, 'id'> {
  const { x, y } = findOptimalLampPosition(room, existingLamps);
  const z = room.z - 0.3;
  return {
    lamp_type: 'krcl_222',
    preset_id: undefined, // Will need to select
    name: undefined,
    x,
    y,
    z,
    // Aim point defaults to directly below the lamp (at floor level)
    aimx: x,
    aimy: y,
    aimz: 0,
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
    show_values: true
  };
}

export function defaultProject(): Project {
  return {
    version: '1.0',
    name: 'Untitled Project',
    room: defaultRoom(),
    lamps: [],
    zones: [],
    lastModified: new Date().toISOString()
  };
}
