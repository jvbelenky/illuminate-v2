/**
 * Zone Sync Service
 *
 * Handles synchronization of zone data between frontend and backend.
 * This service extracts computed values from API responses, allowing
 * the store to decide how to apply them without tight coupling.
 */

import {
  updateSessionZone,
  type SessionZoneUpdateResponse,
} from '$lib/api/client';
import type { CalcZone } from '$lib/types/project';

/**
 * Result from syncing a zone to the backend.
 * Contains the computed values that the backend calculated.
 */
export interface ZoneSyncResult {
  success: boolean;
  zoneId: string;
  /**
   * Computed values from the backend.
   * Since spacing is always authoritative, this contains the
   * backend-computed num_points values when spacing was sent.
   */
  computedValues: Partial<CalcZone>;
  /**
   * The original updates that were sent, for reference.
   */
  sentUpdates: Partial<CalcZone>;
  /**
   * Raw API response, used to extract state_hashes.
   */
  rawResponse: SessionZoneUpdateResponse;
}

/**
 * Extract all backend-computed grid values from a zone update response.
 * Both spacing and num_points are always returned so the store stays
 * fully in sync with the authoritative backend state.
 */
function extractComputedValues(
  response: SessionZoneUpdateResponse,
): Partial<CalcZone> {
  const result: Partial<CalcZone> = {};
  if (response.num_x != null) result.num_x = response.num_x;
  if (response.num_y != null) result.num_y = response.num_y;
  if (response.num_z != null) result.num_z = response.num_z;
  if (response.x_spacing != null) result.x_spacing = response.x_spacing;
  if (response.y_spacing != null) result.y_spacing = response.y_spacing;
  if (response.z_spacing != null) result.z_spacing = response.z_spacing;
  return result;
}

type WallBlock = { wall_id: string; normal_offset: number; flip: boolean };

const LEGACY_GEOMETRY_KEYS = ['height', 'ref_surface', 'direction', 'x1', 'x2', 'y1', 'y2', 'vertices'];
const WALL_TOUCHING_KEYS: (keyof CalcZone)[] = [
  'surface', 'normal_offset', 'flip', 'wall_vertices',
  'height', 'ref_surface', 'direction', 'x1', 'x2', 'y1', 'y2', 'vertices',
];

/**
 * Build the updates object for the backend API.
 * Filters out undefined/null values and applies priority rules.
 */
function buildApiUpdates(partial: Partial<CalcZone>, wall?: WallBlock): Record<string, unknown> {
  const updates: Record<string, unknown> = {};

  // Basic properties
  if (partial.name != null) updates.name = partial.name;
  if (partial.enabled != null) updates.enabled = partial.enabled;
  if (partial.dose != null) updates.dose = partial.dose;
  if (partial.hours != null) updates.hours = partial.hours;
  if (partial.minutes != null) updates.minutes = partial.minutes;
  if (partial.seconds != null) updates.seconds = partial.seconds;
  if (partial.height != null) updates.height = partial.height;
  if (partial.offset != null) updates.offset = partial.offset;

  // Plane calculation options
  if (partial.calc_mode != null) updates.calc_mode = partial.calc_mode;
  if (partial.ref_surface != null) updates.ref_surface = partial.ref_surface;
  if (partial.direction != null) updates.direction = partial.direction;
  if (partial.fov_vert != null) updates.fov_vert = partial.fov_vert;
  if (partial.fov_horiz != null) updates.fov_horiz = partial.fov_horiz;
  if (partial.horiz != null) updates.horiz = partial.horiz;
  if (partial.vert != null) updates.vert = partial.vert;
  if (partial.use_normal != null) updates.use_normal = partial.use_normal;
  if (partial.view_direction != null) updates.view_direction = partial.view_direction;
  if (partial.view_target != null) updates.view_target = partial.view_target;

  // Plane dimensions (already normalized by ZoneEditor, but guard here too)
  if (partial.x1 != null) updates.x1 = partial.x1;
  if (partial.x2 != null) updates.x2 = partial.x2;
  if (partial.y1 != null) updates.y1 = partial.y1;
  if (partial.y2 != null) updates.y2 = partial.y2;

  // Volume dimensions (already normalized by ZoneEditor, but guard here too)
  if (partial.x_min != null) updates.x_min = partial.x_min;
  if (partial.x_max != null) updates.x_max = partial.x_max;
  if (partial.y_min != null) updates.y_min = partial.y_min;
  if (partial.y_max != null) updates.y_max = partial.y_max;
  if (partial.z_min != null) updates.z_min = partial.z_min;
  if (partial.z_max != null) updates.z_max = partial.z_max;

  // Drawn footprint. guv_calcs reshapes a polygon zone only through a new
  // outline, so an update that turns one back into a rectangle (vertices
  // cleared, bounds given) sends the rectangle's corners.
  if (partial.vertices != null && partial.vertices.length >= 3) {
    updates.vertices = partial.vertices;
  } else if ('vertices' in partial) {
    const xa = partial.x1 ?? partial.x_min, xb = partial.x2 ?? partial.x_max;
    const ya = partial.y1 ?? partial.y_min, yb = partial.y2 ?? partial.y_max;
    if (xa != null && xb != null && ya != null && yb != null) {
      updates.vertices = [[xa, ya], [xb, ya], [xb, yb], [xa, yb]];
    }
  }

  // Point-specific (position and aim point)
  if (partial.x != null) updates.x = partial.x;
  if (partial.y != null) updates.y = partial.y;
  if (partial.z != null) updates.z = partial.z;
  if (partial.aim_x != null) updates.aim_x = partial.aim_x;
  if (partial.aim_y != null) updates.aim_y = partial.aim_y;
  if (partial.aim_z != null) updates.aim_z = partial.aim_z;

  // Grid params — send whichever mode the user edited
  if (partial.x_spacing != null) updates.x_spacing = partial.x_spacing;
  if (partial.y_spacing != null) updates.y_spacing = partial.y_spacing;
  if (partial.z_spacing != null) updates.z_spacing = partial.z_spacing;
  if (partial.num_x != null) updates.num_x = partial.num_x;
  if (partial.num_y != null) updates.num_y = partial.num_y;
  if (partial.num_z != null) updates.num_z = partial.num_z;

  // Display
  if (partial.display_mode != null) updates.display_mode = partial.display_mode;

  // A wall plane is edited through `wall` alone: legacy geometry would flatten it
  if (wall) {
    for (const key of LEGACY_GEOMETRY_KEYS) delete updates[key];
    if (WALL_TOUCHING_KEYS.some((key) => key in partial)) {
      updates.wall = wall;
      if ('wall_vertices' in partial) updates.vertices = partial.wall_vertices ?? null;
    }
  }

  return updates;
}

/**
 * Sync zone updates to the backend and return computed values.
 * The calling code decides what to do with the result.
 *
 * @param zoneId - The zone ID to update
 * @param partial - The partial zone updates to send
 * @returns ZoneSyncResult with computed values from backend
 */
export async function syncZoneToBackend(
  zoneId: string,
  partial: Partial<CalcZone>,
  wall?: WallBlock,
): Promise<ZoneSyncResult> {
  const updates = buildApiUpdates(partial, wall);

  // Nothing to sync
  if (Object.keys(updates).length === 0) {
    return {
      success: true,
      zoneId,
      computedValues: {},
      sentUpdates: partial,
      rawResponse: { success: true },
    };
  }

  const response = await updateSessionZone(zoneId, updates);

  return {
    success: response.success,
    zoneId,
    computedValues: extractComputedValues(response),
    sentUpdates: partial,
    rawResponse: response,
  };
}
