/**
 * Undo/redo for scene edits.
 *
 * Entries are snapshots of the scene taken just BEFORE a user edit. Undo waits
 * for the backend to settle (so echoes such as nudge-into-bounds have landed),
 * stashes the current scene for redo, and asks the host to restore the older
 * snapshot. The host restores by diffing and replaying ordinary store
 * mutations, so everything still flows through the sync queue.
 *
 * Grouping: every `record` in one synchronous task is one step (a gesture that
 * calls several store methods, or a store method that calls others). Records
 * that share a `key` within `coalesceMs` of the previous one also merge, so a
 * slider drag or a run of arrow-key nudges is a single step.
 */
import { writable, type Readable } from 'svelte/store';

export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
}

export interface HistoryOptions<S> {
  /** The scene as it is now (must be safe to keep: no later mutation of what it returns). */
  capture: () => S;
  /** Make the scene equal `target` (through ordinary store mutations). */
  restore: (target: S) => Promise<void>;
  /** Resolve once pending backend work (sync queue, echo follow-ups) has settled. */
  waitIdle: () => Promise<void>;
  /** True when two snapshots describe the same scene (a no-op step is skipped). */
  equals: (a: S, b: S) => boolean;
  limit?: number;
  coalesceMs?: number;
  now?: () => number;
}

interface Entry<S> {
  label: string;
  snapshot: S;
  key?: string;
  at: number;
}

export interface History<S> extends Readable<HistoryState> {
  /** Call before mutating the scene for a user edit. */
  record(label: string, key?: string): void;
  /** One undo step for everything `fn` does (sync or async). */
  batch<T>(label: string, fn: () => T): T;
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
  clear(): void;
  /** True while an undo/redo is replaying (store mutations must not record). */
  isReplaying(): boolean;
}

export function createHistory<S>(options: HistoryOptions<S>): History<S> {
  const { capture, restore, waitIdle, equals } = options;
  const limit = options.limit ?? 100;
  const coalesceMs = options.coalesceMs ?? 600;
  const now = options.now ?? (() => Date.now());

  let undoStack: Entry<S>[] = [];
  let redoStack: Entry<S>[] = [];
  let replaying = false;
  let busy = false;
  let openTask = false;
  let batchDepth = 0;

  const state = writable<HistoryState>(snapshotState());

  function snapshotState(): HistoryState {
    return {
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0,
      undoLabel: undoStack.at(-1)?.label ?? null,
      redoLabel: redoStack.at(-1)?.label ?? null,
    };
  }
  function publish() {
    state.set(snapshotState());
  }

  function record(label: string, key?: string) {
    if (replaying || batchDepth > 0 || openTask) return;
    openTask = true;
    queueMicrotask(() => { openTask = false; });
    const t = now();
    const last = undoStack.at(-1);
    if (key !== undefined && last && last.key === key && t - last.at <= coalesceMs && redoStack.length === 0) {
      // Same continuing edit: keep the older snapshot, extend the window
      last.at = t;
      return;
    }
    undoStack.push({ label, snapshot: capture(), key, at: t });
    if (undoStack.length > limit) undoStack = undoStack.slice(-limit);
    redoStack = [];
    publish();
  }

  function batch<T>(label: string, fn: () => T): T {
    record(label);
    batchDepth++;
    let result: T;
    try {
      result = fn();
    } catch (e) {
      batchDepth--;
      throw e;
    }
    if (result instanceof Promise) {
      return result.finally(() => { batchDepth--; }) as T;
    }
    batchDepth--;
    return result;
  }

  async function step(from: () => Entry<S>[], to: () => Entry<S>[]): Promise<boolean> {
    if (busy) return false;
    busy = true;
    try {
      while (from().length > 0) {
        await waitIdle();
        const entry = from().pop()!;
        const current = capture();
        if (equals(current, entry.snapshot)) continue; // a step that changed nothing
        to().push({ label: entry.label, snapshot: current, at: now() });
        publish();
        replaying = true;
        try {
          await restore(entry.snapshot);
          await waitIdle();
        } finally {
          replaying = false;
        }
        return true;
      }
      publish();
      return false;
    } finally {
      busy = false;
    }
  }

  return {
    subscribe: state.subscribe,
    record,
    batch,
    undo: () => step(() => undoStack, () => redoStack),
    redo: () => step(() => redoStack, () => undoStack),
    clear() {
      undoStack = [];
      redoStack = [];
      publish();
    },
    isReplaying: () => replaying,
  };
}
