/**
 * Zod schemas for API response validation.
 *
 * These schemas validate critical API responses at runtime to catch
 * shape mismatches early rather than letting them cause cryptic errors.
 */

import { z } from 'zod';

// ============================================================
// Session Init Response
// ============================================================

export const SessionInitResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  lamp_count: z.number(),
  zone_count: z.number(),
});

export type SessionInitResponse = z.infer<typeof SessionInitResponseSchema>;

// ============================================================
// Zone Update Response
// ============================================================

export const SessionZoneUpdateResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  // Grid resolution - computed values returned by backend
  // Use nullish() to accept both null (from backend for N/A fields) and undefined
  num_x: z.number().nullish(),
  num_y: z.number().nullish(),
  num_z: z.number().nullish(),
  x_spacing: z.number().nullish(),
  y_spacing: z.number().nullish(),
  z_spacing: z.number().nullish(),
});

export type SessionZoneUpdateResponse = z.infer<typeof SessionZoneUpdateResponseSchema>;

// ============================================================
// Calculate Response
// ============================================================

export const ZoneStatisticsSchema = z.object({
  min: z.number().nullable(),
  max: z.number().nullable(),
  mean: z.number().nullable(),
  std: z.number().nullable().optional(),
});

export const ZoneResultSchema = z.object({
  zone_id: z.string(),
  zone_name: z.string().nullable().optional(),
  zone_type: z.string(),
  statistics: ZoneStatisticsSchema,
  num_points: z.array(z.number()).optional(),
  values: z.array(z.unknown()).optional(), // Can be nested arrays
});

export const CalculateResponseSchema = z.object({
  success: z.boolean(),
  calculated_at: z.string(),
  mean_fluence: z.number().nullable().optional(),
  zones: z.record(z.string(), ZoneResultSchema),
});

export type CalculateResponse = z.infer<typeof CalculateResponseSchema>;

// ============================================================
// Check Lamps Response
// ============================================================

export const LampComplianceResultSchema = z.object({
  lamp_id: z.string(),
  lamp_name: z.string(),
  skin_dose_max: z.number(),
  eye_dose_max: z.number(),
  skin_tlv: z.number(),
  eye_tlv: z.number(),
  skin_dimming_required: z.number(),
  eye_dimming_required: z.number(),
  is_skin_compliant: z.boolean(),
  is_eye_compliant: z.boolean(),
  missing_spectrum: z.boolean(),
});

export const SafetyWarningSchema = z.object({
  level: z.string(),
  message: z.string(),
  lamp_id: z.string().nullable().optional(),
});

export const CheckLampsResponseSchema = z.object({
  status: z.enum(['compliant', 'non_compliant', 'compliant_with_dimming', 'non_compliant_even_with_dimming']),
  lamp_results: z.record(z.string(), LampComplianceResultSchema),
  warnings: z.array(SafetyWarningSchema),
  max_skin_dose: z.number(),
  max_eye_dose: z.number(),
  skin_dimming_for_compliance: z.number().nullable().optional(),
  eye_dimming_for_compliance: z.number().nullable().optional(),
});

export type CheckLampsResponse = z.infer<typeof CheckLampsResponseSchema>;

// ============================================================
// Load Session Response
// ============================================================

export const LoadedLampSchema = z.object({
  id: z.string(),
  lamp_type: z.string(),
  preset_id: z.string().optional(),
  name: z.string().optional(),
  x: z.number(),
  y: z.number(),
  z: z.number(),
  aimx: z.number(),
  aimy: z.number(),
  aimz: z.number(),
  scaling_factor: z.number(),
  enabled: z.boolean(),
});

export const LoadedZoneSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  type: z.enum(['plane', 'volume']),
  enabled: z.boolean(),
  // Grid resolution
  num_x: z.number().optional(),
  num_y: z.number().optional(),
  num_z: z.number().optional(),
  x_spacing: z.number().optional(),
  y_spacing: z.number().optional(),
  z_spacing: z.number().optional(),
  offset: z.boolean().optional(),
  // Plane-specific
  height: z.number().optional(),
  x1: z.number().optional(),
  x2: z.number().optional(),
  y1: z.number().optional(),
  y2: z.number().optional(),
  ref_surface: z.string().optional(),
  direction: z.number().optional(),
  horiz: z.boolean().optional(),
  vert: z.boolean().optional(),
  fov_vert: z.number().optional(),
  fov_horiz: z.number().optional(),
  dose: z.boolean().optional(),
  hours: z.number().optional(),
  // Volume-specific
  x_min: z.number().optional(),
  x_max: z.number().optional(),
  y_min: z.number().optional(),
  y_max: z.number().optional(),
  z_min: z.number().optional(),
  z_max: z.number().optional(),
});

export const LoadedRoomSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
  units: z.string(),
  standard: z.string(),
  precision: z.number(),
  enable_reflectance: z.boolean(),
  reflectances: z.record(z.string(), z.number()).optional(),
  air_changes: z.number(),
  ozone_decay_constant: z.number(),
  colormap: z.string().optional(),
});

export const LoadSessionResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  room: LoadedRoomSchema,
  lamps: z.array(LoadedLampSchema),
  zones: z.array(LoadedZoneSchema),
});

export type LoadSessionResponse = z.infer<typeof LoadSessionResponseSchema>;

// ============================================================
// Validation Helper
// ============================================================

/**
 * Environment flag: when true, validation failures throw errors.
 * Set to true in development to catch API contract mismatches early.
 * In production, we log warnings but don't break the app.
 */
const STRICT_VALIDATION = import.meta.env.DEV;

/**
 * Validate an API response against a schema.
 *
 * In development (STRICT_VALIDATION=true): throws on validation failure
 * In production: logs warning and returns data as-is for backwards compatibility
 *
 * This helps catch API contract mismatches during development while
 * maintaining resilience in production.
 */
export function validateResponse<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  context: string
): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const errorDetails = result.error.format();
    console.error(`[API validation] ${context} response validation failed:`, errorDetails);
    console.error(`[API validation] Received data:`, JSON.stringify(data, null, 2));

    if (STRICT_VALIDATION) {
      throw new Error(
        `API validation failed for ${context}: ${JSON.stringify(errorDetails)}`
      );
    }

    // Production fallback: return data as-is (type safety is compromised)
    // WARNING: This may cause runtime errors downstream
    return data as T;
  }
  return result.data;
}
