import { describe, it, expect } from 'vitest';
import {
  allSurfaces, stepSurface, surfaceName, wallIndex, wallSegment, toWall, fromWall,
  wallIdForIndex, wallIndexForId, zoneSurface, parseSurface,
} from './surfaces';
import type { Vertex } from './roomGeometry';

const rect: Vertex[] = [[0, 0], [6, 0], [6, 4], [0, 4]];
const pentagon: Vertex[] = [[0, 0], [6, 0], [6, 4], [3, 6], [0, 4]];

describe('surfaces', () => {
  it('lists floor, ceiling, then the walls', () => {
    expect(allSurfaces(rect)).toEqual(['floor', 'ceiling', 'wall:0', 'wall:1', 'wall:2', 'wall:3']);
  });
  it('steps with wrap-around', () => {
    expect(stepSurface('wall:3', rect, 1)).toBe('floor');
    expect(stepSurface('floor', rect, -1)).toBe('wall:3');
    expect(stepSurface('floor', rect, 1)).toBe('ceiling');
  });
  it('names surfaces', () => {
    expect(surfaceName('wall:0')).toBe('Wall 1');
    expect(surfaceName('floor')).toBe('Floor');
    expect(surfaceName('ceiling')).toBe('Ceiling');
    expect(wallIndex('wall:2')).toBe(2);
    expect(wallIndex('floor')).toBeNull();
  });
  it('parses only valid surfaces', () => {
    expect(parseSurface('wall:3')).toBe('wall:3');
    expect(parseSurface('wall:x')).toBeNull();
    expect(parseSurface(5)).toBeNull();
  });
  it('round-trips wall coordinates on an angled segment', () => {
    const seg = wallSegment([[0, 0], [4, 3], [0, 6]], 0)!;
    expect(seg.length).toBeCloseTo(5);
    const w = toWall(2.5, 1.2, 1.7, seg);
    const p = fromWall(w.along, w.up, w.depth, seg);
    expect(p.x).toBeCloseTo(2.5);
    expect(p.y).toBeCloseTo(1.2);
    expect(p.z).toBeCloseTo(1.7);
  });
  it('has a room-facing normal on a CCW square', () => {
    const seg = wallSegment(rect, 0)!;
    expect(seg.nx).toBeCloseTo(0);
    expect(seg.ny).toBeCloseTo(1);
    const inside = toWall(3, 1, 0, seg);
    expect(inside.depth).toBeCloseTo(1);
    expect(inside.along).toBeCloseTo(3);
  });
  it('maps wall indexes to ids and back', () => {
    expect(wallIdForIndex(rect, 0)).toBe('south');
    expect(wallIdForIndex(pentagon, 0)).toBe('wall_0');
    expect(wallIndexForId(rect, 'east')).toBe(1);
    expect(wallIndexForId(rect, 'nope')).toBeNull();
  });
  it('derives a zone surface', () => {
    expect(zoneSurface({ type: 'plane', surface: 'wall:2' }, 3)).toBe('wall:2');
    expect(zoneSurface({ type: 'plane', ref_surface: 'xy', direction: -1, height: 3 }, 3)).toBe('ceiling');
    expect(zoneSurface({ type: 'plane', ref_surface: 'xy', direction: 1, height: 3 }, 3)).toBe('floor');
    expect(zoneSurface({ type: 'plane', ref_surface: 'xy', direction: -1, height: 1 }, 3)).toBe('floor');
  });
});
