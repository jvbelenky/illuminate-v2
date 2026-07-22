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

  async function runOnce(entry: QueueEntry): Promise<void> {
    current = entry;
    try {
      await runExecutor(executors, entry.cmd);
      current = null;
      resolveEntry(entry);
    } catch (err) {
      current = null;
      const canRetry = entry.attempt < retryDelaysMs.length && isRetryable(err);
      if (!canRetry) {
        onError(entry.cmd, err);
        rejectEntry(entry, err);
        return;
      }
      // Retry: wait out the backoff, modeling this command as back at the
      // head of the queue for the duration of the wait (so a same-id
      // coalesce arriving during the wait merges into it, and a delete
      // supersedes it, before the retry fires).
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
    while (!paused && queue.length > 0) {
      const entry = queue.shift()!;
      await runOnce(entry);
    }
    running = false;
    checkDrained();
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
      } else {
        queue.push({ cmd, attempt: 0, waiters: [{ resolve, reject }] });
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

  function clearPending(): void {
    const dropped = queue;
    queue = [];
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

  return { enqueue, pause, resume, clearPending, pendingCount, drained };
}
