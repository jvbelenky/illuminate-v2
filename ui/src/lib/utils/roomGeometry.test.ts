import { describe, it, expect } from 'vitest';
import {
  type Vertex,
  roomVertices,
  isPolygonRoom,
  rectangleVertices,
  polygonArea,
  polygonSignedArea,
  normalizeCCW,
  polygonBoundingBox,
  polygonCentroid,
  polygonEdgeLengths,
  edgeMidpoints,
  edgeInwardNormals,
  vertexInwardDirections,
  isAxisAlignedRectangle,
  wallIdsFor,
  surfaceIdsFor,
  surfaceLabel,
  roomExtents,
  roomFloorArea,
  pointInPolygon,
  nearestBoundaryPoint,
  distanceToBoundary,
  isInsideWithMargin,
  rayToBoundary,
  segmentsIntersect,
  isSimplePolygon,
  validatePolygon,
  isOriginRectangle,
  snapTo,
  angleBetweenDeg,
  snapSegmentDirection,
  scaleOutlineTo,
} from './roomGeometry';

const L_SHAPE: Vertex[] = [[0, 0], [6, 0], [6, 2], [3, 2], [3, 4], [0, 4]];
const RECT: Vertex[] = [[0, 0], [6, 0], [6, 4], [0, 4]];

