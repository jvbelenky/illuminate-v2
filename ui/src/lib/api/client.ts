import type {
  Project,
  LampSelectionOptions,
  LampPresetInfo,
  LampTypeInfo,
  LampType
} from '$lib/types/project';

// API base URL - configurable via environment variable
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new ApiError(response.status, text || `Request failed: ${response.status}`);
  }

  // Handle empty responses
  const text = await response.text();
  if (!text) return {} as T;

  return JSON.parse(text) as T;
}

// Health check
export async function checkHealth(): Promise<{ status: string }> {
  return request('/health');
}

// ============================================================
// Standard Zones
// ============================================================

export interface StandardZoneDefinition {
  zone_id: string;
  name: string;
  zone_type: 'plane' | 'volume';
  x_min?: number;
  x_max?: number;
  y_min?: number;
  y_max?: number;
  z_min?: number;
  z_max?: number;
  height?: number;
  num_x?: number;
  num_y?: number;
  num_z?: number;
  x_spacing?: number;
  y_spacing?: number;
  z_spacing?: number;
  dose: boolean;
  hours: number;
  use_normal?: boolean;
  vert?: boolean;
  horiz?: boolean;
  fov_vert?: number;
  show_values: boolean;
}

export interface StandardZonesResponse {
  zones: StandardZoneDefinition[];
}

export async function getStandardZones(params: {
  x: number;
  y: number;
  z: number;
  units: 'meters' | 'feet';
  standard: string;
}): Promise<StandardZonesResponse> {
  return request('/standard-zones', {
    method: 'POST',
    body: JSON.stringify(params)
  });
}

// ============================================================
// Lamp Types & Presets
// ============================================================

export async function getLampTypes(): Promise<LampTypeInfo[]> {
  return request('/lamps/types');
}

export async function getLampPresets(): Promise<LampPresetInfo[]> {
  return request('/lamps/presets');
}

export async function getLampOptions(): Promise<LampSelectionOptions> {
  return request('/lamps/options');
}

export async function getLampPresetDetails(presetId: string): Promise<{
  id: string;
  name: string;
  description: string;
  lamp_type: string;
  wavelength: number;
  requires_ies_upload: boolean;
  requires_spectrum_upload: boolean;
}> {
  return request(`/lamps/presets/${encodeURIComponent(presetId)}`);
}

// ============================================================
// Rooms
// ============================================================

export interface RoomCreateRequest {
  x: number;
  y: number;
  z: number;
  units: 'meters' | 'feet';
  standard?: string;
  room_name?: string;
  precision?: number;
}

export interface RoomSummary {
  room_id: string;
  room_name: string;
  room_uuid: string;
  dimensions: [number, number, number];
  units: string;
  standard: string;
  enable_reflectance: boolean;
  air_changes: number;
  ozone_decay_constant: number;
  colormap: string;
  number_of_lamps: number;
  number_of_calc_zones: number;
  created_at: string;
  updated_at: string;
  created_by_user_id?: string;
}

export async function getRooms(): Promise<RoomSummary[]> {
  return request('/rooms');
}

export async function getRoom(id: string): Promise<RoomSummary> {
  return request(`/rooms/${encodeURIComponent(id)}`);
}

