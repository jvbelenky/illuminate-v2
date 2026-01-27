import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { defaultProject, defaultSurfaceSpacings, defaultSurfaceNumPoints, ROOM_DEFAULTS, type Project, type LampInstance, type CalcZone, type RoomConfig } from '$lib/types/project';
import {
  initSession as apiInitSession,
  updateSessionRoom,
  addSessionLamp,
  updateSessionLamp,
  deleteSessionLamp,
  addSessionZone,
  updateSessionZone,
  deleteSessionZone,
  getStandardZones as apiGetStandardZones,
  uploadSessionLampIES,
  generateSessionId,
  hasSessionId,
  setSessionExpiredHandler,
  type SessionInitRequest,
  type SessionLampInput,
  type SessionZoneInput,
  type SessionZoneUpdateResponse,
  type StandardZoneDefinition,
  type LoadSessionResponse,
} from '$lib/api/client';

// Generate a deterministic snapshot of parameters that would be sent to the API
// Used to detect if recalculation is needed by comparing current vs last request
export function getRequestState(p: Project): string {
  // Only include parameters that affect calculation results
  // Display-only params (colormap, precision) are excluded
  const roomState = {
    x: p.room.x,
    y: p.room.y,
    z: p.room.z,
    units: p.room.units
  };

  // Include all lamps with photometric data, track enabled status (backend handles enabled logic)
  const lampStates = p.lamps
    .filter(l => {
      if (l.preset_id && l.preset_id !== 'custom') return true;
      if (l.has_ies_file) return true;
      return false;
    })
    .map(l => ({
      x: l.x,
      y: l.y,
      z: l.z,
      aimx: l.aimx,
      aimy: l.aimy,
      aimz: l.aimz,
      scaling_factor: l.scaling_factor,
      lamp_type: l.lamp_type,
      preset_id: l.preset_id,
      has_ies_file: l.has_ies_file,
      enabled: l.enabled !== false
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

  // All zones (including standard) are now stored in p.zones
  // Note: dose/hours are excluded as they only transform display values, not fluence calculation
  const zoneStates = p.zones
    .filter(z => z.enabled !== false)
    .map(z => ({
      id: z.id,
      type: z.type,
      height: z.height,
      num_x: z.num_x,
      num_y: z.num_y,
      num_z: z.num_z,
      x_spacing: z.x_spacing,
      y_spacing: z.y_spacing,
      z_spacing: z.z_spacing,
      x_min: z.x_min,
      x_max: z.x_max,
      y_min: z.y_min,
      y_max: z.y_max,
      z_min: z.z_min,
      z_max: z.z_max,
      isStandard: z.isStandard
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return JSON.stringify({ room: roomState, lamps: lampStates, zones: zoneStates });
}

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

// Convert project to session init format
function projectToSessionInit(p: Project): SessionInitRequest {
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
      air_changes: p.room.air_changes ?? ROOM_DEFAULTS.air_changes,
      ozone_decay_constant: p.room.ozone_decay_constant ?? ROOM_DEFAULTS.ozone_decay_constant,
    },
    lamps: p.lamps.map(lampToSessionLamp),
    zones: p.zones.map(zoneToSessionZone),
  };
}

function lampToSessionLamp(lamp: LampInstance): SessionLampInput {
  return {
    id: lamp.id,
    lamp_type: lamp.lamp_type,
    preset_id: lamp.preset_id,
    x: lamp.x,
    y: lamp.y,
    z: lamp.z,
    aimx: lamp.aimx,
    aimy: lamp.aimy,
    aimz: lamp.aimz,
    scaling_factor: lamp.scaling_factor,
    enabled: lamp.enabled !== false,
  };
}

function zoneToSessionZone(zone: CalcZone): SessionZoneInput {
  return {
    id: zone.id,
    name: zone.name,
    type: zone.type,
    enabled: zone.enabled !== false,
    isStandard: zone.isStandard ?? false,
    dose: zone.dose ?? false,
    hours: zone.hours ?? 8,
    // Plane-specific
    height: zone.height,
    x1: zone.x1,
    x2: zone.x2,
    y1: zone.y1,
    y2: zone.y2,
    // Volume-specific
    x_min: zone.x_min,
    x_max: zone.x_max,
    y_min: zone.y_min,
    y_max: zone.y_max,
    z_min: zone.z_min,
    z_max: zone.z_max,
    // Resolution
    num_x: zone.num_x,
    num_y: zone.num_y,
    num_z: zone.num_z,
    x_spacing: zone.x_spacing,
    y_spacing: zone.y_spacing,
    z_spacing: zone.z_spacing,
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
    return await operation();
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
    if (partial.air_changes !== undefined) updates.air_changes = partial.air_changes;
    if (partial.ozone_decay_constant !== undefined) updates.ozone_decay_constant = partial.ozone_decay_constant;

    if (Object.keys(updates).length > 0) {
      await updateSessionRoom(updates);
    }
  } catch (e) {
    syncErrors.add('Update room', e);
  }
}

function syncAddLamp(lamp: LampInstance) {
  return withSyncGuard('Add lamp', () => addSessionLamp(lampToSessionLamp(lamp)));
}

async function syncUpdateLamp(
  id: string,
  partial: Partial<LampInstance>,
  onIesUploaded?: (filename?: string) => void,
  onIesUploadError?: () => void
) {
  if (!_sessionInitialized || !_syncEnabled) return;

  try {
    // Handle IES file upload if pending
    if (partial.pending_ies_file) {
      try {
        const result = await uploadSessionLampIES(id, partial.pending_ies_file);
        if (result.success) {
          console.log('[session] IES file uploaded for lamp', id, result.filename);
          onIesUploaded?.(result.filename);
        }
      } catch (uploadError) {
        console.error('[session] IES upload failed for lamp', id, uploadError);
        syncErrors.add('Upload IES file', uploadError);
        // Clear pending state on error so user can retry
        onIesUploadError?.();
      }
    }

    // Sync other property updates (excluding file objects)
    const { pending_ies_file, pending_spectrum_file, ...updates } = partial;
    if (Object.keys(updates).length > 0) {
      await updateSessionLamp(id, updates);
    }
  } catch (e) {
    syncErrors.add('Update lamp', e);
  }
}

function syncDeleteLamp(id: string) {
  return withSyncGuard('Delete lamp', () => deleteSessionLamp(id));
}

function syncAddZone(zone: CalcZone) {
  return withSyncGuard('Add zone', () => addSessionZone(zoneToSessionZone(zone)));
}

async function syncUpdateZone(
  id: string,
  partial: Partial<CalcZone>,
  onBackendUpdate?: (id: string, values: Partial<CalcZone>) => void
) {
  if (!_sessionInitialized || !_syncEnabled) return;

  try {
    // Build updates object with properties the backend accepts
    // Use != null to filter both undefined and null (backend rejects null values)
    const updates: Record<string, unknown> = {};
    if (partial.name != null) updates.name = partial.name;
    if (partial.enabled != null) updates.enabled = partial.enabled;
    if (partial.dose != null) updates.dose = partial.dose;
    if (partial.hours != null) updates.hours = partial.hours;
    if (partial.height != null) updates.height = partial.height;

    // Grid params - send only one mode (num_points OR spacing)
    // num_points mode takes precedence
    if (partial.num_x != null || partial.num_y != null || partial.num_z != null) {
      if (partial.num_x != null) updates.num_x = partial.num_x;
      if (partial.num_y != null) updates.num_y = partial.num_y;
      if (partial.num_z != null) updates.num_z = partial.num_z;
    } else if (partial.x_spacing != null || partial.y_spacing != null || partial.z_spacing != null) {
      if (partial.x_spacing != null) updates.x_spacing = partial.x_spacing;
      if (partial.y_spacing != null) updates.y_spacing = partial.y_spacing;
      if (partial.z_spacing != null) updates.z_spacing = partial.z_spacing;
    }

    if (Object.keys(updates).length > 0) {
      const response = await updateSessionZone(id, updates);

      // Only update COMPLEMENTARY values from backend (not the ones the user is editing)
      // This prevents reactivity conflicts in ZoneEditor
      if (onBackendUpdate) {
        if (updates.num_x !== undefined || updates.num_y !== undefined || updates.num_z !== undefined) {
          // User was in num_points mode - only update spacing (the computed values)
          onBackendUpdate(id, {
            x_spacing: response.x_spacing,
            y_spacing: response.y_spacing,
            z_spacing: response.z_spacing,
          });
        } else if (updates.x_spacing !== undefined || updates.y_spacing !== undefined || updates.z_spacing !== undefined) {
          // User was in spacing mode - only update num_points (the computed values)
          onBackendUpdate(id, {
            num_x: response.num_x,
            num_y: response.num_y,
            num_z: response.num_z,
          });
        }
      }
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
      height: def.height ?? 1.7,
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

// Synchronous fallback for initial project creation (before backend is ready)
// This is only used during initial load; updateRoom will fetch from backend
function getStandardZonesFallback(room: RoomConfig): CalcZone[] {
  const height = room.units === 'meters' ? 1.7 : 5.6;

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
      x_spacing: 0.1, y_spacing: 0.1,
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
      x_spacing: 0.1, y_spacing: 0.1,
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
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(project));
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
      // Ensure we have a session ID before making API calls
      if (!hasSessionId()) {
        generateSessionId();
      }

      const current = get({ subscribe });
      try {
        const result = await apiInitSession(projectToSessionInit(current));
        _sessionInitialized = result.success;
        _sessionLoadedFromFile = false; // Fresh session, not loaded from file
        console.log('[session] Initialized:', result.message, `(${result.lamp_count} lamps, ${result.zone_count} zones)`);

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

      const current = get({ subscribe });
      try {
        const result = await apiInitSession(projectToSessionInit(current));
        _sessionInitialized = result.success;
        // Keep _sessionLoadedFromFile as-is; if it was loaded from file,
        // the IES data is still in memory on the backend (just the session expired)
        console.log('[session] Reinitialized:', result.message, `(${result.lamp_count} lamps, ${result.zone_count} zones)`);

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
      scheduleAutosave();
      // Reinitialize session with fresh state and refresh standard zones
      if (_sessionInitialized) {
        apiInitSession(projectToSessionInit(fresh))
          .then(async () => {
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

    // Load from API response (after Room.load() on backend)
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
        reflectance_num_points: defaultSurfaceNumPoints(),
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
        lamp_type: lamp.lamp_type as 'krcl_222' | 'lp_254',
        preset_id: lamp.preset_id,
        name: lamp.name,
        x: lamp.x,
        y: lamp.y,
        z: lamp.z,
        aimx: lamp.aimx,
        aimy: lamp.aimy,
        aimz: lamp.aimz,
        scaling_factor: lamp.scaling_factor,
        enabled: lamp.enabled,
        // Loaded lamps always have IES data (embedded in .guv file)
        has_ies_file: true,
      }));

      // Standard zone IDs that should be marked as isStandard
      const STANDARD_ZONE_IDS = ['WholeRoomFluence', 'EyeLimits', 'SkinLimits'];

      // Convert loaded zones to CalcZone[]
      const zones: CalcZone[] = response.zones.map(zone => ({
        id: zone.id,
        name: zone.name,
        type: zone.type,
        enabled: zone.enabled,
        isStandard: STANDARD_ZONE_IDS.includes(zone.id),
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
        name: projectName || 'Loaded Project',
        room: roomConfig,
        lamps,
        zones,
        lastModified: new Date().toISOString(),
      };

      // The session is already initialized on the backend (Room.load was called)
      // Mark as loaded from file - this session has embedded IES data that would be lost on reinit
      _sessionInitialized = true;
      _sessionLoadedFromFile = true;
      set(project);
      scheduleAutosave();

      console.log('[session] Loaded from API:', response.lamps.length, 'lamps,', response.zones.length, 'zones');
    },

    // Export current state (for saving to .guv file)
    export(): Project {
      return get({ subscribe });
    },

    // Room operations
    updateRoom(partial: Partial<RoomConfig>) {
      const currentProject = get({ subscribe });
      const standardChanged = partial.standard !== undefined && partial.standard !== currentProject.room.standard;
      const dimensionsChanged = partial.x !== undefined || partial.y !== undefined || partial.z !== undefined;

      updateWithTimestamp((p) => {
        const newRoom = { ...p.room, ...partial };
        let newZones = p.zones;

        // Handle useStandardZones toggle
        if (partial.useStandardZones !== undefined) {
          if (partial.useStandardZones) {
            // Add standard zones with fallback; async fetch will update with correct values
            const hasStandardZones = p.zones.some(z => z.isStandard);
            if (!hasStandardZones) {
              const standardZones = getStandardZonesFallback(newRoom);
              newZones = [...p.zones, ...standardZones];
              // Sync new standard zones to backend
              standardZones.forEach(z => syncAddZone(z));
            }
          } else {
            // Remove standard zones
            const removedZones = p.zones.filter(z => z.isStandard);
            newZones = p.zones.filter(z => !z.isStandard);
            // Sync removals to backend
            removedZones.forEach(z => syncDeleteZone(z.id));
          }
        }

        // Only clear results if calculation-affecting parameters changed
        // Non-invalidating params: display-only OR can be recomputed from existing fluence
        const nonInvalidatingParams = new Set([
          'colormap', 'precision',           // Display only
          'standard',                        // TLV limits can be recomputed
          'air_changes', 'ozone_decay_constant'  // Ozone estimate can be recomputed
        ]);
        const changedKeys = Object.keys(partial) as (keyof RoomConfig)[];
        const calculationAffected = changedKeys.some(key => !nonInvalidatingParams.has(key));

        return {
          ...p,
          room: newRoom,
          zones: newZones,
          results: calculationAffected ? undefined : p.results
        };
      });

      // Sync to backend with debounce for rapid changes (e.g., sliders)
      debounce('room', () => syncRoom(partial));

      // Refresh standard zones from backend when standard or dimensions change
      // Standard changes affect heights (UL8802 vs others), dimensions affect zone bounds
      const needsRefresh = (standardChanged || dimensionsChanged || partial.useStandardZones === true);
      if (needsRefresh && get({ subscribe }).room.useStandardZones) {
        this.refreshStandardZones();
      }
    },

    // Fetch standard zones from backend and update store
    async refreshStandardZones() {
      const current = get({ subscribe });
      if (!current.room.useStandardZones) return;

      // Capture counter at start to detect if a newer request supersedes this one
      const requestId = ++_refreshStandardZonesCounter;

      const standardZones = await fetchStandardZonesFromBackend(current.room);

      // Check if this request was superseded by a newer one
      if (requestId !== _refreshStandardZonesCounter) {
        console.log('[illuminate] refreshStandardZones: superseded by newer request, discarding');
        return;
      }

      if (standardZones.length === 0) return;

      // Re-check current state after async operation to avoid race conditions
      // The project may have changed while we were fetching
      const latestState = get({ subscribe });
      if (!latestState.room.useStandardZones) return;

      // Check which zones already exist in session (using latest state, not stale `current`)
      const existingZoneIds = new Set(latestState.zones.filter(z => z.isStandard).map(z => z.id));

      // Update store with new zones
      update((p) => {
        const customZones = p.zones.filter(z => !z.isStandard);
        return {
          ...p,
          zones: [...customZones, ...standardZones],
          lastModified: new Date().toISOString()
        };
      });

      // Sync to session backend - update existing zones, add new ones
      for (const zone of standardZones) {
        if (existingZoneIds.has(zone.id)) {
          // Zone exists - update it with properties that can change with standard
          // Height, vert, horiz, fov_vert all depend on the safety standard
          syncUpdateZone(zone.id, {
            height: zone.height,
            // Note: vert, horiz, fov_vert are set at zone creation and can't be updated
            // For full sync, we'd need to delete and re-add, but that causes race conditions
          });
        } else {
          // New zone - add it
          syncAddZone(zone);
        }
      }

      scheduleAutosave();
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
    addLamp(lamp: Omit<LampInstance, 'id'>) {
      const id = crypto.randomUUID();
      const newLamp = { ...lamp, id };
      updateWithTimestamp((p) => ({
        ...p,
        lamps: [...p.lamps, newLamp]
      }));
      // Sync to backend
      syncAddLamp(newLamp as LampInstance);
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
        // Success callback: update has_ies_file and store filename
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
        // Error callback: clear pending state so user can retry
        () => {
          updateWithTimestamp((p) => ({
            ...p,
            lamps: p.lamps.map((l) => (l.id === id ? {
              ...l,
              pending_ies_file: undefined
            } : l))
          }));
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

    // Zone operations
    addZone(zone: Omit<CalcZone, 'id'>) {
      const id = crypto.randomUUID();
      const newZone = { ...zone, id };
      updateWithTimestamp((p) => ({
        ...p,
        zones: [...p.zones, newZone]
        // Don't clear results - new zone just won't have results yet
      }));
      // Sync to backend
      syncAddZone(newZone as CalcZone);
      return id;
    },

    updateZone(id: string, partial: Partial<CalcZone>) {
      updateWithTimestamp((p) => {
        const oldZone = p.zones.find((z) => z.id === id);
        const newZones = p.zones.map((z) => (z.id === id ? { ...z, ...partial } : z));

        // Only clear this zone's results if grid parameters changed
        const gridChanged = oldZone && (
          partial.num_x !== undefined && partial.num_x !== oldZone.num_x ||
          partial.num_y !== undefined && partial.num_y !== oldZone.num_y ||
          partial.num_z !== undefined && partial.num_z !== oldZone.num_z ||
          partial.x_spacing !== undefined && partial.x_spacing !== oldZone.x_spacing ||
          partial.y_spacing !== undefined && partial.y_spacing !== oldZone.y_spacing ||
          partial.z_spacing !== undefined && partial.z_spacing !== oldZone.z_spacing ||
          partial.height !== undefined && partial.height !== oldZone.height
        );

        let newResults = p.results;
        if (gridChanged && newResults?.zones) {
          // Remove only this zone's results
          const { [id]: _, ...remainingZones } = newResults.zones;
          newResults = { ...newResults, zones: remainingZones };
        }

        return { ...p, zones: newZones, results: newResults };
      });
      // Sync to backend with debounce - pass callback for backend-computed values
      debounce(`zone-${id}`, () => syncUpdateZone(id, partial, updateZoneFromBackendInternal));
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
    return project.subscribe((p) => fn(p.zones));
  }
};

export const results = {
  subscribe: (fn: (value: Project['results']) => void) => {
    return project.subscribe((p) => fn(p.results));
  }
};
