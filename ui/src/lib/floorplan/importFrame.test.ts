import { describe, it, expect } from 'vitest';
import {
  straightenRotation, snapRotation, normalizeDeg, toAligned, fromAligned, pixelToMeters, metersToPixel,
  placementFromFrame, frameFromPlacement, pxPerMeter, alignedBounds, type ImportFrame, type Pt,
} from './importFrame';
import { pixelToRoom } from '$lib/utils/floorplanImage';

describe('straighten', () => {
  it('turns a wall a few degrees off level back to level, by the smallest angle', () => {
    // A wall rising 4 degrees to the right on screen (y down: negative dy)
    const a: Pt = [100, 100];
    const b: Pt = [100 + 200 * Math.cos((4 * Math.PI) / 180), 100 - 200 * Math.sin((4 * Math.PI) / 180)];
    expect(straightenRotation(a, b, 0)).toBeCloseTo(4, 9);
    // Picking the points the other way round gives the same answer
    expect(straightenRotation(b, a, 0)).toBeCloseTo(4, 9);
  });
  it('a nearly upright wall goes upright, not level', () => {
    const r = straightenRotation([0, 0], [10, 200], 0);
    expect(Math.abs(r)).toBeLessThan(45);
    expect(r).toBeCloseTo((Math.atan2(10, 200) * 180) / Math.PI, 9);
  });
  it('is measured on the image, so it works from any current rotation', () => {
    const a: Pt = [0, 0], b: Pt = [100, 5];
    const fromZero = straightenRotation(a, b, 0);
    expect(straightenRotation(a, b, 90)).toBeCloseTo(normalizeDeg(fromZero + 90), 9);
    expect(straightenRotation(a, b, fromZero)).toBeCloseTo(fromZero, 9);
  });
  it('never turns more than 45 degrees', () => {
    for (let g = -180; g <= 180; g += 7) {
      const r = (g * Math.PI) / 180;
      const turn = straightenRotation([0, 0], [Math.cos(r), Math.sin(r)], 0);
      expect(Math.abs(turn)).toBeLessThanOrEqual(45 + 1e-9);
    }
  });
});

describe('rotation helpers', () => {
  it('snaps to a quarter turn within 1.5 degrees', () => {
    expect(snapRotation(89.2)).toBe(90);
    expect(snapRotation(-1.4)).toBe(0);
    expect(snapRotation(2)).toBe(2);
    expect(snapRotation(181)).toBe(180);
  });
  it('normalizes into (-180, 180]', () => {
    expect(normalizeDeg(270)).toBe(-90);
    expect(normalizeDeg(-180)).toBe(180);
    expect(normalizeDeg(45)).toBe(45);
  });
  it('aligned bounds of a quarter-turned image swap width and height', () => {
    const b = alignedBounds({ widthPx: 400, heightPx: 200, rotation: 90, origin: null, pxPerM: null });
    expect(b.width).toBeCloseTo(200, 9);
    expect(b.height).toBeCloseTo(400, 9);
  });
});

describe('pixel <-> room with rotation, origin and scale', () => {
  const frame: ImportFrame = { widthPx: 400, heightPx: 300, rotation: -6, origin: [50, 260], pxPerM: 40 };

  it('the origin is (0, 0); x runs right and y up in the aligned frame', () => {
    const o = pixelToMeters(frame, frame.origin!);
    expect(o[0]).toBeCloseTo(0, 9);
    expect(o[1]).toBeCloseTo(0, 9);
    const oa = toAligned(frame, frame.origin!);
    const right = pixelToMeters(frame, fromAligned(frame, [oa[0] + 80, oa[1]]));
    expect(right[0]).toBeCloseTo(2, 9);
    expect(right[1]).toBeCloseTo(0, 9);
    const up = pixelToMeters(frame, fromAligned(frame, [oa[0], oa[1] - 40]));
    expect(up[0]).toBeCloseTo(0, 9);
    expect(up[1]).toBeCloseTo(1, 9);
  });
  it('round-trips', () => {
    const p: Pt = [123.4, 56.7];
    const back = metersToPixel(frame, pixelToMeters(frame, p));
    expect(back[0]).toBeCloseTo(p[0], 9);
    expect(back[1]).toBeCloseTo(p[1], 9);
  });
  it('the placement it builds maps every pixel to the same room point', () => {
    const placement = placementFromFrame(frame, 'img', 0.6);
    expect(placement.rotation).toBe(-6);
    expect(placement.scale).toBeCloseTo(1 / 40, 12);
    for (const p of [[0, 0], [400, 300], [123, 45], [50, 260]] as Pt[]) {
      const viaFrame = pixelToMeters(frame, p);
      const viaPlacement = pixelToRoom(placement, p[0], p[1]);
      expect(viaPlacement[0]).toBeCloseTo(viaFrame[0], 9);
      expect(viaPlacement[1]).toBeCloseTo(viaFrame[1], 9);
    }
  });
  it('an unrotated frame writes no rotation', () => {
    expect('rotation' in placementFromFrame({ ...frame, rotation: 0 }, 'img', 0.6)).toBe(false);
  });
  it('a placement reopens as the frame it came from', () => {
    const back = frameFromPlacement(placementFromFrame(frame, 'img', 0.6));
    expect(back.rotation).toBe(-6);
    expect(back.pxPerM).toBeCloseTo(40, 9);
    expect(back.origin![0]).toBeCloseTo(50, 9);
    expect(back.origin![1]).toBeCloseTo(260, 9);
  });
  it('scale from two points and a distance', () => {
    expect(pxPerMeter([0, 0], [30, 40], 2)).toBe(25);
    expect(pxPerMeter([0, 0], [0, 0], 2)).toBeNull();
    expect(pxPerMeter([0, 0], [3, 4], 0)).toBeNull();
  });
});
