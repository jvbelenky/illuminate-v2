import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSyncQueue, type SyncCommand, type SyncQueue, type SyncQueueOptions } from './syncQueue';
import { ApiError } from '$lib/api/client';

function makeOptions(overrides: Partial<SyncQueueOptions> = {}): SyncQueueOptions {
  return {
    executors: {
      'room-update': vi.fn().mockResolvedValue(undefined),
      'lamp-update': vi.fn().mockResolvedValue(undefined),
      'lamp-delete': vi.fn().mockResolvedValue(undefined),
      'zone-update': vi.fn().mockResolvedValue(undefined),
      'zone-type-change': vi.fn().mockResolvedValue(undefined),
      'zone-delete': vi.fn().mockResolvedValue(undefined),
    },
    onError: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('syncQueue: FIFO / pause / clearPending / drained (semantics 1, 3, 4, 6)', () => {
  it('semantic 1: executes commands one at a time, in enqueue order', async () => {
    const order: string[] = [];
    const options = makeOptions();
    (options.executors['lamp-update'] as ReturnType<typeof vi.fn>).mockImplementation(
      async (cmd: SyncCommand & { kind: 'lamp-update' }) => {
        order.push(`lamp-update-${cmd.id}`);
      }
    );
    (options.executors['lamp-delete'] as ReturnType<typeof vi.fn>).mockImplementation(
      async (cmd: SyncCommand & { kind: 'lamp-delete' }) => {
        order.push(`lamp-delete-${cmd.id}`);
      }
    );
    const queue = createSyncQueue(options);

    const p1 = queue.enqueue({ kind: 'lamp-update', id: 'a', partial: { x: 1 } });
    const p2 = queue.enqueue({ kind: 'lamp-update', id: 'b', partial: { x: 2 } });
    const p3 = queue.enqueue({ kind: 'lamp-delete', id: 'c' });

    await vi.runAllTimersAsync();
    await Promise.all([p1, p2, p3]);

    expect(order).toEqual(['lamp-update-a', 'lamp-update-b', 'lamp-delete-c']);
  });

  it('semantic 3: pause() lets in-flight finish, blocks new starts; resume() drains', async () => {
    const order: string[] = [];
    let releaseFirst: (() => void) | null = null;
    const options = makeOptions();
    (options.executors['lamp-update'] as ReturnType<typeof vi.fn>).mockImplementation(
      async (cmd: SyncCommand & { kind: 'lamp-update' }) => {
        order.push(`start-${cmd.id}`);
        if (cmd.id === 'a') {
          await new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
        }
        order.push(`end-${cmd.id}`);
      }
    );
    const queue = createSyncQueue(options);

    const p1 = queue.enqueue({ kind: 'lamp-update', id: 'a', partial: {} });
    // Let the first command start executing (it awaits releaseFirst).
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['start-a']);

    queue.pause();
    const p2 = queue.enqueue({ kind: 'lamp-update', id: 'b', partial: {} });

    // Finish the in-flight command; queue is paused so 'b' must not start.
    releaseFirst!();
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['start-a', 'end-a']);

    queue.resume();
    await vi.runAllTimersAsync();
    await Promise.all([p1, p2]);

    expect(order).toEqual(['start-a', 'end-a', 'start-b', 'end-b']);
  });

  it('semantic 4: clearPending() drops queued commands (resolving their promises) but leaves in-flight untouched', async () => {
    const order: string[] = [];
    let releaseFirst: (() => void) | null = null;
    const options = makeOptions();
    (options.executors['lamp-update'] as ReturnType<typeof vi.fn>).mockImplementation(
      async (cmd: SyncCommand & { kind: 'lamp-update' }) => {
        order.push(`start-${cmd.id}`);
        if (cmd.id === 'a') {
          await new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
        }
        order.push(`end-${cmd.id}`);
      }
    );
    const queue = createSyncQueue(options);

    const p1 = queue.enqueue({ kind: 'lamp-update', id: 'a', partial: {} });
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['start-a']);

    const p2 = queue.enqueue({ kind: 'lamp-update', id: 'b', partial: {} });
    expect(queue.pendingCount()).toBe(1);

    queue.clearPending();
    expect(queue.pendingCount()).toBe(0);
    await expect(p2).resolves.toBeUndefined(); // superseded, not rejected

    releaseFirst!();
    await vi.runAllTimersAsync();
    await p1;

    expect(order).toEqual(['start-a', 'end-a']); // 'b' never ran
  });

  it('semantic 6: drained() resolves immediately when idle', async () => {
    const queue = createSyncQueue(makeOptions());
    await expect(queue.drained()).resolves.toBeUndefined();
  });

  it('semantic 6: drained() resolves only once the last command settles', async () => {
    let release: (() => void) | null = null;
    const options = makeOptions();
    (options.executors['lamp-update'] as ReturnType<typeof vi.fn>).mockImplementation(
      async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
    );
    const queue = createSyncQueue(options);

    const p = queue.enqueue({ kind: 'lamp-update', id: 'a', partial: {} });
    let drainedResolved = false;
    const drainedPromise = queue.drained().then(() => {
      drainedResolved = true;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(drainedResolved).toBe(false); // still in-flight, not drained yet

    release!();
    await vi.runAllTimersAsync();
    await p;
    await drainedPromise;
    expect(drainedResolved).toBe(true);
  });

  it('pendingCount() reflects only queued (not in-flight) commands', async () => {
    let releaseFirst: (() => void) | null = null;
    const options = makeOptions();
    (options.executors['lamp-update'] as ReturnType<typeof vi.fn>).mockImplementation(
      async (cmd: SyncCommand & { kind: 'lamp-update' }) => {
        if (cmd.id === 'a') {
          await new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
        }
      }
    );
    const queue = createSyncQueue(options);

    const p1 = queue.enqueue({ kind: 'lamp-update', id: 'a', partial: {} });
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.pendingCount()).toBe(0); // 'a' is in-flight, not pending

    const p2 = queue.enqueue({ kind: 'lamp-update', id: 'z', partial: {} });
    expect(queue.pendingCount()).toBe(1);

    releaseFirst!();
    await vi.runAllTimersAsync();
    await Promise.all([p1, p2]);
  });
});

