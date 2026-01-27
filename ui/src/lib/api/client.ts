import type {
  LampSelectionOptions,
  LampPresetInfo,
  LampTypeInfo,
  SurfaceReflectances
} from '$lib/types/project';
import {
  validateResponse,
  SessionInitResponseSchema,
  SessionZoneUpdateResponseSchema,
  CalculateResponseSchema,
  CheckLampsResponseSchema,
  LoadSessionResponseSchema,
  type LoadSessionResponse,
} from './schemas';

// Re-export types from schemas for backward compatibility
export type { LoadSessionResponse };

// API base URL - configurable via environment variable
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

// Session ID for multi-user support
// Generated once on app init and included in all session API requests
let _sessionId: string | null = null;

/**
 * Generate a new session ID.
 * Uses crypto.randomUUID() for a proper UUID v4.
 */
export function generateSessionId(): string {
  _sessionId = crypto.randomUUID();
  console.log('[session] Generated session ID:', _sessionId.slice(0, 8) + '...');
  return _sessionId;
}

/**
 * Get the current session ID.
 * Generates one if not already set.
 */
export function getSessionId(): string {
  if (!_sessionId) {
    return generateSessionId();
  }
  return _sessionId;
}

/**
 * Set the session ID (e.g., for restoring from storage).
 */
export function setSessionId(id: string): void {
  _sessionId = id;
  console.log('[session] Set session ID:', _sessionId.slice(0, 8) + '...');
}

/**
 * Check if a session ID has been generated.
 */
export function hasSessionId(): boolean {
  return _sessionId !== null;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ============================================================
// Session Expiration Detection & Recovery
// ============================================================

/**
 * Check if an error indicates session expiration.
 * The backend returns 400 with "No active session" when the session has timed out.
 */
export function isSessionExpiredError(error: unknown): boolean {
  return error instanceof ApiError &&
         error.status === 400 &&
         error.message.includes('No active session');
}

/**
 * Callback for reinitializing session when it expires.
 * Set by the project store to re-sync current frontend state to a new backend session.
 */
let _onSessionExpired: (() => Promise<void>) | null = null;

/**
 * Register a handler to be called when session expiration is detected.
 * The handler should reinitialize the session with current frontend state.
 */
export function setSessionExpiredHandler(handler: () => Promise<void>): void {
  _onSessionExpired = handler;
}

/**
 * Flag to prevent recursive reinitialize attempts during recovery.
 */
let _isReinitializing = false;

/**
 * Promise to track ongoing reinitialization.
 * Allows concurrent requests to wait for reinit to complete.
 */
let _reinitPromise: Promise<void> | null = null;

async function request<T>(
  endpoint: string,
  options: RequestInit = {},
  _isRetry: boolean = false  // Track retry state to prevent infinite loops
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;

  // Include session ID header for session-scoped endpoints
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Add session ID for session endpoints
  if (endpoint.startsWith('/session') && _sessionId) {
    headers['X-Session-ID'] = _sessionId;
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      ...headers,
      ...options.headers
    }
  });

  if (!response.ok) {
    const text = await response.text();
    const error = new ApiError(response.status, text || `Request failed: ${response.status}`);

    // Session expiration recovery with auto-retry
    // Don't recover during init (which is how we recover) or on retry
    const isSessionEndpoint = endpoint.startsWith('/session');
    const isInitEndpoint = endpoint === '/session/init';
    if (isSessionEndpoint && !isInitEndpoint && !_isRetry && isSessionExpiredError(error)) {
      // If another request is already reinitializing, wait for it then retry
      if (_isReinitializing && _reinitPromise) {
        console.log('[session] Waiting for ongoing reinit...');
        try {
          await _reinitPromise;
          console.log('[session] Reinit complete, retrying request...');
          return request<T>(endpoint, options, true);  // Retry after waiting
        } catch {
          // Reinit failed, throw original error
          throw error;
        }
      }

      // First request to detect expiration - do the reinit
      if (_onSessionExpired) {
        console.log('[session] Session expired, reinitializing...');
        _isReinitializing = true;
        _reinitPromise = _onSessionExpired();
        try {
          await _reinitPromise;
          console.log('[session] Reinitialized, retrying request...');
          return request<T>(endpoint, options, true);  // Retry once
        } catch (reinitError) {
          console.error('[session] Reinit failed:', reinitError);
          // Fall through to throw original error
        } finally {
          _isReinitializing = false;
          _reinitPromise = null;
        }
      }
    }

    throw error;
  }

  // Handle empty responses
  const text = await response.text();
  if (!text) return {} as T;

  return JSON.parse(text) as T;
}

