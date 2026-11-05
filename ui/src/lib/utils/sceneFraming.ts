/**
 * Camera framing for the 3D room view: the target, distance and preset view
 * positions, all from the outline's own min..max box (not 0..max), so a room
 * drawn away from the origin is centred and sized like one at the origin.
 *
 * Room (x, y, z) maps to Three.js (x, z, -y).
 */

import { polygonBoundingBox, roomVertices, type RoomOutline } from './roomGeometry';

export type FramingView =
  | 'front' | 'back' | 'left' | 'right'
  | 'iso-front-left' | 'iso-front-right' | 'iso-back-left' | 'iso-back-right';

export interface RoomFrame {
  /** Outline extents in room units */
  xMin: number; xMax: number; yMin: number; yMax: number; height: number;
  /** Middle of the outline's box at half height, in Three.js coordinates */
  center: { x: number; y: number; z: number };
  /** The box's longest side (width, length or height) */
  size: number;
  /** Camera distance from the target */
  distance: number;
}

export function roomFrame(room: RoomOutline & { z: number }): RoomFrame {
  const vs = roomVertices(room);
  const bb = vs.length ? polygonBoundingBox(vs) : { xMin: 0, xMax: room.x, yMin: 0, yMax: room.y };
  const size = Math.max(bb.xMax - bb.xMin, bb.yMax - bb.yMin, room.z);
  return {
    ...bb,
    height: room.z,
    center: { x: (bb.xMin + bb.xMax) / 2, y: room.z / 2, z: -(bb.yMin + bb.yMax) / 2 },
    size,
    distance: size * 1.4,
  };
}

/** The opening camera position: up and out past the front-left corner. */
export function defaultCameraPosition(f: RoomFrame): [number, number, number] {
  const d = f.distance;
  return [f.xMin - d * 0.7, d * 0.6, -f.yMin + d * 0.7];
}

/** Camera position for a preset view; the target is always `f.center`. */
export function presetViewPosition(view: FramingView, f: RoomFrame): [number, number, number] {
  const d = f.distance;
  const iso = d * 0.7;
  const isoHeight = d * 0.6;
  const c = f.center;
  // Room front is y min (Three +z side), back is y max
  const front = -f.yMin, back = -f.yMax;
  switch (view) {
    case 'front': return [c.x, c.y, front + d];
    case 'back': return [c.x, c.y, back - d];
    case 'left': return [f.xMin - d, c.y, c.z];
    case 'right': return [f.xMax + d, c.y, c.z];
    case 'iso-front-left': return [f.xMin - iso, isoHeight, front + iso];
    case 'iso-front-right': return [f.xMax + iso, isoHeight, front + iso];
    case 'iso-back-left': return [f.xMin - iso, isoHeight, back - iso];
    case 'iso-back-right': return [f.xMax + iso, isoHeight, back - iso];
  }
}
