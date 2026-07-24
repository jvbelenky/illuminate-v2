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
  return `session-${lamp.id}-${def}-${lamp.scaling_factor}-${units}-${density}-${width}-${length}-${sessionUnits}`;
}
