import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import { defaultProject, defaultSurfaceSpacings, defaultSurfaceNumPoints, ROOM_DEFAULTS, type Project, type LampInstance, type CalcZone, type RoomConfig, type StateHashes, type SurfaceSpacings, type SurfaceNumPointsAll } from '$lib/types/project';
import {
  initSession as apiInitSession,
  createSession as apiCreateSession,
  updateSessionRoom,
  addSessionLamp,
  updateSessionLamp,
  deleteSessionLamp,
  addSessionZone,
  deleteSessionZone,
  copySessionLamp,
  copySessionZone,
  getStandardZones as apiGetStandardZones,
  getSessionZones,
  getStateHashes as apiGetStateHashes,
  uploadSessionLampIES,
  uploadSessionLampSpectrum,
  generateSessionId,
  hasSessionId,
  hasSession,
  setSessionExpiredHandler,
  type SessionInitRequest,
  type SessionLampInput,
  type SessionZoneInput,
  type StandardZoneDefinition,
  type SessionZoneState,
  type LoadSessionResponse,
} from '$lib/api/client';
import { syncZoneToBackend } from '$lib/sync/zoneSyncService';

const STANDARD_ZONE_IDS = ['WholeRoomFluence', 'EyeLimits', 'SkinLimits'] as const;

// Re-export StateHashes type for convenience
export type { StateHashes } from '$lib/types/project';

// ============================================================
// State Hashes Store — backend-driven staleness detection
// ============================================================

/**
 * Writable store holding current and last-calculated state hashes from the backend.
 * `current` is updated after every mutation (debounced fetch from GET /session/state-hashes).
 * `lastCalculated` is set from the calculate response's state_hashes field.
 */
export const stateHashes = writable<{
  current: StateHashes | null;
  lastCalculated: StateHashes | null;
}>({ current: null, lastCalculated: null });

/** Overall: needs calculation if hashes differ or no previous calculation */
export const needsCalculation = derived(stateHashes, ($sh) => {
  if (!$sh.current || !$sh.lastCalculated) {
    // No hashes yet — need calculation if we have current (meaning session is live)
    return $sh.current !== null;
  }
  const c = $sh.current;
  const l = $sh.lastCalculated;
  // Compare top-level calc_state and update_state
  if (c.calc_state.lamps !== l.calc_state.lamps) return true;
  if (c.calc_state.reflectance !== l.calc_state.reflectance) return true;
  if (c.update_state.lamps !== l.update_state.lamps) return true;
  if (c.update_state.reflectance !== l.update_state.reflectance) return true;
  // Compare per-zone calc hashes
  const currentZoneIds = Object.keys(c.calc_state.calc_zones);
  const lastZoneIds = Object.keys(l.calc_state.calc_zones);
  if (currentZoneIds.length !== lastZoneIds.length) return true;
  for (const id of currentZoneIds) {
    if (c.calc_state.calc_zones[id] !== l.calc_state.calc_zones[id]) return true;
  }
  // Compare per-zone update hashes
  const currentUpdateZoneIds = Object.keys(c.update_state.calc_zones);
  const lastUpdateZoneIds = Object.keys(l.update_state.calc_zones);
  if (currentUpdateZoneIds.length !== lastUpdateZoneIds.length) return true;
  for (const id of currentUpdateZoneIds) {
    if (c.update_state.calc_zones[id] !== l.update_state.calc_zones[id]) return true;
  }
  return false;
});

/** Lamp state changed since last calculation */
export const lampsStale = derived(stateHashes, ($sh) => {
  if (!$sh.current || !$sh.lastCalculated) return false;
  return $sh.current.calc_state.lamps !== $sh.lastCalculated.calc_state.lamps;
});

/** Room/reflectance state changed since last calculation */
export const roomStale = derived(stateHashes, ($sh) => {
  if (!$sh.current || !$sh.lastCalculated) return false;
  return $sh.current.calc_state.reflectance !== $sh.lastCalculated.calc_state.reflectance
    || $sh.current.update_state.reflectance !== $sh.lastCalculated.update_state.reflectance;
});

/** Check if a specific zone is stale (calc or update state changed) */
export function isZoneStale(zoneId: string, current: StateHashes | null, lastCalculated: StateHashes | null): boolean {
  if (!current || !lastCalculated) return false;
  const cc = current.calc_state.calc_zones[zoneId];
  const lc = lastCalculated.calc_state.calc_zones[zoneId];
  if (cc !== lc) return true;
  const cu = current.update_state.calc_zones[zoneId];
  const lu = lastCalculated.update_state.calc_zones[zoneId];
  if (cu !== lu) return true;
  return false;
}

/**
 * Apply state hashes from a mutation response to the store.
 * Mutation endpoints now return state_hashes inline, eliminating the
 * need for a separate GET /session/state-hashes round-trip.
 */
function applyStateHashes(response: { state_hashes?: StateHashes | null }) {
  if (response?.state_hashes) {
    stateHashes.update(sh => ({ ...sh, current: response.state_hashes! }));
  }
}

/**
 * Fetch current state hashes from the backend (debounced).
 * Kept for backward compatibility — used only during session init
 * when no mutation response is available.
 * Also exported for use by components that bypass the normal sync path
 * (e.g., AdvancedLampSettingsModal which uses its own API endpoint).
 */
export function fetchStateHashesDebounced() {
  if (!_sessionInitialized) return;
  if (_stateHashFetchTimer) clearTimeout(_stateHashFetchTimer);
  _stateHashFetchTimer = setTimeout(async () => {
    try {
      const hashes = await apiGetStateHashes();
      stateHashes.update(sh => ({ ...sh, current: hashes }));
    } catch (e) {
      console.warn('[state-hashes] Failed to fetch:', e);
    }
  }, STATE_HASH_FETCH_DEBOUNCE_MS);
}

let _stateHashFetchTimer: ReturnType<typeof setTimeout> | undefined;
const STATE_HASH_FETCH_DEBOUNCE_MS = 300;

const STORAGE_KEY = 'illuminate_project';
const AUTOSAVE_DELAY_MS = 1000;
const SYNC_DEBOUNCE_MS = 150; // Debounce for slider/drag interactions

// ============================================================
// Session Sync State
// ============================================================

let _sessionInitialized = false;
let _sessionLoadedFromFile = false; // Track if session was loaded from .guv file (has embedded IES data)
let _syncEnabled = true;

// Counter to detect stale refreshStandardZones requests
// Incremented on each call; if counter changes during async operation, result is stale
let _refreshStandardZonesCounter = 0;

// Track the last room sync promise so refreshStandardZones can wait for it to complete
let _lastRoomSyncPromise: Promise<void> | null = null;

// ============================================================
// Sync Error Tracking
// ============================================================

export interface SyncError {
  id: string;
  type: 'error' | 'warning' | 'info';
  message: string;
  operation: string;
  timestamp: number;
}

// Store for sync errors - subscribers can display notifications
const { subscribe: subscribeSyncErrors, update: updateSyncErrors } = writable<SyncError[]>([]);

