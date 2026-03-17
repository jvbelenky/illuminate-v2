/**
 * Colormap implementations for heatmap visualization.
 * Based on matplotlib colormaps.
 */

import { COLORMAP_DATA, COLORMAP_CATEGORIES } from './colormapData';
import type { ColormapData } from './colormapData';

export type RGB = { r: number; g: number; b: number };

export { COLORMAP_CATEGORIES };
export type { ColormapData };

/**
 * Interpolate between colormap stops
 */
function interpolateColormap(data: ColormapData, t: number): RGB {
  // Clamp t to [0, 1]
  t = Math.max(0, Math.min(1, t));

  // Find the two stops to interpolate between
  let lower = data[0];
  let upper = data[data.length - 1];

  for (let i = 0; i < data.length - 1; i++) {
    if (t >= data[i][0] && t <= data[i + 1][0]) {
      lower = data[i];
      upper = data[i + 1];
      break;
    }
  }

  // Interpolate
  const range = upper[0] - lower[0];
  const s = range > 0 ? (t - lower[0]) / range : 0;

  return {
    r: lower[1] + s * (upper[1] - lower[1]),
    g: lower[2] + s * (upper[2] - lower[2]),
    b: lower[3] + s * (upper[3] - lower[3])
  };
}

/**
 * Get color for a normalized value (0-1) using the specified colormap.
 * @param t - Normalized value between 0 and 1
 * @param colormap - Colormap name (e.g., 'plasma', 'viridis')
 * @returns RGB color with values 0-1
 */
export function valueToColor(t: number, colormap: string = 'plasma'): RGB {
  // Check for reversed colormap
  const isReversed = colormap.endsWith('_r');
  const baseName = isReversed ? colormap.slice(0, -2) : colormap;

  // Get colormap data, fallback to plasma
  const data = COLORMAP_DATA[baseName] || COLORMAP_DATA.plasma;

  // Reverse t if needed
  const effectiveT = isReversed ? 1 - t : t;

  return interpolateColormap(data, effectiveT);
}

/**
 * Get a hex color for isosurface index `i` out of `count` surfaces.
 * Uses even spacing across the colormap so all components show identical colors.
 */
export function isoColorHex(i: number, count: number, colormap: string = 'plasma'): string {
  const t = count <= 1 ? 0.5 : i / (count - 1);
  const c = valueToColor(t, colormap);
  const r = Math.round(c.r * 255).toString(16).padStart(2, '0');
  const g = Math.round(c.g * 255).toString(16).padStart(2, '0');
  const b = Math.round(c.b * 255).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

/**
 * Get available base colormap names (without _r variants)
 */
export function getColormapNames(): string[] {
  return Object.keys(COLORMAP_DATA);
}
