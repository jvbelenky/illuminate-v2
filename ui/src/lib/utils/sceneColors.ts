/**
 * Neutral palette for non-lamp scene geometry (room wireframe, calc zones,
 * obstacles). Lamps own the hue channel — their color encodes wavelength
 * (see wavelengthColor.ts) — so everything else stays slate/grey and signals
 * state through lightness, with sky cyan reserved for one selected object and
 * a fainter cyan for a hovered one.
 * The floor plan uses the same values via --color-scene-wire /
 * --color-scene-selected / --color-scene-item in app.css; keep them in sync.
 */
import type { Theme } from '$lib/stores/theme';

export const DISABLED_COLOR = '#888888';

export function selectedColor(theme: Theme): string {
  return theme === 'light' ? '#0284c7' : '#38bdf8';
}

export function roomWireColor(theme: Theme): string {
  return theme === 'light' ? '#475569' : '#7c8aa0';
}

/** An idle zone, obstacle or ceiling item (--color-scene-item). */
export function sceneItemBaseColor(theme: Theme): string {
  return theme === 'light' ? '#334155' : '#cbd5e1';
}

function mix(a: string, b: string, t: number): string {
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return '#' + [0, 1, 2].map((i) => Math.round(ch(a, i) * t + ch(b, i) * (1 - t)).toString(16).padStart(2, '0')).join('');
}

/** A hovered object: the selection cyan, fainter (drawn toward the idle neutral). */
export function hoverColor(theme: Theme): string {
  return mix(selectedColor(theme), sceneItemBaseColor(theme), 0.6);
}

/**
 * Ceiling layout colours: items in the idle neutral (not the warning amber, not the
 * selection cyan); keep-out areas in the --color-danger token of app.css.
 */
export function ceilingColors(theme: Theme): { point: string; keepOut: string } {
  return theme === 'light' ? { point: sceneItemBaseColor(theme), keepOut: '#dc2626' } : { point: sceneItemBaseColor(theme), keepOut: '#ef4444' };
}

interface StateFlags {
  disabled?: boolean;
  highlighted?: boolean;
  selected?: boolean;
}

/**
 * State color for a zone or obstacle: grey = disabled, cyan = selected, faint
 * cyan = hovered, otherwise `base` (a zone's neutral by default).
 */
export function sceneItemColor(theme: Theme, { disabled, highlighted, selected }: StateFlags, base?: string): string {
  if (disabled) return DISABLED_COLOR;
  if (selected) return selectedColor(theme);
  if (highlighted) return hoverColor(theme);
  return base ?? sceneItemBaseColor(theme);
}