describe('syncQueue: coalescing (semantic 2)', () => {
  it('merges same-id zone-update partials into the queued command; both promises resolve on the merged run', async () => {
    const options = makeOptions();
    const zoneUpdate = options.executors['zone-update'] as ReturnType<typeof vi.fn>;
    const queue = createSyncQueue(options);

    queue.pause();
    const p1 = queue.enqueue({ kind: 'zone-update', id: 'z1', partial: { a: 1 } });
    const p2 = queue.enqueue({ kind: 'zone-update', id: 'z1', partial: { b: 2 } });
    expect(queue.pendingCount()).toBe(1);

    queue.resume();
    await vi.runAllTimersAsync();
    await Promise.all([p1, p2]);

    expect(zoneUpdate).toHaveBeenCalledTimes(1);
    expect(zoneUpdate).toHaveBeenCalledWith({ kind: 'zone-update', id: 'z1', partial: { a: 1, b: 2 } });
  });

  it('merges same-id lamp-update partials into the queued command', async () => {
    const options = makeOptions();
    const lampUpdate = options.executors['lamp-update'] as ReturnType<typeof vi.fn>;
    const queue = createSyncQueue(options);

    queue.pause();
    const p1 = queue.enqueue({ kind: 'lamp-update', id: 'l1', partial: { x: 1 } });
    const p2 = queue.enqueue({ kind: 'lamp-update', id: 'l1', partial: { y: 2 } });
    expect(queue.pendingCount()).toBe(1);

    queue.resume();
    await vi.runAllTimersAsync();
    await Promise.all([p1, p2]);

    expect(lampUpdate).toHaveBeenCalledTimes(1);
    expect(lampUpdate).toHaveBeenCalledWith({ kind: 'lamp-update', id: 'l1', partial: { x: 1, y: 2 } });
  });

  it('merges any two queued room-updates (no id) into one', async () => {
    const options = makeOptions();
    const roomUpdate = options.executors['room-update'] as ReturnType<typeof vi.fn>;
    const queue = createSyncQueue(options);

    queue.pause();
    const p1 = queue.enqueue({ kind: 'room-update', partial: { width: 1 } });
    const p2 = queue.enqueue({ kind: 'room-update', partial: { height: 2 } });
    expect(queue.pendingCount()).toBe(1);

    queue.resume();
    await vi.runAllTimersAsync();
    await Promise.all([p1, p2]);

    expect(roomUpdate).toHaveBeenCalledTimes(1);
    expect(roomUpdate).toHaveBeenCalledWith({ kind: 'room-update', partial: { width: 1, height: 2 } });
  });

  it('zone-type-change never coalesces, even with the same id', async () => {
    const options = makeOptions();
    const zoneTypeChange = options.executors['zone-type-change'] as ReturnType<typeof vi.fn>;
    const queue = createSyncQueue(options);

    queue.pause();
    const p1 = queue.enqueue({ kind: 'zone-type-change', id: 'z1', snapshot: { type: 'A' } });
    const p2 = queue.enqueue({ kind: 'zone-type-change', id: 'z1', snapshot: { type: 'B' } });
    expect(queue.pendingCount()).toBe(2);

    queue.resume();
    await vi.runAllTimersAsync();
    await Promise.all([p1, p2]);

    expect(zoneTypeChange).toHaveBeenCalledTimes(2);
    expect(zoneTypeChange.mock.calls[0][0]).toEqual({ kind: 'zone-type-change', id: 'z1', snapshot: { type: 'A' } });
    expect(zoneTypeChange.mock.calls[1][0]).toEqual({ kind: 'zone-type-change', id: 'z1', snapshot: { type: 'B' } });
  });

  it('zone-delete removes queued zone-update and zone-type-change for that id (their promises resolve, not reject); the delete itself still runs', async () => {
    const options = makeOptions();
    const zoneUpdate = options.executors['zone-update'] as ReturnType<typeof vi.fn>;
    const zoneTypeChange = options.executors['zone-type-change'] as ReturnType<typeof vi.fn>;
    const zoneDelete = options.executors['zone-delete'] as ReturnType<typeof vi.fn>;
    const queue = createSyncQueue(options);

    queue.pause();
    const pUpdate = queue.enqueue({ kind: 'zone-update', id: 'z1', partial: { a: 1 } });
    const pTypeChange = queue.enqueue({ kind: 'zone-type-change', id: 'z1', snapshot: { type: 'A' } });
    // Unrelated queued command for a different id must survive.
    const pOther = queue.enqueue({ kind: 'zone-update', id: 'other', partial: { c: 3 } });
    expect(queue.pendingCount()).toBe(3);

    const pDelete = queue.enqueue({ kind: 'zone-delete', id: 'z1' });
    // The two queued z1 commands are superseded immediately (synchronously), leaving delete + other.
    expect(queue.pendingCount()).toBe(2);

    queue.resume();
    await vi.runAllTimersAsync();
    await Promise.all([pUpdate, pTypeChange, pOther, pDelete]);

    expect(zoneUpdate).toHaveBeenCalledTimes(1); // only the 'other' id ran
    expect(zoneUpdate).toHaveBeenCalledWith({ kind: 'zone-update', id: 'other', partial: { c: 3 } });
    expect(zoneTypeChange).not.toHaveBeenCalled();
    expect(zoneDelete).toHaveBeenCalledTimes(1);
  });

  it('lamp-delete removes queued lamp-update for that id (its promise resolves, not rejects)', async () => {
    const options = makeOptions();
    const lampUpdate = options.executors['lamp-update'] as ReturnType<typeof vi.fn>;
    const lampDelete = options.executors['lamp-delete'] as ReturnType<typeof vi.fn>;
    const queue = createSyncQueue(options);

    queue.pause();
    const pUpdate = queue.enqueue({ kind: 'lamp-update', id: 'l1', partial: { x: 1 } });
    const pDelete = queue.enqueue({ kind: 'lamp-delete', id: 'l1' });
    expect(queue.pendingCount()).toBe(1); // update superseded, only delete remains

    queue.resume();
    await vi.runAllTimersAsync();
    await Promise.all([pUpdate, pDelete]);

    expect(lampUpdate).not.toHaveBeenCalled();
    expect(lampDelete).toHaveBeenCalledTimes(1);
  });

  it('coalescing only merges into queued commands, never the in-flight one', async () => {
    let release: (() => void) | null = null;
    const options = makeOptions();
    const zoneUpdate = options.executors['zone-update'] as ReturnType<typeof vi.fn>;
    zoneUpdate.mockImplementation(async (cmd: SyncCommand & { kind: 'zone-update' }) => {
      if (cmd.partial.first) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
    });
    const queue = createSyncQueue(options);

    const p1 = queue.enqueue({ kind: 'zone-update', id: 'z1', partial: { first: true } });
    await vi.advanceTimersByTimeAsync(0); // let the first command become in-flight
    expect(queue.pendingCount()).toBe(0);

    const p2 = queue.enqueue({ kind: 'zone-update', id: 'z1', partial: { second: true } });
    expect(queue.pendingCount()).toBe(1); // new queued entry, NOT merged into the in-flight one

    release!();
    await vi.runAllTimersAsync();
    await Promise.all([p1, p2]);

    expect(zoneUpdate).toHaveBeenCalledTimes(2);
    expect(zoneUpdate.mock.calls[0][0]).toEqual({ kind: 'zone-update', id: 'z1', partial: { first: true } });
    expect(zoneUpdate.mock.calls[1][0]).toEqual({ kind: 'zone-update', id: 'z1', partial: { second: true } });
  });
});

