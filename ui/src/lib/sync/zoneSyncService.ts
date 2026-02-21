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
   * Only includes the COMPLEMENTARY values to what was sent:
   * - If num_points were sent, contains computed spacing values
   * - If spacing was sent, contains computed num_points values
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
 * Extract computed values from a zone update response.
 * Returns only the complementary values based on what was updated.
 *
 * @param response - The API response with all grid values
 * @param sentUpdates - The updates that were sent to determine which values are complementary
 */
function extractComputedValues(
  response: SessionZoneUpdateResponse,
  sentUpdates: Partial<CalcZone>
): Partial<CalcZone> {
  const sentNumPoints = sentUpdates.num_x !== undefined ||
                        sentUpdates.num_y !== undefined ||
                        sentUpdates.num_z !== undefined;

  const sentSpacing = sentUpdates.x_spacing !== undefined ||
                      sentUpdates.y_spacing !== undefined ||
                      sentUpdates.z_spacing !== undefined;

  if (sentNumPoints) {
    // User was in num_points mode - return computed spacing values
    return {
      x_spacing: response.x_spacing ?? undefined,
      y_spacing: response.y_spacing ?? undefined,
      z_spacing: response.z_spacing ?? undefined,
    };
  } else if (sentSpacing) {
    // User was in spacing mode - return computed num_points values
    return {
      num_x: response.num_x ?? undefined,
      num_y: response.num_y ?? undefined,
      num_z: response.num_z ?? undefined,
    };
  }

  // No grid parameters were updated, no computed values to return
  return {};
}

/**
 * Build the updates object for the backend API.
 * Filters out undefined/null values and applies priority rules.
 */
function buildApiUpdates(partial: Partial<CalcZone>): Record<string, unknown> {
  const updates: Record<string, unknown> = {};

  // Basic properties
  if (partial.name != null) updates.name = partial.name;
  if (partial.enabled != null) updates.enabled = partial.enabled;
  if (partial.dose != null) updates.dose = partial.dose;
  if (partial.hours != null) updates.hours = partial.hours;
  if (partial.height != null) updates.height = partial.height;
  if (partial.offset != null) updates.offset = partial.offset;

  // Plane calculation options
  if (partial.calc_type != null) updates.calc_type = partial.calc_type;
  if (partial.ref_surface != null) updates.ref_surface = partial.ref_surface;
  if (partial.direction != null) updates.direction = partial.direction;
  if (partial.fov_vert != null) updates.fov_vert = partial.fov_vert;
  if (partial.fov_horiz != null) updates.fov_horiz = partial.fov_horiz;

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
  partial: Partial<CalcZone>
): Promise<ZoneSyncResult> {
  const updates = buildApiUpdates(partial);

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
    computedValues: extractComputedValues(response, partial),
    sentUpdates: partial,
    rawResponse: response,
  };
}
