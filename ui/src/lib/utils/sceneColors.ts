/**
 * Neutral palette for non-lamp scene geometry (room wireframe, calc zones,
 * obstacles). Lamps own the hue channel — their color encodes wavelength
 * (see wavelengthColor.ts) — so everything else stays slate/grey and signals
 * state through lightness, with sky cyan reserved for a selected zone/object.
 * The floor plan uses the same values via --color-scene-wire /
 * --color-scene-selected in app.css; keep the two in sync.
 */
import type { Theme } from '$lib/stores/theme';

export const DISABLED_COLOR = '#888888';

export function selectedColor(theme: Theme): string {
  return theme === 'light' ? '#0284c7' : '#38bdf8';
}

export function roomWireColor(theme: Theme): string {
  return theme === 'light' ? '#475569' : '#7c8aa0';
}

/** Ceiling layout colours (the --color-warning and --color-danger tokens in app.css; keep the two in sync). */
export function ceilingColors(theme: Theme): { point: string; keepOut: string } {
  return theme === 'light' ? { point: '#ca8a04', keepOut: '#dc2626' } : { point: '#fbbf24', keepOut: '#ef4444' };
}

interface StateFlags {
  disabled?: boolean;
  highlighted?: boolean;
  selected?: boolean;
}

/**
 * State color for a zone or obstacle: grey = disabled, max-contrast neutral =
 * hovered, cyan = selected, otherwise `base` (a zone's neutral by default).
 */
export function sceneItemColor(theme: Theme, { disabled, highlighted, selected }: StateFlags, base?: string): string {
  if (disabled) return DISABLED_COLOR;
  if (highlighted) return theme === 'light' ? '#020617' : '#ffffff';
  if (selected) return selectedColor(theme);
  return base ?? (theme === 'light' ? '#334155' : '#cbd5e1');
}
