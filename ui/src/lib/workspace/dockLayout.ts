/**
 * Dock layout model: which panels sit in the left and right columns, which
 * are minimized, which view fills the main area, and any column width the
 * user dragged. Pure functions only.
 */

export type DockPanelId = 'editor' | 'results' | 'mini' | 'calculate';
export type DockColumn = 'left' | 'right';
export type MainView = '2d' | '3d';

export interface DockLayout {
  left: DockPanelId[];
  right: DockPanelId[];
  minimized: DockPanelId[];
  main: MainView;
  /** Widths the user dragged, per column; a column without one follows its panels. */
  widths?: Partial<Record<DockColumn, number>>;
  /** Where the mini view floats (px from the workspace's top left); it is then in neither column. */
  float?: FloatBox | null;
}

export interface FloatBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AreaSize {
  width: number;
  height: number;
}

/** A floating mini view's default size (its docked 4:3 size) and smallest size (px). */
export const FLOAT_DEFAULT = { w: 300, h: 225 };
export const FLOAT_MIN = { w: 200, h: 150 };

/** How narrow and wide a column can be dragged (px). */
export const COLUMN_LIMITS: Record<DockColumn, { min: number; max: number }> = {
  left: { min: 320, max: 550 },
  right: { min: 260, max: 600 },
};

const COLUMNS: DockColumn[] = ['left', 'right'];

const PANEL_IDS: DockPanelId[] = ['editor', 'results', 'mini', 'calculate'];

export const DEFAULT_DOCK: DockLayout = {
  left: ['editor'],
  right: ['mini', 'calculate', 'results'],
  minimized: [],
  main: '2d',
};

function isPanelId(v: unknown): v is DockPanelId {
  return typeof v === 'string' && (PANEL_IDS as string[]).includes(v);
}

function clampWidth(column: DockColumn, w: number): number {
  const { min, max } = COLUMN_LIMITS[column];
  return Math.round(Math.max(min, Math.min(max, w)));
}

/** A layout with these widths: the key is left out when there are none. */
function withWidths(l: DockLayout, widths: Partial<Record<DockColumn, number>>): DockLayout {
  const { widths: _old, ...rest } = l;
  return Object.keys(widths).length ? { ...rest, widths } : rest;
}

function fresh(l: DockLayout): DockLayout {
  const next: DockLayout = { left: [...l.left], right: [...l.right], minimized: [...l.minimized], main: l.main };
  if (l.float) next.float = { ...l.float };
  return l.widths ? withWidths(next, { ...l.widths }) : next;
}

/** The layout with the mini view docked: no float key. */
function withoutFloat(l: DockLayout): DockLayout {
  const { float: _f, ...rest } = l;
  return rest;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(Math.max(lo, hi), v));
}

/** A box kept inside the area: the size first (min, then half the area), then the position. */
function fitBox(b: FloatBox, area: AreaSize): FloatBox {
  const w = Math.round(clamp(b.w, FLOAT_MIN.w, area.width / 2));
  const h = Math.round(clamp(b.h, FLOAT_MIN.h, area.height / 2));
  return { x: Math.round(clamp(b.x, 0, area.width - w)), y: Math.round(clamp(b.y, 0, area.height - h)), w, h };
}

/** A box kept inside the area by position only (size untouched). */
function placeBox(b: FloatBox, area: AreaSize): FloatBox {
  return { ...b, x: Math.round(clamp(b.x, 0, area.width - b.w)), y: Math.round(clamp(b.y, 0, area.height - b.h)) };
}

/** A stored float box, or null unless it is four finite numbers (clamped to sane values). */
function sanitizeFloat(raw: unknown): FloatBox | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const nums = [r.x, r.y, r.w, r.h];
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  const [x, y, w, h] = nums as number[];
  return {
    x: Math.round(Math.max(0, x)),
    y: Math.round(Math.max(0, y)),
    w: Math.round(Math.max(FLOAT_MIN.w, w)),
    h: Math.round(Math.max(FLOAT_MIN.h, h)),
  };
}

/** Stored widths, keeping finite numbers (clamped) and dropping anything else. */
function sanitizeWidths(raw: unknown): Partial<Record<DockColumn, number>> {
  const out: Partial<Record<DockColumn, number>> = {};
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  for (const c of COLUMNS) {
    const w = r[c];
    if (typeof w === 'number' && Number.isFinite(w)) out[c] = clampWidth(c, w);
  }
  return out;
}