export const syncErrors = {
  subscribe: subscribeSyncErrors,

  /** Add a sync error to the queue */
  add(operation: string, error: unknown, type: 'error' | 'warning' | 'info' = 'error') {
    const message = error instanceof Error ? error.message : String(error);
    const syncError: SyncError = {
      id: crypto.randomUUID(),
      type,
      operation,
      message,
      timestamp: Date.now(),
    };
    updateSyncErrors((errors) => [...errors, syncError]);
    console.warn(`[sync ${type}] ${operation}:`, message);
  },

  /** Remove an error by ID (e.g., after user dismisses it) */
  dismiss(id: string) {
    updateSyncErrors((errors) => errors.filter((e) => e.id !== id));
  },

  /** Clear all errors */
  clear() {
    updateSyncErrors(() => []);
  },
};

// Debounce timers for different sync operations
const _debounceTimers: Record<string, ReturnType<typeof setTimeout>> = {};

function debounce(key: string, fn: () => void, delay: number = SYNC_DEBOUNCE_MS) {
  if (_debounceTimers[key]) {
    clearTimeout(_debounceTimers[key]);
  }
  _debounceTimers[key] = setTimeout(() => {
    try {
      fn();
    } finally {
      // Clean up timer entry after execution, even if fn() throws
      delete _debounceTimers[key];
    }
  }, delay);
}

/**
 * Cancel and clean up a debounce timer.
 * Call this when the associated item (lamp/zone) is deleted.
 */
function cancelDebounce(key: string) {
  if (_debounceTimers[key]) {
    clearTimeout(_debounceTimers[key]);
    delete _debounceTimers[key];
  }
}

// Flatten nested per-surface spacings to backend flat dicts
function flattenSpacings(spacings: SurfaceSpacings): {
  reflectance_x_spacings: Record<string, number>;
  reflectance_y_spacings: Record<string, number>;
} {
  const reflectance_x_spacings: Record<string, number> = {};
  const reflectance_y_spacings: Record<string, number> = {};
  for (const [surface, val] of Object.entries(spacings)) {
    reflectance_x_spacings[surface] = val.x;
    reflectance_y_spacings[surface] = val.y;
  }
  return { reflectance_x_spacings, reflectance_y_spacings };
}

// Flatten nested per-surface num_points to backend flat dicts
function flattenNumPoints(numPoints: SurfaceNumPointsAll): {
  reflectance_x_num_points: Record<string, number>;
  reflectance_y_num_points: Record<string, number>;
} {
  const reflectance_x_num_points: Record<string, number> = {};
  const reflectance_y_num_points: Record<string, number> = {};
  for (const [surface, val] of Object.entries(numPoints)) {
    reflectance_x_num_points[surface] = val.x;
    reflectance_y_num_points[surface] = val.y;
  }
  return { reflectance_x_num_points, reflectance_y_num_points };
}

// Convert project to session init format
function projectToSessionInit(p: Project): SessionInitRequest {
  const resolutionFields = p.room.reflectance_resolution_mode === 'spacing'
    ? flattenSpacings(p.room.reflectance_spacings)
    : flattenNumPoints(p.room.reflectance_num_points);

  return {
    room: {
      x: p.room.x,
      y: p.room.y,
      z: p.room.z,
      units: p.room.units,
      precision: p.room.precision,
      standard: p.room.standard,
      enable_reflectance: p.room.enable_reflectance,
      reflectances: p.room.reflectances,
      ...resolutionFields,
      reflectance_max_num_passes: p.room.reflectance_max_num_passes,
      reflectance_threshold: p.room.reflectance_threshold,
      air_changes: p.room.air_changes ?? ROOM_DEFAULTS.air_changes,
      ozone_decay_constant: p.room.ozone_decay_constant ?? ROOM_DEFAULTS.ozone_decay_constant,
    },
    lamps: p.lamps.map(lampToSessionLamp),
    zones: p.zones.map(zoneToSessionZone),
  };
}

function lampToSessionLamp(lamp: LampInstance | Omit<LampInstance, 'id'>): SessionLampInput {
  return {
    id: 'id' in lamp ? lamp.id : undefined,
    name: lamp.name,
    lamp_type: lamp.lamp_type,
    preset_id: lamp.preset_id,
    wavelength: lamp.lamp_type === 'other' ? lamp.wavelength : undefined,
    x: lamp.x,
    y: lamp.y,
    z: lamp.z,
    angle: lamp.angle,
    aimx: lamp.aimx,
    aimy: lamp.aimy,
    aimz: lamp.aimz,
    scaling_factor: lamp.scaling_factor,
    enabled: lamp.enabled !== false,
  };
}

function zoneToSessionZone(zone: CalcZone | Omit<CalcZone, 'id'>): SessionZoneInput {
  // Determine which resolution mode to send (num_points takes priority)
  // Only send one mode to avoid guv_calcs Axis1D giving spacing precedence over num_points
  const hasNumPoints = zone.num_x != null || zone.num_y != null || zone.num_z != null;

  // Normalize extents so min <= max for both planes and volumes
  const x1 = zone.x1 != null && zone.x2 != null ? Math.min(zone.x1, zone.x2) : zone.x1;
  const x2 = zone.x1 != null && zone.x2 != null ? Math.max(zone.x1, zone.x2) : zone.x2;
  const y1 = zone.y1 != null && zone.y2 != null ? Math.min(zone.y1, zone.y2) : zone.y1;
  const y2 = zone.y1 != null && zone.y2 != null ? Math.max(zone.y1, zone.y2) : zone.y2;
  const xMin = zone.x_min != null && zone.x_max != null ? Math.min(zone.x_min, zone.x_max) : zone.x_min;
  const xMax = zone.x_min != null && zone.x_max != null ? Math.max(zone.x_min, zone.x_max) : zone.x_max;
  const yMin = zone.y_min != null && zone.y_max != null ? Math.min(zone.y_min, zone.y_max) : zone.y_min;
  const yMax = zone.y_min != null && zone.y_max != null ? Math.max(zone.y_min, zone.y_max) : zone.y_max;
  const zMin = zone.z_min != null && zone.z_max != null ? Math.min(zone.z_min, zone.z_max) : zone.z_min;
  const zMax = zone.z_min != null && zone.z_max != null ? Math.max(zone.z_min, zone.z_max) : zone.z_max;

  return {
    id: 'id' in zone ? zone.id : undefined,
    name: zone.name,
    type: zone.type,
    enabled: zone.enabled !== false,
    isStandard: zone.isStandard ?? false,
    dose: zone.dose ?? false,
    hours: zone.hours ?? 8,
    // Plane-specific (normalized)
    height: zone.height,
    x1,
    x2,
    y1,
    y2,
    // Volume-specific (normalized)
    x_min: xMin,
    x_max: xMax,
    y_min: yMin,
    y_max: yMax,
    z_min: zMin,
    z_max: zMax,
    // Resolution — only send one mode
    num_x: hasNumPoints ? zone.num_x : undefined,
    num_y: hasNumPoints ? zone.num_y : undefined,
    num_z: hasNumPoints ? zone.num_z : undefined,
    x_spacing: hasNumPoints ? undefined : zone.x_spacing,
    y_spacing: hasNumPoints ? undefined : zone.y_spacing,
    z_spacing: hasNumPoints ? undefined : zone.z_spacing,
    offset: zone.offset,
    // Plane calculation options
    ref_surface: zone.ref_surface as 'xy' | 'xz' | 'yz' | undefined,
    direction: zone.direction,
    horiz: zone.horiz,
    vert: zone.vert,
    fov_vert: zone.fov_vert,
    fov_horiz: zone.fov_horiz,
  };
}

