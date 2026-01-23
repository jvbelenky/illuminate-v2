import type {
  LampSelectionOptions,
  LampPresetInfo,
  LampTypeInfo,
  SurfaceReflectances
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
// Lamp Info (for popup display)
// ============================================================

export interface LampInfoResponse {
  preset_id: string;
  name: string;
  total_power_mw: number;
  max_skin_dose_8h: number;
  max_eye_dose_8h: number;
  photometric_plot_base64: string;
  spectrum_plot_base64: string | null;
  has_spectrum: boolean;
  report_url: string | null;
}

export async function getLampInfo(
  presetId: string,
  standard: string = 'ACGIH',
  spectrumScale: 'linear' | 'log' = 'linear'
): Promise<LampInfoResponse> {
  return request(`/lamps/info/${encodeURIComponent(presetId)}?standard=${standard}&spectrum_scale=${spectrumScale}`);
}

export function getLampIesDownloadUrl(presetId: string): string {
  return `${API_BASE}/lamps/download/ies/${encodeURIComponent(presetId)}`;
}

export function getLampSpectrumDownloadUrl(presetId: string): string {
  return `${API_BASE}/lamps/download/spectrum/${encodeURIComponent(presetId)}`;
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
// Types used by Session API
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

// ============================================================
// Session API - Real-time sync with persistent backend Room
// ============================================================

export interface SessionRoomConfig {
  x: number;
  y: number;
  z: number;
  units: 'meters' | 'feet';
  precision: number;
  standard: 'ACGIH' | 'ACGIH-UL8802' | 'ICNIRP';
  enable_reflectance: boolean;
  reflectances?: SurfaceReflectances;
  air_changes: number;
  ozone_decay_constant: number;
}

export interface SessionLampInput {
  id: string;
  lamp_type: 'krcl_222' | 'lp_254';
  preset_id?: string;
  x: number;
  y: number;
  z: number;
  aimx: number;
  aimy: number;
  aimz: number;
  scaling_factor: number;
  enabled: boolean;
}

export interface SessionZoneInput {
  id: string;
  name?: string;
  type: 'plane' | 'volume';
  enabled: boolean;
  isStandard: boolean;
  dose: boolean;
  hours: number;
  // Plane-specific
  height?: number;
  x1?: number;
  x2?: number;
  y1?: number;
  y2?: number;
  // Volume-specific
  x_min?: number;
  x_max?: number;
  y_min?: number;
  y_max?: number;
  z_min?: number;
  z_max?: number;
  // Resolution
  num_x?: number;
  num_y?: number;
  num_z?: number;
  x_spacing?: number;
  y_spacing?: number;
  z_spacing?: number;
  offset?: boolean;
  // Plane calculation options
  ref_surface?: 'xy' | 'xz' | 'yz';
  direction?: number;
  horiz?: boolean;
  vert?: boolean;
  fov_vert?: number;
  fov_horiz?: number;
}

export interface SessionInitRequest {
  room: SessionRoomConfig;
  lamps: SessionLampInput[];
  zones: SessionZoneInput[];
}

export interface SessionInitResponse {
  success: boolean;
  message: string;
  lamp_count: number;
  zone_count: number;
}

export interface SessionCalculateResponse {
  success: boolean;
  calculated_at: string;
  mean_fluence?: number;
  zones: Record<string, SimulationZoneResult>;
}

/**
 * Initialize a new session with the current project state.
 * This creates the backend Room that will be mutated by subsequent calls.
 */
export async function initSession(req: SessionInitRequest): Promise<SessionInitResponse> {
  return request('/session/init', {
    method: 'POST',
    body: JSON.stringify(req)
  });
}

/**
 * Update room configuration on the session.
 */
export async function updateSessionRoom(updates: Partial<SessionRoomConfig>): Promise<{ success: boolean }> {
  return request('/session/room', {
    method: 'PATCH',
    body: JSON.stringify(updates)
  });
}

/**
 * Add a new lamp to the session.
 */
export async function addSessionLamp(lamp: SessionLampInput): Promise<{ success: boolean; lamp_id: string }> {
  return request('/session/lamps', {
    method: 'POST',
    body: JSON.stringify(lamp)
  });
}

/**
 * Update an existing lamp in the session.
 */
export async function updateSessionLamp(
  lampId: string,
  updates: Partial<Omit<SessionLampInput, 'id'>>
): Promise<{ success: boolean }> {
  return request(`/session/lamps/${encodeURIComponent(lampId)}`, {
    method: 'PATCH',
    body: JSON.stringify(updates)
  });
}

/**
 * Delete a lamp from the session.
 */
export async function deleteSessionLamp(lampId: string): Promise<{ success: boolean }> {
  return request(`/session/lamps/${encodeURIComponent(lampId)}`, {
    method: 'DELETE'
  });
}

/**
 * Add a new zone to the session.
 */
export async function addSessionZone(zone: SessionZoneInput): Promise<{ success: boolean; zone_id: string }> {
  return request('/session/zones', {
    method: 'POST',
    body: JSON.stringify(zone)
  });
}

/**
 * Response from updating a zone - includes computed grid values from backend.
 */
export interface SessionZoneUpdateResponse {
  success: boolean;
  message: string;
  // Computed grid values (authoritative from backend)
  num_x?: number;
  num_y?: number;
  num_z?: number;
  x_spacing?: number;
  y_spacing?: number;
  z_spacing?: number;
}

/**
 * Update an existing zone in the session.
 * If grid params are provided, backend returns computed values.
 */
export async function updateSessionZone(
  zoneId: string,
  updates: Partial<Pick<SessionZoneInput, 'name' | 'enabled' | 'dose' | 'hours' | 'num_x' | 'num_y' | 'num_z' | 'x_spacing' | 'y_spacing' | 'z_spacing'>>
): Promise<SessionZoneUpdateResponse> {
  return request(`/session/zones/${encodeURIComponent(zoneId)}`, {
    method: 'PATCH',
    body: JSON.stringify(updates)
  });
}

/**
 * Delete a zone from the session.
 */
export async function deleteSessionZone(zoneId: string): Promise<{ success: boolean }> {
  return request(`/session/zones/${encodeURIComponent(zoneId)}`, {
    method: 'DELETE'
  });
}

/**
 * Run calculation on the session Room.
 * Uses the existing Room with all current lamps and zones.
 */
export async function calculateSession(): Promise<SessionCalculateResponse> {
  return request('/session/calculate', {
    method: 'POST'
  });
}

/**
 * Get a CSV report from the session Room.
 * Room must have been calculated first.
 */
export async function getSessionReport(): Promise<Blob> {
  const url = `${API_BASE}/session/report`;

  const response = await fetch(url, {
    method: 'GET'
  });

  if (!response.ok) {
    const text = await response.text();
    throw new ApiError(response.status, text || 'Report generation failed');
  }

  return response.blob();
}

/**
 * Get current session status (for debugging).
 */
export async function getSessionStatus(): Promise<{
  active: boolean;
  message?: string;
  room?: { dimensions: number[]; units: string; standard: string };
  lamp_count?: number;
  zone_count?: number;
}> {
  return request('/session/status');
}
