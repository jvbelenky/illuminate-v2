/**
 * Picking room surfaces in the 3D view: which surfaces lie under the cursor,
 * in the order clicks cycle through them, and whether a click goes to an item
 * or to a surface.
 */
import type { Surface } from '$lib/utils/surfaces';
import type { PlanContext } from '$lib/workspace/editorNav';

export interface SurfaceHit {
  surface: Surface;
  /** Distance from the camera along the ray. */
  distance: number;
  /** True when the ray leaves the room through it, so its inside faces the camera. */
  facesCamera: boolean;
}

/**
 * Surfaces under the cursor in the order clicks cycle through them, as in
 * ReflectancePreview3D's candidatesAt: the floor and far walls (seen from
 * inside) nearest first, then the ceiling, then the near walls the ray entered
 * through. The room encloses everything, so the nearest hit alone would
 * always be a near wall.
 */
export function orderSurfaceHits(hits: SurfaceHit[]): Surface[] {
  const byDistance = [...hits].sort((a, b) => a.distance - b.distance);
  const far = byDistance.filter((h) => h.surface !== 'ceiling' && h.facesCamera);
  const ceiling = byDistance.filter((h) => h.surface === 'ceiling');
  const near = byDistance.filter((h) => h.surface !== 'ceiling' && !h.facesCamera);
  const ordered = [...far, ...ceiling, ...near].map((h) => h.surface);
  return ordered.filter((s, i) => ordered.indexOf(s) === i);
}

/** The surface a click picks: the one after `current` when it is under the cursor (wrapping), else the first. */
export function nextSurface(order: Surface[], current: Surface | null): Surface | null {
  if (order.length === 0) return null;
  const i = current ? order.indexOf(current) : -1;
  return i < 0 ? order[0] : order[(i + 1) % order.length];
}

export type ClickItemType = 'lamp' | 'zone' | 'object';
export interface ClickItem { type: ClickItemType; id: string }

/** What lies under the pointer in 3D: items, and surfaces in click order, at client coordinates. */
export interface SceneHover { items: ClickItem[]; surfaces: Surface[]; x: number; y: number }

/** The kind of item a 3D click selects in each editor context. */
const CONTEXT_ITEM: Partial<Record<PlanContext, ClickItemType>> = {
  lamps: 'lamp',
  zones: 'zone',
  obstacles: 'object',
};

export type ClickTarget<T extends ClickItem> =
  | { kind: 'items'; items: T[] }
  | { kind: 'surface'; order: Surface[] };

/**
 * What a 3D click acts on. Items of the context's kind (lamps in Lamps,
 * structures in Structures, zones in Zones) win; otherwise the surfaces under
 * the cursor. `context` null (outside the editor) acts on nothing.
 */
export function chooseClickTarget<T extends ClickItem>(items: T[], surfaces: Surface[], context: PlanContext | null): ClickTarget<T> | null {
  if (context === null) return null;
  const type = CONTEXT_ITEM[context];
  const fitting = type ? items.filter((t) => t.type === type) : [];
  if (fitting.length > 0) return { kind: 'items', items: fitting };
  if (surfaces.length > 0) return { kind: 'surface', order: surfaces };
  return null;
}