/** A stored layout, or the default unless it is complete and consistent. */
export function sanitizeDock(raw: unknown): DockLayout {
  if (!raw || typeof raw !== 'object') return fresh(DEFAULT_DOCK);
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.left) || !Array.isArray(r.right) || !Array.isArray(r.minimized)) return fresh(DEFAULT_DOCK);
  if (r.main !== '2d' && r.main !== '3d') return fresh(DEFAULT_DOCK);
  let left = r.left as unknown[];
  let right = r.right as unknown[];
  // A layout stored before Calculate had its own panel gets one directly above Results
  if (![...left, ...right].includes('calculate')) {
    if (left.includes('results')) {
      left = [...left];
      left.splice(left.indexOf('results'), 0, 'calculate');
    } else if (right.includes('results')) {
      right = [...right];
      right.splice(right.indexOf('results'), 0, 'calculate');
    } else {
      right = ['calculate', ...right];
    }
  }
  const placed = [...left, ...right];
  if (!placed.every(isPanelId)) return fresh(DEFAULT_DOCK);
  // A floating mini view is in neither column; every other panel is in one exactly once
  const float = r.float === undefined || r.float === null ? null : sanitizeFloat(r.float);
  if (r.float !== undefined && r.float !== null && !float) return fresh(DEFAULT_DOCK);
  const expected = float ? PANEL_IDS.filter((id) => id !== 'mini') : PANEL_IDS;
  if (placed.length !== expected.length || !expected.every((id) => placed.filter((p) => p === id).length === 1)) {
    return fresh(DEFAULT_DOCK);
  }
  if (!r.minimized.every(isPanelId) || new Set(r.minimized).size !== r.minimized.length) return fresh(DEFAULT_DOCK);
  const layout: DockLayout = {
    left: [...(left as DockPanelId[])],
    right: [...(right as DockPanelId[])],
    minimized: [...(r.minimized as DockPanelId[])],
    main: r.main,
  };
  if (float) layout.float = float;
  return withWidths(layout, sanitizeWidths(r.widths));
}

/** Move a panel to a column at an index (in that column once the panel is lifted out, clamped). */
export function movePanel(l: DockLayout, id: DockPanelId, column: DockColumn, index: number): DockLayout {
  const next = id === 'mini' ? withoutFloat(fresh(l)) : fresh(l);
  next.left = next.left.filter((p) => p !== id);
  next.right = next.right.filter((p) => p !== id);
  const target = next[column];
  const at = Math.max(0, Math.min(target.length, Math.trunc(index)));
  target.splice(at, 0, id);
  return next;
}

export function toggleMinimized(l: DockLayout, id: DockPanelId): DockLayout {
  const next = fresh(l);
  next.minimized = next.minimized.includes(id) ? next.minimized.filter((p) => p !== id) : [...next.minimized, id];
  return next;
}

export function swapMain(l: DockLayout): DockLayout {
  return { ...fresh(l), main: l.main === '2d' ? '3d' : '2d' };
}

/** The layout with `view` as the main view (the same object when it already is). */
export function withMain(l: DockLayout, view: MainView): DockLayout {
  return l.main === view ? l : { ...fresh(l), main: view };
}

/** A panel's default column width (px): Results keeps one width whether or not results exist. */
export function panelWidth(id: DockPanelId): number {
  return id === 'editor' || id === 'results' ? 420 : 300;
}

/**
 * A column's width: 0 when empty, else the width the user dragged, else the
 * widest of its panels.
 */
export function columnWidth(l: DockLayout, column: DockColumn): number {
  const ids = l[column];
  if (ids.length === 0) return 0;
  const stored = l.widths?.[column];
  if (stored !== undefined) return clampWidth(column, stored);
  return clampWidth(column, ids.reduce((w, id) => Math.max(w, panelWidth(id)), 0));
}

/** The layout with a column dragged to `width` (clamped to its limits). */
export function resizeColumn(l: DockLayout, column: DockColumn, width: number): DockLayout {
  return withWidths(fresh(l), { ...l.widths, [column]: clampWidth(column, width) });
}

/** The layout with a column back on its default width. */
export function resetColumnWidth(l: DockLayout, column: DockColumn): DockLayout {
  const widths = { ...l.widths };
  delete widths[column];
  return withWidths(fresh(l), widths);
}

/** Insertion index for a pointer y, given the vertical midpoints of the panels in a column. */
export function dropIndex(panelMidYs: number[], y: number): number {
  return panelMidYs.filter((m) => m < y).length;
}

/** The mini view floating with its top left at (x, y), at its floating size or the default. */
export function floatPanel(l: DockLayout, x: number, y: number, area?: AreaSize): DockLayout {
  const next = fresh(l);
  next.left = next.left.filter((p) => p !== 'mini');
  next.right = next.right.filter((p) => p !== 'mini');
  const box = { x: Math.round(x), y: Math.round(y), w: l.float?.w ?? FLOAT_DEFAULT.w, h: l.float?.h ?? FLOAT_DEFAULT.h };
  next.float = area ? placeBox(box, area) : box;
  return next;
}

/** The floating mini view moved to (x, y), kept inside the area (unchanged when docked). */
export function moveFloat(l: DockLayout, x: number, y: number, area: AreaSize): DockLayout {
  if (!l.float) return l;
  return { ...fresh(l), float: placeBox({ ...l.float, x, y }, area) };
}

/** The floating mini view resized, between its min size and half the area, kept inside it. */
export function resizeFloat(l: DockLayout, w: number, h: number, area: AreaSize): DockLayout {
  if (!l.float) return l;
  return { ...fresh(l), float: fitBox({ ...l.float, w, h }, area) };
}

/** The floating mini view docked into a column at an index. */
export function dockFloating(l: DockLayout, column: DockColumn, index: number): DockLayout {
  return movePanel(l, 'mini', column, index);
}

/** Where a float box shows in an area of this size: inside it, and no more than half of it. */
export function floatInArea(b: FloatBox, area: AreaSize | null): FloatBox {
  if (!area || area.width <= 0 || area.height <= 0) return b;
  return fitBox(b, area);
}
