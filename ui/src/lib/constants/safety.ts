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
 * @deprecated Use guv-calcs efficacy module for pathogen susceptibility data.
 * This constant is kept for backwards compatibility only.
 * Typical value for SARS-CoV-2 in cm²/mJ.
 */
export const DEFAULT_PATHOGEN_SUSCEPTIBILITY = 0.377;

/**
 * Ozone generation constant.
 * Used for estimating ozone increase from 222nm lamps.
 * This is a rough estimate - actual values depend on lamp spectra.
 */
export const OZONE_GENERATION_CONSTANT = 10;

/** Default FOV values per ANSI/IES RP 27.1-22 */
export const FOV_DEFAULTS = {
  /** Vertical FOV for eye dose calculations (degrees) */
  VERT: 80,
  /** Horizontal FOV (degrees) */
  HORIZ: 360,
  /** Full hemisphere (for skin calculations) */
  HEMISPHERE: 180
};

/** Ozone warning threshold in ppb */
export const OZONE_WARNING_THRESHOLD_PPB = 5;