describe('roomGeometry', () => {
  describe('roomVertices', () => {
    it('expands a rectangle room to its four corners', () => {
      expect(roomVertices({ x: 6, y: 4 })).toEqual(RECT);
      expect(roomVertices({ x: 6, y: 4, shape: 'rectangle' })).toEqual(RECT);
      expect(rectangleVertices(2, 3)).toEqual([[0, 0], [2, 0], [2, 3], [0, 3]]);
    });

    it('returns polygon vertices in CCW order', () => {
      const cw = [...L_SHAPE].reverse();
      expect(roomVertices({ x: 6, y: 4, shape: 'polygon', vertices: cw })).toEqual(L_SHAPE);
    });

    it('falls back to the rectangle when polygon mode has no usable outline', () => {
      expect(isPolygonRoom({ x: 6, y: 4, shape: 'polygon', vertices: [[0, 0]] })).toBe(false);
      expect(roomVertices({ x: 6, y: 4, shape: 'polygon', vertices: [] })).toEqual(RECT);
    });
  });

  describe('measures', () => {
    it('computes area with the shoelace formula', () => {
      expect(polygonArea(RECT)).toBe(24);
      expect(polygonArea(L_SHAPE)).toBe(18);
      expect(polygonSignedArea([...RECT].reverse())).toBe(-24);
    });

    it('normalises winding to CCW', () => {
      expect(normalizeCCW([...RECT].reverse())).toEqual(RECT);
      expect(normalizeCCW(RECT)).toEqual(RECT);
    });

    it('computes bounding box, extents and centroid', () => {
      expect(polygonBoundingBox(L_SHAPE)).toEqual({ xMin: 0, yMin: 0, xMax: 6, yMax: 4 });
      expect(roomExtents(L_SHAPE)).toEqual({ x: 6, y: 4 });
      const [cx, cy] = polygonCentroid(L_SHAPE);
      // Centroid of the L: weighted mean of the 6x2 and 3x2 blocks
      expect(cx).toBeCloseTo((12 * 3 + 6 * 1.5) / 18, 9);
      expect(cy).toBeCloseTo((12 * 1 + 6 * 3) / 18, 9);
      expect(polygonCentroid(RECT)).toEqual([3, 2]);
    });

    it('computes edge lengths, midpoints and inward normals', () => {
      expect(polygonEdgeLengths(RECT)).toEqual([6, 4, 6, 4]);
      expect(edgeMidpoints(RECT)).toEqual([[3, 0], [6, 2], [3, 4], [0, 2]]);
      const normals = edgeInwardNormals(RECT);
      expect(normals[0]).toEqual([-0, 1]);   // south edge points +y
      expect(normals[1]).toEqual([-1, 0]);   // east edge points -x
      expect(normals[2][1]).toBe(-1);        // north edge points -y
      expect(normals[3][0]).toBe(1);         // west edge points +x
    });

    it('points inward at each vertex', () => {
      const dirs = vertexInwardDirections(RECT);
      const s = Math.SQRT1_2;
      expect(dirs[0][0]).toBeCloseTo(s); expect(dirs[0][1]).toBeCloseTo(s);
      expect(dirs[2][0]).toBeCloseTo(-s); expect(dirs[2][1]).toBeCloseTo(-s);
      // Reflex corner of the L at (3, 2) points away from the notch
      const reflex = vertexInwardDirections(L_SHAPE)[3];
      expect(reflex[0]).toBeCloseTo(-s); expect(reflex[1]).toBeCloseTo(-s);
    });

    it('computes floor area for both shapes', () => {
      expect(roomFloorArea({ x: 6, y: 4 })).toBe(24);
      expect(roomFloorArea({ x: 6, y: 4, shape: 'polygon', vertices: L_SHAPE })).toBe(18);
    });
  });

  describe('naming', () => {
    it('detects axis-aligned rectangles', () => {
      expect(isAxisAlignedRectangle(RECT)).toBe(true);
      expect(isAxisAlignedRectangle([[1, 1], [5, 1], [5, 3], [1, 3]])).toBe(true);
      expect(isAxisAlignedRectangle([[0, 0], [4, 1], [4, 3], [0, 3]])).toBe(false);
      expect(isAxisAlignedRectangle(L_SHAPE)).toBe(false);
    });

    it('names walls like guv_calcs', () => {
      expect(wallIdsFor(RECT)).toEqual(['south', 'east', 'north', 'west']);
      expect(wallIdsFor(L_SHAPE)).toEqual(['wall_0', 'wall_1', 'wall_2', 'wall_3', 'wall_4', 'wall_5']);
      expect(surfaceIdsFor({ x: 6, y: 4 })).toEqual(['floor', 'ceiling', 'south', 'east', 'north', 'west']);
      expect(surfaceIdsFor({ x: 6, y: 4, shape: 'polygon', vertices: L_SHAPE })).toHaveLength(8);
    });

    it('labels surfaces', () => {
      expect(surfaceLabel('floor')).toBe('Floor');
      expect(surfaceLabel('south')).toBe('South');
      expect(surfaceLabel('wall_0')).toBe('Wall 1');
      expect(surfaceLabel('wall_11')).toBe('Wall 12');
    });
  });

  describe('containment', () => {
    it('point-in-polygon handles concave outlines', () => {
      expect(pointInPolygon(L_SHAPE, 1, 1)).toBe(true);
      expect(pointInPolygon(L_SHAPE, 5, 1)).toBe(true);
      expect(pointInPolygon(L_SHAPE, 5, 3)).toBe(false); // in the notch
      expect(pointInPolygon(L_SHAPE, 7, 1)).toBe(false);
      expect(pointInPolygon(L_SHAPE, 1, 3)).toBe(true);
    });

    it('finds the nearest boundary point and distance', () => {
      expect(nearestBoundaryPoint(RECT, 1, 2)).toEqual([0, 2]);
      expect(distanceToBoundary(RECT, 1, 2)).toBe(1);
      expect(nearestBoundaryPoint(L_SHAPE, 5, 3)).toEqual([5, 2]); // point in the notch
    });

    it('checks inside-with-margin', () => {
      expect(isInsideWithMargin(RECT, 0.05, 2, 0.1)).toBe(false);
      expect(isInsideWithMargin(RECT, 0.15, 2, 0.1)).toBe(true);
      expect(isInsideWithMargin(RECT, 0, 2, 0)).toBe(true); // boundary allowed when margin is 0
    });

    it('casts a ray to the far boundary', () => {
      expect(rayToBoundary(RECT, [3, 0.1], [0, 1])).toEqual([3, 4]);
      expect(rayToBoundary(RECT, [0.1, 2], [1, 0])).toEqual([6, 2]);
      // From the reflex corner region of the L, heading +y hits the notch edge
      const hit = rayToBoundary(L_SHAPE, [4, 1], [0, 1]);
      expect(hit).toEqual([4, 2]);
      expect(rayToBoundary(RECT, [3, 2], [0, 0])).toBeNull();
    });
  });

  describe('validation', () => {
    it('detects crossing segments', () => {
      expect(segmentsIntersect([0, 0], [2, 2], [0, 2], [2, 0])).toBe(true);
      expect(segmentsIntersect([0, 0], [1, 0], [2, 0], [3, 0])).toBe(false);
      expect(segmentsIntersect([0, 0], [1, 1], [1, 1], [2, 0])).toBe(false); // touching endpoints
    });

    it('detects simple polygons', () => {
      expect(isSimplePolygon(RECT)).toBe(true);
      expect(isSimplePolygon(L_SHAPE)).toBe(true);
      expect(isSimplePolygon([[0, 0], [2, 2], [2, 0], [0, 2]])).toBe(false); // bowtie
      expect(isSimplePolygon([[0, 0], [1, 0], [0, 1]])).toBe(true);
    });

    it('validates outlines with user-facing reasons', () => {
      expect(validatePolygon(RECT)).toBeNull();
      expect(validatePolygon(L_SHAPE)).toBeNull();
      expect(validatePolygon([[0, 0], [1, 0]])).toMatch(/at least 3/);
      expect(validatePolygon([[0, 0], [1, 0], [1, 0], [0, 1]])).toMatch(/coincide/);
      expect(validatePolygon([[0, 0], [2, 2], [2, 0], [0, 2]])).toMatch(/cross/);
      expect(validatePolygon([[0, 0], [1, 1], [2, 2]])).toMatch(/non-zero area/);
      expect(validatePolygon([[-1, 0], [1, 0], [1, 1]])).toMatch(/>= 0/);
      expect(validatePolygon([[NaN, 0], [1, 0], [1, 1]])).toMatch(/finite/);
    });
  });
});

