/**
 * Export utilities for downloading zone data and reports.
 */

import type { CalcZone, ZoneResult } from '$lib/types/project';

/**
 * Trigger a file download in the browser.
 *
 * @param content - File content as string
 * @param filename - Name for the downloaded file
 * @param mimeType - MIME type of the file
 */
export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Generate CSV content from zone result values.
 * Handles 1D, 2D, and 3D value arrays.
 *
 * @param result - Zone result with values
 * @returns CSV string content
 */
export function generateZoneCSV(result: ZoneResult): string {
  if (!result.values) return '';

  const values = result.values;

  // Check if it's a 3D array (volume)
  if (Array.isArray(values[0]) && Array.isArray((values[0] as number[][])[0])) {
    // 3D array: each plane separated by blank line
    const values3D = values as number[][][];
    return values3D
      .map(plane => plane.map(row => row.join(',')).join('\n'))
      .join('\n\n');
  }

  // Check if it's a 2D array (plane)
  if (Array.isArray(values[0])) {
    const values2D = values as number[][];
    return values2D.map(row => row.join(',')).join('\n');
  }

  // 1D array (shouldn't happen, but handle gracefully)
  return (values as unknown as number[]).join('\n');
}

/**
 * Export zone data as a CSV file download.
 *
 * @param zone - Zone configuration (for name)
 * @param result - Zone result with values
 */
export function exportZoneCSV(zone: CalcZone, result: ZoneResult): void {
  if (!result.values) return;

  const zoneName = zone.name || zone.id;
  const csv = generateZoneCSV(result);
  downloadFile(csv, `${zoneName}.csv`, 'text/csv');
}
