import { describe, it, expect } from 'vitest';


import { computeAuditItems, type AuditInput } from './audit';
import type { CalcZone, RoomConfig } from '$lib/types/project';

const room = { x: 6, y: 4, z: 3, shape: 'rectangle', useStandardZones: false } as RoomConfig;
const input = (zones: CalcZone[], r = room): AuditInput => ({
  room: r,
  zones,
  lamps: [],
  results: null,
  positionWarnings: [],
  needsCalculation: false,
  lampsStale: false,
  roomStale: false,
  stateHashes: { current: null, lastCalculated: null },
});

describe('computeAuditItems wall planes', () => {
  const stranded = { id: 'a', name: 'Shelf', type: 'plane', surface: 'wall:0', wall_vertices: [[0, 0], [5, 0], [5, 1]] } as CalcZone;

  it('lists a plane whose outline leaves its wall', () => {
    const items = computeAuditItems(input([stranded], { ...room, x: 4 }));
    expect(items.some((i) => i.level === 'warning' && i.message.includes('Shelf'))).toBe(true);
  });

  it('does not list a plane that still fits', () => {
    const items = computeAuditItems(input([stranded]));
    expect(items.some((i) => i.message.includes('Shelf'))).toBe(false);
  });
});
