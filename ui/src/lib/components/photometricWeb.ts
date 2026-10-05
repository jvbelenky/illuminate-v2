import type { LampInstance } from '$lib/types/project';

// Where a lamp's photometric-web mesh data comes from:
//  - 'preset':  a built-in preset id (fetched from the preset endpoint)
//  - 'session': session-uploaded IES (custom lamp / loaded file) — session endpoint
//  - 'none':    no IES data available, so no mesh can be shown
export type PhotometricWebSource = 'preset' | 'session' | 'none';

export function photometricWebSource(lamp: LampInstance): PhotometricWebSource {
  const hasPreset = !!lamp.preset_id && lamp.preset_id !== 'custom';
  if (hasPreset) return 'preset';
  if (lamp.has_ies_file) return 'session';
  return 'none';
}

// Stable cache/fetch key for a lamp's photometric web. Two lamps (or the same
// lamp before/after an edit) produce the same key iff their mesh data is
// identical, so it doubles as the module-level cache key and the refetch
// trigger.
//
// The 'none' sentinel is returned when there is no IES data. Crucially, callers
// must store this sentinel as the last-fetched key when they clear the mesh:
// otherwise, after a lamp regains IES with unchanged source params, the new key
// would still equal the stale pre-clear key and the refetch would be skipped,
// leaving a custom lamp with no photometric web (the round-2 bug).
//
// `custom_lamp_id` is part of the session key so replacing one custom lamp
// definition with another on the same instance (same id + source params, IES
// staying present) still changes the key and triggers a refetch.
export function photometricWebCacheKey(lamp: LampInstance, sessionUnits: string): string {
  const source = photometricWebSource(lamp);
  if (source === 'none') return 'none';

  const density = lamp.source_density ?? 'default';
  const width = lamp.source_width ?? 'default';
  const length = lamp.source_length ?? 'default';

  if (source === 'preset') {
    return `preset-${lamp.preset_id}-${lamp.scaling_factor}-${density}-${width}-${length}-${sessionUnits}`;
  }

  // Session (custom IES) lamps: keyed by lamp id AND the referenced definition
  // so a def swap refetches even when every numeric source param matches.
  const units = lamp.intensity_units ?? 'default';
  const def = lamp.custom_lamp_id ?? 'custom';
  return `session-${lamp.id}-${def}-${lamp.scaling_factor}-${units}-${density}-${width}-${length}-${sessionUnits}-${lamp.photometric_axis ?? 'down'}-${lamp.photometric_depth ?? 0}`;
}

/** Distance from the lamp origin to the farthest web vertex, in the vertices' units. */
export function webLongestSpoke(vertices: number[][]): number {
  let r = 0;
  for (const [x, y, z] of vertices) r = Math.max(r, Math.hypot(x, y, z));
  return r;
}

/** A web this many times the knee is drawn at the full room length. */
const WEB_FULL_SPAN_RATIO = 20;

/**
 * Uniform display factor for a lamp's photometric web in the room view.
 *
 * The API draws the web at one metre of longest spoke per 100 mW of optical
 * power with no ceiling, so a multi-watt 254 nm fixture swallows the room.
 * Up to a knee of half the room's smallest extent the web is drawn as is
 * (every 222 nm preset lands here). Above it the drawn size grows with the
 * log of the spoke, reaching the room's length (its longer horizontal extent)
 * at WEB_FULL_SPAN_RATIO times the knee (about 2.7 W in a 6 x 4 x 2.7 m room)
 * and stopping there. Never scales up. The room and the spoke share one unit.
 */
export function webDisplayScale(longestSpoke: number, room: { x: number; y: number; z: number }): number {
  const knee = 0.5 * Math.min(room.x, room.y, room.z);
  if (!(longestSpoke > 0) || !(knee > 0) || longestSpoke <= knee) return 1;
  const cap = Math.max(room.x, room.y);
  const t = Math.min(1, Math.log(longestSpoke / knee) / Math.log(WEB_FULL_SPAN_RATIO));
  const shown = knee + (cap - knee) * t;
  return Math.min(1, shown / longestSpoke);
}
