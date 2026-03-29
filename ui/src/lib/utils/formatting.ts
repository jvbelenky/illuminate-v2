/**
 * Formatting utilities for displaying values in the UI.
 */

/**
 * Format a numeric value with appropriate precision.
 * Uses exponential notation for very small values and limits decimal places for larger values.
 */
export function formatValue(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined) return '—';
  if (value === 0) return (0).toFixed(decimals);
  if (Math.abs(value) < 0.01) return value.toExponential(2);
  if (Math.abs(value) < 1) return value.toFixed(Math.max(decimals, 3));
  if (Math.abs(value) < 100) return value.toFixed(decimals);
  return value.toFixed(1);
}

/**
 * Format a dimension value for display in an input field.
 * Rounds to exactly `decimals` decimal places, avoiding ugly artifacts
 * from unit conversions (e.g. 3.6576 → "3.7" with decimals=1).
 */
export function displayDimension(value: number, decimals: number): string {
  return value.toFixed(decimals);
}

/**
 * Format a float for display in an input field.
 * Shows at least `minDecimals` decimal places (respecting room precision),
 * but preserves additional meaningful digits without float noise.
 *
 * Examples with minDecimals=2:
 *   0.5           → "0.50"
 *   0.50234       → "0.50234"
 *   1.9999999999  → "2.00"   (float noise stripped)
 *   3.280839895   → "3.280839895" (meaningful precision kept)
 */
export function formatFloat(value: number, minDecimals: number): string {
  // Clean float noise first (10 significant figures covers all reasonable precision)
  const clean = cleanFloat(value);
  const fixed = clean.toFixed(minDecimals);
  // If toFixed is lossless, use it (gives trailing zeros)
  if (parseFloat(fixed) === clean) return fixed;
  // Otherwise the value has more meaningful digits — show them all
  const str = String(clean);
  // Ensure at least minDecimals places
  const dot = str.indexOf('.');
  if (dot === -1) return clean.toFixed(minDecimals);
  const existingDecimals = str.length - dot - 1;
  if (existingDecimals >= minDecimals) return str;
  return clean.toFixed(minDecimals);
}

/**
 * Strip floating-point noise from a number.
 * Preserves ~10 significant figures, which is enough for all practical
 * dimensions while eliminating artifacts like 1.9999999999999998.
 *
 * Use at serialization boundaries (save, export) to keep files clean.
 */
export function cleanFloat(value: number): number {
  if (!isFinite(value) || value === 0) return value;
  return parseFloat(value.toPrecision(10));
}

