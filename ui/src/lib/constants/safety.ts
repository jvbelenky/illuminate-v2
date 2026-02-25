/**
 * Safety-related constants for photobiological dose calculations.
 * These values are based on ACGIH, ICNIRP, and related standards.
 */

/** Monochromatic 222nm TLV limits by standard (mJ/cm² over 8 hours).
 * These are ONLY correct for pure 222nm (LPHG) lamps without spectral data.
 * For lamps with spectrum files, use the per-lamp TLVs from the checkLamps response
 * (which may be significantly more restrictive). */
export const TLV_LIMITS: Record<string, { skin: number; eye: number }> = {
  'ANSI IES RP 27.1-22 (ACGIH Limits)': { skin: 478.5, eye: 160.7 },
  'UL8802 (ACGIH Limits)': { skin: 478.5, eye: 160.7 },
  'IEC 62471-6:2022 (ICNIRP Limits)': { skin: 23.0, eye: 23.0 }
};

/** Ozone warning threshold in ppb */
export const OZONE_WARNING_THRESHOLD_PPB = 5;
