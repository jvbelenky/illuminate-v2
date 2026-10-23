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
}

const STORAGE_KEY = 'illuminate_workspace_ui';

const DEFAULTS: WorkspaceUiState = { mode: 'editor', stage: 'room', part: 'floorplan' };

function load(): WorkspaceUiState {
  if (!browser) return { ...DEFAULTS };
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const p = JSON.parse(raw) ?? {};
    return {
      mode: p.mode === 'editor' || p.mode === 'summary' ? p.mode : DEFAULTS.mode,
      stage: STAGES.some(s => s.id === p.stage) ? p.stage : DEFAULTS.stage,
      part: ROOM_PARTS.some(r => r.id === p.part) ? p.part : DEFAULTS.part,
    };
  } catch {
    return { ...DEFAULTS };
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

  const change = (fn: (s: WorkspaceUiState) => WorkspaceUiState) =>
    update(s => {
      const next = fn(s);
      save(next);
      return next;
    });

  return {
    subscribe,
    goTo: (stage: EditorStage, part?: RoomPart) =>
      change(s => ({ mode: 'editor', stage, part: part ?? s.part })),
    showSummary: () => change(s => ({ ...s, mode: 'summary' })),
    showEditor: () => change(s => ({ ...s, mode: 'editor' })),
    reset: (mode: WorkspaceMode) => {
      const next = { ...DEFAULTS, mode };
      save(next);
      set(next);
    },
  };
}

export const workspaceUi = createWorkspaceUi();
