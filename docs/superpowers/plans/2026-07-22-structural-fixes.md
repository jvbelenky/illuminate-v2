# Structural Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the structural fixes agreed in the July 2026 architecture review: backend correctness cleanups, OpenAPI codegen for the UI↔API contract, client-authoritative IDs, and svelte-check to zero with a CI gate.

**Architecture:** Four phases. Phase A: three self-contained backend fixes (diagnostic hot-path removal, error-detail sanitization, per-session lock). Phase B: generate TypeScript types from FastAPI's OpenAPI schema, commit the generated artifacts, gate freshness in CI, and migrate a first slice of hand-written types. Phase C: make client-supplied IDs authoritative (backend accepts optional `id` with `on_collision="error"`; frontend mints UUIDs; the zone type-change ID-remap machinery becomes dead code and is deleted). Phase D: drive svelte-check errors to zero and gate it in CI.

**Tech Stack:** FastAPI/Pydantic, guv_calcs (local at `~/guv-calcs`), SvelteKit + Svelte 5 runes, Vitest + MSW, openapi-typescript.

## Global Constraints

- **Never edit `.svelte` files with the Edit tool or sed** — use the `editing-svelte-files` skill (Python helper / Write tool). `.svelte` files use **tabs**; `.ts` uses 2-space; `.py` uses 4-space indentation.
- **No `Co-Authored-By` trailers** on commits.
- **Changelog**: every user-facing change adds a line to `CHANGELOG.md` `[Unreleased]` in the same commit. Infrastructure/test/CI changes don't.
- **Never commit to `~/guv-calcs`** — this plan needs no guv_calcs changes; if one seems needed, stop and ask.
- **Run tests before every commit**: `pnpm test:run` in `ui/` for frontend changes; `uv run pytest tests/` in `api/` for backend changes.
- **Another Claude session may be active in this repo.** Before starting any task that modifies `ui/src/lib/stores/project.ts` or `ui/src/routes/+page.svelte`, run `git status --short` — if either file is dirty, pause that task and do a non-conflicting one instead.
- API test suite is slow (real guv_calcs calculations). Prefer `-k <pattern>` while iterating; run the full suite before commit.

---

## Phase A — Backend correctness cleanups

### Task 1: Remove [DIAG] diagnostics from the calculate hot path

**Files:**
- Modify: `api/api/v1/calculation_routers.py:191-218`

The block runs `wrf.get_statistics()` and `l.ies.photometry.interpolated()` for every lamp on **every** `/session/calculate`, unconditionally (the expensive calls are outside the f-strings; even the f-strings evaluate before `logger.debug` checks level). It was debug scaffolding.

- [ ] **Step 1: Delete the block**

Delete from `# --- Diagnostic logging for WholeRoomFluence ---` (line 191) through the closing `logger.debug(...)` at line 218 inclusive, leaving `# Collect results` as the code that follows `log_calculation_complete(estimate, actual_time)`.

- [ ] **Step 2: Run calculation tests**

Run: `cd api && uv run pytest tests/ -k "calc" -x -q`
Expected: PASS (same count as before the change)

- [ ] **Step 3: Run full API suite**

Run: `cd api && uv run pytest tests/ -q`
Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add api/api/v1/calculation_routers.py
git commit -m "perf: remove per-lamp diagnostic logging from calculate hot path"
```

(No changelog entry — internal perf/log change, borderline; skip.)

### Task 2: Stop leaking internal exception text in HTTP error details

**Files:**
- Modify: `api/api/v1/session_helpers.py:135-144` (`_log_and_raise`)
- Test: `api/tests/test_error_detail.py` (create)

Current behavior: `detail=f"{operation}: {e}"` for *any* exception — arbitrary internal error text (paths, library internals) reaches clients. But guv_calcs raises user-meaningful `ValueError`s for validation ("x2 must be greater than x1"), and the frontend shows `detail` in toasts, so those must keep flowing.

Policy: `HTTPException` → re-raise unchanged (existing). `ValueError` → keep message (user-facing validation). Anything else → generic `detail=operation`, full details logged server-side (already done).

- [ ] **Step 1: Write the failing test**

Create `api/tests/test_error_detail.py`:

```python
"""_log_and_raise must not leak internal exception details to clients."""
import pytest
from fastapi import HTTPException

from api.v1.session_helpers import _log_and_raise


