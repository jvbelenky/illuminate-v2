import { describe, it, expect } from 'vitest';
import { photometricWebSource, photometricWebCacheKey } from './photometricWeb';
import type { LampInstance } from '$lib/types/project';

function lamp(overrides: Partial<LampInstance>): LampInstance {
  return {
    id: 'lamp-1',
    lamp_type: 'krcl_222',
    x: 1, y: 1, z: 2.5,
    aimx: 1, aimy: 1, aimz: 0,
    scaling_factor: 1,
    enabled: true,
    ...overrides,
  } as LampInstance;
}

describe('photometricWebSource', () => {
  it('returns preset for a built-in preset id', () => {
    expect(photometricWebSource(lamp({ preset_id: 'beacon' }))).toBe('preset');
  });

  it('returns session for a custom lamp with session IES', () => {
    expect(
      photometricWebSource(lamp({ preset_id: 'custom', custom_lamp_id: 'def-1', has_ies_file: true }))
    ).toBe('session');
  });

  it('returns session for a bare loaded IES (no preset, has_ies_file)', () => {
    expect(photometricWebSource(lamp({ preset_id: '', has_ies_file: true }))).toBe('session');
  });

  it('returns none for an unconfigured lamp', () => {
    expect(photometricWebSource(lamp({ preset_id: '', has_ies_file: false }))).toBe('none');
  });
});

describe('photometricWebCacheKey', () => {
  it('returns the "none" sentinel when there is no IES data', () => {
    expect(photometricWebCacheKey(lamp({ preset_id: '', has_ies_file: false }), 'meters')).toBe('none');
  });

  it('the none sentinel differs from any real session key (fixes stale-key suppression)', () => {
    // Regression: a custom lamp whose web was cleared (has_ies_file false) must
    // produce a key ('none') that differs from the key it had while showing a
    // web, so restoring IES with unchanged source params still triggers a fetch.
    const cleared = photometricWebCacheKey(lamp({ preset_id: '', has_ies_file: false }), 'meters');
    const restored = photometricWebCacheKey(
      lamp({ preset_id: 'custom', custom_lamp_id: 'def-1', has_ies_file: true }),
      'meters'
    );
    expect(cleared).toBe('none');
    expect(restored).not.toBe('none');
    expect(restored).not.toBe(cleared);
  });

  it('differs when the referenced custom definition changes (def swap refetches)', () => {
    // Regression: replacing one custom lamp definition with another on the same
    // instance — same id, same source params, IES staying present — must change
    // the key so the mesh refetches instead of showing the previous def's web.
    const a = photometricWebCacheKey(
      lamp({ preset_id: 'custom', custom_lamp_id: 'def-a', has_ies_file: true }),
      'meters'
    );
    const b = photometricWebCacheKey(
      lamp({ preset_id: 'custom', custom_lamp_id: 'def-b', has_ies_file: true }),
      'meters'
    );
    expect(a).not.toBe(b);
  });

  it('is stable for identical preset lamps', () => {
    const k1 = photometricWebCacheKey(lamp({ preset_id: 'beacon' }), 'meters');
    const k2 = photometricWebCacheKey(lamp({ preset_id: 'beacon' }), 'meters');
    expect(k1).toBe(k2);
    expect(k1.startsWith('preset-beacon-')).toBe(true);
  });

  it('changes with session units', () => {
    const m = photometricWebCacheKey(lamp({ preset_id: 'beacon' }), 'meters');
    const f = photometricWebCacheKey(lamp({ preset_id: 'beacon' }), 'feet');
    expect(m).not.toBe(f);
  });
});
