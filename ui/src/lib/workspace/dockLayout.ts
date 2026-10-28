/**
 * Dock layout model: which panels sit in the left and right columns, which
 * are minimized, which view fills the main area, and any column width the
 * user dragged. Pure functions only.
 */

export type DockPanelId = 'editor' | 'results' | 'mini';
export type DockColumn = 'left' | 'right';
export type MainView = '2d' | '3d';

export interface DockLayout {
  left: DockPanelId[];
  right: DockPanelId[];
  minimized: DockPanelId[];
  main: MainView;
  /** Widths the user dragged, per column; a column without one follows its panels. */
  widths?: Partial<Record<DockColumn, number>>;
  /** Floating panels (px from the workspace's top left); a floating panel is in neither column. */
  floats?: Partial<Record<DockPanelId, FloatBox>>;
  /**
   * Docked heights the user dragged (px, panel bar included). The last open
   * editor or results panel in a column ignores its height and fills the rest;
   * the mini view without one is 25% of the column tall (at least 150 px).
   */
  heights?: Partial<Record<DockPanelId, number>>;
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

/** Floating sizes per panel (px); a floating Results window includes the Calculate control above it. */
export const FLOAT_DEFAULTS: Record<DockPanelId, { w: number; h: number }> = {
  editor: { w: 420, h: 600 },
  results: { w: 420, h: 500 },
  mini: { w: 300, h: 225 },
};
export const FLOAT_MINS: Record<DockPanelId, { w: number; h: number }> = {
  editor: { w: 260, h: 200 },
  results: { w: 260, h: 200 },
  mini: { w: 200, h: 150 },
};

/** A panel's title bar height (px). */
export const BAR_HEIGHT = 26;
/** The largest docked height kept (px). */
const MAX_HEIGHT = 10000;

/** How short a docked panel can be dragged: its bar plus 80 px (the mini view 100 px). */
export function minPanelHeight(id: DockPanelId): number {
  return BAR_HEIGHT + (id === 'mini' ? 100 : 80);
}

/** How narrow and wide a column can be dragged (px). */
export const COLUMN_LIMITS: Record<DockColumn, { min: number; max: number }> = {
  left: { min: 320, max: 550 },
  right: { min: 260, max: 600 },
};

const COLUMNS: DockColumn[] = ['left', 'right'];

const PANEL_IDS: DockPanelId[] = ['editor', 'results', 'mini'];

/** A panel id from before Calculate became a control above Results: dropped from stored layouts. */
const RETIRED = 'calculate';

export const DEFAULT_DOCK: DockLayout = {
  left: ['editor', 'mini'],
  right: ['results'],
  minimized: [],
  main: '2d',
};

function isPanelId(v: unknown): v is DockPanelId {
  return typeof v === 'string' && (PANEL_IDS as string[]).includes(v);
}

/** Editor and Results fill the space a column has left. */
function isFiller(id: DockPanelId): boolean {
  return id === 'editor' || id === 'results';
}

function clampWidth(column: DockColumn, w: number): number {
  const { min, max } = COLUMN_LIMITS[column];
  return Math.round(Math.max(min, Math.min(max, w)));
}

/** A layout with this optional record: the key is left out when it is empty. */
function withKey<K extends 'widths' | 'floats' | 'heights'>(l: DockLayout, key: K, value: DockLayout[K]): DockLayout {
  const next = { ...l };
  delete next[key];
  if (value && Object.keys(value).length) next[key] = value;
  return next;
}

/** A layout with these widths: the key is left out when there are none. */
function withWidths(l: DockLayout, widths: Partial<Record<DockColumn, number>>): DockLayout {
  return withKey(l, 'widths', widths);
}

function fresh(l: DockLayout): DockLayout {
  let next: DockLayout = { left: [...l.left], right: [...l.right], minimized: [...l.minimized], main: l.main };
  if (l.widths) next = withKey(next, 'widths', { ...l.widths });
  if (l.floats) {
    const floats: Partial<Record<DockPanelId, FloatBox>> = {};
    for (const [id, b] of Object.entries(l.floats)) if (b) floats[id as DockPanelId] = { ...b };
    next = withKey(next, 'floats', floats);
  }
  if (l.heights) next = withKey(next, 'heights', { ...l.heights });
  return next;
}

/** The layout with a panel out of the columns, the floats and the heights. */
function lifted(l: DockLayout, id: DockPanelId): DockLayout {
  let next = fresh(l);
  next.left = next.left.filter((p) => p !== id);
  next.right = next.right.filter((p) => p !== id);
  const floats = { ...next.floats };
  delete floats[id];
  const heights = { ...next.heights };
  delete heights[id];
  next = withKey(next, 'floats', floats);
  return withKey(next, 'heights', heights);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(Math.max(lo, hi), v));
}

