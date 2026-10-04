import { describe, it, expect } from 'vitest';
import type { SceneObject } from '$lib/types/project';
import {
  draftFromObject, draftsFromObjects, draftFromPolygon,
  duplicateDraft, translateVertices, footprintGeometry, diffObstacleDrafts,
} from './obstacleDrafts';

function box(overrides: Partial<SceneObject> = {}): SceneObject {
  return {
    id: 'object-1', name: 'Desk 1', shape: 'box', width: 2, length: 1, height: 0.75,
    x: 3, y: 4, z: 0, yaw: 0, pitch: 0, roll: 0, reflectance: 0.1, transmittance: 0, enabled: true,
    ...overrides,
  };
}

describe('drafts from objects', () => {
  it('carries the world footprint of a box', () => {
    const d = draftFromObject(box());
    expect(d.id).toBe('object-1');
    expect(d.vertices).toEqual([[2, 3.5], [4, 3.5], [4, 4.5], [2, 4.5]]);
    expect(d.sourceShape).toBe('box');
    expect(d.height).toBe(0.75);
  });

  it('numbers new drafts and makes them floor to ceiling', () => {
    const existing = draftsFromObjects([box({ name: 'Obstacle 1' })]);
    const d = draftFromPolygon([[0, 0], [1, 0], [1, 1], [0, 1]], 2.7, existing);
    expect(d.name).toBe('Obstacle 2');
    expect(d.id).toBeNull();
    expect(d.height).toBe(2.7);
    expect(d.reflectance).toBe(0);
  });

  it('duplicates with an offset and a new name', () => {
    const d = draftFromObject(box());
    const copy = duplicateDraft(d, 0.5, [d]);
    expect(copy.id).toBeNull();
    expect(copy.name).toBe('Desk 2');
    expect(copy.vertices[0]).toEqual([2.5, 4]);
  });

  it('translates and rounds', () => {
    expect(translateVertices([[0.1, 0.2]], 0.1, 0.1)).toEqual([[0.2, 0.3]]);
  });
});

describe('footprintGeometry', () => {
  it('re-expresses a world polygon about its centroid', () => {
    const g = footprintGeometry([[2, 3.5], [4, 3.5], [4, 4.5], [2, 4.5]]);
    expect(g.x).toBeCloseTo(3, 6);
    expect(g.y).toBeCloseTo(4, 6);
    expect(g.width).toBeCloseTo(2, 6);
    expect(g.length).toBeCloseTo(1, 6);
    expect(g.yaw).toBe(0);
    expect(g.shape).toBe('extrusion');
    expect(g.vertices?.[0]).toEqual([-1, -0.5]);
  });
});

describe('diffObstacleDrafts', () => {
  it('is empty when nothing changed', () => {
    const o = box();
    const diff = diffObstacleDrafts(draftsFromObjects([o]), [o]);
    expect(diff).toEqual({ adds: [], updates: [], removes: [] });
  });

  it('adds new drafts full height with no tilt', () => {
    const d = draftFromPolygon([[0, 0], [1, 0], [1, 1], [0, 1]], 2.7, []);
    const diff = diffObstacleDrafts([d], []);
    expect(diff.adds).toHaveLength(1);
    expect(diff.adds[0]).toMatchObject({ shape: 'extrusion', name: 'Obstacle 1', z: 0, height: 2.7, pitch: 0, roll: 0, x: 0.5, y: 0.5 });
  });

  it('updates only the properties that changed, without geometry', () => {
    const o = box({ yaw: 30 });
    const d = { ...draftFromObject(o), height: 2.7, name: 'Wall' };
    const diff = diffObstacleDrafts([d], [o]);
    expect(diff.updates).toEqual([{ id: 'object-1', partial: { height: 2.7, name: 'Wall' } }]);
  });

  it('rewrites geometry when the footprint moved, dropping the yaw into the vertices', () => {
    const o = box();
    const d = { ...draftFromObject(o), vertices: translateVertices(draftFromObject(o).vertices, 1, 0) };
    const diff = diffObstacleDrafts([d], [o]);
    expect(diff.updates[0].partial).toMatchObject({ shape: 'extrusion', x: 4, y: 4, yaw: 0 });
    expect(diff.updates[0].partial.vertices).toHaveLength(4);
  });

  it('sends R and T together when either changes', () => {
    const o = box();
    const d = { ...draftFromObject(o), transmittance: 0.3 };
    const diff = diffObstacleDrafts([d], [o]);
    expect(diff.updates[0].partial).toEqual({ reflectance: 0.1, transmittance: 0.3 });
  });

  it('removes objects missing from the drafts', () => {
    const diff = diffObstacleDrafts([], [box(), box({ id: 'object-2' })]);
    expect(diff.removes).toEqual(['object-1', 'object-2']);
  });
});