def test_value_error_message_passes_through():
    with pytest.raises(HTTPException) as exc_info:
        _log_and_raise("Failed to update zone", ValueError("x2 must be greater than x1"))
    assert exc_info.value.status_code == 400
    assert "x2 must be greater than x1" in exc_info.value.detail


def test_http_exception_reraised_unchanged():
    original = HTTPException(status_code=404, detail="Zone 'foo' not found")
    with pytest.raises(HTTPException) as exc_info:
        _log_and_raise("Failed to update zone", original)
    assert exc_info.value is original


def test_internal_exception_detail_is_generic():
    with pytest.raises(HTTPException) as exc_info:
        _log_and_raise(
            "Failed to update zone",
            RuntimeError("secret internal state at /home/user/guv-calcs/room.py:123"),
        )
    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Failed to update zone"
    assert "secret" not in exc_info.value.detail
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && uv run pytest tests/test_error_detail.py -v`
Expected: `test_internal_exception_detail_is_generic` FAILS (detail contains "secret internal state..."); the other two PASS.

- [ ] **Step 3: Implement**

In `api/api/v1/session_helpers.py`, replace the body of `_log_and_raise`:

```python
def _log_and_raise(operation: str, e: Exception, status_code: int = 400) -> None:
    """Log error details server-side and raise a client-safe HTTPException.

    HTTPExceptions re-raise unchanged (structured errors, e.g. budget).
    ValueError messages pass through: guv_calcs uses them for user-facing
    validation ("x2 must be greater than x1"). Everything else gets a
    generic detail so internal state never reaches the client.
    """
    logger.error(f"{operation}: {e}", exc_info=True)
    if isinstance(e, HTTPException):
        raise e
    if isinstance(e, ValueError):
        raise HTTPException(status_code=status_code, detail=f"{operation}: {e}")
    raise HTTPException(status_code=status_code, detail=operation)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && uv run pytest tests/test_error_detail.py -v`
Expected: 3 PASS

- [ ] **Step 5: Full API suite** (some tests may assert on error detail text — fix any that assert internal-exception details, keeping assertions on ValueError/HTTPException details)

Run: `cd api && uv run pytest tests/ -q`
Expected: all pass

- [ ] **Step 6: Commit** (with changelog line under `### Fixed`: "API error responses no longer include internal exception details; validation messages still pass through")

```bash
git add api/api/v1/session_helpers.py api/tests/test_error_detail.py CHANGELOG.md
git commit -m "fix: stop leaking internal exception text in API error details"
```

### Task 3: Per-session lock for mutating requests

**Files:**
- Modify: `api/api/v1/session_manager.py` (Session class, ~line 33-82)
- Modify: `api/api/v1/session_helpers.py` (new context manager + dependency)
- Modify: mutating handlers in `api/api/v1/session_core.py`, `lamp_session_routers.py`, `zone_session_routers.py`, `calculation_routers.py`
- Test: `api/tests/test_session_lock.py` (create)

