/**
 * Dock layout model: which panels sit in the left and right columns, which
 * are minimized, and which view fills the main area. Pure functions only.
 */

export type DockPanelId = 'editor' | 'results' | 'mini';
export type DockColumn = 'left' | 'right';
export type MainView = '2d' | '3d';

export interface DockLayout {
  left: DockPanelId[];
  right: DockPanelId[];
  minimized: DockPanelId[];
  main: MainView;
}

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

function fresh(l: DockLayout): DockLayout {
  return { left: [...l.left], right: [...l.right], minimized: [...l.minimized], main: l.main };
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
  return {
    left: [...(r.left as DockPanelId[])],
    right: [...(r.right as DockPanelId[])],
    minimized: [...(r.minimized as DockPanelId[])],
    main: r.main,
  };
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
  return id === 'results' && resultsWide ? 420 : 300;
}

export function columnWidth(ids: DockPanelId[], resultsWide: boolean): number {
  return ids.reduce((w, id) => Math.max(w, panelWidth(id, resultsWide)), 0);
}

/** Insertion index for a pointer y, given the vertical midpoints of the panels in a column. */
export function dropIndex(panelMidYs: number[], y: number): number {
  return panelMidYs.filter((m) => m < y).length;
}