/**
 * Handle session expiration recovery for a failed request.
 * Returns true if recovery succeeded and request should be retried.
 */
async function handleSessionRecovery(
  error: ApiError,
  endpoint: string,
  isRetry: boolean
): Promise<boolean> {
  const isSessionEndpoint = endpoint.startsWith('/session');
  const isInitEndpoint = endpoint === '/session/init';

  if (!isSessionEndpoint || isInitEndpoint || isRetry || !isSessionExpiredError(error)) {
    return false;
  }

  // If another request is already reinitializing, wait for it
  if (_isReinitializing && _reinitPromise) {
    console.log('[session] Waiting for ongoing reinit...');
    try {
      await _reinitPromise;
      console.log('[session] Reinit complete, retrying request...');
      return true;
    } catch {
      return false;
    }
  }

  // First request to detect expiration - do the reinit
  if (_onSessionExpired) {
    console.log('[session] Session expired, reinitializing...');
    _isReinitializing = true;
    _reinitPromise = _onSessionExpired();
    try {
      await _reinitPromise;
      console.log('[session] Reinitialized, retrying request...');
      return true;
    } catch (reinitError) {
      console.error('[session] Reinit failed:', reinitError);
      return false;
    } finally {
      _isReinitializing = false;
      _reinitPromise = null;
    }
  }

  return false;
}

/**
 * Make a request that returns a Blob (for file downloads).
 * Includes session expiration recovery.
 */
async function requestBlob(
  endpoint: string,
  options: RequestInit = {},
  _isRetry: boolean = false
): Promise<Blob> {
  const url = `${API_BASE}${endpoint}`;

  // Include session ID header for session-scoped endpoints
  const headers: Record<string, string> = {};
  if (endpoint.startsWith('/session') && _sessionId) {
    headers['X-Session-ID'] = _sessionId;
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      ...headers,
      ...options.headers
    }
  });

  if (!response.ok) {
    const text = await response.text();
    const error = new ApiError(response.status, text || `Request failed: ${response.status}`);

    if (!_isRetry && await handleSessionRecovery(error, endpoint, _isRetry)) {
      return requestBlob(endpoint, options, true);
    }

    throw error;
  }

  return response.blob();
}

/**
 * Make a request that returns text (for non-JSON responses).
 * Includes session expiration recovery.
 */
async function requestText(
  endpoint: string,
  options: RequestInit = {},
  _isRetry: boolean = false
): Promise<string> {
  const url = `${API_BASE}${endpoint}`;

  // Include session ID header for session-scoped endpoints
  const headers: Record<string, string> = {};
  if (endpoint.startsWith('/session') && _sessionId) {
    headers['X-Session-ID'] = _sessionId;
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      ...headers,
      ...options.headers
    }
  });

  if (!response.ok) {
    const text = await response.text();
    const error = new ApiError(response.status, text || `Request failed: ${response.status}`);

    if (!_isRetry && await handleSessionRecovery(error, endpoint, _isRetry)) {
      return requestText(endpoint, options, true);
    }

    throw error;
  }

  return response.text();
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
// Version Info
// ============================================================

export interface VersionInfo {
  app: string;
  version: string;
  guv_calcs_version: string;
}