The `SessionManager` RLock guards the sessions **dict**, not the objects inside. Two concurrent requests on one session mutate the same live `Room` unguarded (the 0.1.1 "mutating calc_zones during iteration" bug was one symptom; `zone_session_routers.py:296`'s defensive `list()` snapshot is another).

Design: `threading.Lock` per `Session` (plain Lock, NOT RLock — release may happen on a different thread than acquire for the async calculate handler; RLock forbids that). Mutating handlers acquire with a timeout; on timeout raise 423 Locked ("Session is busy"). Read-only GETs stay lock-free (status quo). Calculate holds the lock for the whole calculation — concurrent *edits* during a calc now fail fast with a clear error instead of corrupting the in-progress calculation.

**Interfaces:**
- Produces: `session.lock: threading.Lock`; `locked_session(session)` context manager in `session_helpers.py` (raises `HTTPException(423)` after `LOCK_TIMEOUT_SECONDS = 10`).

- [ ] **Step 1: Write the failing test**

Create `api/tests/test_session_lock.py`:

```python
"""Per-session lock: mutating endpoints serialize; a held lock returns 423."""
import threading

from api.v1.session_helpers import locked_session
from api.v1.session_manager import Session


def test_session_has_lock():
    session = Session("test-id")
    assert isinstance(session.lock, type(threading.Lock()))


def test_locked_session_acquires_and_releases():
    session = Session("test-id")
    with locked_session(session):
        assert session.lock.locked()
    assert not session.lock.locked()


def test_locked_session_raises_423_when_held(monkeypatch):
    import api.v1.session_helpers as helpers
    from fastapi import HTTPException
    import pytest

    monkeypatch.setattr(helpers, "LOCK_TIMEOUT_SECONDS", 0.05)
    session = Session("test-id")
    session.lock.acquire()
    try:
        with pytest.raises(HTTPException) as exc_info:
            with locked_session(session):
                pass
        assert exc_info.value.status_code == 423
    finally:
        session.lock.release()
```

Note: check `Session.__init__`'s actual signature in `session_manager.py` first and construct accordingly (it may require/generate a token).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && uv run pytest tests/test_session_lock.py -v`
Expected: FAIL — `Session` has no attribute `lock`; `locked_session` import error.

- [ ] **Step 3: Implement**

In `Session.__init__` (session_manager.py), add:

```python
self.lock = threading.Lock()  # serializes mutating requests on this session
```

(add `import threading` if absent). In `session_helpers.py`:

```python
from contextlib import contextmanager

LOCK_TIMEOUT_SECONDS = 10


@contextmanager
def locked_session(session: Session):
    """Serialize mutating requests against one session's live Room.

    Read-only endpoints don't take the lock; a long calculation holds it,
    so edits during a calc fail fast instead of corrupting it.
    """
    if not session.lock.acquire(timeout=LOCK_TIMEOUT_SECONDS):
        raise HTTPException(
            status_code=423,
            detail="Session is busy with another operation. Try again shortly.",
        )
    try:
        yield session
    finally:
        session.lock.release()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && uv run pytest tests/test_session_lock.py -v`
Expected: 3 PASS

- [ ] **Step 5: Wrap mutating handlers**

In every **mutating** session handler (POST/PATCH/DELETE in `session_core.py` [init, room, units, load], `lamp_session_routers.py` [add/update/delete/copy lamp, file uploads], `zone_session_routers.py` [add/update/delete/copy zone]), wrap the existing `try:` body:

```python
    with locked_session(session):
        # existing try/except body unchanged, indented one level
```

For the async `calculate_session` in `calculation_routers.py`, acquire without blocking the event loop, around the existing semaphore/executor block:

```python
    loop = asyncio.get_event_loop()
    acquired = await loop.run_in_executor(None, lambda: session.lock.acquire(timeout=LOCK_TIMEOUT_SECONDS))
    if not acquired:
        raise HTTPException(status_code=423, detail="Session is busy with another operation. Try again shortly.")
    try:
        ...  # existing calculation logic
    finally:
        session.lock.release()
```

Leave GET endpoints (zones list, plots, exports, save) lock-free.

- [ ] **Step 6: Full API suite**

Run: `cd api && uv run pytest tests/ -q`
Expected: all pass (module-scoped fixtures are single-threaded; no 423s expected).

- [ ] **Step 7: Commit** (changelog `### Fixed`: "Concurrent edits to the same session can no longer corrupt each other — mutating requests are serialized per session; edits during a running calculation return a clear 'session busy' error instead of racing it")

```bash
git add api/api/v1/session_manager.py api/api/v1/session_helpers.py \
  api/api/v1/session_core.py api/api/v1/lamp_session_routers.py \
  api/api/v1/zone_session_routers.py api/api/v1/calculation_routers.py \
  api/tests/test_session_lock.py CHANGELOG.md
git commit -m "fix: serialize mutating requests per session with a lock"
```

---

## Phase B — OpenAPI codegen for the UI↔API contract

### Task 4: OpenAPI export + TypeScript generation

**Files:**
- Create: `api/scripts/export_openapi.py`
- Create: `ui/src/lib/api/generated/api-types.ts` (generated, committed)
- Create: `api/openapi.json` (generated, committed)
- Modify: `ui/package.json` (devDependency + script), `Makefile` (target)

**Interfaces:**
- Produces: `make generate-api` regenerates both artifacts; TS types importable as `import type { components, paths } from '$lib/api/generated/api-types'`.

- [ ] **Step 1: Write the export script**

`api/scripts/export_openapi.py`:

```python
"""Export the FastAPI OpenAPI schema to api/openapi.json (repo contract artifact).

Run via: uv run python scripts/export_openapi.py
Regenerate whenever API schemas change; CI fails if the committed copy is stale.
"""
import json
from pathlib import Path

from app.main import app

OUT = Path(__file__).resolve().parent.parent / "openapi.json"


def main() -> None:
    schema = app.openapi()
    OUT.write_text(json.dumps(schema, indent=2, sort_keys=True) + "\n")
    print(f"Wrote {OUT} ({len(schema.get('paths', {}))} paths)")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run it**

Run: `cd api && uv run python scripts/export_openapi.py`
Expected: `Wrote .../api/openapi.json (N paths)` with N ≈ 40+.
Sanity-check: `python -c "import json; s=json.load(open('openapi.json')); print(list(s['components']['schemas'])[:10])"` shows `AddZoneResponse`, `RoomInput`, etc.

- [ ] **Step 3: Add openapi-typescript and generate**

```bash
cd ui && pnpm add -D openapi-typescript
```

Add to `ui/package.json` scripts:

```json
"generate:api": "openapi-typescript ../api/openapi.json -o src/lib/api/generated/api-types.ts"
```

Run: `pnpm generate:api`
Expected: file created; open it and confirm `components['schemas']['RoomInput']` exists and the `standard` field is a string-literal union matching `api/api/v1/schemas.py:19`.

- [ ] **Step 4: Makefile target**

Add to `Makefile`:

```makefile
generate-api:  ## Regenerate OpenAPI schema + TS types from FastAPI app
	cd api && uv run python scripts/export_openapi.py
	cd ui && pnpm generate:api
```

- [ ] **Step 5: Verify nothing broke**

Run: `cd ui && pnpm test:run` — all pass. `pnpm check` — error count not worse than baseline.

- [ ] **Step 6: Commit**

```bash
git add api/scripts/export_openapi.py api/openapi.json \
  ui/src/lib/api/generated/api-types.ts ui/package.json ui/pnpm-lock.yaml Makefile
git commit -m "feat: generate TypeScript API types from FastAPI OpenAPI schema"
```

(No changelog — infrastructure.)

### Task 5: CI freshness gate for generated contract

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add a `contract` job**

```yaml
  contract:
    name: API Contract Freshness
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
          cache-dependency-path: ui/pnpm-lock.yaml
      - uses: astral-sh/setup-uv@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: cd api && uv sync --no-sources --locked --dev
      - run: cd ui && pnpm install --frozen-lockfile
      - name: Regenerate and diff
        run: |
          cd api && uv run python scripts/export_openapi.py && cd ..
          cd ui && pnpm generate:api && cd ..
          git diff --exit-code api/openapi.json ui/src/lib/api/generated/api-types.ts || {
            echo "::error::Generated API contract is stale. Run 'make generate-api' and commit."
            exit 1
          }
```

- [ ] **Step 2: Verify locally** — rerun `make generate-api`; `git status` clean (idempotent). Then temporarily add a junk field to a Pydantic schema, regenerate, confirm diff appears; revert.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: fail when committed OpenAPI contract artifacts are stale"
```

### Task 6: Migrate first slice of hand-written types to generated

**Files:**
- Modify: `ui/src/lib/types/project.ts` (the `standard` union, ~line 49), `ui/src/lib/api/client.ts` (`AddZoneResponse`-shaped and zone-update response interfaces)
- Test: existing suites (behavior unchanged — types only)

Pattern to establish (repeatable for future migration):

```ts
import type { components } from '$lib/api/generated/api-types';

export type GuvStandard = components['schemas']['RoomInput']['standard'];
export type AddZoneResponse = components['schemas']['AddZoneResponse'];
```

- [ ] **Step 1:** Replace the hand-written `standard` literal union in `types/project.ts` with `GuvStandard` (exported from a new small module `ui/src/lib/api/contract.ts` that centralizes generated-type aliases). Update imports where the union was referenced.
- [ ] **Step 2:** In `client.ts`, replace the hand-written interfaces that mirror `AddZoneResponse` and `SessionZoneUpdateResponse` with aliases from `contract.ts`. Keep the Zod `.passthrough()` runtime validation untouched.
- [ ] **Step 3:** Run `pnpm check` (errors not worse) and `pnpm test:run` (all pass).
- [ ] **Step 4: Commit**

```bash
git add ui/src/lib/api/contract.ts ui/src/lib/types/project.ts ui/src/lib/api/client.ts
git commit -m "refactor: source standard union and zone response types from generated contract"
```

---

## Phase C — Client-authoritative IDs

### Task 7: Backend accepts client-supplied IDs with collision errors

**Files:**
- Modify: `api/api/v1/session_schemas.py` (`SessionZoneInput`, `SessionLampInput`/`LampInput` — add optional `id`), `api/api/v1/session_helpers.py` (`_create_zone_from_input`, `_create_lamp_from_input` — thread the id through), `api/api/v1/zone_session_routers.py` (`add_session_zone`), `api/api/v1/lamp_session_routers.py` (add lamp)
- Test: `api/tests/test_client_ids.py` (create)

guv_calcs already supports this: `Registry.add(obj, on_collision="error")` raises `KeyError("ID '...' already exists.")` (`scene_registry.py:132-144`); `room.add_calc_zone`/`add_lamp` forward `**kwargs` to the registry. Verify the kwarg forwarding at `room.py:581,670` before implementing.

Behavior: if the input carries `id`, construct the guv object with that id and add with `on_collision="error"`; map `KeyError` → HTTP 409. If no `id`, current behavior (registry assigns/increments) is unchanged — fully backward compatible.

- [ ] **Step 1: Write the failing tests**

```python
"""Client-supplied IDs are authoritative; collisions are 409s."""


def test_zone_add_honors_client_id(initialized_session):
    client, headers = initialized_session
    resp = client.post(
        "/api/v1/session/zones",
        json={"name": "my zone", "zone_type": "plane", "id": "zone-abc123",
              "x1": 0, "x2": 4, "y1": 0, "y2": 6, "height": 1.9},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["zone_id"] == "zone-abc123"


def test_zone_add_duplicate_client_id_is_409(initialized_session):
    client, headers = initialized_session
    payload = {"name": "my zone", "zone_type": "plane", "id": "zone-dup",
               "x1": 0, "x2": 4, "y1": 0, "y2": 6, "height": 1.9}
    assert client.post("/api/v1/session/zones", json=payload, headers=headers).status_code == 200
    resp = client.post("/api/v1/session/zones", json=payload, headers=headers)
    assert resp.status_code == 409


def test_zone_add_without_id_keeps_legacy_behavior(initialized_session):
    client, headers = initialized_session
    payload = {"name": "my zone", "zone_type": "plane",
               "x1": 0, "x2": 4, "y1": 0, "y2": 6, "height": 1.9}
    r1 = client.post("/api/v1/session/zones", json=payload, headers=headers)
    r2 = client.post("/api/v1/session/zones", json=payload, headers=headers)
    assert r1.json()["zone_id"] != r2.json()["zone_id"]  # registry increments
```

(Adapt fixture names and the exact zone-input payload shape to `api/tests/conftest.py` — use the same function-scoped initialized-session fixture the other zone tests use, and copy a known-valid zone payload from an existing test. Mirror the three tests for lamps.)

- [ ] **Step 2:** Run: `cd api && uv run pytest tests/test_client_ids.py -v` — Expected: FAIL (id field rejected/ignored).
- [ ] **Step 3:** Implement: add `id: Optional[str] = None` to the input schemas; in `_create_zone_from_input`/`_create_lamp_from_input` pass `zone_id=input.id` / `lamp_id=input.id` to the guv constructors when set (check the exact constructor kwarg names in `~/guv-calcs`: `CalcPlane(zone_id=...)` vs `Lamp(lamp_id=...)`); in the add handlers, when `input.id` is set call `session.room.add_calc_zone(guv_zone, on_collision="error")` and catch `KeyError` → `raise HTTPException(status_code=409, detail=f"Zone id {input.id!r} already exists")` (same for lamps). **Note:** the handler's generic `except Exception → _log_and_raise` must not swallow the 409 — raise the HTTPException inside and let `_log_and_raise` re-raise it, or catch `KeyError` before the generic handler.
- [ ] **Step 4:** Run: `cd api && uv run pytest tests/test_client_ids.py -v` — Expected: 6 PASS.
- [ ] **Step 5:** Full suite + regenerate contract: `uv run pytest tests/ -q` then `make generate-api` (schemas changed).
- [ ] **Step 6: Commit**

```bash
git add api/api/v1/session_schemas.py api/api/v1/session_helpers.py \
  api/api/v1/zone_session_routers.py api/api/v1/lamp_session_routers.py \
  api/tests/test_client_ids.py api/openapi.json ui/src/lib/api/generated/api-types.ts
git commit -m "feat: accept client-supplied lamp/zone IDs with 409 on collision"
```

### Task 8: Frontend mints IDs; zone type-change keeps identity; delete remap machinery

**Files:**
- Modify: `ui/src/lib/stores/project.ts` (`addZone` ~1950, `addLamp` ~1784, `syncUpdateZone` 670-718, `remapZoneId` 1052-1075, `onZoneIdRemap` registration, `zoneIdRemapListeners`)
- Modify: consumers of the remap listener (grep `onZoneIdRemap` — `+page.svelte` and/or `ZoneEditor.svelte`)
- Test: `ui/src/lib/stores/project.test.ts` (modify the 'zone type change' describe block; add minting tests)

**CHECK FIRST:** `git status --short` — if `project.ts` or `+page.svelte` is dirty from another session, pause this task.

Behavior change: `addZone`/`addLamp` generate `crypto.randomUUID()` (already deterministic in tests via `setup.ts` mock) and send it; the backend echoes it. The type-change delete+recreate re-sends the **same id** (stop `delete payload.id`), so the recreated zone keeps its identity: no remount-by-id-change, no result eviction by old id, no remap listeners. `remapZoneId`, `zoneIdRemapListeners`, and the `onZoneIdChanged` callback plumbing become dead code — delete them. Keep the type-change result-eviction (results for the changed zone are stale) by evicting `results.zones[id]` directly in the type-change branch of `syncUpdateZone`.

- [ ] **Step 1:** Update the existing `'zone type change'` test: MSW POST handler now expects the request body to carry the same `id`; respond echoing it (`zone_id` = request body id). Assert the zone keeps its original id after type change, grid values update (num_x 42 etc.), and `results.zones` no longer has an entry for it. Add a new test: `addZone` sends a generated id and the store uses it.
- [ ] **Step 2:** Run the file — new/updated tests FAIL against current code.
- [ ] **Step 3:** Implement in `project.ts`: mint ids in `addZone`/`addLamp`; stop deleting `payload.id` in the type-change branch; evict `results.zones[id]` there; delete `remapZoneId`, `zoneIdRemapListeners`, `onZoneIdChanged` parameter threading, and the public `onZoneIdRemap` API; update `zoneToSessionZone`/`lampToSessionLamp` (in the converters module) to include `id`.
- [ ] **Step 4:** Grep `onZoneIdRemap|remapZoneId` across `ui/src` — remove the now-dead consumer wiring (use `editing-svelte-files` skill for any `.svelte` file).
- [ ] **Step 5:** `pnpm test:run` all pass; `pnpm check` not worse.
- [ ] **Step 6:** Run e2e zone specs against real stack: `make test-e2e` (or at minimum the zones + workflow specs) — the type-change flow is the historically fragile path; verify end-to-end before committing.
- [ ] **Step 7: Commit** (changelog `### Changed`: "Zone and lamp IDs are now assigned by the app, and a zone keeps its identity when its type changes — type switches no longer recreate the zone under a new ID")

```bash
git add ui/src CHANGELOG.md
git commit -m "feat: client-minted IDs; zone type change preserves identity"
```

### Task 9: Remove backend lamp_id_map/zone_id_map indirection

**Files:**
- Modify: `api/api/v1/session_manager.py` (Session), `session_helpers.py` (`_get_lamp_or_404`, `_get_zone_or_404`), `calculation_routers.py` (reverse-map blocks at ~687, ~761, ~814), `zone_session_routers.py`, `lamp_session_routers.py`, `session_core.py` (map rebuild on load)

With IDs identical on both sides (Task 7+8, and the load path already uses guv ids as frontend ids), the maps are identity maps. Replace `session.lamp_id_map.get(id)` with `session.room.lamps.get(id)` (check the registry's get/`__getitem__` API in `scene_registry.py`), `session.zone_id_map.get(id)` with `session.room.calc_zones.get(id)`; delete the map attributes, their rebuild-on-load code, and the three reverse-map constructions in `calculation_routers.py` (guv id **is** the frontend id now).

- [ ] **Step 1:** Grep both maps: `grep -rn "lamp_id_map\|zone_id_map" api/` — list every usage before editing.
- [ ] **Step 2:** Mechanically replace lookups with registry access; delete map maintenance lines; simplify the reverse-map blocks to pass ids through.
- [ ] **Step 3:** Full API suite: `uv run pytest tests/ -q` — all pass. These tests cover save/load round-trips and safety-check id mapping; failures here mean a spot where the two id spaces genuinely diverged — stop and investigate rather than patching the test.
- [ ] **Step 4:** Run e2e save/load + zones specs (`make test-e2e`): loading legacy `.guv` files (whose ids came from guv_calcs) must still work.
- [ ] **Step 5: Commit**

```bash
git add api/
git commit -m "refactor: drop lamp/zone id maps — client ids are authoritative"
```

---

## Phase D — svelte-check to zero + CI gate

### Task 10: Fix all svelte-check errors (128 at baseline; warnings out of scope)

**Files:** 39 files; biggest: `ZoneEditor.svelte`, `LampEditor.svelte`, `project.ts`, `+page.svelte`, `LampDetailsTabInfo.svelte`, test files.

**CHECK FIRST:** `git status --short` for the shared files, per Global Constraints.

Hard rules: **no runtime behavior changes**, no `@ts-ignore`/`any`-casting escapes (fix the type, not the checker), `.svelte` edits via `editing-svelte-files` skill, `pnpm test:run` green after each batch.

Known categories from the baseline inventory (fix category-by-category, re-running `pnpm check` between batches):

1. **`enterToggle` action typed `HTMLInputElement` but used on `<button>`** (8 errors in `+page.svelte`): find the action's definition (grep `export function enterToggle`), widen its element parameter to `HTMLElement` (or `HTMLInputElement | HTMLButtonElement` if it reads input-specific properties — read the body first).
2. **Test fixtures missing required props** (~30 errors in `*.test.ts`): the components' `Props` gained required fields the fixtures never got. Add the missing fields with realistic values (copy shapes from the component's actual callers, not `as any`).
3. **Threlte/Three types**: `'cursor' does not exist on Mesh` (7) — `cursor` is Threlte-interactivity's extension; add a module augmentation in `ui/src/lib/types/threlte.d.ts` declaring `cursor?: string` on the event-object interface (check `@threlte/extras` docs/source for the canonical augmentation). Camera `null` vs `undefined` (6) — normalize with `?? undefined` at the assignment sites.
4. **`Expected N arguments, but got N`** (11): read each call site; these are usually stale call signatures after refactors — align caller with callee.
5. **Nullability** (`'parsedSpectrum' is possibly 'null'`, `used before being assigned`): add narrowing guards that preserve behavior.
6. Remainder: fix file-by-file, largest files first.

- [ ] **Step 1:** Baseline: `cd ui && pnpm check 2>&1 | tail -1` — record the count (~128 errors).
- [ ] **Step 2..N:** One commit per category/batch above, each with: fixes, `pnpm check` (count strictly decreasing), `pnpm test:run` green.

```bash
git commit -m "fix: svelte-check errors — <category>"
```

- [ ] **Final step:** `pnpm check` reports **0 errors** (warnings may remain).

### Task 11: Gate svelte-check in CI

**Files:**
- Modify: `.github/workflows/ci.yml` (ui-tests job)

- [ ] **Step 1:** Add to the `ui-tests` job after `pnpm install`:

```yaml
      - run: pnpm check
```

Note: `pnpm check` runs `svelte-kit sync` first, so no build step is needed. Warnings don't fail svelte-check by default; the gate is errors-only, matching Task 10's scope.

- [ ] **Step 2:** Verify locally that `pnpm check` exits 0.
- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: gate UI on svelte-check errors"
```

---

## Verification (end-to-end)

1. `make test` — full UI + API + e2e suites green.
2. `make generate-api && git status` — clean (contract artifacts fresh).
3. Manual smoke via the running dev stack (localhost:5173): create a room → add a lamp → add a plane zone → switch its type to volume (id stays stable, grid values update) → calculate → verify stats panel → save `.guv` → reload → load the file back.
4. Load a **pre-change** `.guv` file (save one from the deployed https://illuminate.osluv.org before starting) to confirm legacy id handling survives Task 9.
