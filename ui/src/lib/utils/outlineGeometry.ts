/**
 * Three.js geometry builders for an extruded floor outline.
 *
 * Room coordinates (x, y, z) map to Three.js (x, z, -y): Y is up, room Y runs
 * along -Z. All builders take CCW outline vertices in room units.
 */

import * as THREE from 'three';
import type { Vertex } from './roomGeometry';

/** Positions for a floor loop at z1, a ceiling loop at z2, and the verticals. */
export function outlineWireframePositions(vertices: Vertex[], z1: number, z2: number, scale = 1): Float32Array {
  const n = vertices.length;
  const positions: number[] = [];
  for (let i = 0; i < n; i++) {
    const [x1, y1] = vertices[i];
    const [x2, y2] = vertices[(i + 1) % n];
    positions.push(x1 * scale, z1 * scale, -y1 * scale, x2 * scale, z1 * scale, -y2 * scale);
    positions.push(x1 * scale, z2 * scale, -y1 * scale, x2 * scale, z2 * scale, -y2 * scale);
    positions.push(x1 * scale, z1 * scale, -y1 * scale, x1 * scale, z2 * scale, -y1 * scale);
  }
  return new Float32Array(positions);
}

/** LineSegments geometry: floor loop, ceiling loop, verticals. */
export function outlineWireframe(vertices: Vertex[], z1: number, z2: number, scale = 1): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(outlineWireframePositions(vertices, z1, z2, scale), 3));
  geo.computeBoundingSphere();
  return geo;
}

/** One quad per wall between z1 and z2, as a single indexed geometry. */
export function outlineWalls(vertices: Vertex[], z1: number, z2: number, scale = 1): THREE.BufferGeometry {
  const n = vertices.length;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < n; i++) {
    const [x1, y1] = vertices[i];
    const [x2, y2] = vertices[(i + 1) % n];
    const base = positions.length / 3;
    positions.push(
      x1 * scale, z1 * scale, -y1 * scale,
      x2 * scale, z1 * scale, -y2 * scale,
      x2 * scale, z2 * scale, -y2 * scale,
      x1 * scale, z2 * scale, -y1 * scale,
    );
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * A horizontal cap of the outline (floor or ceiling) as a ShapeGeometry in the
 * XY plane. Rotate it by -90° about X to lay it on the floor: (x, y) -> (x, 0, -y).
 * ShapeGeometry triangulates concave outlines correctly.
 */
export function outlineCap(vertices: Vertex[], scale = 1): THREE.ShapeGeometry {
  const shape = new THREE.Shape(vertices.map(([x, y]) => new THREE.Vector2(x * scale, y * scale)));
  return new THREE.ShapeGeometry(shape);
}

/** Edges of an axis-aligned box from (x1, y1, z1) to (x2, y2, z2) in room units. */
export function boxWireframe(
  x1: number, x2: number, y1: number, y2: number, z1: number, z2: number, scale = 1,
): THREE.BufferGeometry {
  return outlineWireframe([[x1, y1], [x2, y1], [x2, y2], [x1, y2]], z1, z2, scale);
}
