import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import { defaultProject, defaultSurfaceSpacings, defaultSurfaceNumPoints, ROOM_DEFAULTS, type Project, type LampInstance, type CalcZone, type RoomConfig, type RoomOverrides, type StateHashes, type SurfaceSpacings, type SurfaceNumPointsAll } from '$lib/types/project';
import { userSettings } from '$lib/stores/settings';
import type { UserSettings } from '$lib/stores/settings';
import { fileStore } from '$lib/stores/fileStore';
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
  getSessionZones,
  getStateHashes as apiGetStateHashes,
  uploadSessionLampIES,
  uploadSessionLampSpectrum,
  getSessionLampInfo,
  getSessionLampPlots,
  setSessionUnits,
  generateSessionId,
  hasSessionId,
  hasSession,
  clearSession,
  setSessionExpiredHandler,
  type SessionInitRequest,
  type SessionLampInput,
  type SessionZoneInput,
  type SessionZoneState,
  type SessionLampInfoResponse,
  type LoadSessionResponse,
  parseBudgetError,
  isSessionExpiredError,
} from '$lib/api/client';
import { syncZoneToBackend } from '$lib/sync/zoneSyncService';
import { createSyncQueue, type SyncCommand } from '$lib/sync/syncQueue';
import { theme } from '$lib/stores/theme';

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

/** Track whether the project has any lamps with photometric data (preset or IES/spectrum file).
 *  Internal: auto-synced from project store, consumed only by needsCalculation. */
export const hasValidLamps = writable(false);

/** Track whether the project has any zones (standard or custom).
 *  Internal: auto-synced from project store, consumed only by needsCalculation. */
export const hasZones = writable(false);

