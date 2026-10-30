/**
 * Session-only UI state for the workspace: which mode is showing and where
 * the user is in the editor. Backed by sessionStorage so a reload keeps place.
 */

import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import {
  STAGES,
  ROOM_PARTS,
  type EditorStage,
  type RoomPart,
  type WorkspaceMode,
} from '$lib/workspace/editorNav';

export interface WorkspaceUiState {
  mode: WorkspaceMode;
  stage: EditorStage;
  /** The last Room part, kept even while on Lamps or Zones. */
  part: RoomPart;
  /** The Room parts opened in this project (their tabs are ticked), in tab order. */
  visited: RoomPart[];
}

const STORAGE_KEY = 'illuminate_workspace_ui';

const DEFAULTS: WorkspaceUiState = { mode: 'editor', stage: 'room', part: 'floorplan', visited: [] };

// True when this tab already had a saved place (a reload or back-navigation)
let restored = false;
/** Whether the workspace state came from this tab's sessionStorage rather than the defaults. */
export function workspaceUiWasRestored(): boolean {
  return restored;
}

function load(): WorkspaceUiState {
  if (!browser) return { ...DEFAULTS, visited: [] };
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS, visited: [] };
    const p = JSON.parse(raw) ?? {};
    restored = true;
    return {
      mode: p.mode === 'editor' || p.mode === 'summary' ? p.mode : DEFAULTS.mode,
      stage: STAGES.some(s => s.id === p.stage) ? p.stage : DEFAULTS.stage,
      part: ROOM_PARTS.some(r => r.id === p.part) ? p.part : DEFAULTS.part,
      visited: Array.isArray(p.visited)
        ? ROOM_PARTS.map(r => r.id).filter(id => p.visited.includes(id))
        : [],
    };
  } catch {
    return { ...DEFAULTS, visited: [] };
  }
}

function save(state: WorkspaceUiState) {
  if (!browser) return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('[workspaceUi] Failed to save to sessionStorage:', e);
  }
}

function createWorkspaceUi() {
  const { subscribe, set, update } = writable<WorkspaceUiState>(load());
  let current!: WorkspaceUiState;
  subscribe(s => (current = s));

  const change = (fn: (s: WorkspaceUiState) => WorkspaceUiState) =>
    update(s => {
      const next = fn(s);
      save(next);
      return next;
    });

  return {
    subscribe,
    goTo: (stage: EditorStage, part?: RoomPart) =>
      change(s => ({ ...s, mode: 'editor', stage, part: part ?? s.part })),
    /** Tick a Room part as opened; a no-op (no store change) once it is. */
    visit: (part: RoomPart) => {
      if (current.visited.includes(part)) return;
      change(s => ({ ...s, visited: ROOM_PARTS.map(r => r.id).filter(id => id === part || s.visited.includes(id)) }));
    },
    /** A newly opened project: nothing visited yet. */
    clearVisited: () => {
      if (current.visited.length === 0) return;
      change(s => ({ ...s, visited: [] }));
    },
    showSummary: () => change(s => ({ ...s, mode: 'summary' })),
    showEditor: () => change(s => ({ ...s, mode: 'editor' })),
    reset: (mode: WorkspaceMode) => {
      const next = { ...DEFAULTS, mode, visited: [] };
      save(next);
      set(next);
    },
  };
}

export const workspaceUi = createWorkspaceUi();