export async function getVersion(): Promise<VersionInfo> {
  return request('/version');
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

export interface TlvLimits {
  skin: number;
  eye: number;
}

export interface LampInfoResponse {
  preset_id: string;
  name: string;
  total_power_mw: number;
  tlv_acgih: TlvLimits;
  tlv_icnirp: TlvLimits;
  photometric_plot_base64: string;
  spectrum_plot_base64: string | null;
  has_spectrum: boolean;
  report_url: string | null;
}

export async function getLampInfo(
  presetId: string,
  spectrumScale: 'linear' | 'log' = 'linear',
  theme: 'light' | 'dark' = 'dark',
  dpi: number = 100
): Promise<LampInfoResponse> {
  return request(`/lamps/info/${encodeURIComponent(presetId)}?spectrum_scale=${spectrumScale}&theme=${theme}&dpi=${dpi}`);
}

export function getLampIesDownloadUrl(presetId: string): string {
  return `${API_BASE}/lamps/download/ies/${encodeURIComponent(presetId)}`;
}

export function getLampSpectrumDownloadUrl(presetId: string): string {
  return `${API_BASE}/lamps/download/spectrum/${encodeURIComponent(presetId)}`;
}

export interface SessionLampInfoResponse {
  lamp_id: string;
  name: string;
  total_power_mw: number;
  tlv_acgih: TlvLimits;
  tlv_icnirp: TlvLimits;
  photometric_plot_base64: string;
  spectrum_plot_base64: string | null;
  has_spectrum: boolean;
}

export async function getSessionLampInfo(
  lampId: string,
  spectrumScale: 'linear' | 'log' = 'linear',
  theme: 'light' | 'dark' = 'dark',
  dpi: number = 100
): Promise<SessionLampInfoResponse> {
  return request(`/session/lamps/${encodeURIComponent(lampId)}/info?spectrum_scale=${spectrumScale}&theme=${theme}&dpi=${dpi}`);
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

export async function getSessionLampPhotometricWeb(lampId: string): Promise<PhotometricWebData> {
  return request(`/session/lamps/${encodeURIComponent(lampId)}/photometric-web`, {
    method: 'GET'
  });
}

// ============================================================
// Lamp File Uploads
// ============================================================

export interface IESUploadResponse {
  success: boolean;
  message: string;
  has_ies_file: boolean;
  filename?: string;
}

export async function uploadSessionLampIES(
  lampId: string,
  file: File,
  _isRetry: boolean = false
): Promise<IESUploadResponse> {
  const formData = new FormData();
  formData.append('file', file);

  const endpoint = `/session/lamps/${encodeURIComponent(lampId)}/ies`;
  const url = `${API_BASE}${endpoint}`;

  // Include session ID header
  const headers: Record<string, string> = {};
  if (_sessionId) {
    headers['X-Session-ID'] = _sessionId;
  }

  const response = await fetch(url, {
    method: 'POST',
    body: formData,
    headers
  });

  if (!response.ok) {
    const text = await response.text();
    const error = new ApiError(response.status, text || 'IES upload failed');

    // Session recovery for uploads
    if (!_isRetry && await handleSessionRecovery(error, endpoint, _isRetry)) {
      return uploadSessionLampIES(lampId, file, true);
    }

    throw error;
  }

  return response.json();
}


// ============================================================
// Types used by Session API
// ============================================================

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
  const data = await request('/session/init', {
    method: 'POST',
    body: JSON.stringify(req)
  });
  return validateResponse(SessionInitResponseSchema, data, 'initSession');
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
  message?: string;
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
  const data = await request(`/session/zones/${encodeURIComponent(zoneId)}`, {
    method: 'PATCH',
    body: JSON.stringify(updates)
  });
  return validateResponse(SessionZoneUpdateResponseSchema, data, 'updateSessionZone');
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
  const data = await request('/session/calculate', {
    method: 'POST'
  });
  return validateResponse(CalculateResponseSchema, data, 'calculateSession') as SessionCalculateResponse;
}

/**
 * Get a CSV report from the session Room.
 * Room must have been calculated first.
 */
export async function getSessionReport(): Promise<Blob> {
  return requestBlob('/session/report');
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

/**
 * Export a single zone's data as CSV.
 * Uses zone.export() from guv_calcs which produces properly formatted CSV.
 */
export async function getSessionZoneExport(zoneId: string): Promise<Blob> {
  return requestBlob(`/session/zones/${encodeURIComponent(zoneId)}/export`);
}

/**
 * Export all results as a ZIP file.
 * Uses room.export_zip() from guv_calcs which includes project file and all zone CSVs.
 */
export async function getSessionExportZip(options?: { include_plots?: boolean }): Promise<Blob> {
  const params = new URLSearchParams();
  if (options?.include_plots) {
    params.append('include_plots', 'true');
  }
  const queryString = params.toString();
  return requestBlob(`/session/export${queryString ? `?${queryString}` : ''}`);
}

// ============================================================
// Disinfection Data
// ============================================================

export interface DisinfectionRow {
  species: string;
  seconds_to_90: number | null;
  seconds_to_99: number | null;
  seconds_to_99_9: number | null;
}

export interface DisinfectionTableResponse {
  rows: DisinfectionRow[];
  air_changes: number;
  fluence: number;
}

export interface SurvivalPlotResponse {
  image_base64: string;
  content_type: string;
}

/**
 * Get disinfection time data for key pathogens.
 */
export async function getDisinfectionTable(zoneId: string = 'WholeRoomFluence'): Promise<DisinfectionTableResponse> {
  return request(`/session/disinfection-table?zone_id=${encodeURIComponent(zoneId)}`);
}

export interface ZonePlotResponse {
  image_base64: string;
  content_type: string;
}

/**
 * Get zone plot as base64 image.
 */
export async function getZonePlot(
  zoneId: string,
  theme: 'light' | 'dark' = 'dark',
  dpi: number = 100
): Promise<ZonePlotResponse> {
  return request(`/session/zones/${encodeURIComponent(zoneId)}/plot?theme=${theme}&dpi=${dpi}`);
}

/**
 * Get survival plot as base64 image.
 */
export async function getSurvivalPlot(
  zoneId: string = 'WholeRoomFluence',
  theme: 'light' | 'dark' = 'dark',
  dpi: number = 100
): Promise<SurvivalPlotResponse> {
  return request(`/session/survival-plot?zone_id=${encodeURIComponent(zoneId)}&theme=${theme}&dpi=${dpi}`);
}

// ============================================================
// Project Save/Load
// ============================================================

/**
 * Save the session Room to .guv format.
 * Uses Room.save() from guv_calcs which produces a JSON file with version info.
 */
export async function saveSession(): Promise<string> {
  return requestText('/session/save');
}

/**
 * Load a session Room from .guv file data.
 * Uses Room.load() from guv_calcs to parse the file.
 * Returns the full room state so the frontend can update its store.
 */
export async function loadSession(guvData: unknown): Promise<LoadSessionResponse> {
  const data = await request('/session/load', {
    method: 'POST',
    body: JSON.stringify(guvData)
  });
  return validateResponse(LoadSessionResponseSchema, data, 'loadSession');
}

// ============================================================
// Safety Compliance Check (check_lamps)
// ============================================================

export interface LampComplianceResultResponse {
  lamp_id: string;
  lamp_name: string;
  skin_dose_max: number;
  eye_dose_max: number;
  skin_tlv: number;
  eye_tlv: number;
  skin_dimming_required: number;
  eye_dimming_required: number;
  is_skin_compliant: boolean;
  is_eye_compliant: boolean;
  missing_spectrum: boolean;
}

export interface SafetyWarningResponse {
  level: 'info' | 'warning' | 'error';
  message: string;
  lamp_id?: string;
}

export interface CheckLampsResponse {
  status: 'compliant' | 'non_compliant' | 'compliant_with_dimming' | 'non_compliant_even_with_dimming';
  lamp_results: Record<string, LampComplianceResultResponse>;
  warnings: SafetyWarningResponse[];
  max_skin_dose: number;
  max_eye_dose: number;
  skin_dimming_for_compliance?: number;
  eye_dimming_for_compliance?: number;
}

/**
 * Run safety compliance check on all lamps in the session.
 * Uses room.check_lamps() from guv_calcs for comprehensive safety analysis.
 */
export async function checkLampsSession(): Promise<CheckLampsResponse> {
  const data = await request('/session/check-lamps', {
    method: 'POST'
  });
  return validateResponse(CheckLampsResponseSchema, data, 'checkLampsSession') as CheckLampsResponse;
}