/** A box kept inside the area: the size first (the panel's min, then the area), then the position. */
function fitBox(b: FloatBox, area: AreaSize, id: DockPanelId): FloatBox {
  const min = FLOAT_MINS[id];
  const w = Math.round(clamp(b.w, min.w, area.width));
  const h = Math.round(clamp(b.h, min.h, area.height));
  return { x: Math.round(clamp(b.x, 0, area.width - w)), y: Math.round(clamp(b.y, 0, area.height - h)), w, h };
}

/** A box kept inside the area by position only (size untouched). */
function placeBox(b: FloatBox, area: AreaSize): FloatBox {
  return { ...b, x: Math.round(clamp(b.x, 0, area.width - b.w)), y: Math.round(clamp(b.y, 0, area.height - b.h)) };
}

/** A stored float box, or null unless it is four finite numbers (clamped to sane values). */
function sanitizeFloat(raw: unknown, id: DockPanelId): FloatBox | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const nums = [r.x, r.y, r.w, r.h];
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  const [x, y, w, h] = nums as number[];
  const min = FLOAT_MINS[id];
  return {
    x: Math.round(Math.max(0, x)),
    y: Math.round(Math.max(0, y)),
    w: Math.round(Math.max(min.w, w)),
    h: Math.round(Math.max(min.h, h)),
  };
}

/** Stored floats, or null unless every entry is a known panel with a good box. */
function sanitizeFloats(raw: unknown): Partial<Record<DockPanelId, FloatBox>> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Partial<Record<DockPanelId, FloatBox>> = {};
  for (const [id, b] of Object.entries(raw as Record<string, unknown>)) {
    if (id === RETIRED) continue;
    if (!isPanelId(id)) return null;
    const box = sanitizeFloat(b, id);
    if (!box) return null;
    out[id] = box;
  }
  return out;
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

/** Stored heights of docked panels, as finite numbers clamped to the panel's range. */
function sanitizeHeights(raw: unknown, docked: DockPanelId[]): Partial<Record<DockPanelId, number>> {
  const out: Partial<Record<DockPanelId, number>> = {};
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  for (const id of docked) {
    const h = r[id];
    if (typeof h === 'number' && Number.isFinite(h)) {
      out[id] = Math.round(clamp(h, minPanelHeight(id), MAX_HEIGHT));
    }
  }
  return out;
}

/** A stored layout, or the default unless it is complete and consistent. */
export function sanitizeDock(raw: unknown): DockLayout {
  if (!raw || typeof raw !== 'object') return fresh(DEFAULT_DOCK);
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.left) || !Array.isArray(r.right) || !Array.isArray(r.minimized)) return fresh(DEFAULT_DOCK);
  if (r.main !== '2d' && r.main !== '3d') return fresh(DEFAULT_DOCK);
  // Floating panels; a layout from before every panel could float had at most a floating mini view
  let floats: Partial<Record<DockPanelId, FloatBox>> = {};
  if (r.floats !== undefined && r.floats !== null) {
    const f = sanitizeFloats(r.floats);
    if (!f) return fresh(DEFAULT_DOCK);
    floats = f;
  } else if (r.float !== undefined && r.float !== null) {
    const mini = sanitizeFloat(r.float, 'mini');
    if (!mini) return fresh(DEFAULT_DOCK);
    floats = { mini };
  }
  const floating = Object.keys(floats) as DockPanelId[];
  // Calculate was a panel for a while: a stored layout drops it
  const left = (r.left as unknown[]).filter((p) => p !== RETIRED);
  const right = (r.right as unknown[]).filter((p) => p !== RETIRED);
  const minimized = (r.minimized as unknown[]).filter((p) => p !== RETIRED);
  const placed = [...left, ...right, ...floating];
  if (!placed.every(isPanelId)) return fresh(DEFAULT_DOCK);
  // Every panel exactly once, in a column or floating
  if (placed.length !== PANEL_IDS.length || !PANEL_IDS.every((id) => placed.filter((p) => p === id).length === 1)) {
    return fresh(DEFAULT_DOCK);
  }
  if (!minimized.every(isPanelId) || new Set(minimized).size !== minimized.length) return fresh(DEFAULT_DOCK);
  let layout: DockLayout = {
    left: [...(left as DockPanelId[])],
    right: [...(right as DockPanelId[])],
    minimized: [...(minimized as DockPanelId[])],
    main: r.main,
  };
  layout = withWidths(layout, sanitizeWidths(r.widths));
  layout = withKey(layout, 'floats', floats);
  return withKey(layout, 'heights', sanitizeHeights(r.heights, [...layout.left, ...layout.right]));
}

