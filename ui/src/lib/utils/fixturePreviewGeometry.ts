/**
 * Geometry helpers for the lamp fixture 3D preview.
 *
 * guv_calcs describes a lamp in a local frame where +X runs along the fixture's
 * *length*, +Y runs along its *width*, and +Z points away from the aim direction
 * (see `LampGeometry.get_bounding_box_corners` and `LampSurface._generate_raw_points`).
 * Three.js is Y-up, so the preview re-maps those axes.
 */

/** Convert a lamp-local `[x, y, z]` point to Three.js world coordinates. */
export function lampLocalToThree([x, y, z]: number[]): [number, number, number] {
  return [x, z, -y];
}

/**
 * `PlaneGeometry` args for the luminous opening.
 *
 * The plane is rotated by -90 degrees about X, which sends its local X to
 * Three.js X and its local Y to Three.js -Z. Returned as
 * `[extentAlongThreeX, extentAlongThreeZ]`.
 */
export function luminousOpeningPlaneArgs(
  sourceWidth: number,
  sourceLength: number
): [number, number] {
  // Length runs along lamp-local X (-> Three.js X); width along lamp-local Y
  // (-> Three.js -Z). Passing them in the other order rotates the opening 90
  // degrees away from the fixture wireframe.
  return [sourceLength, sourceWidth];
}