// Sync functions - report errors to syncErrors store for UI notification

/**
 * Wrapper for sync operations that handles common guard checks and error reporting.
 * Returns undefined if sync is disabled, otherwise returns the operation result.
 */
async function withSyncGuard<T>(
  operationName: string,
  operation: () => Promise<T>
): Promise<T | undefined> {
  if (!_sessionInitialized || !_syncEnabled) return;

  try {
    const result = await operation();
    if (result && typeof result === 'object' && 'state_hashes' in result) {
      applyStateHashes(result as { state_hashes?: StateHashes | null });
    }
    return result;
  } catch (e) {
    syncErrors.add(operationName, e);
  }
}

async function syncRoom(partial: Partial<RoomConfig>) {
  if (!_sessionInitialized || !_syncEnabled) return;

  try {
    // Only sync properties that the backend cares about
    const updates: Record<string, unknown> = {};
    if (partial.x !== undefined) updates.x = partial.x;
    if (partial.y !== undefined) updates.y = partial.y;
    if (partial.z !== undefined) updates.z = partial.z;
    if (partial.units !== undefined) updates.units = partial.units;
    if (partial.precision !== undefined) updates.precision = partial.precision;
    if (partial.standard !== undefined) updates.standard = partial.standard;
    if (partial.enable_reflectance !== undefined) updates.enable_reflectance = partial.enable_reflectance;
    if (partial.reflectances !== undefined) updates.reflectances = partial.reflectances;
    if (partial.reflectance_spacings !== undefined) {
      const flattened = flattenSpacings(partial.reflectance_spacings);
      updates.reflectance_x_spacings = flattened.reflectance_x_spacings;
      updates.reflectance_y_spacings = flattened.reflectance_y_spacings;
    }
    if (partial.reflectance_num_points !== undefined) {
      const flattened = flattenNumPoints(partial.reflectance_num_points);
      updates.reflectance_x_num_points = flattened.reflectance_x_num_points;
      updates.reflectance_y_num_points = flattened.reflectance_y_num_points;
    }
    if (partial.reflectance_max_num_passes !== undefined) updates.reflectance_max_num_passes = partial.reflectance_max_num_passes;
    if (partial.reflectance_threshold !== undefined) updates.reflectance_threshold = partial.reflectance_threshold;
    if (partial.air_changes !== undefined) updates.air_changes = partial.air_changes;
    if (partial.ozone_decay_constant !== undefined) updates.ozone_decay_constant = partial.ozone_decay_constant;

    if (Object.keys(updates).length > 0) {
      const result = await updateSessionRoom(updates);
      applyStateHashes(result);
    }
  } catch (e) {
    syncErrors.add('Update room', e);
  }
}


async function syncUpdateLamp(
  id: string,
  partial: Partial<LampInstance>,
  onIesUploaded?: (filename?: string) => void,
  onIesUploadError?: () => void,
  onSpectrumUploaded?: (result?: { peak_wavelength?: number }) => void,
  onSpectrumUploadError?: () => void,
  onLampUpdated?: (response: { aimx?: number; aimy?: number; aimz?: number; tilt?: number; orientation?: number }) => void
) {
  if (!_sessionInitialized || !_syncEnabled) return;

  try {
    // Sync property updates FIRST (excluding file objects).
    // This must happen before file uploads because property updates that include
    // lamp_type may recreate the lamp on the backend, which would discard any
    // previously uploaded IES/spectrum data.
    const { pending_ies_file, pending_spectrum_file, ...updates } = partial;
    if (Object.keys(updates).length > 0) {
      const response = await updateSessionLamp(id, updates);
      applyStateHashes(response);
      // If backend returned computed values, notify the caller
      if (onLampUpdated && response) {
        onLampUpdated({
          aimx: response.aimx,
          aimy: response.aimy,
          aimz: response.aimz,
          tilt: response.tilt,
          orientation: response.orientation,
        });
      }
    }

    // Handle IES file upload AFTER property sync
    if (partial.pending_ies_file) {
      try {
        const result = await uploadSessionLampIES(id, partial.pending_ies_file);
        if (result.success) {
          console.log('[session] IES file uploaded for lamp', id, result.filename);
          onIesUploaded?.(result.filename);
          fetchStateHashesDebounced();
        }
      } catch (uploadError) {
        console.error('[session] IES upload failed for lamp', id, uploadError);
        syncErrors.add('Upload IES file', uploadError);
        // Clear pending state on error so user can retry
        onIesUploadError?.();
      }
    }

    // Handle spectrum file upload AFTER property sync
    if (partial.pending_spectrum_file) {
      try {
        const result = await uploadSessionLampSpectrum(id, partial.pending_spectrum_file);
        if (result.success) {
          console.log('[session] Spectrum file uploaded for lamp', id, 'peak_wavelength:', result.peak_wavelength);
          onSpectrumUploaded?.(result);
          fetchStateHashesDebounced();
        }
      } catch (uploadError) {
        console.error('[session] Spectrum upload failed for lamp', id, uploadError);
        syncErrors.add('Upload spectrum file', uploadError);
        onSpectrumUploadError?.();
      }
    }
  } catch (e) {
    syncErrors.add('Update lamp', e);
  }
}

function syncDeleteLamp(id: string) {
  return withSyncGuard('Delete lamp', () => deleteSessionLamp(id));
}


/**
 * Sync zone updates to backend and apply computed values.
 * Uses zoneSyncService to decouple API call from store update logic.
 */
async function syncUpdateZone(
  id: string,
  partial: Partial<CalcZone>,
  applyComputedValues?: (id: string, values: Partial<CalcZone>) => void,
  zoneForTypeChange?: CalcZone
) {
  if (!_sessionInitialized || !_syncEnabled) return;

  try {
    // Type changes require delete + recreate since the backend uses different
    // classes for CalcPlane vs CalcVol and can't convert in place
    if (partial.type != null && zoneForTypeChange) {
      await deleteSessionZone(id);
      const addResult = await addSessionZone(zoneToSessionZone(zoneForTypeChange));
      applyStateHashes(addResult);
      return;
    }

    // Delegate to sync service - it handles API call and extracts computed values
    const result = await syncZoneToBackend(id, partial);
    applyStateHashes(result.rawResponse);

    // Store decides what to do with computed values
    if (applyComputedValues && Object.keys(result.computedValues).length > 0) {
      applyComputedValues(id, result.computedValues);
    }
  } catch (e) {
    syncErrors.add('Update zone', e);
  }
}

function syncDeleteZone(id: string) {
  return withSyncGuard('Delete zone', () => deleteSessionZone(id));
}


/**
 * Load project from sessionStorage.
 *
 * Behavior:
 * - Persists while tab is open (survives backend session timeout)
 * - Clears on page refresh (F5) for fresh start
 * - Clears on tab close (sessionStorage is per-tab)
 */
