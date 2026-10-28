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
}

/** How narrow and wide a column can be dragged (px). */
export const COLUMN_LIMITS: Record<DockColumn, { min: number; max: number }> = {
  left: { min: 320, max: 550 },
  right: { min: 260, max: 600 },
};

const COLUMNS: DockColumn[] = ['left', 'right'];

const PANEL_IDS: DockPanelId[] = ['editor', 'results', 'mini'];

export const DEFAULT_DOCK: DockLayout = {
  left: ['editor'],
  right: ['mini', 'results'],
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
  return l.widths ? withWidths(next, { ...l.widths }) : next;
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
  const placed = [...r.left, ...r.right];
  if (!placed.every(isPanelId)) return fresh(DEFAULT_DOCK);
  if (placed.length !== PANEL_IDS.length || !PANEL_IDS.every((id) => placed.filter((p) => p === id).length === 1)) {
    return fresh(DEFAULT_DOCK);
  }
  if (!r.minimized.every(isPanelId) || new Set(r.minimized).size !== r.minimized.length) return fresh(DEFAULT_DOCK);
  const layout: DockLayout = {
    left: [...(r.left as DockPanelId[])],
    right: [...(r.right as DockPanelId[])],
    minimized: [...(r.minimized as DockPanelId[])],
    main: r.main,
  };
  return withWidths(layout, sanitizeWidths(r.widths));
}

/** Move a panel to a column at an index (in that column once the panel is lifted out, clamped). */
export function movePanel(l: DockLayout, id: DockPanelId, column: DockColumn, index: number): DockLayout {
  const next = fresh(l);
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

export function panelWidth(id: DockPanelId, resultsWide: boolean): number {
  if (id === 'editor') return 420;
  return id === 'results' && resultsWide ? 420 : 300;
}

/**
 * A column's width: 0 when empty, else the width the user dragged, else the
 * widest of its panels (so a column holding results widens when they arrive).
 */
export function columnWidth(l: DockLayout, column: DockColumn, resultsWide: boolean): number {
  const ids = l[column];
  if (ids.length === 0) return 0;
  const stored = l.widths?.[column];
  if (stored !== undefined) return clampWidth(column, stored);
  return clampWidth(column, ids.reduce((w, id) => Math.max(w, panelWidth(id, resultsWide)), 0));
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
