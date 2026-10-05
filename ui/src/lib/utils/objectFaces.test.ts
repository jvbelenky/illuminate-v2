import { describe, it, expect } from 'vitest';
import type { SceneObject } from '$lib/types/project';
import {
  objectFaceIds, faceLabel, planeKey, parsePlaneKey, faceOptics, withFaceOptics,
  overridesWithReflectance, overridesWithTransmittance, absorbance, commonTransmittance,
  faceSpans, faceNumPoints, faceSpacing, commonReflectance,
} from './objectFaces';

function box(overrides: Partial<SceneObject> = {}): SceneObject {
  return {
    id: 'object-1', shape: 'box', width: 2, length: 1, height: 0.5,
    x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0,
    reflectance: 0.1, transmittance: 0, enabled: true,
    ...overrides,
  };
}

describe('objectFaceIds', () => {
  it('lists bottom, top and four sides for a box, in guv_calcs order', () => {
    expect(objectFaceIds(box())).toEqual(['bottom', 'top', 'wall_0', 'wall_1', 'wall_2', 'wall_3']);
  });

  it('lists one side per footprint edge for an extrusion', () => {
    const l = box({ shape: 'extrusion', vertices: [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]] });
    expect(objectFaceIds(l)).toHaveLength(8);
  });
});

describe('faceLabel and plane keys', () => {
  it('labels faces for people', () => {
    expect(faceLabel('bottom')).toBe('Bottom');
    expect(faceLabel('wall_2')).toBe('Side 3');
  });

  it('round-trips a plane key', () => {
    expect(parsePlaneKey(planeKey('object-1', 'wall_0'))).toEqual({ objectId: 'object-1', faceId: 'wall_0' });
    expect(parsePlaneKey('floor')).toBeNull();
  });
});

describe('face optics', () => {
  it('falls back to the object-level pair', () => {
    expect(faceOptics(box(), 'top')).toEqual({ R: 0.1, T: 0 });
    expect(faceOptics(box({ face_properties: { top: { R: 0.5, T: 0.2 } } }), 'top')).toEqual({ R: 0.5, T: 0.2 });
  });

  it('keeps overrides sparse: a face set back to the baseline is dropped', () => {
    const baseline = { R: 0.1, T: 0 };
    const withTop = withFaceOptics(undefined, baseline, 'top', { R: 0.5, T: 0 });
    expect(withTop).toEqual({ top: { R: 0.5, T: 0 } });
    expect(withFaceOptics(withTop, baseline, 'top', { R: 0.1, T: 0 })).toEqual({});
  });

  it('rebases overrides onto a new reflectance while keeping each face T', () => {
    const obj = box({ transmittance: 0, face_properties: { top: { R: 0.5, T: 0 }, wall_0: { R: 0.1, T: 0.6 } } });
    // top differed only in R → now equals the baseline and is dropped;
    // wall_0 keeps its own T, so it stays as an override with the new R.
    expect(overridesWithReflectance(obj, 0.3)).toEqual({ wall_0: { R: 0.3, T: 0.6 } });
  });
});

describe('transmittance helpers', () => {
  it('rebases overrides onto a new transmittance while keeping each face R', () => {
    const obj = box({ reflectance: 0.1, transmittance: 0, face_properties: { top: { R: 0.1, T: 0.5 }, wall_0: { R: 0.4, T: 0 } } });
    expect(overridesWithTransmittance(obj, 0.2)).toEqual({ wall_0: { R: 0.4, T: 0.2 } });
  });

  it('absorbance is what is left, clamped to 0..1', () => {
    expect(absorbance({ R: 0.1, T: 0.2 })).toBeCloseTo(0.7);
    expect(absorbance({ R: 0.6, T: 0.6 })).toBe(0);
  });

  it('commonTransmittance spans objects and their overrides, null with none', () => {
    expect(commonTransmittance([])).toBeNull();
    expect(commonTransmittance([box(), box({ id: 'b' })])).toBe(0);
    expect(commonTransmittance([box({ face_properties: { top: { R: 0.1, T: 0.3 } } })])).toBeNull();
  });
});

describe('face grids', () => {
  it('spans the footprint bounding box for top/bottom and edge x height for sides', () => {
    expect(faceSpans(box(), 'top')).toEqual({ x: 2, y: 1 });
    expect(faceSpans(box(), 'wall_0')).toEqual({ x: 2, y: 0.5 });
    expect(faceSpans(box(), 'wall_1')).toEqual({ x: 1, y: 0.5 });
  });

  it('defaults to a 5x5 grid and derives spacing from spans', () => {
    expect(faceNumPoints(box(), 'top')).toEqual({ x: 5, y: 5 });
    expect(faceSpacing(box(), 'top')).toEqual({ x: 0.4, y: 0.2 });
    expect(faceSpacing(box({ face_spacings: { top: { x: 0.1, y: 0.1 } } }), 'top')).toEqual({ x: 0.1, y: 0.1 });
  });
});

describe('commonReflectance', () => {
  const room = { reflectances: { floor: 0.1, ceiling: 0.1, north: 0.1 } };

  it('is the shared value when every plane agrees', () => {
    expect(commonReflectance(room, [box()])).toBe(0.1);
  });

  it('is null when any room surface, object or face override differs', () => {
    expect(commonReflectance({ reflectances: { ...room.reflectances, north: 0.2 } }, [])).toBeNull();
    expect(commonReflectance(room, [box({ reflectance: 0.3 })])).toBeNull();
    expect(commonReflectance(room, [box({ face_properties: { top: { R: 0.5, T: 0 } } })])).toBeNull();
  });

  it('ignores transmittance', () => {
    expect(commonReflectance(room, [box({ face_properties: { top: { R: 0.1, T: 0.5 } } })])).toBe(0.1);
  });
});