export async function createRoom(data: RoomCreateRequest): Promise<RoomSummary> {
  return request('/rooms', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

// ============================================================
// Room Lamps
// ============================================================

export interface RoomLampCreate {
  lamp_type: LampType;
  preset_id?: string;
  x: number;
  y: number;
  z: number;
  aimx?: number;
  aimy?: number;
  aimz?: number;
  scaling_factor?: number;
  name?: string;
  enabled?: boolean;
}

export interface RoomLampResponse {
  lamp_id: string;
  room_id: string;
  lamp_type: string;
  preset_id?: string;
  name?: string;
  x: number;
  y: number;
  z: number;
  aimx: number;
  aimy: number;
  aimz: number;
  scaling_factor: number;
  wavelength?: number;
  enabled: boolean;
  has_ies_file: boolean;
  has_spectrum_file: boolean;
}

export async function listRoomLamps(roomId: string): Promise<RoomLampResponse[]> {
  return request(`/rooms/${encodeURIComponent(roomId)}/lamps`);
}

export async function addRoomLamp(roomId: string, lamp: RoomLampCreate): Promise<RoomLampResponse> {
  return request(`/rooms/${encodeURIComponent(roomId)}/lamps`, {
    method: 'POST',
    body: JSON.stringify(lamp)
  });
}

export async function getRoomLamp(roomId: string, lampId: string): Promise<RoomLampResponse> {
  return request(`/rooms/${encodeURIComponent(roomId)}/lamps/${encodeURIComponent(lampId)}`);
}

export async function updateRoomLamp(
  roomId: string,
  lampId: string,
  updates: Partial<RoomLampCreate>
): Promise<RoomLampResponse> {
  return request(`/rooms/${encodeURIComponent(roomId)}/lamps/${encodeURIComponent(lampId)}`, {
    method: 'PATCH',
    body: JSON.stringify(updates)
  });
}

export async function deleteRoomLamp(roomId: string, lampId: string): Promise<void> {
  await request(`/rooms/${encodeURIComponent(roomId)}/lamps/${encodeURIComponent(lampId)}`, {
    method: 'DELETE'
  });
}

// ============================================================
// Lamp Photometric Web Data (for 3D visualization)
// ============================================================

export interface PhotometricWebData {
  vertices: number[][];  // [[x, y, z], ...]
  triangles: number[][]; // [[i, j, k], ...]
  aim_line: number[][];  // [[start_x, start_y, start_z], [end_x, end_y, end_z]]
  surface_points: number[][];  // [[x, y, z], ...]
  color: string;
}

export interface PhotometricWebRequest {
  preset_id: string;
  scaling_factor?: number;
  units?: 'meters' | 'feet';
}

export async function getPhotometricWeb(params: PhotometricWebRequest): Promise<PhotometricWebData> {
  return request('/lamps/photometric-web', {
    method: 'POST',
    body: JSON.stringify({
      preset_id: params.preset_id,
      scaling_factor: params.scaling_factor ?? 1.0,
      units: params.units ?? 'meters'
    })
  });
}

// ============================================================
// Lamp File Uploads
// ============================================================

export async function uploadLampIES(
  roomId: string,
  lampId: string,
  file: File
): Promise<{ message: string; filename: string; size_bytes: number }> {
  const formData = new FormData();
  formData.append('file', file);

  const url = `${API_BASE}/rooms/${encodeURIComponent(roomId)}/lamps/${encodeURIComponent(lampId)}/ies`;

  const response = await fetch(url, {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    const text = await response.text();
    throw new ApiError(response.status, text || 'Upload failed');
  }

  return response.json();
}

export async function uploadLampSpectrum(
  roomId: string,
  lampId: string,
  file: File
): Promise<{ message: string; filename: string; lines: number }> {
  const formData = new FormData();
  formData.append('file', file);

  const url = `${API_BASE}/rooms/${encodeURIComponent(roomId)}/lamps/${encodeURIComponent(lampId)}/spectrum`;

  const response = await fetch(url, {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    const text = await response.text();
    throw new ApiError(response.status, text || 'Upload failed');
  }

  return response.json();
}

// ============================================================
// Calc Zone Visualization
// ============================================================

export interface ZoneVisualizationData {
  zone_id: string;
  zone_type: 'plane' | 'volume';
  has_values: boolean;
  coords: number[][];  // [[x, y, z], ...]
  // Only present when has_values is true
  values?: number[][] | number[];  // 2D grid for planes, flat for volumes
  num_points?: number[];  // [num_x, num_y] for planes
  x_grid?: number[][];
  y_grid?: number[][];
  z_grid?: number[][];
}

export async function getZoneVisualization(
  roomId: string,
  zoneId: string
): Promise<ZoneVisualizationData> {
  return request(`/rooms/${encodeURIComponent(roomId)}/zones/${encodeURIComponent(zoneId)}/visualization`);
}

// ============================================================
// Simulation
// ============================================================

export interface FullSimulationRequest {
  include_safety?: boolean;
  include_efficacy?: boolean;
  include_ozone?: boolean;
}

export interface ZoneResultResponse {
  zone_id: string;
  zone_name?: string;
  zone_type: string;
  statistics: {
    min?: number;
    max?: number;
    mean?: number;
    std?: number;
  };
}

export interface SafetyResultResponse {
  standard: string;
  skin_dose: Record<string, unknown>;
  eye_dose: Record<string, unknown>;
  overall_compliant: boolean;
}

export interface EfficacyResultResponse {
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

export interface FullSimulationResponse {
  success: boolean;
  room_id: string;
  calculated_at: string;
  zones: Record<string, ZoneResultResponse>;
  safety?: SafetyResultResponse;
  efficacy?: EfficacyResultResponse;
  ozone?: {
    estimated_increase_ppb: number;
    air_changes: number;
    decay_constant: number;
    warning?: string;
  };
}

export async function calculateRoom(
  roomId: string,
  options: FullSimulationRequest = {}
): Promise<FullSimulationResponse> {
  return request(`/rooms/${encodeURIComponent(roomId)}/calculate`, {
    method: 'POST',
    body: JSON.stringify(options)
  });
}

// ============================================================
// Simulation
// ============================================================

export interface ZoneInput {
  zone_id?: string;
  name?: string;
  zone_type: 'plane' | 'volume';
  enabled?: boolean;

  // Value display settings
  dose?: boolean;
  hours?: number;

  // For planes - dimensions
  height?: number;
  x1?: number;
  x2?: number;
  y1?: number;
  y2?: number;

  // Plane-specific calculation options
  calc_type?: 'planar_normal' | 'planar_max' | 'fluence_rate' | 'vertical_dir' | 'vertical';
  ref_surface?: 'xy' | 'xz' | 'yz';
  direction?: number;
  horiz?: boolean;
  vert?: boolean;
  fov_vert?: number;
  fov_horiz?: number;

  // For volumes - dimensions
  x_min?: number;
  x_max?: number;
  y_min?: number;
  y_max?: number;
  z_min?: number;
  z_max?: number;

  // Resolution (both plane and volume)
  num_x?: number;
  num_y?: number;
  num_z?: number;
  x_spacing?: number;
  y_spacing?: number;
  z_spacing?: number;

  // Grid offset option
  offset?: boolean;

  // Display options
  show_values?: boolean;
}

import type { SurfaceReflectances } from '$lib/types/project';

export interface LampInputForSim {
  x: number;
  y: number;
  z: number;
  wavelength: number;
  guv_type: 'LED' | 'LP' | 'MP';
  aimx: number;
  aimy: number;
  aimz: number;
  scaling_factor: number;
  preset_id?: string;  // e.g., "ushio_b1", "aerolamp", etc.
  enabled?: boolean;
}

export interface SimulationRequest {
  room: {
    x: number;
    y: number;
    z: number;
    units: 'meters' | 'feet';
    precision: number;
    standard?: 'ACGIH' | 'ACGIH-UL8802' | 'ICNIRP';
    enable_reflectance?: boolean;
    reflectances?: SurfaceReflectances;
    reflectance_x_spacings?: Record<string, number>;
    reflectance_y_spacings?: Record<string, number>;
    reflectance_x_num_points?: Record<string, number>;
    reflectance_y_num_points?: Record<string, number>;
    reflectance_max_num_passes?: number;
    reflectance_threshold?: number;
    air_changes?: number;
    ozone_decay_constant?: number;
    colormap?: string;
  };
  lamps: LampInputForSim[];  // Support multiple lamps
  zones?: ZoneInput[];
  include_zone_values?: boolean;
}

export interface SimulationZoneResult {
  zone_id: string;
  zone_name?: string;
  zone_type: string;
  statistics: {
    min?: number;
    max?: number;
    mean?: number;
    std?: number;
  };
  num_points?: number[];  // [num_x, num_y] or [num_x, num_y, num_z]
  values?: number[][] | number[][][];  // 2D for planes, 3D for volumes
}

export interface SimulationResponse {
  success: boolean;
  mean_fluence?: number;
  units: string;
  zones?: Record<string, SimulationZoneResult>;
}

export async function runSimulation(req: SimulationRequest): Promise<SimulationResponse> {
  return request('/simulate', {
    method: 'POST',
    body: JSON.stringify(req)
  });
}

// Run simulation from full project state
export async function simulateProject(project: {
  room: {
    x: number;
    y: number;
    z: number;
    units: 'meters' | 'feet';
    precision: number;
    standard?: 'ACGIH' | 'ACGIH-UL8802' | 'ICNIRP';
    enable_reflectance?: boolean;
    reflectances?: SurfaceReflectances;
    reflectance_spacings?: {
      floor: { x: number; y: number };
      ceiling: { x: number; y: number };
      north: { x: number; y: number };
      south: { x: number; y: number };
      east: { x: number; y: number };
      west: { x: number; y: number };
    };
    reflectance_num_points?: {
      floor: { x: number; y: number };
      ceiling: { x: number; y: number };
      north: { x: number; y: number };
      south: { x: number; y: number };
      east: { x: number; y: number };
      west: { x: number; y: number };
    };
    reflectance_resolution_mode?: 'spacing' | 'num_points';
    reflectance_max_num_passes?: number;
    reflectance_threshold?: number;
    air_changes?: number;
    ozone_decay_constant?: number;
    colormap?: string;
  };
  lamps: Array<{
    x: number;
    y: number;
    z: number;
    aimx: number;
    aimy: number;
    aimz: number;
    scaling_factor: number;
    lamp_type?: string;
    preset_id?: string;
    enabled?: boolean;
    has_ies_file?: boolean;
  }>;
  zones?: Array<{
    id: string;
    name?: string;
    type: 'plane' | 'volume';
    enabled?: boolean;
    // Value display
    dose?: boolean;
    hours?: number;
    // Grid resolution
    num_x?: number;
    num_y?: number;
    num_z?: number;
    x_spacing?: number;
    y_spacing?: number;
    z_spacing?: number;
    offset?: boolean;
    // Plane-specific
    height?: number;
    x1?: number;
    x2?: number;
    y1?: number;
    y2?: number;
    calc_type?: string;
    ref_surface?: string;
    direction?: number;
    horiz?: boolean;
    vert?: boolean;
    fov_vert?: number;
    fov_horiz?: number;
    // Volume-specific
    x_min?: number;
    x_max?: number;
    y_min?: number;
    y_max?: number;
    z_min?: number;
    z_max?: number;
    // Display
    show_values?: boolean;
  }>;
}): Promise<SimulationResponse> {
  // Filter to lamps with photometric data (backend handles enabled/disabled logic and empty case)
  const lampsWithData = project.lamps.filter(lamp => {
    if (lamp.preset_id && lamp.preset_id !== 'custom') return true;
    if (lamp.has_ies_file) return true;
    return false;
  });

  // Convert lamps to API format - include enabled status for backend to handle
  const lamps: LampInputForSim[] = lampsWithData.map(lamp => ({
    x: lamp.x,
    y: lamp.y,
    z: lamp.z,
    wavelength: lamp.lamp_type === 'lp_254' ? 254 : 222,
    guv_type: lamp.lamp_type === 'lp_254' ? 'LP' : 'LED',
    aimx: lamp.aimx,
    aimy: lamp.aimy,
    aimz: lamp.aimz,
    scaling_factor: lamp.scaling_factor,
    preset_id: lamp.preset_id,
    enabled: lamp.enabled !== false
  }));

  // Convert frontend zones to API format (only include enabled zones)
  const zones: ZoneInput[] | undefined = project.zones
    ?.filter(z => z.enabled !== false)
    .map(z => ({
      zone_id: z.id,
      name: z.name,
      zone_type: z.type,
      enabled: z.enabled,
      // Value display
      dose: z.dose,
      hours: z.hours,
      // Grid resolution
      num_x: z.num_x,
      num_y: z.num_y,
      num_z: z.num_z,
      x_spacing: z.x_spacing,
      y_spacing: z.y_spacing,
      z_spacing: z.z_spacing,
      offset: z.offset,
      // Plane-specific
      height: z.height,
      x1: z.x1,
      x2: z.x2,
      y1: z.y1,
      y2: z.y2,
      calc_type: z.calc_type as ZoneInput['calc_type'],
      ref_surface: z.ref_surface as ZoneInput['ref_surface'],
      direction: z.direction,
      horiz: z.horiz,
      vert: z.vert,
      fov_vert: z.fov_vert,
      fov_horiz: z.fov_horiz,
      // Volume-specific
      x_min: z.x_min,
      x_max: z.x_max,
      y_min: z.y_min,
      y_max: z.y_max,
      z_min: z.z_min,
      z_max: z.z_max,
      // Display
      show_values: z.show_values,
    }));

  // Build room object with reflectance settings if enabled
  const roomRequest: SimulationRequest['room'] = {
    x: project.room.x,
    y: project.room.y,
    z: project.room.z,
    units: project.room.units,
    precision: project.room.precision,
    standard: project.room.standard,
    enable_reflectance: project.room.enable_reflectance,
    reflectances: project.room.reflectances,
    air_changes: project.room.air_changes,
    ozone_decay_constant: project.room.ozone_decay_constant,
    colormap: project.room.colormap
  };

  // Add reflectance resolution settings if reflectance is enabled
  if (project.room.enable_reflectance) {
    const mode = project.room.reflectance_resolution_mode || 'spacing';

    if (mode === 'spacing' && project.room.reflectance_spacings) {
      const spacings = project.room.reflectance_spacings;
      roomRequest.reflectance_x_spacings = {
        floor: spacings.floor.x,
        ceiling: spacings.ceiling.x,
        north: spacings.north.x,
        south: spacings.south.x,
        east: spacings.east.x,
        west: spacings.west.x
      };
      roomRequest.reflectance_y_spacings = {
        floor: spacings.floor.y,
        ceiling: spacings.ceiling.y,
        north: spacings.north.y,
        south: spacings.south.y,
        east: spacings.east.y,
        west: spacings.west.y
      };
    } else if (mode === 'num_points' && project.room.reflectance_num_points) {
      const numPoints = project.room.reflectance_num_points;
      roomRequest.reflectance_x_num_points = {
        floor: numPoints.floor.x,
        ceiling: numPoints.ceiling.x,
        north: numPoints.north.x,
        south: numPoints.south.x,
        east: numPoints.east.x,
        west: numPoints.west.x
      };
      roomRequest.reflectance_y_num_points = {
        floor: numPoints.floor.y,
        ceiling: numPoints.ceiling.y,
        north: numPoints.north.y,
        south: numPoints.south.y,
        east: numPoints.east.y,
        west: numPoints.west.y
      };
    }

    roomRequest.reflectance_max_num_passes = project.room.reflectance_max_num_passes;
    roomRequest.reflectance_threshold = project.room.reflectance_threshold;
  }

  return runSimulation({
    room: roomRequest,
    lamps,
    zones: zones && zones.length > 0 ? zones : undefined,
    include_zone_values: true
  });
}

// ============================================================
// Project Export/Import
// ============================================================

export async function exportRoom(
  roomId: string,
  options: {
    include_ies_files?: boolean;
    include_spectrum_files?: boolean;
    include_results?: boolean;
  } = {}
): Promise<unknown> {
  const params = new URLSearchParams();
  if (options.include_ies_files !== undefined) {
    params.set('include_ies_files', String(options.include_ies_files));
  }
  if (options.include_spectrum_files !== undefined) {
    params.set('include_spectrum_files', String(options.include_spectrum_files));
  }
  if (options.include_results !== undefined) {
    params.set('include_results', String(options.include_results));
  }
  params.set('download', 'false'); // Get JSON response

  return request(`/rooms/${encodeURIComponent(roomId)}/export?${params.toString()}`);
}

export async function importRoom(
  file: File,
  newRoomId?: string
): Promise<{ message: string; room_id: string; room_name: string; lamps_count: number; zones_count: number }> {
  const formData = new FormData();
  formData.append('file', file);

  const params = new URLSearchParams();
  if (newRoomId) {
    params.set('new_room_id', newRoomId);
  }

  const url = `${API_BASE}/rooms/import?${params.toString()}`;

  const response = await fetch(url, {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    const text = await response.text();
    throw new ApiError(response.status, text || 'Import failed');
  }

  return response.json();
}

export async function duplicateRoom(
  roomId: string,
  newName?: string
): Promise<RoomSummary> {
  const params = new URLSearchParams();
  if (newName) {
    params.set('new_name', newName);
  }

  return request(`/rooms/${encodeURIComponent(roomId)}/duplicate?${params.toString()}`, {
    method: 'POST'
  });
}

// ============================================================
// Efficacy Data (guv-calcs integration)
// ============================================================

export interface PathogenSummary {
  species: string;
  log1_seconds?: number | null;
  log2_seconds?: number | null;
  log3_seconds?: number | null;
}

export interface EfficacySummaryResponse {
  pathogens: PathogenSummary[];
  wavelength: number;
  fluence: number;
}

export interface EfficacyTableResponse {
  columns: string[];
  rows: unknown[][];
  count: number;
}

export interface EfficacyPlotResponse {
  image_base64: string;
  content_type: string;
}

export interface EfficacyStatsResponse {
  each_uv_median: number;
  each_uv_min: number;
  each_uv_max: number;
  pathogen_count: number;
  wavelength?: number | null;
  medium: string;
}

export async function getEfficacyCategories(): Promise<string[]> {
  return request('/efficacy/categories');
}

export async function getEfficacyMediums(): Promise<string[]> {
  return request('/efficacy/mediums');
}

export async function getEfficacyWavelengths(): Promise<number[]> {
  return request('/efficacy/wavelengths');
}

export async function getEfficacySummary(
  fluence: number,
  wavelength?: number
): Promise<EfficacySummaryResponse> {
  return request('/efficacy/summary', {
    method: 'POST',
    body: JSON.stringify({ fluence, wavelength })
  });
}

export async function getEfficacyTable(params: {
  fluence: number;
  wavelength?: number;
  medium?: string;
  category?: string;
}): Promise<EfficacyTableResponse> {
  return request('/efficacy/table', {
    method: 'POST',
    body: JSON.stringify(params)
  });
}

export async function getEfficacyStats(params: {
  fluence: number;
  wavelength?: number;
  medium?: string;
}): Promise<EfficacyStatsResponse> {
  return request('/efficacy/stats', {
    method: 'POST',
    body: JSON.stringify({
      fluence: params.fluence,
      wavelength: params.wavelength,
      medium: params.medium || 'Aerosol'
    })
  });
}

export async function getEfficacySwarmPlot(params: {
  fluence: number;
  wavelength?: number;
  medium?: string;
  air_changes?: number;
}): Promise<EfficacyPlotResponse> {
  return request('/efficacy/plot/swarm', {
    method: 'POST',
    body: JSON.stringify({
      fluence: params.fluence,
      wavelength: params.wavelength,
      medium: params.medium,
      air_changes: params.air_changes || 1.0
    })
  });
}

export async function getEfficacySurvivalPlot(params: {
  fluence: number;
  wavelength?: number;
  medium?: string;
  air_changes?: number;
}): Promise<EfficacyPlotResponse> {
  return request('/efficacy/plot/survival', {
    method: 'POST',
    body: JSON.stringify({
      fluence: params.fluence,
      wavelength: params.wavelength,
      medium: params.medium,
      air_changes: params.air_changes || 1.0
    })
  });
}
