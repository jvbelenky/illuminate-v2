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
  type SessionInitRequest,
  type SessionLampInput,
  type SessionZoneInput,
  type SessionZoneUpdateResponse,
  type StandardZoneDefinition,
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
let _syncEnabled = true;

// Debounce timers for different sync operations
const _debounceTimers: Record<string, ReturnType<typeof setTimeout>> = {};

function debounce(key: string, fn: () => void, delay: number = SYNC_DEBOUNCE_MS) {
  if (_debounceTimers[key]) {
    clearTimeout(_debounceTimers[key]);
  }
  _debounceTimers[key] = setTimeout(fn, delay);
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

// Sync functions - fire and forget with error logging
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
    console.warn('[session] Failed to sync room:', e);
  }
}

async function syncAddLamp(lamp: LampInstance) {
  if (!_sessionInitialized || !_syncEnabled) return;

  try {
    await addSessionLamp(lampToSessionLamp(lamp));
  } catch (e) {
    console.warn('[session] Failed to sync add lamp:', e);
  }
}

async function syncUpdateLamp(id: string, partial: Partial<LampInstance>) {
  if (!_sessionInitialized || !_syncEnabled) return;

  try {
    await updateSessionLamp(id, partial);
  } catch (e) {
    console.warn('[session] Failed to sync update lamp:', e);
  }
}

async function syncDeleteLamp(id: string) {
  if (!_sessionInitialized || !_syncEnabled) return;

  try {
    await deleteSessionLamp(id);
  } catch (e) {
    console.warn('[session] Failed to sync delete lamp:', e);
  }
}

async function syncAddZone(zone: CalcZone) {
  if (!_sessionInitialized || !_syncEnabled) return;

  try {
    await addSessionZone(zoneToSessionZone(zone));
  } catch (e) {
    console.warn('[session] Failed to sync add zone:', e);
  }
}

async function syncUpdateZone(
  id: string,
  partial: Partial<CalcZone>,
  onBackendUpdate?: (id: string, values: Partial<CalcZone>) => void
) {
  if (!_sessionInitialized || !_syncEnabled) return;

  try {
    // Build updates object with properties the backend accepts
    const updates: Record<string, unknown> = {};
    if (partial.name !== undefined) updates.name = partial.name;
    if (partial.enabled !== undefined) updates.enabled = partial.enabled;
    if (partial.dose !== undefined) updates.dose = partial.dose;
    if (partial.hours !== undefined) updates.hours = partial.hours;
    if (partial.height !== undefined) updates.height = partial.height;

    // Grid params - send only one mode (num_points OR spacing)
    // num_points mode takes precedence
    if (partial.num_x !== undefined || partial.num_y !== undefined || partial.num_z !== undefined) {
      if (partial.num_x !== undefined) updates.num_x = partial.num_x;
      if (partial.num_y !== undefined) updates.num_y = partial.num_y;
      if (partial.num_z !== undefined) updates.num_z = partial.num_z;
    } else if (partial.x_spacing !== undefined || partial.y_spacing !== undefined || partial.z_spacing !== undefined) {
      if (partial.x_spacing !== undefined) updates.x_spacing = partial.x_spacing;
      if (partial.y_spacing !== undefined) updates.y_spacing = partial.y_spacing;
      if (partial.z_spacing !== undefined) updates.z_spacing = partial.z_spacing;
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
    console.warn('[session] Failed to sync update zone:', e);
  }
}

async function syncDeleteZone(id: string) {
  if (!_sessionInitialized || !_syncEnabled) return;

  try {
    await deleteSessionZone(id);
  } catch (e) {
    console.warn('[session] Failed to sync delete zone:', e);
  }
}

// TODO: RESTORE localStorage functionality before release
// NOTE: This code is intentionally disabled during development/testing.
// The implementation below is complete and working - just uncomment when ready.
function loadFromStorage(): Project {
  // Always return fresh default project during testing
  return initializeStandardZones(defaultProject());

  /* DISABLED FOR TESTING - restore before release:
  if (!browser) return initializeStandardZones(defaultProject());

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Project;
      console.log('[illuminate] Restored project from localStorage');
      // Ensure standard zones are present if useStandardZones is enabled
      return initializeStandardZones(parsed);
    }
  } catch (e) {
    console.warn('[illuminate] Failed to restore from localStorage:', e);
  }

  return initializeStandardZones(defaultProject());
  */
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
    // Return empty array on failure - UI will show no standard zones
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

// TODO: RESTORE localStorage functionality before release
// NOTE: This code is intentionally disabled during development/testing.
// The implementation below is complete and working - just uncomment when ready.
function saveToStorage(project: Project) {
  // Disabled during testing
  return;

  /* DISABLED FOR TESTING - restore before release:
  if (!browser) return;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    console.log('[illuminate] Auto-saved to localStorage');
  } catch (e) {
    console.warn('[illuminate] Failed to auto-save:', e);
  }
  */
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
    update((p) => ({
      ...p,
      zones: p.zones.map((z) => (z.id === id ? { ...z, ...values } : z))
    }));
    _syncEnabled = wasSyncEnabled;
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
      const current = get({ subscribe });
      try {
        const result = await apiInitSession(projectToSessionInit(current));
        _sessionInitialized = result.success;
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

    // Check if session is initialized
    isSessionInitialized() {
      return _sessionInitialized;
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
          .then(() => {
            if (fresh.room.useStandardZones) this.refreshStandardZones();
          })
          .catch(e => console.warn('[session] Failed to reinit on reset:', e));
      }
    },

    // Load from .guv file
    loadFromFile(data: Project) {
      const initialized = initializeStandardZones(data);
      set(initialized);
      scheduleAutosave();
      // Reinitialize session with loaded state and refresh standard zones
      if (_sessionInitialized) {
        apiInitSession(projectToSessionInit(initialized))
          .then(() => {
            if (initialized.room.useStandardZones) this.refreshStandardZones();
          })
          .catch(e => console.warn('[session] Failed to reinit on load:', e));
      }
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

      const standardZones = await fetchStandardZonesFromBackend(current.room);
      if (standardZones.length === 0) return;

      // Check which zones already exist in session
      const existingZoneIds = new Set(current.zones.filter(z => z.isStandard).map(z => z.id));

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
      debounce(`lamp-${id}`, () => syncUpdateLamp(id, partial));
    },

    removeLamp(id: string) {
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
