/**
 * Calculation utilities for UV safety and efficacy metrics.
 */

/** Maximum grid points for volume numeric display (individual 3D text sprites). */
export const MAX_NUMERIC_VOLUME_POINTS = 1000;

/**
 * Calculate hours until TLV (Threshold Limit Value) is reached.
 *
 * @param maxDose - Maximum dose over 8 hours (mJ/cm²)
 * @param tlv - Threshold limit value (mJ/cm²)
 * @returns Hours to reach TLV, or null if dose is 0
 */
export function calculateHoursToTLV(maxDose: number | null | undefined, tlv: number): number | null {
  if (!maxDose || maxDose <= 0) return null;
  return (8 * tlv) / maxDose;
}

/**
 * Calculate spacing from number of points across a span.
 *
 * Uses the conservative rounding algorithm from guv_calcs `_set_spacing`:
 * tries rounding to 1–5 decimal places and picks the first rounded value
 * where `numPointsFromSpacing(span, rounded) === numPoints`, so the
 * derived spacing stays as clean as possible.
 *
 * @param span - Total span length
 * @param numPoints - Number of grid points
 * @returns Spacing between points (nicely rounded when possible)
 */
export function spacingFromNumPoints(span: number, numPoints: number): number {
  if (numPoints <= 1) return span;
  const raw = span / numPoints;
  for (let decimals = 1; decimals <= 5; decimals++) {
    const factor = 10 ** decimals;
    const rounded = Math.round(raw * factor) / factor;
    if (rounded !== 0 && Math.round(span / rounded) === numPoints) {
      return rounded;
    }
  }
  return raw;  // no nice rounding found — use raw value
}

/**
 * Calculate number of points from spacing across a span.
 *
 * @param span - Total span length
 * @param spacing - Desired spacing between points
 * @returns Number of grid points (minimum 2)
 */
export function numPointsFromSpacing(span: number, spacing: number): number {
  if (span === 0) return 1;
  if (spacing <= 0) return 2;
  return Math.max(2, Math.round(span / spacing));  // cell model (matches guv_calcs)
}

/**
 * Compute a multiplier to convert stored result values to the zone's current display units.
 *
 * The backend returns values via get_values(), which applies dose conversion
 * (irradiance × 3.6 × hours) when zone.dose=true at calculation time.
 * If the user toggles dose mode after calculation, we need to convert on the fly.
 *
 * @param zoneDose - Current zone dose setting
 * @param zoneHours - Current zone hours setting
 * @param doseAtCalcTime - Whether dose was active when results were calculated
 * @param hoursAtCalcTime - Hours value at calculation time
 * @returns Multiplier to apply to stored values for correct display
 */
export function doseConversionFactor(
  zoneDose: boolean,
  zoneHours: number,
  doseAtCalcTime: boolean | undefined,
  hoursAtCalcTime: number | undefined
): number {
  const calcDose = doseAtCalcTime ?? false;
  const calcHours = hoursAtCalcTime ?? 8;

  if (zoneDose === calcDose) {
    // Same mode — but if both dose, hours might differ
    if (zoneDose && calcHours > 0) {
      return zoneHours / calcHours;
    }
    return 1;
  }

  if (zoneDose && !calcDose) {
    // Stored as irradiance, display as dose
    return 3.6 * zoneHours;
  }

  // Stored as dose, display as irradiance
  if (calcHours > 0) {
    return 1 / (3.6 * calcHours);
  }
  return 1;
}

/** Round away float artifacts without forcing the value to an integer. */
function cleanTimeComponent(v: number): number {
  return Math.round((v + Number.EPSILON) * 1e4) / 1e4;
}

/**
 * Format h/m/s into a display string like "1h 30m 15s".
 *
 * Always emits all three components (never "8h" for 8 hours) — the results
 * panel renders this into a click-to-edit field, so the shape the user reads
 * has to match the shape they type back.
 */
export function formatDoseTime(h: number, m: number, s: number): string {
  return `${cleanTimeComponent(h)}h ${cleanTimeComponent(m)}m ${cleanTimeComponent(s)}s`;
}

/**
 * Parse a user-typed exposure time into h/m/s components.
 *
 * Accepted forms (case-insensitive, whitespace-tolerant):
 *   - suffix:  "8h 0m 0s", "8h30m", "90m", "45s"  (each unit at most once)
 *   - colon:   "8:00:00" (h:m:s), "8:30" (h:m — *not* m:s)
 *   - bare:    "8" → 8 hours
 *
 * Components are normalized so overflow carries upward: "90m" → 1h 30m 0s.
 * Returns null for anything unparseable, so callers can revert the field.
 */
export function parseDoseTime(input: string): {
  hours: number;
  minutes: number;
  seconds: number;
} | null {
  const text = input.trim().toLowerCase();
  if (!text) return null;

  const NUM = String.raw`\d+(?:\.\d+)?`;
  let h = 0;
  let m = 0;
  let s = 0;

  if (text.includes(':')) {
    const parts = text.split(':');
    if (parts.length < 2 || parts.length > 3) return null;
    if (!parts.every((p) => new RegExp(`^${NUM}$`).test(p))) return null;
    [h, m, s] = [parts[0], parts[1], parts[2] ?? '0'].map(Number);
  } else if (new RegExp(`^${NUM}$`).test(text)) {
    h = Number(text);
  } else {
    // Suffix form: the matches must account for the entire string, and no
    // unit may repeat ("1h 2h" is a typo, not 3 hours).
    const matches = [...text.matchAll(new RegExp(`(${NUM})\\s*([hms])`, 'g'))];
    if (matches.length === 0) return null;
    if (matches.map((x) => x[0]).join('').replace(/\s+/g, '') !== text.replace(/\s+/g, '')) {
      return null;
    }
    const seen = new Set<string>();
    for (const [, value, unit] of matches) {
      if (seen.has(unit)) return null;
      seen.add(unit);
      if (unit === 'h') h = Number(value);
      else if (unit === 'm') m = Number(value);
      else s = Number(value);
    }
  }

  if (![h, m, s].every((v) => isFinite(v) && v >= 0)) return null;

  // Carry overflow upward so the result round-trips through formatDoseTime.
  const total = cleanTimeComponent(h * 3600 + m * 60 + s);
  return {
    hours: Math.floor(total / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: cleanTimeComponent(total % 60),
  };
}

/**
 * Compute total hours from h/m/s components.
 */
export function totalHours(h: number, m: number, s: number): number {
  return h + m / 60 + s / 3600;
}
