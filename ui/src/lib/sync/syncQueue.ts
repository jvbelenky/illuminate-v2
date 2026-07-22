import { ApiError } from '$lib/api/client';

export type SyncCommand =
  | { kind: 'room-update'; partial: Record<string, unknown> }
  | { kind: 'lamp-update'; id: string; partial: Record<string, unknown> }
  | { kind: 'lamp-delete'; id: string }
  | { kind: 'zone-update'; id: string; partial: Record<string, unknown> }
  | { kind: 'zone-type-change'; id: string; snapshot: Record<string, unknown> }
  | { kind: 'zone-delete'; id: string };

export interface SyncQueue {
  enqueue(cmd: SyncCommand): Promise<void>;
  pause(): void;
  resume(): void;
  markReplayBoundary(): void;
  clearPending(): void;
  pendingCount(): number;
  drained(): Promise<void>;
}

export interface SyncQueueOptions {
  executors: { [K in SyncCommand['kind']]: (cmd: Extract<SyncCommand, { kind: K }>) => Promise<void> };
  onError: (cmd: SyncCommand, error: unknown) => void;
  isRetryable?: (error: unknown) => boolean;
  retryDelaysMs?: number[];
}

const DEFAULT_RETRY_DELAYS_MS = [2000, 5000, 10000];

// A 423 ("session busy") means a mutating request is being serialized behind
// another in-flight request — most often a long-running calculation. The API
// client allows /calculate up to 600s (see client.ts: AbortSignal.timeout for
// /calculate), during which every mutation 423s. So a 423 must keep retrying
// for at least that long rather than exhausting the counted retry budget in
// ~30s. This ceiling caps how long a single command will spin on 423s before
// giving up; keep it in sync with the client's max calculation timeout.
const MAX_423_RETRY_WINDOW_MS = 600_000;

function defaultIsRetryable(error: unknown): boolean {
  return error instanceof ApiError && error.status === 423;
}

interface Waiter {
  resolve: () => void;
  reject: (error: unknown) => void;
}

interface QueueEntry {
  cmd: SyncCommand;
  attempt: number;
  waiters: Waiter[];
  // Replay-boundary tag (see markReplayBoundary): false = enqueued before the
  // current boundary (eligible for clearPending), true = after (survives it).
  postBoundary: boolean;
  // Wall-clock time (Date.now()) of this command's first 423 response, or null
  // if it has never 423'd. Used to bound total 423 retry time (see
  // MAX_423_RETRY_WINDOW_MS); 423 retries are otherwise uncounted.
  first423At: number | null;
}

