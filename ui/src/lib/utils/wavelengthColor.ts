/**
 * Wavelength → display color, shared by every view that colors something by
 * wavelength (lamps in the 3D scene / plan / sidebar, efficacy plots).
 *
 * The two central cases are anchored to what the lamps actually look like:
 * KrCl 222 nm lamps glow violet, low-pressure Hg 254 nm lamps glow blue. Other
 * wavelengths interpolate along the ramp, so 230 nm reads "near 222" and 265 nm
 * reads "near 254".
 */
import type { LampType } from '$lib/types/project';

export const WAVELENGTH_ANCHORS: readonly { wl: number; hex: string }[] = [
  { wl: 200, hex: '#ec4899' }, // pink
  { wl: 222, hex: '#a855f7' }, // violet (KrCl)
  { wl: 240, hex: '#6366f1' }, // indigo
  { wl: 254, hex: '#0ea5e9' }, // sky blue (LP Hg)
  { wl: 270, hex: '#14b8a6' }, // teal (UVC LEDs)
  { wl: 285, hex: '#22c55e' }, // green
  { wl: 300, hex: '#eab308' }, // yellow (UV-B)
  { wl: 315, hex: '#f97316' }, // orange
  { wl: 340, hex: '#ef4444' }, // red (UV-A)
];

/** Color for a lamp whose wavelength isn't known (an "other" lamp with none set). */
export const UNKNOWN_WAVELENGTH_COLOR = '#94a3b8';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
}

/** Mix a hex color toward white by `amount` (0–1); used for hover/selected emphasis. */
export function lightenColor(hex: string, amount: number): string {
  return rgbToHex(hexToRgb(hex).map((c) => Math.round(c + (255 - c) * amount)) as [number, number, number]);
}

export function wavelengthToColor(wl: number): string {
  if (!Number.isFinite(wl)) return UNKNOWN_WAVELENGTH_COLOR;
  const stops = WAVELENGTH_ANCHORS;
  if (wl <= stops[0].wl) return stops[0].hex;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (wl === a.wl) return a.hex;
    if (wl < b.wl) {
      const f = (wl - a.wl) / (b.wl - a.wl);
      const c1 = hexToRgb(a.hex);
      const c2 = hexToRgb(b.hex);
      return rgbToHex([0, 1, 2].map((k) => Math.round(c1[k] + (c2[k] - c1[k]) * f)) as [number, number, number]);
    }
  }
  return stops[stops.length - 1].hex;
}

/** The lamp's effective wavelength in nm, or null when an "other" lamp has none. */
export function lampWavelength(lamp: { lamp_type: LampType; wavelength?: number | null }): number | null {
  if (lamp.lamp_type === 'krcl_222') return 222;
  if (lamp.lamp_type === 'lp_254') return 254;
  return lamp.wavelength != null && Number.isFinite(lamp.wavelength) ? lamp.wavelength : null;
}

/**
 * Whether the backend has anything to report for this lamp's info (TLVs,
 * plots). Mirrors the /lamps/{id}/info guard, which 400s a lamp with no
 * wavelength, IES or spectrum.
 */
export function lampHasInfoData(lamp: {
  lamp_type: LampType;
  wavelength?: number | null;
  has_ies_file?: boolean;
  has_spectrum_file?: boolean;
}): boolean {
  return lampWavelength(lamp) != null || !!lamp.has_ies_file || !!lamp.has_spectrum_file;
}

export function lampColor(lamp: { lamp_type: LampType; wavelength?: number | null }): string {
  const wl = lampWavelength(lamp);
  return wl == null ? UNKNOWN_WAVELENGTH_COLOR : wavelengthToColor(wl);
}
