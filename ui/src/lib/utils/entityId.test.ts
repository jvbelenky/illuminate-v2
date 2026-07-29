import { describe, it, expect } from 'vitest';
import { nextEntityId } from './entityId';

describe('nextEntityId', () => {
  it('starts at 1 when nothing exists', () => {
    expect(nextEntityId([], 'zone')).toBe('zone-1');
    expect(nextEntityId([], 'lamp')).toBe('lamp-1');
  });

  it('continues from the highest existing number', () => {
    expect(nextEntityId(['zone-1', 'zone-2'], 'zone')).toBe('zone-3');
  });

  it('does not reuse the ids of deleted entities', () => {
    // zone-2 was deleted. Reusing it would let the new zone inherit the old
    // zone's cached results, so the counter skips past the gap.
    expect(nextEntityId(['zone-1', 'zone-3'], 'zone')).toBe('zone-4');
  });

  it('is unaffected by the order ids are supplied in', () => {
    expect(nextEntityId(['zone-3', 'zone-1', 'zone-2'], 'zone')).toBe('zone-4');
  });

  it('ignores the standard zone ids', () => {
    expect(nextEntityId(['EyeLimits', 'SkinLimits', 'WholeRoomFluence'], 'zone')).toBe('zone-1');
  });

  it('ignores legacy guv-calcs ids loaded from an old .guv file', () => {
    expect(nextEntityId(['CalcPlane', 'CalcPlane-2', 'CalcVol'], 'zone')).toBe('zone-1');
    expect(nextEntityId(['ushio_b1', 'ushio_b1-2'], 'lamp')).toBe('lamp-1');
  });

  it('ignores the other entity kind', () => {
    expect(nextEntityId(['lamp-1', 'lamp-2', 'zone-1'], 'zone')).toBe('zone-2');
    expect(nextEntityId(['lamp-1', 'lamp-2', 'zone-1'], 'lamp')).toBe('lamp-3');
  });

  it('ignores near-miss strings that are not ids of this kind', () => {
    const nearMisses = [
      'zone-',        // no number
      'zone-1a',      // trailing junk
      'zone-1-2',     // guv-calcs two-level increment
      'Zone-1',       // wrong case
      'myzone-9',     // prefix not anchored
      'zone-01a',
    ];
    expect(nextEntityId(nearMisses, 'zone')).toBe('zone-1');
  });

  it('accepts any iterable, not just arrays', () => {
    expect(nextEntityId(new Set(['zone-1', 'zone-2']), 'zone')).toBe('zone-3');
  });
});