describe('rectangle detection and presets', () => {
  it('recognises only origin-anchored axis-aligned rectangles', () => {
    expect(isOriginRectangle([[0, 0], [6, 0], [6, 4], [0, 4]])).toBe(true);
    expect(isOriginRectangle([[6, 4], [0, 4], [0, 0], [6, 0]])).toBe(true);
    expect(isOriginRectangle([[1, 1], [5, 1], [5, 3], [1, 3]])).toBe(false);
    expect(isOriginRectangle([[0, 0], [6, 0], [6, 2], [3, 2], [3, 4], [0, 4]])).toBe(false);
  });

  it('snaps to a step', () => {
    expect(snapTo(1.26, 0.1)).toBe(1.3);
    expect(snapTo(1.26, 0.25)).toBe(1.25);
    expect(snapTo(1.26, 0)).toBe(1.26);
  });

  it('measures the angle between vectors', () => {
    expect(angleBetweenDeg([1, 0], [0, 1])).toBeCloseTo(90);
    expect(angleBetweenDeg([1, 0], [-1, 0])).toBeCloseTo(180);
    expect(angleBetweenDeg([1, 0], [1, 1])).toBeCloseTo(45);
    expect(angleBetweenDeg([0, 0], [1, 1])).toBe(0);
  });

  it('snaps a segment to 45° multiples relative to the previous wall', () => {
    // Previous wall runs along +x; a nearly-vertical segment snaps to exactly 90°
    const r = snapSegmentDirection([2, 0], [2.1, 3], [1, 0], { stepDeg: 45, toleranceDeg: 5 });
    expect(r.snapped).toBe(true);
    expect(r.point[0]).toBeCloseTo(2, 6);
    expect(r.point[1]).toBeCloseTo(Math.hypot(0.1, 3), 6);
    // Outside the tolerance: untouched
    const free = snapSegmentDirection([2, 0], [3, 2], [1, 0], { stepDeg: 45, toleranceDeg: 5 });
    expect(free.snapped).toBe(false);
    expect(free.point).toEqual([3, 2]);
    // Forced: nearest multiple even when far away (63° -> 45°)
    const forced = snapSegmentDirection([0, 0], [1, 2], [1, 0], { stepDeg: 45, toleranceDeg: 5, force: true });
    expect(forced.snapped).toBe(true);
    expect(angleBetweenDeg([1, 0], forced.point)).toBeCloseTo(45, 6);
    // Reference wall at 45°: a perpendicular follows it, not the axes
    const diag = snapSegmentDirection([1, 1], [0, 2.05], [1, 1], { stepDeg: 45, toleranceDeg: 5 });
    expect(diag.snapped).toBe(true);
    expect(angleBetweenDeg([1, 1], [diag.point[0] - 1, diag.point[1] - 1])).toBeCloseTo(90, 5);
  });
});

describe('scaleOutlineTo', () => {
  it('stretches each axis independently about the origin', () => {
    const l: Vertex[] = [[0, 0], [6, 0], [6, 2], [3, 2], [3, 4], [0, 4]];
    expect(scaleOutlineTo(l, 12)).toEqual([[0, 0], [12, 0], [12, 2], [6, 2], [6, 4], [0, 4]]);
    expect(scaleOutlineTo(l, undefined, 2)).toEqual([[0, 0], [6, 0], [6, 1], [3, 1], [3, 2], [0, 2]]);
    expect(scaleOutlineTo(l, 3, 8)).toEqual([[0, 0], [3, 0], [3, 4], [1.5, 4], [1.5, 8], [0, 8]]);
    expect(scaleOutlineTo(l)).toEqual(l);
  });
});
