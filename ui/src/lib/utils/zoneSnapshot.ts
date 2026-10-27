/**
 * A zone's dimensions at calculation time, so the 3D view can hide values a
 * later edit made stale.
 */
import type { CalcZone, ZoneDimensionSnapshot } from '$lib/types/project';

export function snapshotDimensions(zone: CalcZone): ZoneDimensionSnapshot {
  if (zone.type === 'volume') {
    return {
      x_min: zone.x_min, x_max: zone.x_max,
      y_min: zone.y_min, y_max: zone.y_max,
      z_min: zone.z_min, z_max: zone.z_max,
      num_x: zone.num_x, num_y: zone.num_y, num_z: zone.num_z,
    };
  }
  if (zone.type === 'point') {
    return {
      x: zone.x, y: zone.y, z: zone.z,
      aim_x: zone.aim_x, aim_y: zone.aim_y, aim_z: zone.aim_z,
      calc_mode: zone.calc_mode,
      horiz: zone.horiz,
      vert: zone.vert,
      use_normal: zone.use_normal,
      fov_vert: zone.fov_vert,
      fov_horiz: zone.fov_horiz,
    };
  }
  return {
    x1: zone.x1, x2: zone.x2,
    y1: zone.y1, y2: zone.y2,
    height: zone.height,
    ref_surface: zone.ref_surface,
    direction: zone.direction,
    num_x: zone.num_x, num_y: zone.num_y,
    calc_mode: zone.calc_mode,
    horiz: zone.horiz,
    vert: zone.vert,
    use_normal: zone.use_normal,
    fov_vert: zone.fov_vert,
    fov_horiz: zone.fov_horiz,
    view_direction: zone.view_direction,
    view_target: zone.view_target,
    // Where the plane lies: a wall plane's wall, offset, facing and outline
    surface: zone.surface,
    normal_offset: zone.normal_offset,
    flip: zone.flip,
    wall_vertices: zone.wall_vertices?.map(([a, u]) => [a, u] as [number, number]),
  };
}

function arraysEqual(a?: number[], b?: number[]): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function outlinesEqual(a?: [number, number][], b?: [number, number][]): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((p, i) => arraysEqual(p, b[i]));
}

/** Whether a zone's current dimensions match the snapshot from calculation time (no snapshot: a legacy result, shown). */
export function dimensionsMatch(zone: CalcZone, snapshot?: ZoneDimensionSnapshot): boolean {
  if (!snapshot) return true;
  if (zone.type === 'volume') {
    return zone.x_min === snapshot.x_min && zone.x_max === snapshot.x_max
      && zone.y_min === snapshot.y_min && zone.y_max === snapshot.y_max
      && zone.z_min === snapshot.z_min && zone.z_max === snapshot.z_max
      && zone.num_x === snapshot.num_x && zone.num_y === snapshot.num_y
      && zone.num_z === snapshot.num_z;
  }
  if (zone.type === 'point') {
    return zone.x === snapshot.x && zone.y === snapshot.y && zone.z === snapshot.z
      && zone.aim_x === snapshot.aim_x && zone.aim_y === snapshot.aim_y
      && zone.aim_z === snapshot.aim_z
      && zone.calc_mode === snapshot.calc_mode;
  }
  return zone.x1 === snapshot.x1 && zone.x2 === snapshot.x2
    && zone.y1 === snapshot.y1 && zone.y2 === snapshot.y2
    && zone.height === snapshot.height && zone.ref_surface === snapshot.ref_surface
    && zone.direction === snapshot.direction
    && zone.num_x === snapshot.num_x && zone.num_y === snapshot.num_y
    && zone.calc_mode === snapshot.calc_mode
    && zone.fov_vert === snapshot.fov_vert && zone.fov_horiz === snapshot.fov_horiz
    && arraysEqual(zone.view_direction, snapshot.view_direction)
    && arraysEqual(zone.view_target, snapshot.view_target)
    && zone.surface === snapshot.surface
    && zone.normal_offset === snapshot.normal_offset
    && zone.flip === snapshot.flip
    && outlinesEqual(zone.wall_vertices, snapshot.wall_vertices);
}