function loadFromStorage(): Project {
  if (!browser) return initializeStandardZones(defaultProject());

  // Detect page reload (F5) - clear storage for fresh start
  const navEntry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
  if (navEntry?.type === 'reload') {
    console.log('[illuminate] Page reload detected, clearing session storage');
    sessionStorage.removeItem(STORAGE_KEY);
    return initializeStandardZones(defaultProject());
  }

  // Try to restore from sessionStorage
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      // Basic shape validation - ensure essential properties exist
      if (!parsed || typeof parsed !== 'object' || !parsed.room || !Array.isArray(parsed.lamps) || !Array.isArray(parsed.zones)) {
        console.warn('[illuminate] Invalid project shape in sessionStorage, using default');
        sessionStorage.removeItem(STORAGE_KEY);
        return initializeStandardZones(defaultProject());
      }
      console.log('[illuminate] Restored project from sessionStorage');
      // Ensure standard zones are present if useStandardZones is enabled
      return initializeStandardZones(parsed as Project);
    }
  } catch (e) {
    console.warn('[illuminate] Failed to restore from sessionStorage:', e);
    sessionStorage.removeItem(STORAGE_KEY);
  }

  return initializeStandardZones(defaultProject());
}

// Convert backend StandardZoneDefinition to frontend CalcZone format
function convertStandardZone(def: StandardZoneDefinition, room: RoomConfig): CalcZone {
  const base: CalcZone = {
    id: def.zone_id,
    name: def.name,
    type: def.zone_type,
    enabled: true,
    isStandard: true,
    dose: def.dose,
    hours: def.hours,
    offset: true,
  };

  if (def.zone_type === 'volume') {
    return {
      ...base,
      x_min: def.x_min ?? 0,
      x_max: def.x_max ?? room.x,
      y_min: def.y_min ?? 0,
      y_max: def.y_max ?? room.y,
      z_min: def.z_min ?? 0,
      z_max: def.z_max ?? room.z,
      num_x: def.num_x ?? 25,
      num_y: def.num_y ?? 25,
      num_z: def.num_z ?? 25,
    };
  } else {
    return {
      ...base,
      height: def.height ?? 1.8, // ACGIH default; backend should always provide correct value
      x1: def.x_min ?? 0,
      x2: def.x_max ?? room.x,
      y1: def.y_min ?? 0,
      y2: def.y_max ?? room.y,
      x_spacing: def.x_spacing ?? 0.1,
      y_spacing: def.y_spacing ?? 0.1,
      vert: def.vert ?? false,
      horiz: def.horiz ?? false,
      fov_vert: def.fov_vert,
      ref_surface: 'xy',
    };
  }
}

// Fetch standard zones from backend - uses guv_calcs for correct heights based on standard
async function fetchStandardZonesFromBackend(room: RoomConfig): Promise<CalcZone[]> {
  try {
    const response = await apiGetStandardZones({
      x: room.x,
      y: room.y,
      z: room.z,
      units: room.units,
      standard: room.standard,
    });
    return response.zones.map(def => convertStandardZone(def, room));
  } catch (e) {
    console.error('[illuminate] Failed to fetch standard zones from backend:', e);
    syncErrors.add('Load safety zones', 'Safety compliance zones unavailable', 'warning');
    return [];
  }
}

// Convert backend SessionZoneState to frontend CalcZone format
// Used by refreshStandardZones() to fetch zone state from guv_calcs
function convertSessionZoneState(state: SessionZoneState): CalcZone {
  const base: CalcZone = {
    id: state.id,
    name: state.name,
    type: state.type,
    enabled: state.enabled,
    isStandard: true,
    dose: state.dose ?? false,
    hours: state.hours ?? 8,
    offset: state.offset ?? true,
    num_x: state.num_x,
    num_y: state.num_y,
    x_spacing: state.x_spacing,
    y_spacing: state.y_spacing,
  };

  if (state.type === 'volume') {
    return {
      ...base,
      num_z: state.num_z,
      z_spacing: state.z_spacing,
      x_min: state.x_min,
      x_max: state.x_max,
      y_min: state.y_min,
      y_max: state.y_max,
      z_min: state.z_min,
      z_max: state.z_max,
    };
  }
  // For standard zones, enforce correct vert/horiz/fov_vert values
  // (guv_calcs may return wrong defaults after room updates)
  let vert = state.vert;
  let horiz = state.horiz;
  let fov_vert = state.fov_vert;

  if (state.id === 'EyeLimits') {
    vert = true;
    horiz = false;
    fov_vert = 80;
  } else if (state.id === 'SkinLimits') {
    vert = false;
    horiz = true;
    fov_vert = 180;
  }

  return {
    ...base,
    height: state.height,
    x1: state.x1,
    x2: state.x2,
    y1: state.y1,
    y2: state.y2,
    horiz,
    vert,
    fov_vert,
    ref_surface: 'xy',
  };
}

// Cap standard zone grid to 200 points per dimension (matches backend MAX_STANDARD_ZONE_POINTS_PER_DIM)
function standardZoneSpacing(roomDim: number, baseSpacing = 0.1): number {
  if (roomDim <= 0) return baseSpacing;
  if (roomDim < baseSpacing) return roomDim / 10;
  const pointsAtBase = roomDim / baseSpacing + 1;
  if (pointsAtBase <= 200) return baseSpacing;
  return roomDim / (200 - 1);
}

// Synchronous fallback for initial project creation (before backend is ready)
// This is only used during initial load; updateRoom will fetch from backend
function getStandardZonesFallback(room: RoomConfig): CalcZone[] {
  // Heights from guv_calcs PhotStandard.flags():
  // ACGIH: 1.8m / 5.9ft, UL8802: 1.9m / 6.25ft
  const isUL8802 = room.standard === 'ACGIH-UL8802';
  const height = room.units === 'meters'
    ? (isUL8802 ? 1.9 : 1.8)
    : (isUL8802 ? 6.25 : 5.9);

  return [
    {
      id: 'WholeRoomFluence',
      name: 'Whole Room Fluence',
      type: 'volume',
      enabled: true,
      isStandard: true,
      dose: false,
      x_min: 0, x_max: room.x,
      y_min: 0, y_max: room.y,
      z_min: 0, z_max: room.z,
      num_x: 25, num_y: 25, num_z: 25,
      offset: true,
    },
    {
      id: 'EyeLimits',
      name: 'Eye Dose (8 Hours)',
      type: 'plane',
      enabled: true,
      isStandard: true,
      dose: true,
      hours: 8,
      height,
      x1: 0, x2: room.x,
      y1: 0, y2: room.y,
      x_spacing: standardZoneSpacing(room.x), y_spacing: standardZoneSpacing(room.y),
      vert: true,
      horiz: false,
      fov_vert: 80,
      ref_surface: 'xy',
      offset: true,
    },
    {
      id: 'SkinLimits',
      name: 'Skin Dose (8 Hours)',
      type: 'plane',
      enabled: true,
      isStandard: true,
      dose: true,
      hours: 8,
      height,
      x1: 0, x2: room.x,
      y1: 0, y2: room.y,
      x_spacing: standardZoneSpacing(room.x), y_spacing: standardZoneSpacing(room.y),
      horiz: true,
      vert: false,
      fov_vert: 180,
      ref_surface: 'xy',
      offset: true,
    },
  ];
}

