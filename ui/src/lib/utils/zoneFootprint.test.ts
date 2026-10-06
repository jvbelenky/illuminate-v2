import { describe, it, expect } from 'vitest';
import {
  zoneHasFootprint, isAxisRectangle, zoneFootprint, footprintGeometry, roomFootprint,
  fillsRoom, roomFillGeometry, isFloorToCeilingVolume,
} from './zoneFootprint';
import type { CalcZone, RoomConfig } from '$lib/types/project';

const rectRoom = { x: 6, y: 4, shape: 'rectangle', vertices: undefined } as Pick<RoomConfig, 'x' | 'y' | 'shape' | 'vertices'>;
const L: [number, number][] = [[0, 0], [6, 0], [6, 2], [3, 2], [3, 4], [0, 4]];
const lRoom = { x: 6, y: 4, shape: 'polygon', vertices: L } as Pick<RoomConfig, 'x' | 'y' | 'shape' | 'vertices'>;

describe('zone footprints', () => {
  it('only flat planes and volumes have one', () => {
    expect(zoneHasFootprint({ type: 'plane', ref_surface: 'xy' })).toBe(true);
    expect(zoneHasFootprint({ type: 'plane', ref_surface: 'xz' })).toBe(false);
    expect(zoneHasFootprint({ type: 'volume' })).toBe(true);
    expect(zoneHasFootprint({ type: 'point' })).toBe(false);
  });

  it('recognises axis rectangles in any corner order', () => {
    expect(isAxisRectangle([[1, 1], [1, 3], [4, 3], [4, 1]])).toBe(true);
    expect(isAxisRectangle([[0, 0], [4, 0], [3, 3], [0, 3]])).toBe(false);
    expect(isAxisRectangle(L)).toBe(false);
  });

  it('reads a footprint from the outline or the bounds', () => {
    expect(zoneFootprint({ id: 'z', type: 'plane', x1: 3, x2: 1, y1: 0, y2: 2 } as CalcZone)).toEqual([[1, 0], [3, 0], [3, 2], [1, 2]]);
    expect(zoneFootprint({ id: 'z', type: 'volume', vertices: L } as CalcZone)).toEqual(L);
  });

  it('writes bounds plus an outline, and clears the outline for a rectangle', () => {
    const tri: [number, number][] = [[1, 1], [5, 1], [1, 3]];
    expect(footprintGeometry('plane', tri)).toEqual({ x1: 1, x2: 5, y1: 1, y2: 3, vertices: tri });
    const rect = footprintGeometry('volume', [[1, 1], [3, 1], [3, 2], [1, 2]]);
    expect(rect).toEqual({ x_min: 1, x_max: 3, y_min: 1, y_max: 2, vertices: undefined });
    expect('vertices' in rect).toBe(true);
  });

  it('fills a rectangular or polygon room', () => {
    expect(roomFootprint(rectRoom)).toEqual([[0, 0], [6, 0], [6, 4], [0, 4]]);
    const plane = { id: 'z', type: 'plane', ref_surface: 'xy', ...roomFillGeometry('plane', lRoom) } as CalcZone;
    expect(plane.vertices).toEqual(L);
    expect(fillsRoom(plane, lRoom)).toBe(true);
    expect(fillsRoom(plane, rectRoom)).toBe(false);
    const box = { id: 'z', type: 'volume', ...roomFillGeometry('volume', rectRoom) } as CalcZone;
    expect(box.vertices).toBeUndefined();
    expect(fillsRoom(box, rectRoom)).toBe(true);
  });

  it('knows a floor-to-ceiling volume', () => {
    expect(isFloorToCeilingVolume({ id: 'v', type: 'volume', z_min: 0, z_max: 2.7 } as CalcZone, 2.7)).toBe(true);
    expect(isFloorToCeilingVolume({ id: 'v', type: 'volume', z_min: 0.5, z_max: 2.7 } as CalcZone, 2.7)).toBe(false);
  });
});