/** Overall: needs calculation if hashes differ or no previous calculation */
export const needsCalculation = derived([stateHashes, hasValidLamps, hasZones], ([$sh, $hasValid, $hasZones]) => {
  // No point calculating without both lamps and zones
  if (!$hasValid || !$hasZones) return false;
  if (!$sh.current || !$sh.lastCalculated) {
    // No hashes yet — need calculation if session is live
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

// ============================================================
// Session Sync State
// ============================================================

let _sessionInitialized = false;
// Resolves when the initial session init settles (success OR failure). Lets
// callers that must not race init — e.g. loading a .guv file right after page
// load — wait for it, so an in-flight init can't clobber their state.
let _sessionReadyPromise: Promise<void> | null = null;
let _sessionLoadedFromFile = false; // Track if session was loaded from .guv file (has embedded IES data)

// Counter to detect stale refreshStandardZones requests
// Incremented on each call; if counter changes during async operation, result is stale
let _refreshStandardZonesCounter = 0;

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

/**
 * Re-upload custom files from the file store to the backend for lamps that
 * reference files via ies_file_id / spectrum_file_id. Called after session
 * init or reinit to restore file data that only exists client-side.
 */
async function reuploadCustomFiles(lamps: LampInstance[]): Promise<void> {
  if (!fileStore.isInitialized()) return;
  for (const lamp of lamps) {
    if (lamp.ies_file_id) {
      const file = fileStore.toFile(lamp.ies_file_id);
      if (file) {
        try {
          await uploadSessionLampIES(lamp.id, file);
          console.log(`[session] Re-uploaded IES for lamp ${lamp.id}`);
        } catch (e) {
          console.warn(`[session] Failed to re-upload IES for lamp ${lamp.id}:`, e);
        }
      }
    }
    if (lamp.spectrum_file_id) {
      const file = fileStore.toFile(lamp.spectrum_file_id);
      if (file) {
        const entry = fileStore.getFile(lamp.spectrum_file_id);
        const columnIndex = entry?.spectrumColumnIndex ?? 0;
        try {
          await uploadSessionLampSpectrum(lamp.id, file, false, columnIndex);
          console.log(`[session] Re-uploaded spectrum for lamp ${lamp.id}`);
        } catch (e) {
          console.warn(`[session] Failed to re-upload spectrum for lamp ${lamp.id}:`, e);
        }
      }
    }
  }
}

// Convert project to session init format
function projectToSessionInit(p: Project): SessionInitRequest {
  return {
    room: {
      x: p.room.x,
      y: p.room.y,
      z: p.room.z,
      units: get(userSettings).units,
      precision: p.room.precision,
      standard: p.room.standard,
      enable_reflectance: p.room.enable_reflectance,
      reflectances: p.room.reflectances,
      // Reflectance resolution (spacings/num_points/max_passes/threshold) intentionally
      // omitted — the backend (guv_calcs) defaults to 10x10 per surface, which is the
      // correct default. Sending frontend-computed values inflates grids for large rooms.
      air_changes: p.room.air_changes ?? ROOM_DEFAULTS.air_changes,
      ozone_decay_constant: p.room.ozone_decay_constant ?? ROOM_DEFAULTS.ozone_decay_constant,
      colormap: p.room.colormap ?? ROOM_DEFAULTS.colormap,
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
  // Send only the active resolution mode so the backend uses the user's intent
  const useNumPoints = (zone.resolution_mode ?? 'num_points') === 'num_points';

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
    minutes: zone.minutes ?? 0,
    seconds: zone.seconds ?? 0,
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
    // Point-specific
    x: zone.x,
    y: zone.y,
    z: zone.z,
    aim_x: zone.aim_x,
    aim_y: zone.aim_y,
    aim_z: zone.aim_z,
    // Resolution — only send one mode
    num_x: useNumPoints ? zone.num_x : undefined,
    num_y: useNumPoints ? zone.num_y : undefined,
    num_z: useNumPoints ? zone.num_z : undefined,
    x_spacing: useNumPoints ? undefined : zone.x_spacing,
    y_spacing: useNumPoints ? undefined : zone.y_spacing,
    z_spacing: useNumPoints ? undefined : zone.z_spacing,
    offset: zone.offset,
    // Plane calculation options
    calc_mode: zone.calc_mode,
    ref_surface: zone.ref_surface as 'xy' | 'xz' | 'yz' | undefined,
    direction: zone.direction,
    horiz: zone.horiz,
    vert: zone.vert,
    use_normal: zone.use_normal,
    fov_vert: zone.fov_vert,
    fov_horiz: zone.fov_horiz,
    view_direction: zone.view_direction,
    view_target: zone.view_target,
    // Display
    display_mode: zone.display_mode,
  };
}

// Sync functions - executed by the sync queue's executors (see createProjectStore).
// Errors propagate to the queue's onError (retried on 423, else reported).


// ============================================================
// Lamp Info Cache — prefetch lamp info on file upload
// ============================================================

const lampInfoCache = new Map<string, { data: SessionLampInfoResponse; theme: string }>();

// Generation counter per lamp — prevents slow prefetches from overwriting
// newer data (e.g. IES prefetch completing after spectrum upload clears cache).
const prefetchGeneration = new Map<string, number>();

async function prefetchLampInfo(lampId: string) {
  const gen = (prefetchGeneration.get(lampId) ?? 0) + 1;
  prefetchGeneration.set(lampId, gen);
  try {
    const currentTheme = get(theme) as 'light' | 'dark';
    // Fetch base info first so cache has partial data ASAP
    const info = await getSessionLampInfo(lampId);
    if (prefetchGeneration.get(lampId) !== gen) return;
    // Merge with existing cache to preserve plot data (e.g. photometric plots
    // that are still valid after a spectrum-only upload).
    // Clear stale plot fields when capabilities change (e.g. lamp type switch).
    const existing = lampInfoCache.get(lampId);
    let merged: SessionLampInfoResponse;
    if (existing && existing.theme === currentTheme) {
      merged = { ...existing.data, ...info };
      // If spectrum was removed, clear stale spectrum plot data
      if (!info.has_spectrum) {
        merged.spectrum_plot_base64 = null;
        merged.spectrum_linear_plot_base64 = null;
        merged.spectrum_log_plot_base64 = null;
        merged.spectrum_plot_hires_base64 = null;
        merged.spectrum_linear_plot_hires_base64 = null;
        merged.spectrum_log_plot_hires_base64 = null;
      }
      // If IES was removed, clear stale photometric plot data
      if (!info.has_ies) {
        merged.photometric_plot_base64 = null;
        merged.photometric_plot_hires_base64 = null;
      }
    } else {
      merged = info;
    }
    lampInfoCache.set(lampId, { data: merged, theme: currentTheme });

    // Fetch lo-res plots only (fast). Hi-res is fetched on-demand by the modal
    // when the user clicks to open the lightbox.
    if (info.has_ies || info.has_spectrum) {
      try {
        const plots = await getSessionLampPlots(lampId, 'log', currentTheme, 100, false);
        if (prefetchGeneration.get(lampId) === gen) {
          const withPlots: SessionLampInfoResponse = { ...merged, ...plots };
          lampInfoCache.set(lampId, { data: withPlots, theme: currentTheme });
        }
      } catch (e) {
        // Non-critical — modal will fetch plots on its own
        console.warn('[session] Failed to prefetch lamp plots for', lampId, e);
      }
    }
  } catch (e) {
    // Non-critical — the modal will fetch on open if cache misses
    console.warn('[session] Failed to prefetch lamp info for', lampId, e);
  }
}

function getLampInfoCache(lampId: string, theme: string): SessionLampInfoResponse | null {
  const cached = lampInfoCache.get(lampId);
  if (cached && cached.theme === theme) return cached.data;
  return null;
}

function clearLampInfoCache(lampId: string) {
  lampInfoCache.delete(lampId);
  // Bump generation so any in-flight prefetch for this lamp is discarded
  prefetchGeneration.set(lampId, (prefetchGeneration.get(lampId) ?? 0) + 1);
}

/**
 * Invalidate only spectrum-related fields in the cache, preserving photometric
 * data that doesn't change when a spectrum file is uploaded.
 */
function invalidateSpectrumCache(lampId: string) {
  const cached = lampInfoCache.get(lampId);
  if (cached) {
    const { data, theme: cachedTheme } = cached;
    lampInfoCache.set(lampId, {
      theme: cachedTheme,
      data: {
        ...data,
        has_spectrum: true,  // we know a spectrum was just uploaded
        spectrum_plot_base64: undefined as unknown as null,
        spectrum_linear_plot_base64: undefined as unknown as null,
        spectrum_log_plot_base64: undefined as unknown as null,
        spectrum_plot_hires_base64: undefined as unknown as null,
        spectrum_linear_plot_hires_base64: undefined as unknown as null,
        spectrum_log_plot_hires_base64: undefined as unknown as null,
      },
    });
  }
  // Bump generation so any in-flight prefetch for this lamp is discarded
  prefetchGeneration.set(lampId, (prefetchGeneration.get(lampId) ?? 0) + 1);
}

// Properties that affect TLVs/plots — only clear lamp info cache when these actually change
const INFO_AFFECTING_KEYS = ['lamp_type', 'wavelength'] as const;

async function syncUpdateLamp(
  id: string,
  partial: Partial<LampInstance>,
  oldLamp: LampInstance | undefined,
  onIesUploaded?: (filename?: string, hasSpectrum?: boolean) => void,
  onIesUploadError?: () => void,
  onSpectrumUploaded?: (result?: { peak_wavelength?: number }) => void,
  onSpectrumUploadError?: () => void,
  onLampUpdated?: (response: { aimx?: number; aimy?: number; aimz?: number; tilt?: number; orientation?: number; has_ies_file?: boolean }) => void
) {
  // Sync property updates FIRST (excluding file objects).
  // This must happen before file uploads because property updates that include
  // lamp_type may recreate the lamp on the backend.
  // A property-update failure is thrown so the queue can retry (423) or report it.
  const { pending_ies_file, pending_spectrum_file, pending_spectrum_column_index, ...updates } = partial;
  if (Object.keys(updates).length > 0) {
    // When info-affecting properties (lamp_type, wavelength) actually changed,
    // re-fetch lamp info in the background. This merges fresh TLVs over existing
    // cached plots rather than clearing the cache (which would cause a visible
    // loading flash in the modal).
    const infoChanged = oldLamp
      ? INFO_AFFECTING_KEYS.some(k => k in updates && updates[k] !== oldLamp[k])
      : true;
    const response = await updateSessionLamp(id, updates);
    if (infoChanged) {
      prefetchLampInfo(id);
    }
    applyStateHashes(response);
    // If backend returned computed values or state changes, notify the caller
    if (onLampUpdated && response) {
      onLampUpdated({
        aimx: response.aimx,
        aimy: response.aimy,
        aimz: response.aimz,
        tilt: response.tilt,
        orientation: response.orientation,
        has_ies_file: response.has_ies_file,
      });
    }
  }

  // Handle IES file upload AFTER property sync. Upload failures are handled
  // locally (not queue-retried) so a bad file doesn't wedge the command.
  if (partial.pending_ies_file) {
    // Clear cache eagerly so modal doesn't serve stale data while upload is in-flight
    clearLampInfoCache(id);
    try {
      const result = await uploadSessionLampIES(id, partial.pending_ies_file);
      if (result.success) {
        onIesUploaded?.(result.filename, result.has_spectrum);
        applyStateHashes(result);
        fetchStateHashesDebounced();
        prefetchLampInfo(id);
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
    // Invalidate only spectrum fields — photometric data is unaffected by spectrum upload
    invalidateSpectrumCache(id);
    try {
      const result = await uploadSessionLampSpectrum(id, partial.pending_spectrum_file, false, partial.pending_spectrum_column_index ?? 0);
      if (result.success) {
        onSpectrumUploaded?.(result);
        applyStateHashes(result);
        fetchStateHashesDebounced();
        prefetchLampInfo(id);
      }
    } catch (uploadError) {
      console.error('[session] Spectrum upload failed for lamp', id, uploadError);
      syncErrors.add('Upload spectrum file', uploadError);
      onSpectrumUploadError?.();
    }
  }
}



/** Create a default project with the user's saved settings applied. */
function defaultProjectFromSettings(): Project {
  const settings = get(userSettings);
  // Switch display units to the user's default for new rooms
  if (settings.defaultUnits !== settings.units) {
    userSettings.update(s => ({ ...s, units: s.defaultUnits }));
  }
  return defaultProject(settingsToRoomOverrides(settings));
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
  if (!browser) return initializeStandardZones(defaultProjectFromSettings());

  // Detect page reload (F5) - clear ALL storage for fresh start
  const navEntry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
  if (navEntry?.type === 'reload') {
    console.log('[illuminate] Page reload detected, clearing session storage');
    sessionStorage.removeItem(STORAGE_KEY);
    clearSession(); // Also clear session credentials to avoid stale auth on reload
    return initializeStandardZones(defaultProjectFromSettings());
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
        return initializeStandardZones(defaultProjectFromSettings());
      }
      console.log('[illuminate] Restored project from sessionStorage');
      // Migrate old short standard names to canonical labels
      const stdMigration: Record<string, string> = {
        'ACGIH': 'ANSI IES RP 27.1-22 (ACGIH Limits)',
        'ACGIH-UL8802': 'UL8802 (ACGIH Limits)',
        'ICNIRP': 'IEC 62471-6:2022 (ICNIRP Limits)',
      };
      if (parsed.room?.standard && stdMigration[parsed.room.standard]) {
        parsed.room.standard = stdMigration[parsed.room.standard];
      }
      // Ensure standard zones are present if useStandardZones is enabled
      return initializeStandardZones(parsed as Project);
    }
  } catch (e) {
    console.warn('[illuminate] Failed to restore from sessionStorage:', e);
    sessionStorage.removeItem(STORAGE_KEY);
  }

  return initializeStandardZones(defaultProjectFromSettings());
}

// Convert backend SessionZoneState to frontend CalcZone format
function convertSessionZoneState(state: SessionZoneState): CalcZone {
  const base: CalcZone = {
    id: state.id,
    name: state.name,
    type: state.type,
    enabled: state.enabled,
    isStandard: state.is_standard ?? false,
    dose: state.dose ?? false,
    hours: state.hours ?? 8,
    minutes: state.minutes ?? 0,
    seconds: state.seconds ?? 0,
    offset: state.offset ?? true,
    num_x: state.num_x,
    num_y: state.num_y,
    x_spacing: state.x_spacing,
    y_spacing: state.y_spacing,
    display_mode: (state.display_mode as CalcZone['display_mode']) ?? 'heatmap',
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
  if (state.type === 'point') {
    return {
      ...base,
      x: state.x,
      y: state.y,
      z: state.z,
      aim_x: state.aim_x,
      aim_y: state.aim_y,
      aim_z: state.aim_z,
      calc_mode: (state.calc_mode as CalcZone['calc_mode']) ?? 'planar_normal',
      horiz: state.horiz,
      vert: state.vert,
      use_normal: state.use_normal,
      fov_vert: state.fov_vert,
      fov_horiz: state.fov_horiz,
    };
  }
  return {
    ...base,
    height: state.height,
    calc_mode: (state.calc_mode as CalcZone['calc_mode']),
    x1: state.x1,
    x2: state.x2,
    y1: state.y1,
    y2: state.y2,
    horiz: state.horiz,
    vert: state.vert,
    use_normal: state.use_normal,
    fov_vert: state.fov_vert,
    fov_horiz: state.fov_horiz,
    view_direction: state.view_direction,
    view_target: state.view_target,
    direction: state.direction ?? 1,
    ref_surface: (state.ref_surface as 'xy' | 'xz' | 'yz') ?? 'xy',
    // Normalize null -> undefined so the render-layer `!= null` / `!== undefined`
    // guards fall through to the direction-based fallback. GET /session/zones
    // does not compute v_positive_direction, so it arrives as null here.
    v_positive_direction: state.v_positive_direction ?? undefined,
  };
}

// Minimal placeholders for standard zones before the backend responds.
// These contain just enough info for the UI to render zone list items and 3D wireframes.
// The backend (via guv_calcs) is the authority for heights, spacing, and directionality.
function getStandardZonePlaceholders(room: RoomConfig): CalcZone[] {
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
      resolution_mode: 'num_points',
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
      resolution_mode: 'num_points',
      x1: 0, x2: room.x,
      y1: 0, y2: room.y,
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
      resolution_mode: 'num_points',
      x1: 0, x2: room.x,
      y1: 0, y2: room.y,
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
    project.room.reflectance_num_points = defaultSurfaceNumPoints();
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
      project.zones = [...project.zones, ...getStandardZonePlaceholders(project.room)];
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

/** Convert current user settings to room overrides for defaultProject/defaultRoom */
function settingsToRoomOverrides(s: UserSettings): RoomOverrides {
  return {
    x: s.roomX,
    y: s.roomY,
    z: s.roomZ,
    standard: s.standard,
    reflectance: s.reflectance,
    air_changes: s.airChanges,
    enable_reflectance: s.enableReflectance,
    useStandardZones: s.useStandardZones,
    colormap: s.colormap,
    precision: s.precision,
    showDimensions: s.showDimensions,
    showGrid: s.showGrid,
    showPhotometricWebs: s.showPhotometricWebs,
    showXYZMarker: s.showXYZMarker,
    showLampLabels: s.showLampLabels,
    showCalcPointLabels: s.showCalcPointLabels,
    globalHeatmapNormalization: s.globalHeatmapNormalization,
  };
}

function createProjectStore() {
  const initial = loadFromStorage();
  const { subscribe, set, update } = writable<Project>(initial);

  let saveTimeout: ReturnType<typeof setTimeout>;

  // Apply backend-returned (echo) zone values as a plain store write. Sync only
  // fires from explicit enqueue calls, so an echo write can never trigger re-sync.
  function applyZoneServerValues(id: string, values: Partial<CalcZone>) {
    update((p) => ({
      ...p,
      zones: p.zones.map((z) => (z.id === id ? { ...z, ...values } : z))
    }));
  }

  // Evict a zone's cached results (e.g. after a type change recreates the zone
  // under the same id — its old results no longer apply).
  function evictZoneResults(id: string) {
    update((p) => {
      if (!p.results?.zones || !p.results.zones[id]) return p;
      const { [id]: _, ...remainingZones } = p.results.zones;
      return { ...p, results: { ...p.results, zones: remainingZones } };
    });
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

  // ============================================================
  // Sync command queue — serializes all backend update/delete sync so rapid
  // edits to the same lamp/zone can't race or arrive out of order, and
  // transient 423 ("session busy") responses retry instead of surfacing.
  // Adds and copies stay direct-await (they're awaited by callers).
  // ============================================================

  // Per-lamp side channel for the lamp-update executor. updateLamp captures the
  // old-lamp snapshot + the response callbacks here; the executor reads and
  // clears them when the command runs. Keyed by lamp id (not the command
  // object) because the queue swaps in a new command object when it coalesces
  // same-id updates. Coalesce is last-write-wins for these extras — safe
  // because the callbacks are id-keyed idempotent echo writes (see report).
  interface LampUpdateExtras {
    oldLamp: LampInstance | undefined;
    onIesUploaded?: (filename?: string, hasSpectrum?: boolean) => void;
    onIesUploadError?: () => void;
    onSpectrumUploaded?: (result?: { peak_wavelength?: number }) => void;
    onSpectrumUploadError?: () => void;
    onLampUpdated?: (response: { aimx?: number; aimy?: number; aimz?: number; tilt?: number; orientation?: number; has_ies_file?: boolean }) => void;
  }
  const lampUpdateExtras = new Map<string, LampUpdateExtras>();

  function syncOperationLabel(kind: SyncCommand['kind']): string {
    switch (kind) {
      case 'room-update': return 'Update room';
      case 'lamp-update': return 'Update lamp';
      case 'lamp-delete': return 'Delete lamp';
      case 'zone-update':
      case 'zone-type-change': return 'Update zone';
      case 'zone-delete': return 'Delete zone';
    }
  }

  const syncQueue = createSyncQueue({
    executors: {
      // ← body of the former syncRoom(); only sends fields the backend cares about.
      'room-update': async (cmd) => {
        const partial = cmd.partial as Partial<RoomConfig>;
        const updates: Record<string, unknown> = {};
        if (partial.x !== undefined) updates.x = partial.x;
        if (partial.y !== undefined) updates.y = partial.y;
        if (partial.z !== undefined) updates.z = partial.z;
        if (partial.precision !== undefined) updates.precision = partial.precision;
        if (partial.standard !== undefined) updates.standard = partial.standard;
        if (partial.enable_reflectance !== undefined) updates.enable_reflectance = partial.enable_reflectance;
        if (partial.reflectances !== undefined) updates.reflectances = partial.reflectances;
        // When both spacings and num_points are present, only sync the active mode
        // (the other is a derived display value). Matches projectToSessionInit.
        const bothResolution = partial.reflectance_spacings !== undefined && partial.reflectance_num_points !== undefined;
        const currentMode = get(room).reflectance_resolution_mode;
        if (partial.reflectance_spacings !== undefined && !(bothResolution && currentMode === 'num_points')) {
          const flattened = flattenSpacings(partial.reflectance_spacings);
          updates.reflectance_x_spacings = flattened.reflectance_x_spacings;
          updates.reflectance_y_spacings = flattened.reflectance_y_spacings;
        }
        if (partial.reflectance_num_points !== undefined && !(bothResolution && currentMode === 'spacing')) {
          const flattened = flattenNumPoints(partial.reflectance_num_points);
          updates.reflectance_x_num_points = flattened.reflectance_x_num_points;
          updates.reflectance_y_num_points = flattened.reflectance_y_num_points;
        }
        if (partial.reflectance_max_num_passes !== undefined) updates.reflectance_max_num_passes = partial.reflectance_max_num_passes;
        if (partial.reflectance_threshold !== undefined) updates.reflectance_threshold = partial.reflectance_threshold;
        if (partial.air_changes !== undefined) updates.air_changes = partial.air_changes;
        if (partial.ozone_decay_constant !== undefined) updates.ozone_decay_constant = partial.ozone_decay_constant;
        if (partial.colormap !== undefined) updates.colormap = partial.colormap;

        if (Object.keys(updates).length > 0) {
          const result = await updateSessionRoom(updates);
          applyStateHashes(result);
        }
      },
      // ← calls syncUpdateLamp(); extras carry oldLamp + response callbacks.
      'lamp-update': async (cmd) => {
        const extras = lampUpdateExtras.get(cmd.id);
        lampUpdateExtras.delete(cmd.id);
        await syncUpdateLamp(
          cmd.id,
          cmd.partial as Partial<LampInstance>,
          extras?.oldLamp,
          extras?.onIesUploaded,
          extras?.onIesUploadError,
          extras?.onSpectrumUploaded,
          extras?.onSpectrumUploadError,
          extras?.onLampUpdated,
        );
      },
      'lamp-delete': async (cmd) => {
        const result = await deleteSessionLamp(cmd.id);
        applyStateHashes(result);
      },
      // ← body of the former syncUpdateZone() non-type-change branch.
      'zone-update': async (cmd) => {
        const result = await syncZoneToBackend(cmd.id, cmd.partial as Partial<CalcZone>);
        applyStateHashes(result.rawResponse);
        if (Object.keys(result.computedValues).length > 0) {
          applyZoneServerValues(cmd.id, result.computedValues);
        }
      },
      // ← body of the former syncUpdateZone() type-change branch. Delete + recreate
      // under the SAME id preserves identity; evict stale results; apply grid.
      'zone-type-change': async (cmd) => {
        const deleteResult = await deleteSessionZone(cmd.id);
        applyStateHashes(deleteResult);
        const addResult = await addSessionZone(cmd.snapshot as unknown as SessionZoneInput);
        applyStateHashes(addResult);
        if (addResult.zone_id !== cmd.id) {
          console.warn(`[session] backend zone id ${addResult.zone_id} != requested ${cmd.id} on type change`);
        }
        evictZoneResults(cmd.id);
        const computed: Partial<CalcZone> = {};
        if (addResult.num_x != null) computed.num_x = addResult.num_x;
        if (addResult.num_y != null) computed.num_y = addResult.num_y;
        if (addResult.num_z != null) computed.num_z = addResult.num_z;
        if (addResult.x_spacing != null) computed.x_spacing = addResult.x_spacing;
        if (addResult.y_spacing != null) computed.y_spacing = addResult.y_spacing;
        if (addResult.z_spacing != null) computed.z_spacing = addResult.z_spacing;
        if (Object.keys(computed).length > 0) {
          applyZoneServerValues(cmd.id, computed);
        }
      },
      'zone-delete': async (cmd) => {
        const result = await deleteSessionZone(cmd.id);
        applyStateHashes(result);
      },
    },
    onError: (cmd, error) => {
      const op = syncOperationLabel(cmd.kind);
      // Unified budget handling for ALL kinds (room/lamp used to skip this).
      const budget = parseBudgetError(error);
      if (budget) {
        syncErrors.add(op, budget.message, 'warning');
      } else {
        syncErrors.add(op, error);
      }
    },
  });

  // The queue starts paused and drains only while the session is live.
  // initSession/reinitializeSession run the pause → markReplayBoundary →
  // snapshot → init → clearPending → resume protocol; a failed (re)init leaves
  // it paused so queued commands survive for the next attempt.
  syncQueue.pause();

  return {
    subscribe,

    // Initialize backend session with current project state
    async initSession() {
      let resolveReady!: () => void;
      _sessionReadyPromise = new Promise<void>((r) => { resolveReady = r; });
      _sessionInitialized = false;

      // Queue replay protocol. Pause so no mutation races the (re)build, then mark
      // the replay boundary: the snapshot taken immediately below carries every
      // edit made so far, so those pre-boundary commands are redundant and get
      // dropped by clearPending() on success. Any edit enqueued AFTER this point
      // (e.g. the user tweaks room dimensions while init is in flight) is
      // post-boundary — it is NOT in the snapshot, survives clearPending(), and
      // drains in order once the queue resumes.
      syncQueue.pause();
      syncQueue.markReplayBoundary();

      // Snapshot AFTER the boundary mark so any later edit is post-boundary.
      const current = get({ subscribe });

      // Always create fresh credentials to avoid stale credential issues
      // (e.g., navigating away and back with browser back button)
      try {
        await apiCreateSession();
        console.log('[session] Created secure session with server-generated credentials');
      } catch (e) {
        // Fall back to client-generated session ID (for DEV_MODE or offline)
        // Always clear stale credentials first so we don't reuse an expired session
        console.warn('[session] Failed to create secure session, using client-generated ID:', e);
        clearSession();
        generateSessionId();
      }

      try {
        const result = await apiInitSession(projectToSessionInit(current));
        _sessionInitialized = result.success;
        _sessionLoadedFromFile = false; // Fresh session, not loaded from file

        if (result.success) {
          // The snapshot we just pushed supersedes every pre-boundary command;
          // drop them, then resume to drain any edits made while init was in
          // flight (post-boundary commands the snapshot didn't capture).
          syncQueue.clearPending();
          syncQueue.resume();
        }

        console.log('[session] Initialized:', result.message, `(${result.lamp_count} lamps, ${result.zone_count} zones)`);

        // Fetch initial state hashes from backend
        if (result.success) {
          fetchStateHashesDebounced();
        }

        // Refresh standard zones from backend to get correct heights for current standard
        if (result.success && current.room.useStandardZones) {
          this.refreshStandardZones();
        }

        // Re-upload custom files from file store for lamps with file references
        if (result.success) {
          reuploadCustomFiles(current.lamps).catch((e) =>
            console.warn('[session] File re-upload failed during init:', e)
          );
        }

        return result;
      } catch (e) {
        console.error('[session] Failed to initialize:', e);
        _sessionInitialized = false;
        // Leave the queue PAUSED. Commands enqueued during this attempt stay
        // queued (nothing cleared, nothing resumed); the next successful init's
        // snapshot supersedes the pre-boundary ones and its resume drains the
        // rest. Resuming now would drain commands against a session that doesn't
        // exist on the backend.
        throw e;
      } finally {
        resolveReady();
      }
    },

    // Resolves once the initial session init has settled (success or failure).
    // Await before any operation that must not race init (e.g. loading a file).
    sessionReady(): Promise<void> {
      return _sessionReadyPromise ?? Promise.resolve();
    },

    // Reinitialize session after expiration
    // Called automatically when session timeout is detected
    async reinitializeSession() {
      console.log('[session] Reinitializing expired session...');
      _sessionInitialized = false;

      // Same replay protocol as initSession (see there for the full rationale).
      // Reinit is triggered from client.ts recovery while a command may be IN
      // FLIGHT — that in-flight command is not cleared by clearPending(); after
      // recovery it retries once (client.ts `_isRetry`) and lands on the fresh
      // session. Only pre-boundary QUEUED commands are superseded by the snapshot.
      syncQueue.pause();
      syncQueue.markReplayBoundary();

      // Snapshot AFTER the boundary mark so any later edit is post-boundary.
      const current = get({ subscribe });

      // Create new session credentials (old session expired on backend)
      try {
        await apiCreateSession();
        console.log('[session] Created new secure session for reinitialization');
      } catch (e) {
        // Fall back to client-generated session ID (for DEV_MODE)
        // Always clear stale credentials first so we don't reuse an expired session
        console.warn('[session] Failed to create secure session, using client-generated ID:', e);
        clearSession();
        generateSessionId();
      }

      try {
        const result = await apiInitSession(projectToSessionInit(current));
        _sessionInitialized = result.success;
        _sessionLoadedFromFile = false;

        if (result.success) {
          syncQueue.clearPending();
          syncQueue.resume();
        }

        console.log('[session] Reinitialized:', result.message, `(${result.lamp_count} lamps, ${result.zone_count} zones)`);

        // Fetch state hashes from backend
        if (result.success) {
          fetchStateHashesDebounced();
        }

        // Refresh standard zones from backend
        if (result.success && current.room.useStandardZones) {
          this.refreshStandardZones();
        }

        // Re-upload custom files from file store (fixes file loss on session timeout)
        if (result.success) {
          reuploadCustomFiles(current.lamps).catch((e) =>
            console.warn('[session] File re-upload failed during reinit:', e)
          );
        }

        return result;
      } catch (e) {
        console.error('[session] Failed to reinitialize:', e);
        _sessionInitialized = false;
        // Leave the queue PAUSED on failure — commands stay queued for the next
        // successful reinit, whose snapshot supersedes the pre-boundary ones.
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

    // Change units — calls backend set_units() and batch-updates all coordinates
    async changeUnits(newUnits: 'meters' | 'feet') {
      if (!_sessionInitialized) return;

      // Flush pending edits before converting — a retry-parked command landing
      // after the switch would write old-unit values. drained() resolves even
      // on terminal failure, which is fine here (failed commands are already
      // toasted; proceeding matches the pre-queue status quo).
      await syncQueue.drained();

      try {
        const response = await setSessionUnits(newUnits);
        if (!response.success) return;

        // Echo application: apply the backend's converted coordinates as a plain
        // store write. Sync fires only from explicit enqueue calls, so this can
        // never trigger a re-sync round-trip.
        {
          updateWithTimestamp((p) => {
            // Update room dimensions
            let newRoom = {
              ...p.room,
              x: response.room.x,
              y: response.room.y,
              z: response.room.z,
            };

            // Update lamp positions
            const newLamps = p.lamps.map(lamp => {
              const coords = response.lamps[lamp.id];
              if (!coords) return lamp;
              return {
                ...lamp,
                x: coords.x,
                y: coords.y,
                z: coords.z,
                aimx: coords.aimx,
                aimy: coords.aimy,
                aimz: coords.aimz,
                ...(coords.source_width != null && { source_width: coords.source_width }),
                ...(coords.source_length != null && { source_length: coords.source_length }),
                ...(coords.source_depth != null && { source_depth: coords.source_depth }),
                ...(coords.housing_width != null && { housing_width: coords.housing_width }),
                ...(coords.housing_length != null && { housing_length: coords.housing_length }),
                ...(coords.housing_height != null && { housing_height: coords.housing_height }),
              };
            });

            // Update zone bounds
            const newZones = p.zones.map(zone => {
              const coords = response.zones[zone.id];
              if (!coords) return zone;
              if (zone.type === 'plane') {
                return {
                  ...zone,
                  height: coords.height ?? zone.height,
                  x1: coords.x1 ?? zone.x1,
                  x2: coords.x2 ?? zone.x2,
                  y1: coords.y1 ?? zone.y1,
                  y2: coords.y2 ?? zone.y2,
                  num_x: coords.num_x ?? zone.num_x,
                  num_y: coords.num_y ?? zone.num_y,
                  x_spacing: coords.x_spacing ?? zone.x_spacing,
                  y_spacing: coords.y_spacing ?? zone.y_spacing,
                };
              } else if (zone.type === 'point') {
                return {
                  ...zone,
                  x: coords.x ?? zone.x,
                  y: coords.y ?? zone.y,
                  z: coords.z ?? zone.z,
                  aim_x: coords.aim_x ?? zone.aim_x,
                  aim_y: coords.aim_y ?? zone.aim_y,
                  aim_z: coords.aim_z ?? zone.aim_z,
                };
              } else {
                return {
                  ...zone,
                  x_min: coords.x_min ?? zone.x_min,
                  x_max: coords.x_max ?? zone.x_max,
                  y_min: coords.y_min ?? zone.y_min,
                  y_max: coords.y_max ?? zone.y_max,
                  z_min: coords.z_min ?? zone.z_min,
                  z_max: coords.z_max ?? zone.z_max,
                  num_x: coords.num_x ?? zone.num_x,
                  num_y: coords.num_y ?? zone.num_y,
                  num_z: coords.num_z ?? zone.num_z,
                  x_spacing: coords.x_spacing ?? zone.x_spacing,
                  y_spacing: coords.y_spacing ?? zone.y_spacing,
                  z_spacing: coords.z_spacing ?? zone.z_spacing,
                };
              }
            });

            // Update reflectance spacings and num_points if provided
            if (response.reflectance_spacings) {
              const spacings = response.reflectance_spacings;
              newRoom = {
                ...newRoom,
                reflectance_spacings: {
                  ...newRoom.reflectance_spacings,
                  ...Object.fromEntries(
                    Object.entries(spacings).map(([k, v]) => [k, { x: v.x, y: v.y }])
                  ),
                },
              };
            }
            if (response.reflectance_num_points) {
              const numPoints = response.reflectance_num_points;
              newRoom = {
                ...newRoom,
                reflectance_num_points: {
                  ...newRoom.reflectance_num_points,
                  ...Object.fromEntries(
                    Object.entries(numPoints).map(([k, v]) => [k, { x: v.x, y: v.y }])
                  ),
                },
              };
            }

            // Update dimensionSnapshots in results so 3D heatmaps stay visible
            // (the values grid hasn't changed, just the coordinate labels)
            let newResults = p.results;
            if (newResults?.zones) {
              const updatedZones: Record<string, typeof newResults.zones[string]> = {};
              for (const [zoneId, result] of Object.entries(newResults.zones)) {
                if (!result.dimensionSnapshot) {
                  updatedZones[zoneId] = result;
                  continue;
                }
                const coords = response.zones[zoneId];
                if (!coords) {
                  updatedZones[zoneId] = result;
                  continue;
                }
                const zone = newZones.find(z => z.id === zoneId);
                if (!zone) {
                  updatedZones[zoneId] = result;
                  continue;
                }
                let newSnapshot;
                if (zone.type === 'volume') {
                  newSnapshot = {
                    ...result.dimensionSnapshot,
                    x_min: coords.x_min ?? result.dimensionSnapshot.x_min,
                    x_max: coords.x_max ?? result.dimensionSnapshot.x_max,
                    y_min: coords.y_min ?? result.dimensionSnapshot.y_min,
                    y_max: coords.y_max ?? result.dimensionSnapshot.y_max,
                    z_min: coords.z_min ?? result.dimensionSnapshot.z_min,
                    z_max: coords.z_max ?? result.dimensionSnapshot.z_max,
                  };
                } else if (zone.type === 'point') {
                  newSnapshot = {
                    ...result.dimensionSnapshot,
                    x: coords.x ?? result.dimensionSnapshot.x,
                    y: coords.y ?? result.dimensionSnapshot.y,
                    z: coords.z ?? result.dimensionSnapshot.z,
                    aim_x: coords.aim_x ?? result.dimensionSnapshot.aim_x,
                    aim_y: coords.aim_y ?? result.dimensionSnapshot.aim_y,
                    aim_z: coords.aim_z ?? result.dimensionSnapshot.aim_z,
                  };
                } else {
                  newSnapshot = {
                    ...result.dimensionSnapshot,
                    x1: coords.x1 ?? result.dimensionSnapshot.x1,
                    x2: coords.x2 ?? result.dimensionSnapshot.x2,
                    y1: coords.y1 ?? result.dimensionSnapshot.y1,
                    y2: coords.y2 ?? result.dimensionSnapshot.y2,
                    height: coords.height ?? result.dimensionSnapshot.height,
                  };
                }
                updatedZones[zoneId] = { ...result, dimensionSnapshot: newSnapshot };
              }
              newResults = { ...newResults, zones: updatedZones };
            }

            return { ...p, room: newRoom, lamps: newLamps, zones: newZones, results: newResults };
          });
        }

        // Update state hashes from the response — update both current and
        // lastCalculated so that a unit-only change doesn't trigger recalculation
        // (fluence values are unit-independent, so results remain valid)
        if (response.state_hashes) {
          stateHashes.update(h => ({
            ...h,
            current: response.state_hashes ?? null,
            // Preserve lastCalculated as-is if no calculation has happened yet
            lastCalculated: h.lastCalculated ? (response.state_hashes ?? null) : null,
          }));
        }

        // Update userSettings
        userSettings.update(s => ({ ...s, units: newUnits }));
      } catch (e) {
        console.error('[session] changeUnits failed:', e);
      }
    },

    // Reset to default project (using user settings for defaults)
    // Pass skipBackendSync: true when you plan to call initSession() yourself afterward
    reset({ skipBackendSync = false }: { skipBackendSync?: boolean } = {}) {
      const fresh = initializeStandardZones(defaultProjectFromSettings());
      set(fresh);
      _sessionLoadedFromFile = false;
      stateHashes.set({ current: null, lastCalculated: null });
      scheduleAutosave();
      // Reinitialize session with fresh state and refresh standard zones
      if (_sessionInitialized && !skipBackendSync) {
        apiInitSession(projectToSessionInit(fresh))
          .then(async () => {
            fetchStateHashesDebounced();
            if (fresh.room.useStandardZones) {
              await this.refreshStandardZones();
            }
          })
          .catch(async e => {
            if (isSessionExpiredError(e)) {
              console.log('[session] Session expired during reset, reinitializing...');
              try {
                await this.reinitializeSession();
              } catch (reinitError) {
                console.error('[session] Reinit after reset failed:', reinitError);
              }
            } else {
              console.warn('[session] Failed to reinit on reset:', e);
              syncErrors.add('Reset session', e);
            }
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
          .catch(async e => {
            if (isSessionExpiredError(e)) {
              console.log('[session] Session expired during load, reinitializing...');
              try {
                await this.reinitializeSession();
              } catch (reinitError) {
                console.error('[session] Reinit after load failed:', reinitError);
              }
            } else {
              console.warn('[session] Failed to reinit on load:', e);
              syncErrors.add('Load session', e);
            }
          });
      }
    },

    // Load from API response (after Project.load() on backend)
    // Called BEFORE the loadSession HTTP round-trip (see +page.svelte) so any
    // command still queued from the PREVIOUS project can't drain against the
    // freshly loaded session. Standard zones share ids across projects
    // (EyeLimits, SkinLimits, WholeRoomFluence), so a stale queued zone-update
    // would otherwise silently overwrite the loaded project's zone. Same replay
    // protocol as init: pause + mark the boundary; on success loadFromApiResponse
    // clears the pre-boundary commands and resumes, on failure abortLoad resumes
    // without clearing.
    beginLoad() {
      syncQueue.pause();
      syncQueue.markReplayBoundary();
    },

    // Load failed: unlike a failed init (where the backend session doesn't
    // exist), the pre-load session is still live and its queued commands are
    // still valid — resume WITHOUT clearing so they drain against it.
    abortLoad() {
      syncQueue.resume();
    },

    loadFromApiResponse(response: LoadSessionResponse, projectName?: string) {
      const d = ROOM_DEFAULTS;

      // Convert loaded room to RoomConfig
      const roomConfig: RoomConfig = {
        x: response.room.x,
        y: response.room.y,
        z: response.room.z,
        standard: response.room.standard as RoomConfig['standard'],
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
        // Reflectance resolution uses defaults (10x10 per surface);
        // actual values are fetched from backend when the modal is opened
        reflectance_spacings: defaultSurfaceSpacings(response.room.x, response.room.y, response.room.z),
        reflectance_num_points: defaultSurfaceNumPoints(),
        reflectance_resolution_mode: d.reflectance_resolution_mode,
        reflectance_max_num_passes: d.reflectance_max_num_passes,
        reflectance_threshold: d.reflectance_threshold,
        air_changes: response.room.air_changes,
        ozone_decay_constant: response.room.ozone_decay_constant,
        colormap: response.room.colormap ?? d.colormap,
        useStandardZones: d.useStandardZones,
        showDimensions: d.showDimensions,
        showPhotometricWebs: d.showPhotometricWebs,
        showGrid: d.showGrid,
        showXYZMarker: d.showXYZMarker,
        showLampLabels: d.showLampLabels,
        showCalcPointLabels: d.showCalcPointLabels,
        globalHeatmapNormalization: d.globalHeatmapNormalization,
      };

      // Convert loaded lamps to LampInstance[]
      // Loaded lamps have embedded IES/photometry data even without a preset_id
      const lamps: LampInstance[] = response.lamps.map(lamp => ({
        id: lamp.id,
        lamp_type: lamp.lamp_type as 'krcl_222' | 'lp_254' | 'other',
        preset_id: lamp.preset_id ?? undefined,
        name: lamp.name ?? undefined,
        x: lamp.x,
        y: lamp.y,
        z: lamp.z,
        angle: lamp.angle ?? 0,
        aimx: lamp.aimx,
        aimy: lamp.aimy,
        aimz: lamp.aimz,
        scaling_factor: lamp.scaling_factor,
        enabled: lamp.enabled,
        has_ies_file: lamp.has_ies_file ?? true,
        has_spectrum_file: lamp.has_spectrum_file ?? false,
      }));

      // Convert loaded zones to CalcZone[]
      const zones: CalcZone[] = response.zones.map(zone => ({
        id: zone.id,
        name: zone.name ?? undefined,
        type: zone.type as CalcZone['type'],
        enabled: zone.enabled,
        isStandard: zone.is_standard ?? false,
        resolution_mode: 'num_points' as const,
        num_x: zone.num_x ?? undefined,
        num_y: zone.num_y ?? undefined,
        num_z: zone.num_z ?? undefined,
        x_spacing: zone.x_spacing ?? undefined,
        y_spacing: zone.y_spacing ?? undefined,
        z_spacing: zone.z_spacing ?? undefined,
        offset: zone.offset ?? undefined,
        calc_mode: (zone.calc_mode ?? undefined) as CalcZone['calc_mode'],
        height: zone.height ?? undefined,
        x1: zone.x1 ?? undefined,
        x2: zone.x2 ?? undefined,
        y1: zone.y1 ?? undefined,
        y2: zone.y2 ?? undefined,
        ref_surface: (zone.ref_surface ?? undefined) as 'xy' | 'xz' | 'yz' | undefined,
        direction: zone.direction ?? undefined,
        horiz: zone.horiz ?? undefined,
        vert: zone.vert ?? undefined,
        fov_vert: zone.fov_vert ?? undefined,
        fov_horiz: zone.fov_horiz ?? undefined,
        view_direction: (zone.view_direction ?? undefined) as [number, number, number] | undefined,
        view_target: (zone.view_target ?? undefined) as [number, number, number] | undefined,
        v_positive_direction: zone.v_positive_direction ?? undefined,
        dose: zone.dose ?? undefined,
        hours: zone.hours ?? undefined,
        minutes: zone.minutes ?? undefined,
        seconds: zone.seconds ?? undefined,
        x_min: zone.x_min ?? undefined,
        x_max: zone.x_max ?? undefined,
        y_min: zone.y_min ?? undefined,
        y_max: zone.y_max ?? undefined,
        z_min: zone.z_min ?? undefined,
        z_max: zone.z_max ?? undefined,
        // Point-specific
        x: zone.x ?? undefined,
        y: zone.y ?? undefined,
        z: zone.z ?? undefined,
        aim_x: zone.aim_x ?? undefined,
        aim_y: zone.aim_y ?? undefined,
        aim_z: zone.aim_z ?? undefined,
        display_mode: (zone.display_mode ?? undefined) as CalcZone['display_mode'],
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
      // The loaded state is now authoritative. Drop any command queued from the
      // previous project (pre-boundary, marked in beginLoad) so a stale
      // zone-update to a shared standard-zone id can't overwrite the loaded
      // zone; then resume to drain edits made during the load round-trip
      // (post-boundary, which survive clearPending).
      syncQueue.clearPending();
      syncQueue.resume();
      scheduleAutosave();

      // Fetch state hashes for the loaded session
      fetchStateHashesDebounced();

      console.log('[session] Loaded from API:', response.lamps.length, 'lamps,', response.zones.length, 'zones');

      // Adopt the file's units — don't convert to user defaults
      const loadedUnits = response.room.units as 'meters' | 'feet';
      userSettings.update(s => ({ ...s, units: loadedUnits }));
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

      // Only UL8802 has different zone heights, so only refresh zones when switching to/from UL8802
      const ul8802Involved = standardChanged && (oldStandard === 'UL8802 (ACGIH Limits)' || newStandard === 'UL8802 (ACGIH Limits)');

      // Collect zones that need syncing — sync happens after state update
      let zonesToAdd: CalcZone[] = [];
      let zoneIdsToDelete: string[] = [];

      updateWithTimestamp((p) => {
        const newRoom = { ...p.room, ...partial };
        let newZones = p.zones;
        let newResults: Project['results'] | undefined;

        // Handle useStandardZones toggle
        if (partial.useStandardZones !== undefined) {
          if (partial.useStandardZones) {
            // Add fresh standard zones
            const standardZones = getStandardZonePlaceholders(newRoom);
            newZones = [...p.zones, ...standardZones];
            zonesToAdd = standardZones;
          } else {
            // Delete standard zones entirely
            const standardZones = p.zones.filter(z => z.isStandard);
            newZones = p.zones.filter(z => !z.isStandard);
            zoneIdsToDelete = standardZones.map(z => z.id);

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
          }

          // When zones are re-added with the same IDs/config, backend hashes
          // end up identical to lastCalculated, but results have been cleared.
          // Clear lastCalculated so needsCalculation detects the change.
          // (When removing zones with none remaining, hasZones=false keeps
          // the button neutral instead — no point calculating without zones.)
          if (partial.useStandardZones) {
            stateHashes.update(sh => ({ ...sh, lastCalculated: null }));
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
      // Only UL8802 switches need a room patch (to trigger zone geometry updates + hash refresh).
      const standardOnlyNoSync = standardChanged && !ul8802Involved
        && Object.keys(partial).length === 1;

      // Serialize the room patch through the sync queue (coalesces rapid edits,
      // retries transient 423s). refreshStandardZones now waits on queue.drained()
      // rather than this specific promise. The .catch keeps a terminal failure —
      // already toasted via onError — from becoming an unhandled rejection on the
      // paths where roomSyncPromise isn't awaited (no zone add/delete below).
      let roomSyncPromise: Promise<void> | undefined;
      if (!standardOnlyNoSync) {
        roomSyncPromise = syncQueue.enqueue({ kind: 'room-update', partial });
        roomSyncPromise.catch(() => {});
      }

      // Standard-zone add/delete round-trip stays a direct await (adds/copies are
      // not queued) but is ordered AFTER the room patch lands, so backend geometry
      // is current before zones are (re)created. Only run it when the session is
      // live — matches the old session-initialized sync guard behavior.
      let zoneChangePromise: Promise<unknown> | undefined;
      if ((zonesToAdd.length > 0 || zoneIdsToDelete.length > 0) && _sessionInitialized) {
        zoneChangePromise = (async () => {
          if (roomSyncPromise) {
            try { await roomSyncPromise; } catch { /* already reported via onError */ }
          }
          if (zonesToAdd.length > 0) {
            await Promise.all(zonesToAdd.map(async (z) => {
              try {
                const result = await addSessionZone(zoneToSessionZone(z));
                applyStateHashes(result);
              } catch (e) {
                const budget = parseBudgetError(e);
                if (budget) syncErrors.add('Add zone', budget.message, 'warning');
                else syncErrors.add('Add zone', e);
              }
            }));
          }
          if (zoneIdsToDelete.length > 0) {
            await Promise.all(zoneIdsToDelete.map(async (id) => {
              try {
                const result = await deleteSessionZone(id);
                applyStateHashes(result);
              } catch (e) {
                syncErrors.add('Delete zone', e);
              }
            }));
          }
        })();
      }

      // Refresh standard zones from backend when relevant properties change
      // The backend's property setters (x, y, z, units) and set_standard() automatically
      // update zones via guv_calcs, so we just need to fetch the updated definitions.
      // Must wait for zone adds to complete first, otherwise getSessionZones() may
      // return empty and the fallback zones (with potentially wrong spacing) persist.
      if (get({ subscribe }).room.useStandardZones) {
        const needsRefresh = dimensionsChanged || ul8802Involved ||
          partial.useStandardZones === true;
        if (needsRefresh) {
          if (zoneChangePromise) {
            zoneChangePromise.then(() => this.refreshStandardZones());
          } else {
            this.refreshStandardZones();
          }
        }
      }
    },

    // Fetch zone state from backend and update frontend store.
    // Standard zones are fully replaced (backend is authoritative for heights,
    // calc_mode, etc). Custom zones get grid values (num_points, spacing) merged
    // so the store stays in sync after reinit or room resize.
    async refreshStandardZones() {
      // Consistent with the other sync guards: don't hit the backend before the
      // session exists (no credentials yet → "Missing X-Session-ID"). initSession
      // calls this again once ready, so nothing is lost by skipping it now.
      if (!_sessionInitialized) return;
      const current = get({ subscribe });
      if (!current.room.useStandardZones) return;

      // Capture counter at start to detect if a newer request supersedes this one
      const requestId = ++_refreshStandardZonesCounter;

      try {
        // Wait for the queue to drain so any pending room PATCH has landed
        // (guv_calcs updates zone geometry as a side effect of the room patch).
        // drained() resolves even if a command terminally FAILED; we proceed
        // unconditionally anyway. This preserves the prior behavior of awaiting
        // the room-sync promise (syncRoom caught its own errors and resolved),
        // and a failed room PATCH has already surfaced a toast via onError.
        await syncQueue.drained();

        // Fetch current zone state from backend (guv_calcs has already updated them)
        const response = await getSessionZones();

        // Check if this request was superseded by a newer one
        if (requestId !== _refreshStandardZonesCounter) {
          return;
        }

        // Re-check current state after async operation to avoid race conditions
        const latestState = get({ subscribe });
        if (!latestState.room.useStandardZones) return;

        const backendZones = response.zones.map(convertSessionZoneState);
        const backendById = new Map(backendZones.map(z => [z.id, z]));

        // Merge backend state into all zones. Backend values override store
        // values, but frontend-only fields (resolution_mode, display_mode)
        // are preserved from the existing store entry.
        update((p) => ({
          ...p,
          zones: p.zones.map(zone => {
            const backend = backendById.get(zone.id);
            if (!backend) return zone;
            return { ...zone, ...backend, resolution_mode: zone.resolution_mode };
          }),
          lastModified: new Date().toISOString()
        }));

        scheduleAutosave();
      } catch (e) {
        console.error('[illuminate] Failed to refresh zones from backend:', e);
        syncErrors.add('Refresh safety zones', e, 'warning');
      }
    },

    // Lamp operations - don't clear results, let CalculateButton detect staleness
    async addLamp(lamp: Omit<LampInstance, 'id'>): Promise<string> {
      // Frontend mints the id; backend echoes it back (409 on collision).
      const id = crypto.randomUUID();
      const response = await addSessionLamp(lampToSessionLamp({ ...lamp, id }));
      if (response.lamp_id !== id) {
        console.warn(`[session] backend lamp id ${response.lamp_id} != requested ${id}`);
      }
      const newLamp = { ...lamp, id, has_ies_file: response.has_ies_file ?? lamp.has_ies_file };
      updateWithTimestamp((p) => ({
        ...p,
        lamps: [...p.lamps, newLamp]
      }));
      applyStateHashes(response);
      return id;
    },

    updateLamp(id: string, partial: Partial<LampInstance>) {
      // Capture old lamp state BEFORE updating so syncUpdateLamp can detect
      // whether info-affecting properties (lamp_type, wavelength) actually changed
      const oldLamp = get({ subscribe }).lamps.find(l => l.id === id);
      updateWithTimestamp((p) => ({
        ...p,
        lamps: p.lamps.map((l) => (l.id === id ? { ...l, ...partial } : l))
      }));
      // Stash the old-lamp snapshot + response callbacks for the lamp-update
      // executor, then serialize the backend sync through the queue (coalesces
      // rapid edits, retries transient 423s). Fire-and-forget: the .catch keeps
      // a terminal failure (already toasted via onError) from becoming an
      // unhandled rejection.
      lampUpdateExtras.set(id, {
        oldLamp,
        // IES success callback: update has_ies_file, store filename, and clear spectrum if backend cleared it
        onIesUploaded: (filename, hasSpectrum) => {
          updateWithTimestamp((p) => ({
            ...p,
            lamps: p.lamps.map((l) => {
              if (l.id !== id) return l;
              const updates: Partial<LampInstance> = {
                has_ies_file: true,
                pending_ies_file: undefined,
                ies_filename: filename || l.ies_filename,
              };
              // Backend clears spectrum on IES upload — reflect that in frontend state
              if (hasSpectrum === false) {
                updates.has_spectrum_file = false;
                updates.wavelength_from_spectrum = false;
              }
              return { ...l, ...updates };
            })
          }));
        },
        // IES error callback: clear pending state so user can retry
        onIesUploadError: () => {
          updateWithTimestamp((p) => ({
            ...p,
            lamps: p.lamps.map((l) => (l.id === id ? {
              ...l,
              pending_ies_file: undefined
            } : l))
          }));
        },
        // Spectrum success callback: update has_spectrum_file and optionally set wavelength from peak
        onSpectrumUploaded: (result) => {
          updateWithTimestamp((p) => ({
            ...p,
            lamps: p.lamps.map((l) => {
              if (l.id !== id) return l;
              const updates: Partial<LampInstance> = {
                has_spectrum_file: true,
                pending_spectrum_file: undefined,
                spectrum_filename: partial.pending_spectrum_file?.name,
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
        onSpectrumUploadError: () => {
          updateWithTimestamp((p) => ({
            ...p,
            lamps: p.lamps.map((l) => (l.id === id ? {
              ...l,
              pending_spectrum_file: undefined
            } : l))
          }));
        },
        // Lamp updated callback: apply backend-computed values (echo) to stay in
        // sync. Plain store write — sync fires only from enqueue, so no re-sync.
        onLampUpdated: (response) => {
          const needsUpdate = (response.aimx != null && response.aimy != null && response.aimz != null)
            || response.has_ies_file !== undefined;
          if (needsUpdate) {
            updateWithTimestamp((p) => ({
              ...p,
              lamps: p.lamps.map((l) => {
                if (l.id !== id) return l;
                const updates: Partial<LampInstance> = {};
                if (response.aimx != null && response.aimy != null && response.aimz != null) {
                  updates.aimx = response.aimx!;
                  updates.aimy = response.aimy!;
                  updates.aimz = response.aimz!;
                  updates.tilt = response.tilt;
                  updates.orientation = response.orientation;
                }
                if (response.has_ies_file !== undefined) {
                  updates.has_ies_file = response.has_ies_file;
                }
                return { ...l, ...updates };
              })
            }));
          }
        },
      });
      syncQueue.enqueue({ kind: 'lamp-update', id, partial }).catch(() => {});
    },

    removeLamp(id: string) {
      updateWithTimestamp((p) => ({
        ...p,
        lamps: p.lamps.filter((l) => l.id !== id)
      }));
      // Sync to backend (delete supersedes any queued update for this lamp).
      // Drop any callback extras a superseded lamp-update left behind — its
      // executor never runs, so it can't consume them itself.
      lampUpdateExtras.delete(id);
      syncQueue.enqueue({ kind: 'lamp-delete', id }).catch(() => {});
    },

    async copyLamp(id: string): Promise<string> {
      const current = get({ subscribe });
      const lamp = current.lamps.find((l) => l.id === id);
      if (!lamp) throw new Error(`Lamp ${id} not found`);

      // Call backend first to get guv_calcs-assigned ID
      const response = await copySessionLamp(id);
      const newId = response.lamp_id;
      const copyName = `${lamp.name || 'Lamp'} (Copy)`;
      const copy = { ...lamp, id: newId, name: copyName, has_ies_file: response.has_ies_file ?? lamp.has_ies_file };
      updateWithTimestamp((p) => ({
        ...p,
        lamps: [...p.lamps, copy]
      }));
      applyStateHashes(response);

      // Sync copy name to backend so compliance checks use the correct name
      // (through the queue, ordered after any prior lamp sync).
      syncQueue.enqueue({ kind: 'lamp-update', id: newId, partial: { name: copyName } }).catch(() => {});

      return newId;
    },

    // Zone operations
    async addZone(zone: Omit<CalcZone, 'id'>): Promise<string> {
      // Frontend mints the id; backend echoes it back (409 on collision).
      const id = crypto.randomUUID();
      const normalized = zoneToSessionZone({ ...zone, id });
      const response = await addSessionZone(normalized);
      if (response.zone_id !== id) {
        console.warn(`[session] backend zone id ${response.zone_id} != requested ${id}`);
      }
      // Store normalized values so store matches backend
      const newZone = {
        ...zone,
        id,
        x1: normalized.x1, x2: normalized.x2,
        y1: normalized.y1, y2: normalized.y2,
        x_min: normalized.x_min, x_max: normalized.x_max,
        y_min: normalized.y_min, y_max: normalized.y_max,
        z_min: normalized.z_min, z_max: normalized.z_max,
        // Use backend-computed grid values (authoritative)
        num_x: response.num_x ?? zone.num_x,
        num_y: response.num_y ?? zone.num_y,
        num_z: response.num_z ?? zone.num_z,
        x_spacing: response.x_spacing ?? zone.x_spacing,
        y_spacing: response.y_spacing ?? zone.y_spacing,
        z_spacing: response.z_spacing ?? zone.z_spacing,
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
        const newZones = p.zones.map((z) => (z.id === id ? { ...z, ...partial } : z));

        // Don't delete zone results on grid change - staleness overlay will grey them out
        return { ...p, zones: newZones };
      });
      // Serialize the backend sync through the queue (ZoneEditor also debounces
      // at 100ms; queue coalescing is belt-and-suspenders on top). Type changes
      // are a delete+recreate — never coalesced — carrying a full snapshot so the
      // recreated zone preserves its identity and config.
      if (partial.type != null) {
        const zone = get({ subscribe }).zones.find(z => z.id === id);
        if (zone) {
          syncQueue.enqueue({
            kind: 'zone-type-change',
            id,
            snapshot: zoneToSessionZone(zone) as unknown as Record<string, unknown>,
          }).catch(() => {});
          return;
        }
      }
      syncQueue.enqueue({ kind: 'zone-update', id, partial }).catch(() => {});
    },

    removeZone(id: string) {
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
      // Sync to backend (delete supersedes any queued update for this zone)
      syncQueue.enqueue({ kind: 'zone-delete', id }).catch(() => {});
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

    // Update lamp with values from advanced settings. Echo application: the
    // modal already saved via its own API endpoint, so this is a plain store
    // write. Sync fires only from enqueue, so it can't trigger a re-sync.
    updateLampFromAdvanced(id: string, values: Partial<LampInstance>) {
      updateWithTimestamp((p) => ({
        ...p,
        lamps: p.lamps.map((l) => (l.id === id ? { ...l, ...values } : l))
      }));
    },

    // Update zone with backend-computed values (echo application — plain write).
    // Called by AuditModal after fetching authoritative values.
    updateZoneFromBackend(id: string, values: Partial<CalcZone>) {
      applyZoneServerValues(id, values);
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
    },

    // Lamp info cache (prefetched on file upload)
    getLampInfoCache,
    clearLampInfoCache,
  };
}

export const project = createProjectStore();

// Keep hasValidLamps in sync with project state
function lampHasPhotometry(l: LampInstance): boolean {
  return !!l.has_ies_file;
}
project.subscribe((p) => hasValidLamps.set(p.lamps.some(lampHasPhotometry)));
project.subscribe((p) => hasZones.set(p.zones.length > 0));

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

// Expose store state for e2e test access (dev only)
if (import.meta.env.DEV) {
  import('$lib/stores/sessionState').then(({ sessionState }) => {
    project.subscribe((state) => {
      (window as any).__illuminate_store__ = {
        lamps: state.lamps,
        zones: state.zones,
        sessionId: sessionState.getSessionId(),
        token: sessionState.getToken(),
      };
    });
  });
}
