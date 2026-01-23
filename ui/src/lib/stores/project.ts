import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { defaultProject, defaultSurfaceSpacings, defaultSurfaceNumPoints, ROOM_DEFAULTS, type Project, type LampInstance, type CalcZone, type RoomConfig } from '$lib/types/project';

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

// Standard zone definitions - created locally, backend uses proper guv-calcs zones during calculation
// These flags must match what guv-calcs expects for proper eye/skin dose calculations
function getStandardZones(room: RoomConfig): CalcZone[] {
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
      // Eye calculation: vertical irradiance with limited FOV
      // This measures what eyes looking straight ahead would receive
      vert: true,
      horiz: false,
      fov_vert: 80,  // 80° per ANSI/IES RP 27.1-22
      fov_horiz: 360,
      direction: 0,  // Omnidirectional (worst case from any direction)
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
      // Skin calculation: horizontal irradiance
      // This measures what top of head/shoulders would receive from above
      horiz: true,
      vert: false,
      fov_vert: 180,
      fov_horiz: 360,
      direction: 0,  // Omnidirectional
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
  if (project.room.useStandardZones) {
    const hasStandardZones = project.zones.some(z => z.isStandard);
    if (!hasStandardZones) {
      project.zones = [...project.zones, ...getStandardZones(project.room)];
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

    // Reset to default project
    reset() {
      const fresh = initializeStandardZones(defaultProject());
      set(fresh);
      scheduleAutosave();
    },

    // Load from .guv file
    loadFromFile(data: Project) {
      set(initializeStandardZones(data));
      scheduleAutosave();
    },

    // Export current state (for saving to .guv file)
    export(): Project {
      return get({ subscribe });
    },

    // Room operations
    updateRoom(partial: Partial<RoomConfig>) {
      updateWithTimestamp((p) => {
        const newRoom = { ...p.room, ...partial };
        let newZones = p.zones;

        // Handle useStandardZones toggle
        if (partial.useStandardZones !== undefined) {
          if (partial.useStandardZones) {
            // Add standard zones if not already present
            const hasStandardZones = p.zones.some(z => z.isStandard);
            if (!hasStandardZones) {
              newZones = [...p.zones, ...getStandardZones(newRoom)];
            }
          } else {
            // Remove standard zones
            newZones = p.zones.filter(z => !z.isStandard);
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
      updateWithTimestamp((p) => ({
        ...p,
        lamps: [...p.lamps, { ...lamp, id }]
      }));
      return id;
    },

    updateLamp(id: string, partial: Partial<LampInstance>) {
      updateWithTimestamp((p) => ({
        ...p,
        lamps: p.lamps.map((l) => (l.id === id ? { ...l, ...partial } : l))
      }));
    },

    removeLamp(id: string) {
      updateWithTimestamp((p) => ({
        ...p,
        lamps: p.lamps.filter((l) => l.id !== id)
      }));
    },

    // Zone operations
    addZone(zone: Omit<CalcZone, 'id'>) {
      const id = crypto.randomUUID();
      updateWithTimestamp((p) => ({
        ...p,
        zones: [...p.zones, { ...zone, id }]
        // Don't clear results - new zone just won't have results yet
      }));
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
