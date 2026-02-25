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
 * @param span - Total span length
 * @param numPoints - Number of grid points
 * @returns Spacing between points
 */
export function spacingFromNumPoints(span: number, numPoints: number): number {
  if (numPoints <= 1) return span;
  return span / numPoints;  // cell model (matches guv_calcs)
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
