/**
 * Calculation utilities for UV safety and efficacy metrics.
 */

import { OZONE_GENERATION_CONSTANT } from '$lib/constants/safety';

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
 * Calculate estimated steady-state ozone increase from 222nm lamps.
 *
 * @param avgFluence - Average fluence rate (µW/cm²)
 * @param airChanges - Room air changes per hour
 * @param decayConstant - Ozone decay constant
 * @returns Estimated ozone increase in ppb, or null if inputs are invalid
 */
export function calculateOzoneIncrease(
  avgFluence: number | null | undefined,
  airChanges: number,
  decayConstant: number
): number | null {
  if (!avgFluence) return null;
  return (avgFluence * OZONE_GENERATION_CONSTANT) / (airChanges + decayConstant);
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
  return span / (numPoints - 1);
}

/**
 * Calculate number of points from spacing across a span.
 *
 * @param span - Total span length
 * @param spacing - Desired spacing between points
 * @returns Number of grid points (minimum 2)
 */
export function numPointsFromSpacing(span: number, spacing: number): number {
  if (spacing <= 0) return 2;
  return Math.max(2, Math.round(span / spacing) + 1);
}
