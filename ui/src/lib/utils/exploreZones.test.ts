import { describe, it, expect } from 'vitest';
import { buildExploreZoneOptions, zoneTypeForMedium } from './exploreZones';
import type { CalcZone, ZoneResult } from '$lib/types/project';

function result(id: string, mean: number, extra: Partial<ZoneResult> = {}): ZoneResult {
  return { zone_id: id, zone_type: 'plane', statistics: { mean }, ...extra };
}

describe('buildExploreZoneOptions', () => {
  const zones: CalcZone[] = [
    { id: 'WholeRoomFluence', name: 'Whole Room Fluence', type: 'volume' },
    { id: 'SkinLimits', name: 'Skin Dose (8 Hours)', type: 'plane', dose: true },
    { id: 'EyeLimits', name: 'Eye Dose (8 Hours)', type: 'plane', dose: true },
    { id: 'bench', name: 'Bench', type: 'plane' },
    { id: 'off', name: 'Off', type: 'plane', enabled: false },
  ];

  it('returns nothing without results', () => {
    expect(buildExploreZoneOptions(zones, undefined)).toEqual([]);
  });

  it('includes dose-mode planes, converted back to µW/cm²', () => {
    const opts = buildExploreZoneOptions(zones, {
      WholeRoomFluence: result('WholeRoomFluence', 5),
      SkinLimits: result('SkinLimits', 28.8, { doseAtCalcTime: true, hoursAtCalcTime: 8 }),
      EyeLimits: result('EyeLimits', 10, { doseAtCalcTime: true, hoursAtCalcTime: 8 }),
      bench: result('bench', 2),
      off: result('off', 3),
    });
    expect(opts.map(o => o.id)).toEqual(['WholeRoomFluence', 'SkinLimits', 'bench']);
    // 28.8 mJ/cm² over 8 h = 28.8 / (3.6 * 8) = 1 µW/cm²
    expect(opts[1].meanFluence).toBeCloseTo(1);
    expect(opts[1].zoneType).toBe('plane');
  });

  it('skips zones without a mean', () => {
    expect(buildExploreZoneOptions(zones, { bench: { zone_id: 'bench', zone_type: 'plane', statistics: {} } })).toEqual([]);
  });
});

describe('zoneTypeForMedium', () => {
  it('maps surface to planes and aerosol to volumes', () => {
    expect(zoneTypeForMedium('Surface')).toBe('plane');
    expect(zoneTypeForMedium('Aerosol')).toBe('volume');
    expect(zoneTypeForMedium('Liquid')).toBeUndefined();
  });
});
