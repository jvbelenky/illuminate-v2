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
  zone_id: z.string(),
  // Grid resolution - computed values returned by backend
  num_x: z.number().optional(),
  num_y: z.number().optional(),
  num_z: z.number().optional(),
  x_spacing: z.number().optional(),
  y_spacing: z.number().optional(),
  z_spacing: z.number().optional(),
});

export type SessionZoneUpdateResponse = z.infer<typeof SessionZoneUpdateResponseSchema>;

// ============================================================
// Calculate Response
// ============================================================

export const ZoneStatisticsSchema = z.object({
  min: z.number(),
  max: z.number(),
  mean: z.number(),
  std: z.number().optional(),
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
  mean_fluence: z.number().nullable().optional(),
  units: z.string(),
  zones: z.record(z.string(), ZoneResultSchema).optional(),
});

export type CalculateResponse = z.infer<typeof CalculateResponseSchema>;

// ============================================================
// Check Lamps Response
// ============================================================

export const LampComplianceResultSchema = z.object({
  lamp_id: z.string(),
  lamp_name: z.string().nullable().optional(),
  skin_dose_max: z.number().nullable().optional(),
  eye_dose_max: z.number().nullable().optional(),
  skin_tlv: z.number().nullable().optional(),
  eye_tlv: z.number().nullable().optional(),
  skin_dimming_required: z.number().nullable().optional(),
  eye_dimming_required: z.number().nullable().optional(),
  is_skin_compliant: z.boolean(),
  is_eye_compliant: z.boolean(),
  missing_spectrum: z.boolean().optional(),
});

export const SafetyWarningSchema = z.object({
  level: z.string(),
  message: z.string(),
  lamp_id: z.string().nullable().optional(),
});

export const CheckLampsResponseSchema = z.object({
  status: z.string(),
  is_compliant: z.boolean(),
  dimming_required: z.number().nullable().optional(),
  lamp_results: z.record(z.string(), LampComplianceResultSchema),
  warnings: z.array(SafetyWarningSchema),
});

export type CheckLampsResponse = z.infer<typeof CheckLampsResponseSchema>;

// ============================================================
// Load Session Response
// ============================================================

export const LoadedLampSchema = z.object({
  id: z.string(),
  name: z.string().nullable().optional(),
  lamp_type: z.string().nullable().optional(),
  preset_id: z.string().nullable().optional(),
  x: z.number(),
  y: z.number(),
  z: z.number(),
  aimx: z.number(),
  aimy: z.number(),
  aimz: z.number(),
  scaling_factor: z.number().optional(),
  enabled: z.boolean().optional(),
  has_ies_file: z.boolean().optional(),
  ies_filename: z.string().nullable().optional(),
});

export const LoadedZoneSchema = z.object({
  id: z.string(),
  name: z.string().nullable().optional(),
  type: z.enum(['plane', 'volume']),
  enabled: z.boolean().optional(),
  isStandard: z.boolean().optional(),
  dose: z.boolean().optional(),
  hours: z.number().optional(),
  height: z.number().nullable().optional(),
  num_x: z.number().optional(),
  num_y: z.number().optional(),
  num_z: z.number().optional(),
  x_spacing: z.number().optional(),
  y_spacing: z.number().optional(),
  z_spacing: z.number().optional(),
});

export const LoadedRoomSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
  units: z.string(),
  standard: z.string(),
  precision: z.number().optional(),
  enable_reflectance: z.boolean().optional(),
  reflectances: z.record(z.string(), z.number()).nullable().optional(),
  air_changes: z.number().optional(),
  ozone_decay_constant: z.number().optional(),
  colormap: z.string().nullable().optional(),
});

export const LoadSessionResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  room: LoadedRoomSchema.optional(),
  lamps: z.array(LoadedLampSchema).optional(),
  zones: z.array(LoadedZoneSchema).optional(),
});

export type LoadSessionResponse = z.infer<typeof LoadSessionResponseSchema>;

// ============================================================
// Validation Helper
// ============================================================

/**
 * Validate an API response against a schema.
 * Logs validation errors but doesn't throw - returns the data as-is on failure
 * to maintain backwards compatibility while alerting developers to issues.
 */
export function validateResponse<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  context: string
): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    console.warn(`[API validation] ${context} response validation failed:`, result.error.format());
    // Return data as-is to avoid breaking functionality
    return data as T;
  }
  return result.data;
}
