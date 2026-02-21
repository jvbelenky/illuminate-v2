/**
 * Zod schemas for API response validation.
 *
 * These schemas validate critical API responses at runtime to catch
 * shape mismatches early rather than letting them cause cryptic errors.
 */

import { z } from 'zod';

// ============================================================
// Shared Schemas
// ============================================================

const StateHashesSchema = z.object({
  calc_state: z.object({
    lamps: z.number(),
    calc_zones: z.record(z.string(), z.number()),
    reflectance: z.number(),
  }),
  update_state: z.object({
    lamps: z.number(),
    calc_zones: z.record(z.string(), z.number()),
    reflectance: z.number(),
  }),
});

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
  state_hashes: StateHashesSchema.nullable().optional(),
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
  num_points: z.array(z.number()).nullish(),
  values: z.array(z.unknown()).nullish(), // Can be nested arrays
});

export const CalculateResponseSchema = z.object({
  success: z.boolean(),
  calculated_at: z.string(),
  mean_fluence: z.number().nullable().optional(),
  zones: z.record(z.string(), ZoneResultSchema),
  state_hashes: StateHashesSchema.nullable().optional(),
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
  skin_compliant: z.boolean(),
  eye_compliant: z.boolean(),
});

export const CheckLampsResponseSchema = z.object({
  success: z.boolean(),
  results: z.array(LampComplianceResultSchema),
  state_hashes: StateHashesSchema.nullable().optional(),
});

export type CheckLampsResponse = z.infer<typeof CheckLampsResponseSchema>;

// ============================================================
// Load Session Response
// ============================================================

export const LoadSessionResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  state_hashes: StateHashesSchema.nullable().optional(),
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
