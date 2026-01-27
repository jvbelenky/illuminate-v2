/**
 * Safety-related constants for photobiological dose calculations.
 * These values are based on ACGIH, ICNIRP, and related standards.
 */

/** TLV limits by standard (mJ/cm² over 8 hours) */
export const TLV_LIMITS: Record<string, { skin: number; eye: number }> = {
  'ACGIH': { skin: 479, eye: 161 },
  'ACGIH-UL8802': { skin: 479, eye: 161 },
  'ICNIRP': { skin: 23, eye: 23 }
};

/**
 * Ozone generation constant.
 * Used for estimating ozone increase from 222nm lamps.
 * This is a rough estimate - actual values depend on lamp spectra.
 */
export const OZONE_GENERATION_CONSTANT = 10;

/** Ozone warning threshold in ppb */
export const OZONE_WARNING_THRESHOLD_PPB = 5;
