import { describe, it, expect } from 'vitest';
import { deepEqual, changedFields, partialChanges, diffEntities, sceneEquals, orderLike, roomPartialFor, type SceneSnapshot } from './sceneDiff';
import type { RoomConfig } from '$lib/types/project';

describe('deepEqual', () => {
  it('treats undefined-valued keys as absent and compares nested data', () => {
    expect(deepEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(deepEqual({ v: [[0, 0], [1, 2]] }, { v: [[0, 0], [1, 2]] })).toBe(true);
    expect(deepEqual({ v: [[0, 0], [1, 2]] }, { v: [[0, 0], [1, 3]] })).toBe(false);
    expect(deepEqual(NaN, NaN)).toBe(true);
  });
  it('compares class instances by identity', () => {
    const f = new File(['x'], 'a.ies');
    expect(deepEqual({ f }, { f })).toBe(true);
    expect(deepEqual({ f }, { f: new File(['x'], 'a.ies') })).toBe(false);
  });
});

describe('changedFields / partialChanges', () => {
  it('returns differing fields, mapping a missing target field to undefined', () => {
    expect(changedFields({ id: 'a', x: 1, y: 2, name: 'n' }, { id: 'a', x: 1, y: 3 } as { id: string; x: number; y: number; name?: string }))
      .toEqual({ y: 3, name: undefined });
  });
  it('detects whether a partial changes anything', () => {
    expect(partialChanges({ x: 1, y: 2 }, { x: 1 })).toBe(false);
    expect(partialChanges({ x: 1, y: 2 }, { x: 4 })).toBe(true);
    expect(partialChanges({ x: 1, show: false }, { show: true }, ['show'])).toBe(false);
    expect(partialChanges(undefined, { x: 1 })).toBe(true);
  });
});

describe('diffEntities', () => {
  it('finds removes, adds and updates by id', () => {
    const d = diffEntities(
      [{ id: 'a', x: 1 }, { id: 'b', x: 2 }],
      [{ id: 'b', x: 5 }, { id: 'c', x: 3 }],
    );
    expect(d.removes).toEqual(['a']);
    expect(d.adds).toEqual([{ id: 'c', x: 3 }]);
    expect(d.updates).toEqual([{ id: 'b', partial: { x: 5 } }]);
  });
});

describe('sceneEquals', () => {
  const room = { x: 4, y: 6, z: 2.7, shape: 'rectangle', showGrid: true } as unknown as RoomConfig;
  const base: SceneSnapshot = { room, lamps: [], zones: [], objects: [], image: null };
  it('ignores view toggles, standard zones and lamp upload state', () => {
    const other: SceneSnapshot = {
      ...base,
      room: { ...room, showGrid: false },
      zones: [{ id: 'WholeRoomFluence', isStandard: true } as never],
    };
    expect(sceneEquals(base, other)).toBe(true);
    const withLamp = { ...base, lamps: [{ id: 'lamp-1', x: 1, has_ies_file: true } as never] };
    const withLamp2 = { ...base, lamps: [{ id: 'lamp-1', x: 1, has_ies_file: false } as never] };
    expect(sceneEquals(withLamp, withLamp2)).toBe(true);
  });
  it('sees outline and image changes', () => {
    expect(sceneEquals(base, { ...base, room: { ...room, z: 3 } })).toBe(false);
    expect(sceneEquals(base, { ...base, image: { id: 'i', mime: 'image/png', src: 'data:' } })).toBe(false);
  });
  it('roomPartialFor skips view keys', () => {
    expect(roomPartialFor(room, { ...room, showGrid: false, z: 3 })).toEqual({ z: 3 });
  });
});

describe('orderLike', () => {
  it('follows the target order with unknown ids last', () => {
    expect(orderLike([{ id: 'c' }, { id: 'x' }, { id: 'a' }], [{ id: 'a' }, { id: 'c' }]).map((e) => e.id)).toEqual(['a', 'c', 'x']);
  });
});
