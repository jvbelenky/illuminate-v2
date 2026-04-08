/**
 * Zod schemas for API response validation.
 *
 * These schemas validate critical API responses at runtime to catch
 * shape mismatches early rather than letting them cause cryptic errors.
 *
 * IMPORTANT: All response schemas use .passthrough() so that new fields
 * added to the backend are preserved rather than silently stripped.
 * Without .passthrough(), Zod's default "strip" mode removes any key
 * not declared in the schema — a silent data-loss bug.
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
  }).passthrough(),
  update_state: z.object({
    lamps: z.number(),
    calc_zones: z.record(z.string(), z.number()),
    reflectance: z.number(),
  }).passthrough(),
}).passthrough();

// ============================================================
// Session Init Response
// ============================================================

export const SessionInitResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  lamp_count: z.number(),
  zone_count: z.number(),
}).passthrough();

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
}).passthrough();

export type SessionZoneUpdateResponse = z.infer<typeof SessionZoneUpdateResponseSchema>;

// ============================================================
// Calculate Response
// ============================================================

export const ZoneStatisticsSchema = z.object({
  min: z.number().nullable(),
  max: z.number().nullable(),
  mean: z.number().nullable(),
  std: z.number().nullable().optional(),
}).passthrough();

export const ZoneResultSchema = z.object({
  zone_id: z.string(),
  zone_name: z.string().nullable().optional(),
  zone_type: z.string(),
  statistics: ZoneStatisticsSchema,
  num_points: z.array(z.number()).nullish(),
  values: z.array(z.unknown()).nullish(), // Can be nested arrays
}).passthrough();

export const CalculateResponseSchema = z.object({
  success: z.boolean(),
  calculated_at: z.string(),
  mean_fluence: z.number().nullable().optional(),
  fluence_by_wavelength: z.record(z.string(), z.number()).nullable().optional(),
  ozone_increase_ppb: z.number().nullable().optional(),
  zones: z.record(z.string(), ZoneResultSchema),
  state_hashes: StateHashesSchema.nullable().optional(),
}).passthrough();

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
  skin_near_limit: z.boolean(),
  eye_near_limit: z.boolean(),
  missing_spectrum: z.boolean(),
}).passthrough();

export const SafetyWarningSchema = z.object({
  level: z.enum(['info', 'warning', 'error']),
  message: z.string(),
  lamp_id: z.string().nullable().optional(),
}).passthrough();

export const CheckLampsResponseSchema = z.object({
  status: z.enum(['compliant', 'non_compliant', 'compliant_with_dimming', 'non_compliant_even_with_dimming']),
  lamp_results: z.record(z.string(), LampComplianceResultSchema),
  warnings: z.array(SafetyWarningSchema),
  max_skin_dose: z.number(),
  max_eye_dose: z.number(),
  is_skin_compliant: z.boolean(),
  is_eye_compliant: z.boolean(),
  skin_near_limit: z.boolean(),
  eye_near_limit: z.boolean(),
  skin_dimming_for_compliance: z.number().nullable().optional(),
  eye_dimming_for_compliance: z.number().nullable().optional(),
}).passthrough();

export type CheckLampsResponse = z.infer<typeof CheckLampsResponseSchema>;

// ============================================================
// Position Check / Nudge Responses
// ============================================================

export const PositionWarningItemSchema = z.object({
  id: z.string(),
  name: z.string().nullable().optional(),
  message: z.string(),
}).passthrough();

export const PositionWarningsResponseSchema = z.object({
  warnings: z.array(PositionWarningItemSchema),
}).passthrough();

export type PositionWarningsResponse = z.infer<typeof PositionWarningsResponseSchema>;

export const NudgedLampPositionSchema = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  z: z.number(),
  aimx: z.number(),
  aimy: z.number(),
  aimz: z.number(),
}).passthrough();

export const NudgedZonePositionSchema = z.object({
  id: z.string(),
  type: z.string(),
  x1: z.number().nullish(),
  x2: z.number().nullish(),
  y1: z.number().nullish(),
  y2: z.number().nullish(),
  height: z.number().nullish(),
  z_min: z.number().nullish(),
  z_max: z.number().nullish(),
  x: z.number().nullish(),
  y: z.number().nullish(),
  z: z.number().nullish(),
  aim_x: z.number().nullish(),
  aim_y: z.number().nullish(),
  aim_z: z.number().nullish(),
}).passthrough();

export const NudgeIntoBoundsResponseSchema = z.object({
  lamps: z.array(NudgedLampPositionSchema),
  zones: z.array(NudgedZonePositionSchema),
  state_hashes: StateHashesSchema.nullable().optional(),
}).passthrough();

export type NudgeIntoBoundsResponse = z.infer<typeof NudgeIntoBoundsResponseSchema>;

// ============================================================
// Load Session Response
// ============================================================

export const LoadedRoomSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
  units: z.string(),
  standard: z.string(),
  precision: z.number(),
  enable_reflectance: z.boolean(),
  reflectances: z.record(z.string(), z.number()).nullable().optional(),
  air_changes: z.number(),
  ozone_decay_constant: z.number(),
  colormap: z.string().nullable().optional(),
}).passthrough();

export const LoadedLampSchema = z.object({
  id: z.string(),
  lamp_type: z.string(),
  preset_id: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  x: z.number(),
  y: z.number(),
  z: z.number(),
  angle: z.number(),
  aimx: z.number(),
  aimy: z.number(),
  aimz: z.number(),
  tilt: z.number(),
  orientation: z.number(),
  scaling_factor: z.number(),
  enabled: z.boolean(),
}).passthrough();

export const LoadedZoneSchema = z.object({
  id: z.string(),
  name: z.string().nullable().optional(),
  type: z.string(),
  enabled: z.boolean(),
  is_standard: z.boolean(),
  num_x: z.number().nullish(),
  num_y: z.number().nullish(),
  num_z: z.number().nullish(),
  x_spacing: z.number().nullish(),
  y_spacing: z.number().nullish(),
  z_spacing: z.number().nullish(),
  offset: z.boolean().nullish(),
  // Plane-specific
  calc_mode: z.string().nullish(),
  height: z.number().nullish(),
  x1: z.number().nullish(),
  x2: z.number().nullish(),
  y1: z.number().nullish(),
  y2: z.number().nullish(),
  ref_surface: z.string().nullish(),
  direction: z.number().nullish(),
  horiz: z.boolean().nullish(),
  vert: z.boolean().nullish(),
  use_normal: z.boolean().nullish(),
  fov_vert: z.number().nullish(),
  fov_horiz: z.number().nullish(),
  view_direction: z.array(z.number()).nullish(),
  view_target: z.array(z.number()).nullish(),
  v_positive_direction: z.boolean().nullish(),
  // Dose/time
  dose: z.boolean().nullish(),
  hours: z.number().nullish(),
  minutes: z.number().nullish(),
  seconds: z.number().nullish(),
  // Volume-specific
  x_min: z.number().nullish(),
  x_max: z.number().nullish(),
  y_min: z.number().nullish(),
  y_max: z.number().nullish(),
  z_min: z.number().nullish(),
  z_max: z.number().nullish(),
  // Point-specific
  x: z.number().nullish(),
  y: z.number().nullish(),
  z: z.number().nullish(),
  aim_x: z.number().nullish(),
  aim_y: z.number().nullish(),
  aim_z: z.number().nullish(),
  // Display
  display_mode: z.string().nullish(),
}).passthrough();

export const LoadSessionResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  room: LoadedRoomSchema,
  lamps: z.array(LoadedLampSchema),
  zones: z.array(LoadedZoneSchema),
}).passthrough();

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