describe('syncQueue: retry on retryable failure (semantic 5)', () => {
  it('retries a 423 ApiError after the configured delay, then resolves on success', async () => {
    const options = makeOptions({ retryDelaysMs: [100] });
    const zoneUpdate = options.executors['zone-update'] as ReturnType<typeof vi.fn>;
    zoneUpdate
      .mockRejectedValueOnce(new ApiError(423, 'locked'))
      .mockResolvedValueOnce(undefined);
    const queue = createSyncQueue(options);

    const p = queue.enqueue({ kind: 'zone-update', id: 'z1', partial: { a: 1 } });
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBeUndefined();

    expect(zoneUpdate).toHaveBeenCalledTimes(2);
    expect(options.onError).not.toHaveBeenCalled();
  });

  it('uses the default retry delays / default isRetryable for a real 423 ApiError', async () => {
    const options = makeOptions();
    const zoneUpdate = options.executors['zone-update'] as ReturnType<typeof vi.fn>;
    zoneUpdate
      .mockRejectedValueOnce(new ApiError(423, 'locked'))
      .mockResolvedValueOnce(undefined);
    const queue = createSyncQueue(options);

    const p = queue.enqueue({ kind: 'zone-update', id: 'z1', partial: { a: 1 } });

    await vi.advanceTimersByTimeAsync(1999);
    expect(zoneUpdate).toHaveBeenCalledTimes(1); // retry not fired yet

    await vi.advanceTimersByTimeAsync(1);
    expect(zoneUpdate).toHaveBeenCalledTimes(2); // fires at the default 2000ms

    await expect(p).resolves.toBeUndefined();
  });

  it('exhausts retries -> onError then reject; the queue continues with the next command', async () => {
    const options = makeOptions({ retryDelaysMs: [10, 10] });
    const zoneUpdate = options.executors['zone-update'] as ReturnType<typeof vi.fn>;
    const lampUpdate = options.executors['lamp-update'] as ReturnType<typeof vi.fn>;
    const err = new ApiError(423, 'locked');
    zoneUpdate.mockRejectedValue(err);
    const queue = createSyncQueue(options);

    const pFail = queue.enqueue({ kind: 'zone-update', id: 'z1', partial: { a: 1 } });
    pFail.catch(() => {}); // intentionally ignored elsewhere; silence unhandled-rejection noise
    const pNext = queue.enqueue({ kind: 'lamp-update', id: 'l1', partial: { x: 1 } });

    await vi.runAllTimersAsync();

    await expect(pFail).rejects.toBe(err);
    expect(zoneUpdate).toHaveBeenCalledTimes(3); // initial attempt + 2 retries
    expect(options.onError).toHaveBeenCalledTimes(1);
    expect(options.onError).toHaveBeenCalledWith(
      { kind: 'zone-update', id: 'z1', partial: { a: 1 } },
      err
    );

    await expect(pNext).resolves.toBeUndefined();
    expect(lampUpdate).toHaveBeenCalledTimes(1); // queue was not wedged by the failure
  });

  it('a non-retryable error rejects immediately (no retry attempts)', async () => {
    const options = makeOptions();
    const zoneUpdate = options.executors['zone-update'] as ReturnType<typeof vi.fn>;
    const err = new Error('boom');
    zoneUpdate.mockRejectedValue(err);
    const queue = createSyncQueue(options);

    const p = queue.enqueue({ kind: 'zone-update', id: 'z1', partial: { a: 1 } });
    p.catch(() => {});
    await vi.runAllTimersAsync();

    await expect(p).rejects.toBe(err);
    expect(zoneUpdate).toHaveBeenCalledTimes(1); // no retries
    expect(options.onError).toHaveBeenCalledTimes(1);
    expect(options.onError).toHaveBeenCalledWith({ kind: 'zone-update', id: 'z1', partial: { a: 1 } }, err);
  });

  it('a 423 ApiError with no retries remaining (0-length retryDelaysMs) is terminal immediately', async () => {
    const options = makeOptions({ retryDelaysMs: [] });
    const zoneUpdate = options.executors['zone-update'] as ReturnType<typeof vi.fn>;
    const err = new ApiError(423, 'locked');
    zoneUpdate.mockRejectedValue(err);
    const queue = createSyncQueue(options);

    const p = queue.enqueue({ kind: 'zone-update', id: 'z1', partial: { a: 1 } });
    p.catch(() => {});
    await vi.runAllTimersAsync();

    await expect(p).rejects.toBe(err);
    expect(zoneUpdate).toHaveBeenCalledTimes(1);
    expect(options.onError).toHaveBeenCalledTimes(1);
  });

  it('a same-id coalesce arriving during the retry-delay wait merges into the retrying command before the retry fires', async () => {
    const options = makeOptions({ retryDelaysMs: [50] });
    const zoneUpdate = options.executors['zone-update'] as ReturnType<typeof vi.fn>;
    zoneUpdate
      .mockRejectedValueOnce(new ApiError(423, 'locked'))
      .mockResolvedValueOnce(undefined);
    const queue = createSyncQueue(options);

    const p1 = queue.enqueue({ kind: 'zone-update', id: 'z1', partial: { a: 1 } });

    // Let the first attempt run and fail; it should now be waiting-to-retry
    // (modeled as back at the head of the queue).
    await vi.advanceTimersByTimeAsync(0);
    expect(zoneUpdate).toHaveBeenCalledTimes(1);
    expect(queue.pendingCount()).toBe(1); // waiting-for-retry command counts as queued during the wait

    const p2 = queue.enqueue({ kind: 'zone-update', id: 'z1', partial: { b: 2 } });
    expect(queue.pendingCount()).toBe(1); // merged, not appended as a second entry

    await vi.runAllTimersAsync();
    await Promise.all([p1, p2]);

    expect(zoneUpdate).toHaveBeenCalledTimes(2);
    expect(zoneUpdate.mock.calls[1][0]).toEqual({
      kind: 'zone-update',
      id: 'z1',
      partial: { a: 1, b: 2 },
    });
    expect(options.onError).not.toHaveBeenCalled();
  });
});

describe('syncQueue: re-entrancy (semantic 7)', () => {
  it('an executor that enqueues during its own execution does not deadlock; the new command just appends', async () => {
    const order: string[] = [];
    let queue: SyncQueue;
    const options = makeOptions();
    (options.executors['lamp-update'] as ReturnType<typeof vi.fn>).mockImplementation(
      async (cmd: SyncCommand & { kind: 'lamp-update' }) => {
        order.push(`start-${cmd.id}`);
        if (cmd.id === 'a') {
          // Re-entrant enqueue call from inside an executor.
          queue.enqueue({ kind: 'lamp-update', id: 'b', partial: {} });
        }
        order.push(`end-${cmd.id}`);
      }
    );
    queue = createSyncQueue(options);

    await queue.enqueue({ kind: 'lamp-update', id: 'a', partial: {} });
    await vi.runAllTimersAsync();
    await queue.drained();

    expect(order).toEqual(['start-a', 'end-a', 'start-b', 'end-b']);
  });
});