function runExecutor(executors: SyncQueueOptions['executors'], cmd: SyncCommand): Promise<void> {
  switch (cmd.kind) {
    case 'room-update':
      return executors['room-update'](cmd);
    case 'lamp-update':
      return executors['lamp-update'](cmd);
    case 'lamp-delete':
      return executors['lamp-delete'](cmd);
    case 'zone-update':
      return executors['zone-update'](cmd);
    case 'zone-type-change':
      return executors['zone-type-change'](cmd);
    case 'zone-delete':
      return executors['zone-delete'](cmd);
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createSyncQueue(options: SyncQueueOptions): SyncQueue {
  const { executors, onError } = options;
  const isRetryable = options.isRetryable ?? defaultIsRetryable;
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;

  let queue: QueueEntry[] = [];
  let current: QueueEntry | null = null;
  let paused = false;
  let running = false;
  let drainedWaiters: Array<() => void> = [];
  // Once a replay boundary has ever been marked, commands enqueued after the
  // most recent mark are post-boundary (survive clearPending). Before the first
  // mark this stays false, so clearPending drops everything (backward-compatible).
  let afterBoundary = false;

  function isIdle(): boolean {
    return queue.length === 0 && current === null;
  }

  function checkDrained(): void {
    if (isIdle() && drainedWaiters.length > 0) {
      const waiters = drainedWaiters;
      drainedWaiters = [];
      waiters.forEach((resolve) => resolve());
    }
  }

  function resolveEntry(entry: QueueEntry): void {
    entry.waiters.forEach((w) => w.resolve());
    checkDrained();
  }

  function rejectEntry(entry: QueueEntry, error: unknown): void {
    entry.waiters.forEach((w) => w.reject(error));
    checkDrained();
  }

  // Report an error to the host without ever letting a throwing reporter kill
  // the drain loop. onError runs Svelte store subscribers synchronously (and
  // hits crypto.randomUUID()), any of which could throw; the queue must survive
  // that. The command's own promise is rejected separately by the caller, so a
  // failed report never leaves a promise unsettled.
  function reportError(cmd: SyncCommand, error: unknown): void {
    try {
      onError(cmd, error);
    } catch (reportErr) {
      console.error('[syncQueue] onError threw while reporting a sync failure', reportErr);
    }
  }

  async function runOnce(entry: QueueEntry): Promise<void> {
    current = entry;
    try {
      await runExecutor(executors, entry.cmd);
      current = null;
      resolveEntry(entry);
    } catch (err) {
      current = null;
      // isRetryable is pluggable and may itself throw; treat a throwing
      // predicate as "not retryable" so the command fails cleanly rather than
      // escaping the loop.
      let retryable = false;
      try {
        retryable = isRetryable(err);
      } catch (predicateErr) {
        console.error('[syncQueue] isRetryable threw; treating error as non-retryable', predicateErr);
      }
      const is423 = err instanceof ApiError && err.status === 423;

      if (retryable && is423 && retryDelaysMs.length > 0) {
        // 423 ("session busy") retries are UNCOUNTED: they self-throttle at the
        // longest tier every cycle and keep going until the session frees up,
        // bounded only by an absolute wall-clock ceiling so they can't spin
        // forever behind a truly stuck request.
        if (entry.first423At === null) entry.first423At = Date.now();
        if (Date.now() - entry.first423At > MAX_423_RETRY_WINDOW_MS) {
          reportError(entry.cmd, err);
          rejectEntry(entry, err);
          return;
        }
        const delayMs = retryDelaysMs[retryDelaysMs.length - 1];
        queue.unshift(entry);
        await wait(delayMs);
        if (!queue.includes(entry)) return; // superseded while waiting
        return;
      }

      const canRetry = retryable && entry.attempt < retryDelaysMs.length;
      if (!canRetry) {
        reportError(entry.cmd, err);
        rejectEntry(entry, err);
        return;
      }
      // Counted retry (non-423 retryable errors): wait out the backoff,
      // modeling this command as back at the head of the queue for the
      // duration of the wait (so a same-id coalesce arriving during the wait
      // merges into it, and a delete supersedes it, before the retry fires).
      const delayMs = retryDelaysMs[entry.attempt];
      entry.attempt += 1;
      queue.unshift(entry);
      await wait(delayMs);
      if (!queue.includes(entry)) {
        // Superseded (coalesced-into-later isn't possible here since it's
        // the same object; removed via delete/clearPending) while waiting —
        // its waiters were already resolved by whoever removed it.
        return;
      }
      // Still queued: leave it at the head for the drain loop's next
      // iteration to pick up and retry.
    }
  }

  async function drainLoop(): Promise<void> {
    if (running) return;
    running = true;
    try {
      while (!paused && queue.length > 0) {
        const entry = queue.shift()!;
        await runOnce(entry);
      }
    } finally {
      // Defense in depth: whatever happens above (including any future escape
      // path), never leave `running` stuck true — that would silently wedge the
      // queue forever. Reset it, notify drained() waiters, and re-kick if there
      // is still work to do and we're not paused.
      running = false;
      checkDrained();
      if (!paused && queue.length > 0) void drainLoop();
    }
  }

  function kickDrain(): void {
    if (!running) {
      void drainLoop();
    }
  }

  function findCoalesceTarget(cmd: SyncCommand): QueueEntry | undefined {
    if (cmd.kind === 'room-update') {
      return queue.find((e) => e.cmd.kind === 'room-update');
    }
    if (cmd.kind === 'lamp-update') {
      return queue.find((e) => e.cmd.kind === 'lamp-update' && e.cmd.id === cmd.id);
    }
    if (cmd.kind === 'zone-update') {
      return queue.find((e) => e.cmd.kind === 'zone-update' && e.cmd.id === cmd.id);
    }
    // zone-type-change, lamp-delete, zone-delete never coalesce.
    return undefined;
  }

  function mergeInto(target: QueueEntry, incoming: SyncCommand): void {
    if (incoming.kind === 'room-update' && target.cmd.kind === 'room-update') {
      target.cmd = { kind: 'room-update', partial: { ...target.cmd.partial, ...incoming.partial } };
    } else if (incoming.kind === 'lamp-update' && target.cmd.kind === 'lamp-update') {
      target.cmd = {
        kind: 'lamp-update',
        id: target.cmd.id,
        partial: { ...target.cmd.partial, ...incoming.partial },
      };
    } else if (incoming.kind === 'zone-update' && target.cmd.kind === 'zone-update') {
      target.cmd = {
        kind: 'zone-update',
        id: target.cmd.id,
        partial: { ...target.cmd.partial, ...incoming.partial },
      };
    }
  }

  function supersedeRelated(cmd: Extract<SyncCommand, { kind: 'lamp-delete' | 'zone-delete' }>): void {
    const isLamp = cmd.kind === 'lamp-delete';
    const kept: QueueEntry[] = [];
    for (const e of queue) {
      const related = isLamp
        ? e.cmd.kind === 'lamp-update' && e.cmd.id === cmd.id
        : (e.cmd.kind === 'zone-update' || e.cmd.kind === 'zone-type-change') && e.cmd.id === cmd.id;
      if (related) {
        resolveEntry(e);
      } else {
        kept.push(e);
      }
    }
    queue = kept;
  }

  function enqueue(cmd: SyncCommand): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (cmd.kind === 'lamp-delete' || cmd.kind === 'zone-delete') {
        supersedeRelated(cmd);
      }
      const target = findCoalesceTarget(cmd);
      if (target) {
        mergeInto(target, cmd);
        target.waiters.push({ resolve, reject });
        // A merged entry that absorbs post-boundary data must survive clearPending.
        target.postBoundary = target.postBoundary || afterBoundary;
      } else {
        queue.push({ cmd, attempt: 0, waiters: [{ resolve, reject }], postBoundary: afterBoundary, first423At: null });
      }
      kickDrain();
    });
  }

  function pause(): void {
    paused = true;
  }

  function resume(): void {
    paused = false;
    kickDrain();
  }

  function markReplayBoundary(): void {
    // Everything currently queued is now "pre-boundary" (a subsequent full-state
    // push supersedes it, so clearPending may drop it); anything enqueued after
    // this call is "post-boundary" and survives clearPending. A new mark replaces
    // the old, so any prior post-boundary entries revert to pre-boundary.
    afterBoundary = true;
    for (const e of queue) e.postBoundary = false;
  }

  function clearPending(): void {
    const dropped: QueueEntry[] = [];
    const kept: QueueEntry[] = [];
    for (const e of queue) {
      if (e.postBoundary) kept.push(e);
      else dropped.push(e);
    }
    queue = kept;
    dropped.forEach((e) => resolveEntry(e));
  }

  function pendingCount(): number {
    return queue.length;
  }

  function drained(): Promise<void> {
    if (isIdle()) return Promise.resolve();
    return new Promise<void>((resolve) => {
      drainedWaiters.push(resolve);
    });
  }

  return { enqueue, pause, resume, markReplayBoundary, clearPending, pendingCount, drained };
}
