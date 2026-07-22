# Sync Command Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `project.ts`'s ad-hoc sync coordination (module-level flags, silent drops, echo-suppression booleans, one-off reconcile pushes) with a single serialized per-session command queue that owns ordering, pause/resume around init/reinit, coalescing, and retry policy.

**Architecture:** New `ui/src/lib/sync/syncQueue.ts` — a FIFO of typed sync commands drained one-at-a-time by pluggable executors. Mutation methods in `project.ts` enqueue instead of calling sync functions directly; backend echoes are applied as plain store writes (no re-entrancy possible, so `_syncEnabled` dies); init/reinit pause the queue and clear superseded commands after a successful full-state push (so the `lastModified` re-push hack and `withSyncGuard`'s silent drops die); HTTP 423 ("session busy", new from the per-session lock) gets a centralized retry policy.

**Tech Stack:** SvelteKit / Svelte 5 runes stores, Vitest + MSW (existing patterns in `project.test.ts`), no new dependencies.

## Global Constraints

- `.ts` files 2-space indent, Edit tool OK. **`.svelte` files: tabs, never Edit tool/sed — Python exact-replace or Write** (none expected to change in this plan; `+page.svelte` only if an API signature forces it — check `git status` first, another session may be active).
- Conventional commits, **no Co-Authored-By**. Changelog lines for user-facing changes in the same commit.
- TDD throughout: RED before GREEN, evidence in reports.
- After every task: `cd ui && pnpm test:run` fully green AND `pnpm check` at **0 errors** (CI now gates on it).
- Do NOT commit `api/uv.lock`. Do not touch `api/` at all — this plan is frontend-only.
- Public store API (`project.updateRoom/updateLamp/updateZone/removeLamp/removeZone/addZone/addLamp/...`) must not change signatures — editors and `+page.svelte` keep working unmodified.
- `adds`/`copies` stay direct-await (NOT queued) — they are awaited by callers and ordering vs. subsequent updates is guaranteed by UI flow (editor opens only after add resolves). Scope is updates + deletes + room updates.

## Current-state map (verified at d016c61 — line numbers will drift, symbols won't)

- Coordination flags in `ui/src/lib/stores/project.ts`: `_syncEnabled` (L171, toggled at L1035/1044, L1227/1391, L1896/1918, L2050/2058), `_sessionInitialized` (L165, gates L409/L428/L585/L677), `_sessionReadyPromise` (L169), `_lastRoomSyncPromise` (L178, set L1722, awaited L1760), `_refreshStandardZonesCounter` (L175).
- Sync functions: `withSyncGuard` (L405), `syncRoom` (L427), `syncUpdateLamp` (L575), `syncDeleteLamp` (L661), `syncUpdateZone` (L670, type-change branch L684–710 does same-id delete+recreate), `syncDeleteZone` (L730). Zone PATCH goes through `syncZoneToBackend` in `ui/src/lib/sync/zoneSyncService.ts` (keep as-is — it becomes the zone-update executor's body).
- Echo application: `updateZoneFromBackendInternal` (L1034, wraps store write in `_syncEnabled=false`), `evictZoneResults` (L1049), `applyStateHashes` (L129).
- Init re-push hack (dies in Task 3): `initSession` L1110–1115 re-pushes full state when `latest.lastModified !== current.lastModified`.
- 423: no special-casing anywhere in `client.ts` today; surfaces as generic `ApiError`. Session-expiry recovery (`handleSessionRecovery`, single retry via `_isRetry`) lives in `client.ts` and stays untouched.
- Editor debounce: ZoneEditor 100ms (`saveTimeout`, type-change bypasses it deliberately), LampEditor 100ms. Unchanged by this plan — coalescing in the queue is belt-and-suspenders on top.
- Tests that pin current behavior: `project.test.ts` `describe('zone type change')` L937, `describe('client-minted IDs')` L1001, `describe('standard zones toggle')` L541, `zoneSyncService.test.ts`.

---

### Task 1: syncQueue module (pure, fully unit-tested)

**Files:**
- Create: `ui/src/lib/sync/syncQueue.ts`
- Test: `ui/src/lib/sync/syncQueue.test.ts`

**Interfaces (Produces — later tasks rely on these exact names):**

```ts
export type SyncCommand =
  | { kind: 'room-update'; partial: Record<string, unknown> }
  | { kind: 'lamp-update'; id: string; partial: Record<string, unknown> }
  | { kind: 'lamp-delete'; id: string }
  | { kind: 'zone-update'; id: string; partial: Record<string, unknown> }
  | { kind: 'zone-type-change'; id: string; snapshot: Record<string, unknown> }
  | { kind: 'zone-delete'; id: string };

export interface SyncQueue {
  enqueue(cmd: SyncCommand): Promise<void>;  // resolves when THIS command completes (or is coalesced into one that completes); rejects only on non-retryable failure AFTER the error has been reported via onError
  pause(): void;
  resume(): void;
  clearPending(): void;                      // drop queued (not in-flight) commands — used after a successful full-state replay supersedes them
  pendingCount(): number;
  drained(): Promise<void>;                  // resolves when queue is empty and nothing in flight
}

export interface SyncQueueOptions {
  executors: { [K in SyncCommand['kind']]: (cmd: Extract<SyncCommand, { kind: K }>) => Promise<void> };
  onError: (cmd: SyncCommand, error: unknown) => void;   // terminal failures only (after retries)
  isRetryable?: (error: unknown) => boolean;             // default: ApiError status 423
  retryDelaysMs?: number[];                              // default [2000, 5000, 10000]
}

export function createSyncQueue(options: SyncQueueOptions): SyncQueue;
```

Semantics to implement (each is a test):
1. FIFO: commands execute one at a time, in enqueue order.
2. Coalescing on enqueue: a new `zone-update`/`lamp-update` with the same `id` (or any `room-update`) merges its `partial` (`{...old, ...new}`) into an existing **queued** (not in-flight) command of the same kind+id; the earlier command's `enqueue` promise resolves when the merged command completes. `zone-type-change` never coalesces. A `zone-delete`/`lamp-delete` removes queued `*-update`s (and queued `zone-type-change`) for that id — their promises resolve (treat as superseded, not failed).
3. `pause()`: in-flight command finishes; nothing new starts; enqueue still accepts and coalesces. `resume()` drains.
4. `clearPending()`: queued commands dropped, their enqueue promises resolve (superseded); in-flight unaffected.
5. Retry: executor throws → if `isRetryable(error)` and retries remain, wait `retryDelaysMs[attempt]` (use real `setTimeout`; tests use `vi.useFakeTimers`) and re-run THE SAME command (a same-id coalesce arriving during the wait merges into it before the retry fires); retries exhausted or non-retryable → `onError(cmd, error)` then reject that command's promise; the queue CONTINUES with the next command (one failure must not wedge the queue).
6. `drained()` resolves immediately when idle; otherwise when the last command settles.
7. Re-entrancy: an executor that enqueues (shouldn't happen, but) must not deadlock — new command just appends.

Steps (TDD, one semantic at a time — write the failing test, watch it fail, implement, watch it pass; commit once at the end of the task):

- [ ] **Step 1:** Tests+impl for semantics 1, 3, 4, 6 (core FIFO/pause/clear/drained) — fake executors pushing to an array, `vi.useFakeTimers` + `await vi.runAllTimersAsync()` for async settling.
- [ ] **Step 2:** Tests+impl for semantic 2 (coalescing incl. delete-supersedes-updates, promise resolution of merged/superseded commands).
- [ ] **Step 3:** Tests+impl for semantic 5 (retry): default `isRetryable` recognizes `ApiError` with `status === 423` (import `ApiError` from `$lib/api/client`); test retryable-then-success, retries-exhausted→onError→reject→queue continues, non-retryable immediate onError, coalesce-during-retry-wait.
- [ ] **Step 4:** Semantic 7 test. Full file green: `pnpm vitest run src/lib/sync/syncQueue.test.ts`.
- [ ] **Step 5:** `pnpm test:run` (all green) + `pnpm check` (0 errors). Commit: `feat: add serialized sync command queue with coalescing and 423 retry`. No changelog (not yet user-visible — nothing uses it).

### Task 2: route updates/deletes through the queue; delete `_syncEnabled`

**Files:**
- Modify: `ui/src/lib/stores/project.ts`
- Test: `ui/src/lib/stores/project.test.ts` (behavior must stay green; add new describe `('sync queue integration')`)

**Consumes:** `createSyncQueue`, `SyncCommand` from Task 1.

Wiring (inside `createProjectStore()` so executors close over `update`/`get`):
- Instantiate one queue. Executors reuse the EXISTING sync-function bodies, renamed as executors: `room-update` ← body of `syncRoom` (minus the `_sessionInitialized`/`_syncEnabled` guard); `lamp-update` ← body of `syncUpdateLamp` (keep the callback plumbing by capturing the callbacks in the closure the same way `updateLamp` passes them today — move the callback wiring into the executor via a per-command options side-map keyed by command object, or simplest: keep `syncUpdateLamp` as a function and have the executor call it); `zone-update` ← `syncZoneToBackend` + computed-values application; `zone-type-change` ← the delete+recreate branch (delete → re-add same id → `evictZoneResults` → apply computed); `zone-delete`/`lamp-delete` ← the delete calls.
- `onError`: `parseBudgetError` → `syncErrors.add(op, msg, 'warning')`, else `syncErrors.add(op, error)` — unify budget handling for ALL kinds (today only zone+guard paths parse budget; room/lamp don't — this is a deliberate small improvement, note in changelog).
- Mutation methods swap direct sync calls for `enqueue`: `updateRoom` → `enqueue({kind:'room-update', partial})` (keep assigning the returned promise where `_lastRoomSyncPromise` was assigned — Task 3 removes it), `updateLamp` → `enqueue({kind:'lamp-update',...})`, `updateZone` → type-change ? `enqueue({kind:'zone-type-change', id, snapshot: zoneToSessionZone(zone)})` : `enqueue({kind:'zone-update',...})`, `removeLamp`/`removeZone` → delete commands. `updateRoom`'s standard-zone add/delete round-trip (currently `withSyncGuard('Add zone'...)`) keeps its direct-await form BUT must be ordered after the room patch: await the room-update `enqueue` promise first (this preserves today's sequencing).
- **Delete `_syncEnabled` entirely**: `updateZoneFromBackendInternal` becomes a plain `update(...)` (rename to `applyZoneServerValues` for honesty); `changeUnits` (L1227/1391) and `updateLampFromAdvanced` (L2050/2058) drop their toggles — verify each site only ever used the flag to suppress echo-triggered re-sync, which can no longer happen since sync fires only from explicit `enqueue` calls; delete `setSyncEnabled` from the public API and fix its callers (grep — `changeUnits` internal only).
- KEEP `_sessionInitialized` as a queue-pause driver for now: while false, the queue starts paused (Task 3 formalizes). The old `withSyncGuard`/`syncRoom`/`syncUpdateLamp`/`syncUpdateZone` early-return guards are DELETED — enqueue always accepts.

Steps:
- [ ] **Step 1 (RED):** New tests in `project.test.ts` `describe('sync queue integration')`: (a) two rapid `updateZone(id, {height:1}); updateZone(id, {num_x:30})` produce ONE PATCH containing both fields (MSW handler counts requests + captures body — proves coalescing through the store); (b) `updateZone` then `removeZone` before drain → NO PATCH is sent, one DELETE (delete supersedes update); (c) a 423 response then success → the PATCH is retried and succeeds, no error toast (`syncErrors` empty; use fake timers to advance the retry delay); (d) existing `describe('zone type change')` and `describe('standard zones toggle')` must pass UNMODIFIED except awaiting `vi.runAllTimersAsync()` where drains are now async. Watch (a)-(c) fail against current code.
- [ ] **Step 2 (GREEN):** Implement the wiring above. Iterate until the new describe passes AND all pre-existing project.test.ts tests pass (fix tests ONLY for timing/microtask ordering, never assertions).
- [ ] **Step 3:** `pnpm test:run` + `pnpm check` (0 errors). Grep `_syncEnabled|setSyncEnabled|withSyncGuard` → zero hits.
- [ ] **Step 4:** Commit (changelog `### Fixed`: "Rapid edits to the same lamp/zone can no longer arrive out of order or race a delete — backend sync is serialized through a command queue; transient 'session busy' responses retry automatically instead of surfacing an error"). `fix: serialize backend sync through a command queue`

### Task 3: init/reinit integration — pause/replay/clear; delete the re-push hack

**Files:**
- Modify: `ui/src/lib/stores/project.ts`
- Test: `ui/src/lib/stores/project.test.ts`

**Consumes:** queue instance from Task 2.

Behavior:
- Queue starts **paused**. `initSession`: pause queue → snapshot → `apiCreateSession` → `apiInitSession(snapshot)` → on success `clearPending()` (the full-state push supersedes anything enqueued before/during init — including edits made in the settle window, because the SNAPSHOT is taken inside initSession *after* pause, and any later edit re-enqueues... **careful**: an edit AFTER the snapshot but BEFORE init resolves is NOT in the snapshot and its command must NOT be cleared). Correct rule: `clearPending` may only drop commands enqueued BEFORE the snapshot was taken. Implement by draining-generation: capture `pendingCount` boundary — simplest correct implementation: swap in a fresh internal array at snapshot time (`markReplayBoundary()`: extend the Task 1 queue with this — commands enqueued before the boundary are cleared by `clearPending()`, ones after survive). Add `markReplayBoundary()` to syncQueue with its own unit test in `syncQueue.test.ts` (TDD there first).
- **Delete the L1110–1115 lastModified re-push block** — the boundary+queue makes it redundant: pre-snapshot edits are IN the snapshot; post-snapshot edits are queued and drain after `resume()`.
- `reinitializeSession`: same pattern (pause → snapshot → init → clearPending-behind-boundary → resume). On init FAILURE: resume the queue anyway? No — leave paused and `onError`-toast once ("Session initialization failed"); commands stay queued for the next successful reinit (they'll be superseded by its snapshot). Document this in a comment.
- `refreshStandardZones`: replace `await _lastRoomSyncPromise` with `await queue.drained()` (it needs the room PATCH to have landed; drained is the honest condition). Delete `_lastRoomSyncPromise`.
- `sessionReady()` stays (callers await init settling, distinct from queue idle).

Steps:
- [ ] **Step 1 (RED, queue):** `markReplayBoundary()` unit tests in `syncQueue.test.ts`: enqueue A, mark boundary, enqueue B, `clearPending()` → A dropped (resolved as superseded), B survives and executes on resume.
- [ ] **Step 2 (GREEN, queue):** implement in `syncQueue.ts`.
- [ ] **Step 3 (RED, store):** `project.test.ts` tests: (a) "edit during init lands after init": start `initSession` (MSW init handler delayed via deferred promise), call `updateRoom({x:9})` while init in flight, resolve init → assert a PATCH /session/room with `x:9` follows the init POST (this is the regression test for the save-load-race class — currently covered by the re-push hack; the test must pass against the NEW mechanism); (b) "pre-snapshot edits are not double-sent": edits made BEFORE `initSession()` is called appear in the init payload and produce NO separate PATCH afterward; (c) reinit failure leaves commands queued, next successful reinit supersedes them (no PATCH from the stale command). Watch them fail meaningfully first (a will pass trivially under the old re-push for the room case — assert specifically that the mechanism is a PATCH, not a second full init POST, which the re-push would produce).
- [ ] **Step 4 (GREEN, store):** implement; delete the re-push block and `_lastRoomSyncPromise`.
- [ ] **Step 5:** Full `pnpm test:run` + `pnpm check` 0 errors. Grep `_lastRoomSyncPromise` → zero. Commit (changelog `### Fixed`: "Edits made while the backend session is still initializing or recovering are queued and delivered in order once it's ready, instead of relying on a one-shot state re-push"). `fix: queue-based init/reinit reconciliation replaces re-push hack`

### Task 4: end-to-end verification + conventions

**Files:**
- Modify: local `CLAUDE.md` (untracked by design — edit, don't commit), `.superpowers/sdd/progress.md`

Steps:
- [ ] **Step 1:** Full suites: `cd ui && pnpm test:run` (green), `pnpm check` (0 errors), `cd api && uv run pytest tests/ -q` (untouched but confirm), `cd e2e && npx playwright test` (ALL specs — session-recovery.spec.ts and save-load.spec.ts are the critical ones for this plan; servers: start backend via `cd api && uv run uvicorn app.main:app --port 8000` if nothing on 8000, vite via playwright config).
- [ ] **Step 2:** Add one line to local CLAUDE.md Conventions: "**All backend sync flows through the sync queue** (`ui/src/lib/sync/syncQueue.ts`) — never call session mutation endpoints directly from store/components for updates/deletes; enqueue a command. Echo application is a plain store write (no suppression flags)."
- [ ] **Step 3:** Verify changelog [Unreleased] reflects both user-facing lines from Tasks 2–3. Final commit if anything outstanding.

## Verification (whole-plan)

1. All three suites + full e2e green (Task 4).
2. Greps return zero: `_syncEnabled`, `withSyncGuard`, `_lastRoomSyncPromise`, `setSyncEnabled`.
3. Manual smoke (dev servers): edit zone fields rapidly → single coalesced save; change zone type → identity preserved, grid updates; start a calculation then immediately edit the room → no error toast, edit lands after calc (423 retry); let session expire (or kill+restart backend) → edit during recovery → edit persists after recovery.
