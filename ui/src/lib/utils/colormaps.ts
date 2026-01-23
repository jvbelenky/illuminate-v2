/**
 * Colormap implementations for heatmap visualization.
 * Based on matplotlib colormaps.
 */

export type RGB = { r: number; g: number; b: number };

// Colormap data - sampled from matplotlib colormaps at key points
// Each colormap is an array of [position, r, g, b] where position is 0-1
type ColormapData = [number, number, number, number][];

const VIRIDIS: ColormapData = [
  [0.0, 0.267, 0.004, 0.329],
  [0.25, 0.282, 0.140, 0.458],
  [0.5, 0.127, 0.566, 0.551],
  [0.75, 0.369, 0.789, 0.383],
  [1.0, 0.993, 0.906, 0.144]
];

const PLASMA: ColormapData = [
  [0.0, 0.050, 0.030, 0.528],
  [0.25, 0.417, 0.001, 0.658],
  [0.5, 0.798, 0.280, 0.470],
  [0.75, 0.973, 0.580, 0.254],
  [1.0, 0.940, 0.975, 0.131]
];

const MAGMA: ColormapData = [
  [0.0, 0.001, 0.000, 0.014],
  [0.25, 0.270, 0.060, 0.430],
  [0.5, 0.716, 0.215, 0.475],
  [0.75, 0.983, 0.525, 0.380],
  [1.0, 0.987, 0.991, 0.750]
];

const INFERNO: ColormapData = [
  [0.0, 0.001, 0.000, 0.014],
  [0.25, 0.320, 0.060, 0.360],
  [0.5, 0.735, 0.215, 0.330],
  [0.75, 0.988, 0.645, 0.298],
  [1.0, 0.988, 1.000, 0.644]
];

const CIVIDIS: ColormapData = [
  [0.0, 0.000, 0.135, 0.304],
  [0.25, 0.260, 0.310, 0.410],
  [0.5, 0.470, 0.470, 0.450],
  [0.75, 0.720, 0.640, 0.420],
  [1.0, 0.995, 0.910, 0.210]
];

const COLORMAPS: Record<string, ColormapData> = {
  viridis: VIRIDIS,
  plasma: PLASMA,
  magma: MAGMA,
  inferno: INFERNO,
  cividis: CIVIDIS
};

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
  const data = COLORMAPS[baseName] || COLORMAPS.plasma;

  // Reverse t if needed
  const effectiveT = isReversed ? 1 - t : t;

  return interpolateColormap(data, effectiveT);
}

/**
 * Get available colormap names
 */
export function getColormapNames(): string[] {
  const base = Object.keys(COLORMAPS);
  const reversed = base.map(name => `${name}_r`);
  return [...base, ...reversed];
}
