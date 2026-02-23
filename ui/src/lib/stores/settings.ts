/**
 * User settings store for persistent preferences across sessions.
 * Backed by localStorage (separate from per-project sessionStorage).
 */

import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import type { LampType, PlaneCalcType, ZoneDisplayMode } from '$lib/types/project';
import { ROOM_DEFAULTS } from '$lib/types/project';
import type { PlacementMode } from '$lib/utils/lampPlacement';

export interface UserSettings {
  // Zone defaults
  zoneType: 'plane' | 'volume';
  planeDisplayMode: ZoneDisplayMode;
  volumeDisplayMode: ZoneDisplayMode;
  zoneOffset: boolean;
  zoneCalcType: PlaneCalcType;
  zoneDose: boolean;
  zoneHours: number;

  // Display defaults
  colormap: string;
  precision: number;
  showDimensions: boolean;
  showGrid: boolean;
  showPhotometricWebs: boolean;
  showXYZMarker: boolean;
  globalHeatmapNormalization: boolean;

  // Room defaults
  units: 'meters' | 'feet';
  standard: 'ACGIH' | 'ACGIH-UL8802' | 'ICNIRP';
  roomX: number;
  roomY: number;
  roomZ: number;
  reflectance: number;
  airChanges: number;
  enableReflectance: boolean;
  useStandardZones: boolean;

  // Behavior
  autoRecalculate: boolean;

  // Lamp defaults
  lampType: LampType;
  lampPlacement: PlacementMode;
  lampPreset222: string;  // preset_id for 222nm lamps ('' = none, 'custom', or a preset id)
}

export const SETTINGS_DEFAULTS: UserSettings = {
  // Zone defaults
  zoneType: 'plane',
  planeDisplayMode: 'heatmap',
  volumeDisplayMode: 'heatmap',
  zoneOffset: true,
  zoneCalcType: 'planar_normal',
  zoneDose: false,
  zoneHours: 8,

  // Display defaults
  colormap: ROOM_DEFAULTS.colormap,
  precision: ROOM_DEFAULTS.precision,
  showDimensions: ROOM_DEFAULTS.showDimensions,
  showGrid: ROOM_DEFAULTS.showGrid,
  showPhotometricWebs: ROOM_DEFAULTS.showPhotometricWebs,
  showXYZMarker: ROOM_DEFAULTS.showXYZMarker,
  globalHeatmapNormalization: ROOM_DEFAULTS.globalHeatmapNormalization,

  // Room defaults
  units: ROOM_DEFAULTS.units,
  standard: ROOM_DEFAULTS.standard,
  roomX: ROOM_DEFAULTS.x,
  roomY: ROOM_DEFAULTS.y,
  roomZ: ROOM_DEFAULTS.z,
  reflectance: ROOM_DEFAULTS.reflectance,
  airChanges: ROOM_DEFAULTS.air_changes,
  enableReflectance: ROOM_DEFAULTS.enable_reflectance,
  useStandardZones: ROOM_DEFAULTS.useStandardZones,

  // Behavior
  autoRecalculate: false,

  // Lamp defaults
  lampType: 'krcl_222',
  lampPlacement: 'downlight',
  lampPreset222: '',  // None selected
};

const STORAGE_KEY = 'illuminate-settings';

function loadSettings(): UserSettings {
  if (!browser) return { ...SETTINGS_DEFAULTS };

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Migrate old single zoneDisplayMode to separate plane/volume modes
      if (parsed.zoneDisplayMode && !parsed.planeDisplayMode) {
        parsed.planeDisplayMode = parsed.zoneDisplayMode;
        parsed.volumeDisplayMode = parsed.zoneDisplayMode;
        delete parsed.zoneDisplayMode;
      }
      // Migrate standalone autorecalculate localStorage key
      if (parsed.autoRecalculate === undefined) {
        const legacyAutoRecalc = localStorage.getItem('illuminate_autorecalculate');
        if (legacyAutoRecalc !== null) {
          parsed.autoRecalculate = legacyAutoRecalc === 'true';
          localStorage.removeItem('illuminate_autorecalculate');
        }
      }
      // Merge with defaults for forward compatibility (new settings get defaults)
      return { ...SETTINGS_DEFAULTS, ...parsed };
    }
  } catch (e) {
    console.warn('[settings] Failed to load from localStorage:', e);
  }

  return { ...SETTINGS_DEFAULTS };
}

function saveSettings(settings: UserSettings) {
  if (!browser) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.warn('[settings] Failed to save to localStorage:', e);
  }
}

function createSettingsStore() {
  const { subscribe, set, update } = writable<UserSettings>(loadSettings());

  return {
    subscribe,
    set: (settings: UserSettings) => {
      saveSettings(settings);
      set(settings);
    },
    update: (fn: (settings: UserSettings) => UserSettings) => {
      update(current => {
        const updated = fn(current);
        saveSettings(updated);
        return updated;
      });
    },
    reset: () => {
      const defaults = { ...SETTINGS_DEFAULTS };
      saveSettings(defaults);
      set(defaults);
    },
  };
}

export const userSettings = createSettingsStore();
