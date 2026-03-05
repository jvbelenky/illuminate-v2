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

