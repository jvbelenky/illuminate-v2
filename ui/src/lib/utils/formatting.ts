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
 * Shows at least `minDecimals` decimal places, but preserves any extra
 * precision the value actually has (e.g. displayDimension(2.54, 1) → "2.54").
 */
export function displayDimension(value: number, minDecimals: number): string {
  const clean = parseFloat(value.toFixed(10));
  const str = String(clean);
  const actualDecimals = str.includes('.') ? str.split('.')[1].length : 0;
  return clean.toFixed(Math.max(minDecimals, actualDecimals));
}

/**
 * Format a number as a percentage string.
 */
export function formatPercentage(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined) return '—';
  return `${(value * 100).toFixed(decimals)}%`;
}
