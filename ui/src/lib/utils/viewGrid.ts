/**
 * The look of the view grid, rulers and XYZ marker, shared by the 3D scene
 * (Scene, Room3D, RoomAxes) and the 2D plan (PlanCanvas), so the two views
 * cannot drift apart: the same colours per theme, the same spacing, the same
 * fade, the same tick generator and the same axis colours.
 */
import type { Theme } from '$lib/stores/theme';
import { gridCellSize, type LengthUnit } from '$lib/utils/unitConversion';
import { toWall, type WallSegment } from '$lib/utils/surfaces';

// --- Grid -------------------------------------------------------------------

/** A stronger section line every this many cells. */
export const GRID_SECTION_CELLS = 5;
/** Line widths in CSS pixels (the 3D grid's cellThickness / sectionThickness). */
export const GRID_CELL_THICKNESS = 1;
export const GRID_SECTION_THICKNESS = 1.5;
/** The 3D grid shader draws cell-only lines at 75% of a section line's alpha. */
export const GRID_CELL_OPACITY = 0.75;
export const GRID_SECTION_OPACITY = 1;
/** The 2D plan leaves out a line family once its lines sit closer than this on screen. */
export const GRID_MIN_GAP_PX = 4;

export interface GridSpacing {
  cell: number;
  section: number;
}

/** One cell per metre or foot (100 cm, 1000 mm, 12 in), a section every 5 cells. */
export function gridSpacing(units: LengthUnit): GridSpacing {
  const cell = gridCellSize(units);
  return { cell, section: cell * GRID_SECTION_CELLS };
}

export function gridColors(theme: Theme): { cell: string; section: string } {
  return theme === 'light' ? { cell: '#b0b0b0', section: '#909090' } : { cell: '#4a4a6a', section: '#6a6a8a' };
}

/** The grid fades out linearly to nothing this far from the view's centre (the room's longest side, times 5). */
export function gridFadeDistance(maxDim: number): number {
  return maxDim * 5;
}

/** Multiples of `step` from `from` to `to`, rounded so they compare exactly. */
export function gridLineValues(from: number, to: number, step: number): number[] {
  if (!(step > 0) || !(to >= from)) return [];
  const out: number[] = [];
  const start = Math.ceil(from / step - 1e-9);
  const end = Math.floor(to / step + 1e-9);
  // `+ 0` turns -0 into 0
  for (let i = start; i <= end; i++) out.push(Math.round(i * step * 1e6) / 1e6 + 0);
  return out;
}

/** Whether a grid coordinate lies on a section line. */
export function isSectionLine(v: number, spacing: GridSpacing): boolean {
  const k = v / spacing.section;
  return Math.abs(k - Math.round(k)) < 1e-6;
}

/**
 * The plan's grid lines along one axis between `lo` and `hi` (room units),
 * split into cell and section lines. `px` is room units per CSS pixel: a
 * family whose lines would sit closer than GRID_MIN_GAP_PX is left out, as the
 * 3D grid's lines melt together at a distance.
 */
export function planGridLines(lo: number, hi: number, spacing: GridSpacing, px: number): { cells: number[]; sections: number[] } {
  const showSections = spacing.section / px >= GRID_MIN_GAP_PX;
  const showCells = spacing.cell / px >= GRID_MIN_GAP_PX;
  const sections = showSections ? gridLineValues(lo, hi, spacing.section) : [];
  const cells = showCells ? gridLineValues(lo, hi, spacing.cell).filter((v) => !isSectionLine(v, spacing)) : [];
  return { cells, sections };
}

// --- Rulers -----------------------------------------------------------------

/** "Nice" ruler ticks from 0 to `max` (display units): about five steps of 1, 2, 2.5 or 5 times a power of ten. */
export function rulerTicks(max: number): number[] {
  if (!(max > 0)) return [0];
  const niceSteps = [1, 2, 2.5, 5, 10];
  const rawStep = max / 5;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  const niceNorm = niceSteps.find((s) => s >= normalized) ?? 10;
  const step = niceNorm * magnitude;

  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.01; v += step) {
    ticks.push(Math.round(v * 1e6) / 1e6);
  }
  return ticks;
}

/** A tick label at the room's decimal precision. */
export function formatTick(value: number, precision: number): string {
  return value.toFixed(precision);
}

export function rulerColors(theme: Theme): { line: string; text: string } {
  return theme === 'light' ? { line: '#666666', text: '#333333' } : { line: '#888888', text: '#cccccc' };
}

// --- XYZ marker -------------------------------------------------------------

/** Room axis colours: X red, Y blue, Z (up) green, as Three's axes helper draws them in the scene. */
export const AXIS_COLORS = { x: '#ff0000', y: '#0000ff', z: '#00ff00' } as const;
export type RoomAxis = keyof typeof AXIS_COLORS;

/** The marker sits a tenth of the room's longest side outside the origin corner, one grid cell long. */
export function xyzMarker(maxDim: number, units: LengthUnit): { offset: number; length: number } {
  return { offset: maxDim * 0.1, length: gridCellSize(units) };
}

// --- The 2D plan's projections ------------------------------------------------

/** How a 2D canvas maps the room: seen from above (floor, ceiling), or a wall face-on from inside. */
export type PlanProjection = { kind: 'top' } | { kind: 'wall'; seg: WallSegment };

/** A room point to canvas (x, y). A wall view is mirrored: x = wall length - along (see wallToCanvas). */
export function projectToPlan(p: [number, number, number], proj: PlanProjection): [number, number] {
  if (proj.kind === 'top') return [p[0], p[1]];
  const w = toWall(p[0], p[1], p[2], proj.seg);
  return [proj.seg.length - w.along, w.up];
}

export interface PlanAxesMarker {
  origin: [number, number];
  /** Each room axis's tip on the canvas; an axis pointing at the viewer ends where it starts. */
  axes: { axis: RoomAxis; color: string; end: [number, number] }[];
}

/** The 3D XYZ marker as the 2D canvas sees it: the same origin, length and colours, projected. */
export function planAxesMarker(proj: PlanProjection, maxDim: number, units: LengthUnit): PlanAxesMarker {
  const { offset, length } = xyzMarker(maxDim, units);
  const o: [number, number, number] = [-offset, -offset, 0];
  const dirs: Record<RoomAxis, [number, number, number]> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
  return {
    origin: projectToPlan(o, proj),
    axes: (Object.keys(dirs) as RoomAxis[]).map((axis) => {
      const d = dirs[axis];
      return { axis, color: AXIS_COLORS[axis], end: projectToPlan([o[0] + d[0] * length, o[1] + d[1] * length, o[2] + d[2] * length], proj) };
    }),
  };
}

export interface PlanRulers {
  /** Along the canvas's x from 0 (labelled, 0 included). */
  h: { length: number; ticks: number[] };
  /** Along the canvas's y from 0 (0 left out, so the origin is marked once). */
  v: { length: number; ticks: number[] };
}

/**
 * The 3D dimension rulers for a 2D canvas: X and Y seen from above, the wall's
 * length and the room's height on a wall. Lengths in display units.
 */
export function planRulers(proj: PlanProjection, room: { x: number; y: number; z: number }): PlanRulers {
  const [hLen, vLen] = proj.kind === 'top' ? [room.x, room.y] : [proj.seg.length, room.z];
  return {
    h: { length: hLen, ticks: rulerTicks(hLen) },
    v: { length: vLen, ticks: rulerTicks(vLen).filter((t) => t > 0) },
  };
}
