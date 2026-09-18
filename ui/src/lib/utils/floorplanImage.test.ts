import { describe, it, expect } from 'vitest';
import {
  pixelToRoom, roomToPixel, initialPlacement, rescaleAboutPoint,
  scaleFromMeasurement, imageRect, DEFAULT_FLOORPLAN_OPACITY,
} from './floorplanImage';
import type { FloorPlanPlacement } from '$lib/types/project';

const base: FloorPlanPlacement = {
  imageId: 'img', widthPx: 200, heightPx: 100, scale: 0.05, offsetX: 1, offsetY: 2, opacity: 0.6,
};

describe('pixel <-> room mapping', () => {
  it('maps the image top-left pixel to the room point above the offset', () => {
    // top-left pixel (0,0) sits at (offsetX, offsetY + heightPx*scale)
    expect(pixelToRoom(base, 0, 0)).toEqual([1, 2 + 100 * 0.05]);
  });
  it('maps the image bottom-left pixel to the offset', () => {
    expect(pixelToRoom(base, 0, 100)).toEqual([1, 2]);
  });
  it('round-trips', () => {
    const [x, y] = pixelToRoom(base, 37, 61);
    const [px, py] = roomToPixel(base, x, y);
    expect(px).toBeCloseTo(37, 9);
    expect(py).toBeCloseTo(61, 9);
  });
});

describe('initialPlacement', () => {
  it('fits the long edge to the room long edge at the origin', () => {
    const p = initialPlacement('id', 400, 100, 6, 4);
    expect(p.scale).toBeCloseTo(6 / 400, 12);
    expect(p.offsetX).toBe(0);
    expect(p.offsetY).toBe(0);
    expect(p.opacity).toBe(DEFAULT_FLOORPLAN_OPACITY);
    expect(p.imageId).toBe('id');
  });
  it('uses the image height when it is the long edge', () => {
    const p = initialPlacement('id', 100, 400, 6, 4);
    expect(p.scale).toBeCloseTo(6 / 400, 12);
  });
});

describe('rescaleAboutPoint', () => {
  it('keeps the anchor fixed in room space', () => {
    const anchor = pixelToRoom(base, 50, 25);
    const next = rescaleAboutPoint(base, anchor, base.scale * 3);
    expect(next.scale).toBeCloseTo(base.scale * 3, 12);
    expect(pixelToRoom(next, 50, 25)[0]).toBeCloseTo(anchor[0], 9);
    expect(pixelToRoom(next, 50, 25)[1]).toBeCloseTo(anchor[1], 9);
  });
});

describe('scaleFromMeasurement', () => {
  it('derives meters per pixel from two room points and a known distance', () => {
    const a = pixelToRoom(base, 0, 50);
    const b = pixelToRoom(base, 100, 50); // 100 px apart
    expect(scaleFromMeasurement(base, a, b, 2.5)).toBeCloseTo(0.025, 12);
  });
  it('returns null for coincident points or a non-positive distance', () => {
    const a = pixelToRoom(base, 10, 10);
    expect(scaleFromMeasurement(base, a, a, 2)).toBeNull();
    const b = pixelToRoom(base, 20, 10);
    expect(scaleFromMeasurement(base, a, b, 0)).toBeNull();
  });
});

describe('imageRect', () => {
  it('returns the rect in display units', () => {
    expect(imageRect(base, 1)).toEqual({ x: 1, y: 2, width: 10, height: 5 });
    const ft = imageRect(base, 2); // k=2 stands in for a unit factor
    expect(ft).toEqual({ x: 2, y: 4, width: 20, height: 10 });
  });
});