/** Move a panel to a column at an index (in that column once the panel is lifted out, clamped). */
export function movePanel(l: DockLayout, id: DockPanelId, column: DockColumn, index: number): DockLayout {
  const next = lifted(l, id);
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
  return id === 'editor' ? 420 : id === 'results' ? 400 : 300;
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

/** The narrowest the main view is squeezed to before the side columns give way (px). */
export const MIN_MAIN_WIDTH = 520;

/**
 * Column widths that leave the main view at least MIN_MAIN_WIDTH in an area
 * `areaWidth` wide (less `gaps`): both columns give way in proportion to what
 * they have above their minimum and stop there, so a narrower window narrows
 * the main view instead. Display only; stored widths are untouched.
 */
export function fitColumns(widths: { left: number; right: number }, areaWidth: number, gaps = 0): { left: number; right: number } {
  const room = areaWidth - gaps - MIN_MAIN_WIDTH;
  const total = widths.left + widths.right;
  if (total <= room) return widths;
  const slackL = Math.max(0, widths.left - (widths.left ? COLUMN_LIMITS.left.min : 0));
  const slackR = Math.max(0, widths.right - (widths.right ? COLUMN_LIMITS.right.min : 0));
  const slack = slackL + slackR;
  if (slack <= 0) return widths;
  const cut = Math.min(slack, total - room);
  return {
    left: Math.round(widths.left - (cut * slackL) / slack),
    right: Math.round(widths.right - (cut * slackR) / slack),
  };
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

/** A panel floating with its top left at (x, y), at its floating size or its default. */
export function floatPanel(l: DockLayout, id: DockPanelId, x: number, y: number, area?: AreaSize): DockLayout {
  const size = l.floats?.[id] ?? FLOAT_DEFAULTS[id];
  const box = { x: Math.round(x), y: Math.round(y), w: size.w, h: size.h };
  const next = lifted(l, id);
  return withKey(next, 'floats', { ...next.floats, [id]: area ? placeBox(box, area) : box });
}

/** A floating panel moved to (x, y), kept inside the area (unchanged when docked). */
export function moveFloat(l: DockLayout, id: DockPanelId, x: number, y: number, area: AreaSize): DockLayout {
  const b = l.floats?.[id];
  if (!b) return l;
  const next = fresh(l);
  return withKey(next, 'floats', { ...next.floats, [id]: placeBox({ ...b, x, y }, area) });
}

/** A floating panel resized, between its min size and the area, kept inside it. */
export function resizeFloat(l: DockLayout, id: DockPanelId, w: number, h: number, area: AreaSize): DockLayout {
  const b = l.floats?.[id];
  if (!b) return l;
  return withKey(fresh(l), 'floats', { ...l.floats, [id]: fitBox({ ...b, w, h }, area, id) });
}

/** A floating panel docked into a column at an index. */
export function dockFloating(l: DockLayout, id: DockPanelId, column: DockColumn, index: number): DockLayout {
  return movePanel(l, id, column, index);
}

/** Where a float box shows in an area of this size: inside it, and no bigger than it. */
export function floatInArea(b: FloatBox, area: AreaSize | null, id: DockPanelId): FloatBox {
  if (!area || area.width <= 0 || area.height <= 0) return b;
  return fitBox(b, area, id);
}

/** The panel in a column that fills the space left: its last open editor or results panel. */
export function fillPanel(l: DockLayout, column: DockColumn): DockPanelId | null {
  const open = l[column].filter((id) => isFiller(id) && !l.minimized.includes(id));
  return open.length ? open[open.length - 1] : null;
}

/**
 * The dividers in a column: one per pair of the nearest open panels above and
 * below a gap, at the first gap between them.
 */
export function splitPairs(l: DockLayout, column: DockColumn): { gap: number; above: DockPanelId; below: DockPanelId }[] {
  const ids = l[column];
  const sizable = (id: DockPanelId) => !l.minimized.includes(id);
  const out: { gap: number; above: DockPanelId; below: DockPanelId }[] = [];
  for (let gap = 0; gap < ids.length - 1; gap++) {
    const above = ids.slice(0, gap + 1).reverse().find(sizable);
    const below = ids.slice(gap + 1).find(sizable);
    if (!above || !below) continue;
    if (out.some((p) => p.above === above && p.below === below)) continue;
    out.push({ gap, above, below });
  }
  return out;
}

/**
 * A divider dragged by `dy` between two panels now `hAbove` and `hBelow` tall:
 * their sum stays, each keeps its minimum, and one height is stored (the mini
 * view's, else the upper one's) while the other follows.
 */
export function splitPanels(
  l: DockLayout,
  above: DockPanelId,
  below: DockPanelId,
  hAbove: number,
  hBelow: number,
  dy: number,
): DockLayout {
  const total = hAbove + hBelow;
  const a = clamp(hAbove + dy, minPanelHeight(above), total - minPanelHeight(below));
  const keep = below === 'mini' ? below : above;
  const heights = { ...l.heights };
  delete heights[above];
  delete heights[below];
  heights[keep] = Math.round(keep === above ? a : total - a);
  return withKey(fresh(l), 'heights', heights);
}

/** Both panels at a divider back on their default heights. */
export function resetSplit(l: DockLayout, above: DockPanelId, below: DockPanelId): DockLayout {
  const heights = { ...l.heights };
  delete heights[above];
  delete heights[below];
  return withKey(fresh(l), 'heights', heights);
}