// Initialize project with standard zones if enabled, and migrate old projects
function initializeStandardZones(project: Project): Project {
  const d = ROOM_DEFAULTS;

  // Handle projects from before useStandardZones was added
  if (project.room.useStandardZones === undefined) {
    project.room.useStandardZones = d.useStandardZones;
  }

  // Migrate projects without reflectances (added in v2)
  if (!project.room.reflectances) {
    const r = d.reflectance;
    project.room.reflectances = {
      floor: r, ceiling: r, north: r, south: r, east: r, west: r
    };
  }

  // Migrate projects without air quality settings
  if (project.room.air_changes === undefined) {
    project.room.air_changes = d.air_changes;
  }
  if (project.room.ozone_decay_constant === undefined) {
    project.room.ozone_decay_constant = d.ozone_decay_constant;
  }

  // Migrate projects without reflectance spacing settings
  if (!project.room.reflectance_spacings) {
    project.room.reflectance_spacings = defaultSurfaceSpacings();
  }
  if (!project.room.reflectance_num_points) {
    project.room.reflectance_num_points = defaultSurfaceNumPoints(
      project.room.x, project.room.y, project.room.z
    );
  }
  if (!project.room.reflectance_resolution_mode) {
    project.room.reflectance_resolution_mode = d.reflectance_resolution_mode;
  }
  if (project.room.reflectance_max_num_passes === undefined) {
    project.room.reflectance_max_num_passes = d.reflectance_max_num_passes;
  }
  if (project.room.reflectance_threshold === undefined) {
    project.room.reflectance_threshold = d.reflectance_threshold;
  }

  // Add standard zones if enabled and not already present
  // Uses fallback for initial sync load; backend fetch happens later via refreshStandardZones
  if (project.room.useStandardZones) {
    const hasStandardZones = project.zones.some(z => z.isStandard);
    if (!hasStandardZones) {
      project.zones = [...project.zones, ...getStandardZonesFallback(project.room)];
    }
  }

  return project;
}

/**
 * Save project to sessionStorage.
 * Called automatically on state changes via debounced autosave.
 */
