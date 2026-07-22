/**
 * Tests for project type helpers.
 */

import { describe, it, expect } from 'vitest';
import { defaultZone, defaultRoom } from './project';

describe('defaultZone', () => {
  it('honors minutes and seconds overrides for dose time', () => {
    const zone = defaultZone(defaultRoom(), 0, { dose: true, hours: 2, minutes: 30, seconds: 15 });
    expect(zone.hours).toBe(2);
    expect(zone.minutes).toBe(30);
    expect(zone.seconds).toBe(15);
  });

  it('defaults minutes and seconds to 0 when not overridden', () => {
    const zone = defaultZone(defaultRoom(), 0, { dose: true });
    expect(zone.minutes).toBe(0);
    expect(zone.seconds).toBe(0);
  });
});