function saveToStorage(project: Project) {
  if (!browser) return;

  try {
    // Strip large values arrays to stay within sessionStorage quota.
    // Values are only needed for plot modals and 3D display (in-memory),
    // and sessionStorage is cleared on refresh anyway.
    const toSave = project.results
      ? {
          ...project,
          results: {
            ...project.results,
            zones: Object.fromEntries(
              Object.entries(project.results.zones).map(([id, z]) => [id, { ...z, values: undefined }])
            )
          }
        }
      : project;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch (e) {
    console.warn('[illuminate] Failed to save to sessionStorage:', e);
  }
}

function createProjectStore() {
  const initial = loadFromStorage();
  const { subscribe, set, update } = writable<Project>(initial);

  let saveTimeout: ReturnType<typeof setTimeout>;

  // Helper to update zone from backend without triggering re-sync
  // Defined here so sync function can access `update`
  function updateZoneFromBackendInternal(id: string, values: Partial<CalcZone>) {
    const wasSyncEnabled = _syncEnabled;
    _syncEnabled = false;
    try {
      update((p) => ({
        ...p,
        zones: p.zones.map((z) => (z.id === id ? { ...z, ...values } : z))
      }));
    } finally {
      _syncEnabled = wasSyncEnabled;
    }
  }

  function scheduleAutosave() {
    if (!browser) return;
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      const current = get({ subscribe });
      saveToStorage(current);
    }, AUTOSAVE_DELAY_MS);
  }

  function updateWithTimestamp(fn: (p: Project) => Project) {
    update((p) => {
      const updated = fn(p);
      updated.lastModified = new Date().toISOString();
      return updated;
    });
    scheduleAutosave();
  }

  return {
    subscribe,

    // Initialize backend session with current project state
    async initSession() {
      _sessionInitialized = false;

      // Always create fresh credentials to avoid stale credential issues
      // (e.g., navigating away and back with browser back button)
      try {
        await apiCreateSession();
        console.log('[session] Created secure session with server-generated credentials');
      } catch (e) {
        // Fall back to client-generated session ID (for DEV_MODE or offline)
        console.warn('[session] Failed to create secure session, using client-generated ID:', e);
        if (!hasSessionId()) {
          generateSessionId();
        }
      }

      const current = get({ subscribe });
      try {
        const result = await apiInitSession(projectToSessionInit(current));
        _sessionInitialized = result.success;
        _sessionLoadedFromFile = false; // Fresh session, not loaded from file
        console.log('[session] Initialized:', result.message, `(${result.lamp_count} lamps, ${result.zone_count} zones)`);

        // Fetch initial state hashes from backend
        if (result.success) {
          fetchStateHashesDebounced();
        }

        // Refresh standard zones from backend to get correct heights for current standard
        if (result.success && current.room.useStandardZones) {
          this.refreshStandardZones();
        }

        return result;
      } catch (e) {
        console.error('[session] Failed to initialize:', e);
        _sessionInitialized = false;
        throw e;
      }
    },

    // Reinitialize session after expiration
    // Called automatically when session timeout is detected
    async reinitializeSession() {
      console.log('[session] Reinitializing expired session...');
      _sessionInitialized = false;

      // Create new session credentials (old session expired on backend)
      try {
        await apiCreateSession();
        console.log('[session] Created new secure session for reinitialization');
      } catch (e) {
        // Fall back to client-generated session ID (for DEV_MODE)
        console.warn('[session] Failed to create secure session, using client-generated ID:', e);
        if (!hasSessionId()) {
          generateSessionId();
        }
      }

      const current = get({ subscribe });
      try {
        const result = await apiInitSession(projectToSessionInit(current));
        _sessionInitialized = result.success;
        // Keep _sessionLoadedFromFile as-is; if it was loaded from file,
        // the IES data is still in memory on the backend (just the session expired)
        console.log('[session] Reinitialized:', result.message, `(${result.lamp_count} lamps, ${result.zone_count} zones)`);

        // Fetch state hashes from backend
        if (result.success) {
          fetchStateHashesDebounced();
        }

        // Refresh standard zones from backend
        if (result.success && current.room.useStandardZones) {
          this.refreshStandardZones();
        }

        return result;
      } catch (e) {
        console.error('[session] Failed to reinitialize:', e);
        _sessionInitialized = false;
        syncErrors.add('Session reinitialize', e);
        throw e;
      }
    },

    // Check if session is initialized
    isSessionInitialized() {
      return _sessionInitialized;
    },

    // Check if session was loaded from a .guv file (has embedded IES data)
    isLoadedFromFile() {
      return _sessionLoadedFromFile;
    },

    // Enable/disable backend sync (useful for batch operations)
    setSyncEnabled(enabled: boolean) {
      _syncEnabled = enabled;
    },

    // Reset to default project
    reset() {
      const fresh = initializeStandardZones(defaultProject());
      set(fresh);
      stateHashes.set({ current: null, lastCalculated: null });
      scheduleAutosave();
      // Reinitialize session with fresh state and refresh standard zones
      if (_sessionInitialized) {
        apiInitSession(projectToSessionInit(fresh))
          .then(async () => {
            fetchStateHashesDebounced();
            if (fresh.room.useStandardZones) {
              await this.refreshStandardZones();
            }
          })
          .catch(e => {
            console.warn('[session] Failed to reinit on reset:', e);
            syncErrors.add('Reset session', e);
          });
      }
    },

    // Load from .guv file (legacy - direct project data)
    loadFromFile(data: Project) {
      const initialized = initializeStandardZones(data);
      set(initialized);
      scheduleAutosave();
      // Reinitialize session with loaded state and refresh standard zones
      if (_sessionInitialized) {
        apiInitSession(projectToSessionInit(initialized))
          .then(async () => {
            if (initialized.room.useStandardZones) {
              await this.refreshStandardZones();
            }
          })
          .catch(e => {
            console.warn('[session] Failed to reinit on load:', e);
            syncErrors.add('Load session', e);
          });
      }
    },

    // Load from API response (after Project.load() on backend)
    loadFromApiResponse(response: LoadSessionResponse, projectName?: string) {
      const d = ROOM_DEFAULTS;

      // Convert loaded room to RoomConfig
      const roomConfig: RoomConfig = {
        x: response.room.x,
        y: response.room.y,
        z: response.room.z,
        units: response.room.units as 'meters' | 'feet',
        standard: response.room.standard as 'ACGIH' | 'ACGIH-UL8802' | 'ICNIRP',
        precision: response.room.precision,
        enable_reflectance: response.room.enable_reflectance,
        reflectances: response.room.reflectances ? {
          floor: response.room.reflectances.floor ?? d.reflectance,
          ceiling: response.room.reflectances.ceiling ?? d.reflectance,
          north: response.room.reflectances.north ?? d.reflectance,
          south: response.room.reflectances.south ?? d.reflectance,
          east: response.room.reflectances.east ?? d.reflectance,
          west: response.room.reflectances.west ?? d.reflectance,
        } : {
          floor: d.reflectance,
          ceiling: d.reflectance,
          north: d.reflectance,
          south: d.reflectance,
          east: d.reflectance,
          west: d.reflectance,
        },
        reflectance_spacings: defaultSurfaceSpacings(),
        reflectance_num_points: defaultSurfaceNumPoints(response.room.x, response.room.y, response.room.z),
        reflectance_resolution_mode: d.reflectance_resolution_mode,
        reflectance_max_num_passes: d.reflectance_max_num_passes,
        reflectance_threshold: d.reflectance_threshold,
        air_changes: response.room.air_changes,
        ozone_decay_constant: response.room.ozone_decay_constant,
        colormap: response.room.colormap ?? d.colormap,
        useStandardZones: d.useStandardZones,
      };

      // Convert loaded lamps to LampInstance[]
      // Loaded lamps have embedded IES/photometry data even without a preset_id
      const lamps: LampInstance[] = response.lamps.map(lamp => ({
        id: lamp.id,
        lamp_type: lamp.lamp_type as 'krcl_222' | 'lp_254' | 'other',
        preset_id: lamp.preset_id,
        name: lamp.name,
        x: lamp.x,
        y: lamp.y,
        z: lamp.z,
        angle: lamp.angle ?? 0,
        aimx: lamp.aimx,
        aimy: lamp.aimy,
        aimz: lamp.aimz,
        scaling_factor: lamp.scaling_factor,
        enabled: lamp.enabled,
        // Loaded lamps always have IES data (embedded in .guv file)
        has_ies_file: true,
      }));

      // Convert loaded zones to CalcZone[]
      const zones: CalcZone[] = response.zones.map(zone => ({
        id: zone.id,
        name: zone.name,
        type: zone.type,
        enabled: zone.enabled,
        isStandard: zone.is_standard ?? false,
        num_x: zone.num_x,
        num_y: zone.num_y,
        num_z: zone.num_z,
        x_spacing: zone.x_spacing,
        y_spacing: zone.y_spacing,
        z_spacing: zone.z_spacing,
        offset: zone.offset,
        height: zone.height,
        x1: zone.x1,
        x2: zone.x2,
        y1: zone.y1,
        y2: zone.y2,
        ref_surface: zone.ref_surface as 'xy' | 'xz' | 'yz' | undefined,
        direction: zone.direction,
        horiz: zone.horiz,
        vert: zone.vert,
        fov_vert: zone.fov_vert,
        fov_horiz: zone.fov_horiz,
        v_positive_direction: zone.v_positive_direction,
        dose: zone.dose,
        hours: zone.hours,
        x_min: zone.x_min,
        x_max: zone.x_max,
        y_min: zone.y_min,
        y_max: zone.y_max,
        z_min: zone.z_min,
        z_max: zone.z_max,
      }));

      // Check if any standard zones were loaded and update room config
      const hasStandardZones = zones.some(z => z.isStandard);
      roomConfig.useStandardZones = hasStandardZones;

      // Create the project
      const project: Project = {
        version: '1.0',
        name: projectName || 'loaded project',
        room: roomConfig,
        lamps,
        zones,
        lastModified: new Date().toISOString(),
      };

      // The session is already initialized on the backend (Project.load was called)
      // Mark as loaded from file - this session has embedded IES data that would be lost on reinit
      _sessionInitialized = true;
      _sessionLoadedFromFile = true;
      set(project);
      scheduleAutosave();

      // Fetch state hashes for the loaded session
      fetchStateHashesDebounced();

      console.log('[session] Loaded from API:', response.lamps.length, 'lamps,', response.zones.length, 'zones');
    },

    // Export current state (for saving to .guv file)
    export(): Project {
      return get({ subscribe });
    },

    // Room operations
    updateRoom(partial: Partial<RoomConfig>) {
      const currentProject = get({ subscribe });
      const oldStandard = currentProject.room.standard;
      const newStandard = partial.standard;
      const standardChanged = newStandard !== undefined && newStandard !== oldStandard;
      const dimensionsChanged = partial.x !== undefined || partial.y !== undefined || partial.z !== undefined;
      const unitsChanged = partial.units !== undefined && partial.units !== currentProject.room.units;

      // Only UL8802 has different zone heights, so only refresh zones when switching to/from UL8802
      const ul8802Involved = standardChanged && (oldStandard === 'ACGIH-UL8802' || newStandard === 'ACGIH-UL8802');

      updateWithTimestamp((p) => {
        const newRoom = { ...p.room, ...partial };
        let newZones = p.zones;
        let newResults: Project['results'] | undefined;

        // Handle useStandardZones toggle
        if (partial.useStandardZones !== undefined) {
          if (partial.useStandardZones) {
            // Add fresh standard zones
            const standardZones = getStandardZonesFallback(newRoom);
            newZones = [...p.zones, ...standardZones];
            // Sync new standard zones to backend (fire-and-forget with existing IDs)
            standardZones.forEach(z => withSyncGuard('Add zone', () => addSessionZone(zoneToSessionZone(z))));
          } else {
            // Delete standard zones entirely
            const standardZones = p.zones.filter(z => z.isStandard);
            newZones = p.zones.filter(z => !z.isStandard);

            // Clear standard zone results, safety, and checkLamps
            if (p.results) {
              const remainingZoneResults = { ...p.results.zones };
              for (const z of standardZones) {
                delete remainingZoneResults[z.id];
              }
              newResults = {
                ...p.results,
                zones: remainingZoneResults,
                safety: undefined,
                checkLamps: undefined,
              };
            }

            // Delete standard zones from backend
            standardZones.forEach(z => syncDeleteZone(z.id));
          }
        }

        // Don't clear results - staleness overlay will grey out stale sections
        return {
          ...p,
          room: newRoom,
          zones: newZones,
          ...(newResults !== undefined ? { results: newResults } : {})
        };
      });

      // Skip backend sync for ACGIH↔ICNIRP standard-only changes -
      // handleStandardChange syncs the standard directly and re-fetches checkLamps.
      // Only UL8802 switches need syncRoom (to trigger zone geometry updates + hash refresh).
      const standardOnlyNoSync = standardChanged && !ul8802Involved
        && Object.keys(partial).length === 1;

      if (!standardOnlyNoSync) {
        // Sync to backend with debounce for rapid changes (e.g., sliders)
        // Track the promise so refreshStandardZones can wait for it to complete
        debounce('room', () => {
          _lastRoomSyncPromise = syncRoom(partial);
        });
      }

      // Refresh standard zones from backend when relevant properties change
      // The backend's property setters (x, y, z, units) and set_standard() automatically
      // update zones via guv_calcs, so we just need to fetch the updated definitions.
      if (get({ subscribe }).room.useStandardZones) {
        const needsRefresh = dimensionsChanged || ul8802Involved || unitsChanged ||
          partial.useStandardZones === true;
        if (needsRefresh) {
          this.refreshStandardZones();
        }
      }
    },

    // Fetch standard zones from backend and update frontend store
    // guv_calcs automatically updates standard zones when room properties change
    // (dimensions, units, standard), so we just need to fetch the updated state.
    // IMPORTANT: guv_calcs may return wrong vert/horiz/fov_vert values for safety zones,
    // so we correct them and re-sync to ensure backend has correct values for calculations.
    async refreshStandardZones() {
      const current = get({ subscribe });
      if (!current.room.useStandardZones) return;

      // Capture counter at start to detect if a newer request supersedes this one
      const requestId = ++_refreshStandardZonesCounter;

      try {
        // Wait for debounced room sync to START
        await new Promise(resolve => setTimeout(resolve, SYNC_DEBOUNCE_MS + 50));

        // Wait for room sync to COMPLETE (the HTTP request + backend processing)
        if (_lastRoomSyncPromise) {
          await _lastRoomSyncPromise;
        }

        // Fetch current zone state from backend (guv_calcs has already updated them)
        const response = await getSessionZones();

        // Check if this request was superseded by a newer one
        if (requestId !== _refreshStandardZonesCounter) {
          return;
        }

        // Re-check current state after async operation to avoid race conditions
        const latestState = get({ subscribe });
        if (!latestState.room.useStandardZones) return;

        // Convert and filter standard zones only
        const rawZones = response.zones.filter(z => z.is_standard);
        const standardZones = rawZones.map(convertSessionZoneState);

        if (standardZones.length === 0) {
          return;
        }

        // Check which safety zones need correction and re-sync to backend
        // (guv_calcs returns wrong vert/horiz/fov_vert after room updates)
        for (const rawZone of rawZones) {
          if (rawZone.id === 'EyeLimits') {
            // EyeLimits needs vert=true, horiz=false, fov_vert=80
            if (rawZone.vert !== true || rawZone.horiz !== false || rawZone.fov_vert !== 80) {
              const correctedZone = standardZones.find(z => z.id === 'EyeLimits')!;
              await deleteSessionZone('EyeLimits');
              const addResult = await addSessionZone(zoneToSessionZone(correctedZone));
              applyStateHashes(addResult);
            }
          } else if (rawZone.id === 'SkinLimits') {
            // SkinLimits needs vert=false, horiz=true, fov_vert=180
            if (rawZone.vert !== false || rawZone.horiz !== true || rawZone.fov_vert !== 180) {
              const correctedZone = standardZones.find(z => z.id === 'SkinLimits')!;
              await deleteSessionZone('SkinLimits');
              const addResult2 = await addSessionZone(zoneToSessionZone(correctedZone));
              applyStateHashes(addResult2);
            }
          }
        }

        // Update frontend state with corrected zones
        update((p) => ({
          ...p,
          zones: [...p.zones.filter(z => !z.isStandard), ...standardZones],
          lastModified: new Date().toISOString()
        }));

        scheduleAutosave();
      } catch (e) {
        console.error('[illuminate] Failed to refresh zones from backend:', e);
        syncErrors.add('Refresh safety zones', e, 'warning');
      }
    },

    // Set standard zones (called after async fetch from API)
    setStandardZones(standardZones: CalcZone[]) {
      update((p) => {
        // Remove any existing standard zones first
        const customZones = p.zones.filter(z => !z.isStandard);
        return {
          ...p,
          zones: [...customZones, ...standardZones],
          lastModified: new Date().toISOString()
        };
      });
      scheduleAutosave();
    },

    // Check if standard zones need to be fetched
    needsStandardZonesFetch(): boolean {
      const current = get({ subscribe });
      if (!current.room.useStandardZones) return false;
      return !current.zones.some(z => z.isStandard);
    },

    // Lamp operations - don't clear results, let CalculateButton detect staleness
    async addLamp(lamp: Omit<LampInstance, 'id'>): Promise<string> {
      // Call backend first to get guv_calcs-assigned ID
      const response = await addSessionLamp(lampToSessionLamp(lamp));
      const id = response.lamp_id;
      const newLamp = { ...lamp, id };
      updateWithTimestamp((p) => ({
        ...p,
        lamps: [...p.lamps, newLamp]
      }));
      applyStateHashes(response);
      return id;
    },

    updateLamp(id: string, partial: Partial<LampInstance>) {
      updateWithTimestamp((p) => ({
        ...p,
        lamps: p.lamps.map((l) => (l.id === id ? { ...l, ...partial } : l))
      }));
      // Sync to backend with debounce for rapid changes (e.g., position sliders)
      // Pass callbacks to handle IES upload success and failure
      debounce(`lamp-${id}`, () => syncUpdateLamp(
        id,
        partial,
        // IES success callback: update has_ies_file and store filename
        (filename) => {
          updateWithTimestamp((p) => ({
            ...p,
            lamps: p.lamps.map((l) => (l.id === id ? {
              ...l,
              has_ies_file: true,
              pending_ies_file: undefined,
              ies_filename: filename || l.ies_filename
            } : l))
          }));
        },
        // IES error callback: clear pending state so user can retry
        () => {
          updateWithTimestamp((p) => ({
            ...p,
            lamps: p.lamps.map((l) => (l.id === id ? {
              ...l,
              pending_ies_file: undefined
            } : l))
          }));
        },
        // Spectrum success callback: update has_spectrum_file and optionally set wavelength from peak
        (result) => {
          updateWithTimestamp((p) => ({
            ...p,
            lamps: p.lamps.map((l) => {
              if (l.id !== id) return l;
              const updates: Partial<LampInstance> = {
                has_spectrum_file: true,
                pending_spectrum_file: undefined,
              };
              // For "other" lamps, set wavelength from spectrum peak
              if (l.lamp_type === 'other' && result?.peak_wavelength != null) {
                updates.wavelength = result.peak_wavelength;
                updates.wavelength_from_spectrum = true;
              }
              return { ...l, ...updates };
            })
          }));
        },
        // Spectrum error callback: clear pending state so user can retry
        () => {
          updateWithTimestamp((p) => ({
            ...p,
            lamps: p.lamps.map((l) => (l.id === id ? {
              ...l,
              pending_spectrum_file: undefined
            } : l))
          }));
        },
        // Lamp updated callback: always apply backend-computed values to stay in sync
        (response) => {
          if (response.aimx != null && response.aimy != null && response.aimz != null) {
            const wasSyncEnabled = _syncEnabled;
            _syncEnabled = false;
            try {
              updateWithTimestamp((p) => ({
                ...p,
                lamps: p.lamps.map((l) => (l.id === id ? {
                  ...l,
                  aimx: response.aimx!,
                  aimy: response.aimy!,
                  aimz: response.aimz!,
                  tilt: response.tilt,
                  orientation: response.orientation,
                } : l))
              }));
            } finally {
              _syncEnabled = wasSyncEnabled;
            }
          }
        }
      ));
    },

    removeLamp(id: string) {
      // Cancel any pending debounce timer for this lamp
      cancelDebounce(`lamp-${id}`);
      updateWithTimestamp((p) => ({
        ...p,
        lamps: p.lamps.filter((l) => l.id !== id)
      }));
      // Sync to backend
      syncDeleteLamp(id);
    },

    async copyLamp(id: string): Promise<string> {
      const current = get({ subscribe });
      const lamp = current.lamps.find((l) => l.id === id);
      if (!lamp) throw new Error(`Lamp ${id} not found`);

      // Call backend first to get guv_calcs-assigned ID
      const response = await copySessionLamp(id);
      const newId = response.lamp_id;
      const copyName = `${lamp.name || 'Lamp'} (Copy)`;
      const copy = { ...lamp, id: newId, name: copyName };
      updateWithTimestamp((p) => ({
        ...p,
        lamps: [...p.lamps, copy]
      }));
      applyStateHashes(response);

      // Sync copy name to backend so compliance checks use the correct name
      syncUpdateLamp(newId, { name: copyName });

      return newId;
    },

    // Zone operations
    async addZone(zone: Omit<CalcZone, 'id'>): Promise<string> {
      // Call backend first to get guv_calcs-assigned ID
      const normalized = zoneToSessionZone(zone);
      const response = await addSessionZone(normalized);
      const id = response.zone_id;
      // Store normalized values so store matches backend
      const newZone = {
        ...zone,
        id,
        x1: normalized.x1, x2: normalized.x2,
        y1: normalized.y1, y2: normalized.y2,
        x_min: normalized.x_min, x_max: normalized.x_max,
        y_min: normalized.y_min, y_max: normalized.y_max,
        z_min: normalized.z_min, z_max: normalized.z_max,
      };
      updateWithTimestamp((p) => ({
        ...p,
        zones: [...p.zones, newZone]
        // Don't clear results - new zone just won't have results yet
      }));
      applyStateHashes(response);
      return id;
    },

    updateZone(id: string, partial: Partial<CalcZone>) {
      updateWithTimestamp((p) => {
        const oldZone = p.zones.find((z) => z.id === id);
        const newZones = p.zones.map((z) => (z.id === id ? { ...z, ...partial } : z));

        // Don't delete zone results on grid change - staleness overlay will grey them out
        return { ...p, zones: newZones };
      });
      // Sync to backend with debounce - pass callback for backend-computed values
      debounce(`zone-${id}`, () => {
        if (partial.type != null) {
          const current = get({ subscribe });
          const zone = current.zones.find(z => z.id === id);
          if (zone) {
            syncUpdateZone(id, partial, updateZoneFromBackendInternal, zone);
            return;
          }
        }
        syncUpdateZone(id, partial, updateZoneFromBackendInternal);
      });
    },

    removeZone(id: string) {
      // Cancel any pending debounce timer for this zone
      cancelDebounce(`zone-${id}`);
      updateWithTimestamp((p) => {
        // Remove zone's results if they exist
        let newResults = p.results;
        if (newResults?.zones && newResults.zones[id]) {
          const { [id]: _, ...remainingZones } = newResults.zones;
          newResults = { ...newResults, zones: remainingZones };
        }

        return {
          ...p,
          zones: p.zones.filter((z) => z.id !== id),
          results: newResults
        };
      });
      // Sync to backend
      syncDeleteZone(id);
    },

    async copyZone(id: string): Promise<string> {
      const current = get({ subscribe });
      const zone = current.zones.find((z) => z.id === id);
      if (!zone) throw new Error(`Zone ${id} not found`);

      // Call backend first to get guv_calcs-assigned ID
      const response = await copySessionZone(id);
      const newId = response.zone_id;
      const copy = { ...zone, id: newId, name: `${zone.name || 'Zone'} (Copy)`, isStandard: false };
      updateWithTimestamp((p) => ({
        ...p,
        zones: [...p.zones, copy]
      }));
      applyStateHashes(response);
      return newId;
    },

    // Update lamp with values from advanced settings (without triggering re-sync)
    // Called by AdvancedLampSettingsModal after saving via its own API endpoint
    updateLampFromAdvanced(id: string, values: Partial<LampInstance>) {
      const wasSyncEnabled = _syncEnabled;
      _syncEnabled = false;
      try {
        updateWithTimestamp((p) => ({
          ...p,
          lamps: p.lamps.map((l) => (l.id === id ? { ...l, ...values } : l))
        }));
      } finally {
        _syncEnabled = wasSyncEnabled;
      }
    },

    // Update zone with backend-computed values (without triggering re-sync)
    // Called after syncUpdateZone receives computed grid values from backend
    updateZoneFromBackend(id: string, values: Partial<CalcZone>) {
      updateZoneFromBackendInternal(id, values);
    },

    // Results - don't update lastModified, results have their own calculatedAt
    setResults(newResults: Project['results']) {
      update((p) => ({ ...p, results: newResults }));
      scheduleAutosave();
    },

    clearResults() {
      update((p) => ({ ...p, results: undefined }));
      scheduleAutosave();
    },

    // Project metadata
    setName(name: string) {
      updateWithTimestamp((p) => ({ ...p, name }));
    }
  };
}

export const project = createProjectStore();

// Register session expiration handler
// When the backend session times out, this will reinitialize with current frontend state
setSessionExpiredHandler(async () => {
  await project.reinitializeSession();
});

// Derived stores for convenience
export const room = {
  subscribe: (fn: (value: RoomConfig) => void) => {
    return project.subscribe((p) => fn(p.room));
  }
};

export const lamps = {
  subscribe: (fn: (value: LampInstance[]) => void) => {
    return project.subscribe((p) => fn(p.lamps));
  }
};

export const zones = {
  subscribe: (fn: (value: CalcZone[]) => void) => {
    return project.subscribe((p) => fn(
      p.zones.filter(z => !(z.isStandard && !p.room.useStandardZones))
    ));
  }
};

export const results = {
  subscribe: (fn: (value: Project['results']) => void) => {
    return project.subscribe((p) => fn(p.results));
  }
};
