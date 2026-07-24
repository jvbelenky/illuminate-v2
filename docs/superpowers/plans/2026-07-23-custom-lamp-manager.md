# Custom Lamp Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the file pool with a self-contained custom-lamp library: a manager modal (Edit menu) for fully-specified lamp definitions, type-filtered dropdowns, two persistence scopes, and content-hash re-linking on .guv load.

**Architecture:** A `CustomLampDef` record embeds its files (base64) and persists to IndexedDB (browser scope) or sessionStorage (project scope). All backend sync rides the existing sync queue / upload endpoints; two small read-only backend endpoints provide canonical content hashing. The old fileStore/FileManagerModal stack is deleted at the end.

**Tech Stack:** Svelte 5 (runes), TypeScript, IndexedDB, FastAPI, guv_calcs, vitest + testing-library, pytest.

**Spec:** `docs/superpowers/specs/2026-07-23-custom-lamp-manager-design.md` — read it before starting any task.

## Global Constraints

- `.svelte` files use TABS; NEVER use the Edit tool or `sed` on them — use the Python-helper pattern from the `editing-svelte-files` skill (single-quoted `python3 -c '...'` wrapper) or the Write tool for full rewrites.
- `.ts` files: 2-space indent. `.py` files: 4-space indent.
- No `Co-Authored-By` trailers in commits.
- `pnpm check` must stay at zero errors; never `@ts-ignore`.
- Never hand-write API request/response TS types — regenerate with `make generate-api` and alias from `ui/src/lib/api/generated/api-types.ts` in `ui/src/lib/api/contract.ts`.
- Mutating session handlers need `with locked_session(session):` / `async_locked_session`; the new GET endpoint is read-only and follows existing read-handler conventions instead.
- No `[DIAG]` / `TEMP DIAG` markers left in commits.
- Editor components must not mirror store state in local `$state` (background store emits clobber it); read/write the store directly or use `$derived`.
- Run `pnpm test:run` in `ui/` after each frontend task; API tests with `uv run pytest` in `api/`.
- CHANGELOG.md `[Unreleased]` entry is written once, in the final task.

---

### Task 1: Backend content hashing + lamp files endpoint

**Files:**
- Create: `api/api/v1/utils/lamp_content.py`
- Modify: `api/api/v1/lamp_routers.py` (stateless hash endpoint)
- Modify: `api/api/v1/lamp_session_routers.py` (session lamp files endpoint)
- Modify: `api/api/v1/schemas.py` or `session_schemas.py` (response models — put each model beside its router's other models)
- Test: `api/tests/test_lamp_content.py`

**Interfaces:**
- Produces: `lamp_content_hash(lamp) -> str` (sha256 hex).
- Produces: `POST /api/v1/lamps/content-hash` — multipart `ies_file` (required), `spectrum_file` (optional), form/query `column: int = 0` → `{"content_hash": str}`.
- Produces: `GET /api/v1/session/lamps/{lamp_id}/files` → `{"ies_filedata": str|null, "ies_filename": str|null, "spectrum": {<wavelength-key>: [str], <intensity-key>: [str]}|null, "content_hash": str|null}` (the spectrum dict is exactly the first two keys of `lamp.spectrum.to_dict(as_string=True)`).

- [ ] **Step 1: Write failing tests**

```python
"""Content-hash + session lamp files endpoint tests."""
import io
from tests.conftest import API

def _ies_bytes():
    # Reuse an existing fixture IES file; tests/ has upload tests — copy the
    # same fixture-loading helper they use (grep tests/ for '.ies' fixtures).
    from pathlib import Path
    return Path("tests/fixtures").glob("*.ies").__next__().read_bytes()

class TestContentHash:
    def test_same_file_same_hash(self, client):
        data = _ies_bytes()
        r1 = client.post(f"{API}/lamps/content-hash",
                         files={"ies_file": ("a.ies", io.BytesIO(data))})
        r2 = client.post(f"{API}/lamps/content-hash",
                         files={"ies_file": ("renamed.ies", io.BytesIO(data))})
        assert r1.status_code == 200 and r2.status_code == 200
        assert r1.json()["content_hash"] == r2.json()["content_hash"]

    def test_spectrum_changes_hash(self, client):
        data = _ies_bytes()
        csv = b"wavelength,intensity\n200,0.1\n222,1.0\n240,0.2\n"
        r1 = client.post(f"{API}/lamps/content-hash",
                         files={"ies_file": ("a.ies", io.BytesIO(data))})
        r2 = client.post(f"{API}/lamps/content-hash",
                         files={"ies_file": ("a.ies", io.BytesIO(data)),
                                "spectrum_file": ("s.csv", io.BytesIO(csv))})
        assert r1.json()["content_hash"] != r2.json()["content_hash"]

    def test_invalid_ies_400(self, client):
        r = client.post(f"{API}/lamps/content-hash",
                        files={"ies_file": ("a.ies", io.BytesIO(b"not an ies"))})
        assert r.status_code == 400

class TestSessionLampFiles:
    def test_roundtrip_hash_matches_stateless(self, client, session_headers):
        # session_headers: reuse the initialized-session fixture used by
        # existing lamp upload tests (grep tests/ for the ies-upload test).
        data = _ies_bytes()
        # add lamp + upload ies (mirror the existing upload test's calls)
        lamp_id = "lamp-files-test"
        client.post(f"{API}/session/lamps", headers=session_headers,
                    json={"id": lamp_id, "lamp_type": "krcl_222", "preset_id": "custom",
                          "x": 1, "y": 1, "z": 2, "aimx": 1, "aimy": 1, "aimz": 0})
        client.post(f"{API}/session/lamps/{lamp_id}/ies", headers=session_headers,
                    files={"file": ("a.ies", io.BytesIO(data))})
        stateless = client.post(f"{API}/lamps/content-hash",
                                files={"ies_file": ("a.ies", io.BytesIO(data))}).json()
        files = client.get(f"{API}/session/lamps/{lamp_id}/files", headers=session_headers)
        assert files.status_code == 200
        body = files.json()
        assert body["content_hash"] == stateless["content_hash"]
        assert body["ies_filedata"]  # non-empty
        assert body["spectrum"] is None  # ies upload clears spectrum

    def test_unknown_lamp_404(self, client, session_headers):
        r = client.get(f"{API}/session/lamps/nope/files", headers=session_headers)
        assert r.status_code == 404
```

Adjust fixture names (`client`, `session_headers`, lamp-add payload) to match what `api/tests/` actually uses — read one existing session-lamp upload test first and copy its setup verbatim.

- [ ] **Step 2: Run tests, verify they fail** — `cd api && uv run pytest tests/test_lamp_content.py -x -q`. Expected: 404s / import errors.

- [ ] **Step 3: Implement**

`api/api/v1/utils/lamp_content.py`:

```python
"""Canonical content hashing for lamp photometry + spectrum."""
import hashlib
import json


def lamp_content_hash(lamp) -> str | None:
    """Sha256 over canonical IES bytes + canonical spectrum serialization.

    Canonical = what guv_calcs re-serializes, so hashes are stable across
    upload -> save -> load round-trips regardless of original file formatting.
    Returns None when the lamp has no photometry.
    """
    ies = lamp.save_ies(original=True)
    if ies is None:
        return None
    if lamp.spectrum is not None:
        sd = lamp.spectrum.to_dict(as_string=True)
        keys = list(sd.keys())[:2]
        spec = json.dumps({k: sd[k] for k in keys}, sort_keys=True).encode()
    else:
        spec = b""
    return hashlib.sha256(ies + b"\x00" + spec).hexdigest()
```

Stateless endpoint in `lamp_routers.py` — build a temporary `Lamp(filedata=ies_bytes)`; if a spectrum file is provided, apply it exactly the way `upload_session_lamp_spectrum` does (read `lamp_session_routers.py:745-830` and reuse its parse/column logic — extract a shared helper if the logic is more than a couple of lines rather than duplicating it). Validate the IES with the existing `_validate_ies_content` pattern (400 on failure), enforce the same size limits (`MAX_IES_FILE_SIZE`, `MAX_SPECTRUM_FILE_SIZE`). Response model `ContentHashResponse(content_hash: str)`.

Session endpoint in `lamp_session_routers.py`:

```python
@router.get("/lamps/{lamp_id}/files", response_model=LampFilesResponse)
def get_session_lamp_files(lamp_id: str, session: InitializedSessionDep):
    """Return the canonical embedded files for a session lamp (base for
    client-side custom-lamp library entries and hash re-linking)."""
    _get_lamp_or_404(session, lamp_id)
    lamp = session.room.lamps[lamp_id]
    filedata = lamp.save_ies(original=True)
    spectrum = None
    if lamp.spectrum is not None:
        sd = lamp.spectrum.to_dict(as_string=True)
        keys = list(sd.keys())[:2]
        spectrum = {k: sd[k] for k in keys}
    return LampFilesResponse(
        ies_filedata=filedata.decode() if filedata is not None else None,
        ies_filename=getattr(lamp, "ies_filename", None) or lamp.name,
        spectrum=spectrum,
        content_hash=lamp_content_hash(lamp),
    )
```

Check what attribute actually stores the uploaded IES display name (the upload handler computes `display_name` — trace where it's kept; if nowhere, return `lamp.name`). `LampFilesResponse` fields: `ies_filedata: Optional[str]`, `ies_filename: Optional[str]`, `spectrum: Optional[dict[str, list[str]]]`, `content_hash: Optional[str]`.

- [ ] **Step 4: Run tests until green** — `uv run pytest tests/test_lamp_content.py tests/test_lamps_catalog.py -q`.
- [ ] **Step 5: Regenerate contract** — `cd /home/jvbelenky/illuminate-v2 && make generate-api`. Then add aliases in `ui/src/lib/api/contract.ts` following its existing pattern (`LampFilesResponse`, `ContentHashResponse`).
- [ ] **Step 6: Add client functions** in `ui/src/lib/api/client.ts`, following the style of `parseSpectrumFile` (multipart) and `getSessionLampInfo` (session GET):

```ts
export async function getLampContentHash(
  iesFile: File, spectrumFile?: File, columnIndex?: number
): Promise<ContentHashResponse> { /* multipart POST /lamps/content-hash */ }

export async function getSessionLampFiles(lampId: string): Promise<LampFilesResponse> {
  /* GET /session/lamps/{lampId}/files with session header + expiry retry,
     mirroring uploadSessionLampIES's recovery pattern */
}
```

- [ ] **Step 7: Commit** — `git add -A api ui/src/lib/api && git commit -m "feat(api): content-hash + session lamp files endpoints"`

---

### Task 2: Lamp library types, IndexedDB layer, and store

**Files:**
- Create: `ui/src/lib/types/lampLibrary.ts`
- Create: `ui/src/lib/utils/lampLibraryDb.ts`
- Create: `ui/src/lib/stores/lampLibrary.ts`
- Modify: `ui/src/lib/stores/project.ts` (export `wasRestoredFromStorage()`)
- Test: `ui/src/lib/stores/lampLibrary.test.ts`

**Interfaces:**
- Produces (types):

```ts
export interface EmbeddedFile { filename: string; dataBase64: string; }
export type LampScope = 'browser' | 'project';
export type CustomLampType = 'krcl_222' | 'lp_254' | 'other'; // keep in sync with LampInstance['lamp_type']

export interface CustomLampDef {
  id: string;
  name: string;
  lampType: CustomLampType;
  wavelength?: number;
  ies: EmbeddedFile;
  spectrum?: EmbeddedFile & { columnIndex?: number };
  scalingFactor?: number;
  intensityUnits?: 'mw/sr' | 'uw/cm2';
  surface?: { width?: number; length?: number; height?: number; units?: 'meters' | 'feet' };
  housing?: { width?: number; length?: number; height?: number };
  sourceDensity?: number;
  intensityMap?: EmbeddedFile;
  scope: LampScope;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
}
```

- Produces (store, `ui/src/lib/stores/lampLibrary.ts`):

```ts
export const customLamps: Readable<CustomLampDef[]>;           // all, sorted by name
export const lampLibrary: {
  init(restoreProjectScope: boolean): Promise<void>;
  add(def: Omit<CustomLampDef, 'id' | 'createdAt' | 'updatedAt'>): Promise<string>;
  update(id: string, patch: Partial<Omit<CustomLampDef, 'id' | 'createdAt'>>): Promise<void>;
  remove(id: string): Promise<void>;
  get(id: string): CustomLampDef | undefined;
  setScope(id: string, scope: LampScope): Promise<void>;
  findByHash(hash: string): CustomLampDef | undefined;         // browser-scoped wins ties
  toIesFile(id: string): File | null;
  toSpectrumFile(id: string): File | null;
  toIntensityMapFile(id: string): File | null;
  isInitialized(): boolean;
};
```

- Produces: `wasRestoredFromStorage(): boolean` exported from `project.ts` (module flag set inside `loadFromStorage()`: true only when a valid sessionStorage project was restored, false on reload/fresh).

Implementation notes:
- Copy the base64 helpers (`fileToBase64`, `base64ToFile`, MIME-by-extension) from `fileStore.ts` — the pool is deleted in Task 9, so duplicate rather than import.
- IndexedDB: DB `illuminate-lamp-library`, store `lamps`, keyPath `id` — model `lampLibraryDb.ts` on `fileDb.ts` (same open/put/get/delete/getAll shape).
- Project scope: persist the project-scoped subset to `sessionStorage['illuminate-project-lamps']` on every mutation; `init(restoreProjectScope)` loads it only when the flag is true, otherwise removes the key.
- `setScope('browser')` = write to IndexedDB + drop from sessionStorage subset; `setScope('project')` = reverse. `update()` bumps `updatedAt` and re-persists in whichever scope the def is in.
- IndexedDB/sessionStorage failures: `console.warn` and keep the def in memory (parity with current pool behavior).

- [ ] **Step 1: Write failing tests** (`lampLibrary.test.ts`) — mock IndexedDB the way `fileStore`'s tests do (find and copy their setup; if none exist, mock `lampLibraryDb` module with `vi.mock`). Cover: add → get/derived store; update bumps `updatedAt` and preserves id; remove; setScope moves persistence location (assert via mocked db + sessionStorage); findByHash prefers browser scope; init(false) clears the sessionStorage key; toIesFile round-trips filename/content.
- [ ] **Step 2: Verify failure** — `cd ui && pnpm vitest run src/lib/stores/lampLibrary.test.ts`.
- [ ] **Step 3: Implement the three files + the `wasRestoredFromStorage` flag.**
- [ ] **Step 4: Green** — same command, then `pnpm check`.
- [ ] **Step 5: Commit** — `git commit -m "feat(ui): custom lamp library store with browser/project scopes"`

---

### Task 3: Shared spectrum file field component

**Files:**
- Create: `ui/src/lib/components/SpectrumFileField.svelte`
- Test: `ui/src/lib/components/SpectrumFileField.test.ts`

**Interfaces:**
- Produces a component with props:

```ts
{
  value: { file: File; columnIndex?: number } | null;   // $bindable
  currentFilename?: string;      // shown when editing an existing def
  recommended?: boolean;         // label "(recommended)" vs "(optional)"
  onerror?: (msg: string) => void;
}
```

Behavior: file input (`.csv,.xls,.xlsx`); on selection call `parseSpectrumFile(file)` (from `$lib/api/client`); if `num_series > 1`, render the column-picker UI (copy the radio-list markup + `selectedColumnIndex` handling from `LampEditor.svelte` — search it for `showColumnPicker` / `selectedColumnIndex` and reproduce the same look); on confirm set `value = { file, columnIndex }`. Single-column files set `value = { file }` directly. Parse errors call `onerror` and clear the input. A "clear" button resets `value` to null.

- [ ] **Step 1: Write failing tests** — mock `parseSpectrumFile`: single-column path sets value; multi-column path shows picker then sets columnIndex; parse rejection calls `onerror`.
- [ ] **Step 2: Verify failure.**
- [ ] **Step 3: Implement** (new file → use the Write tool; tabs).
- [ ] **Step 4: Green + `pnpm check`.**
- [ ] **Step 5: Commit** — `git commit -m "feat(ui): shared spectrum file field with column picker"`

---

### Task 4: LampManagerModal

**Files:**
- Create: `ui/src/lib/components/LampManagerModal.svelte`
- Test: `ui/src/lib/components/LampManagerModal.test.ts`

**Interfaces:**
- Consumes: `lampLibrary` / `customLamps` (Task 2), `SpectrumFileField` (Task 3), `getLampContentHash` (Task 1), `lamps` store + `project` from `$lib/stores/project`.
- Produces component props:

```ts
{
  onClose: () => void;
  initialLampType?: CustomLampType;  // when set, open directly in form view (add mode) with type preselected
}
```

Structure — copy `FileManagerModal.svelte`'s `Modal` usage (title, `dockId`, close wiring) before it's deleted; `dockId="lamp-manager"`, title "Manage Custom Lamps".

**List view:** two sections, "Saved in browser" (`scope === 'browser'`) and "This project only" (`scope === 'project'`); rows show name, type badge (`222 nm` / `254 nm` / `Other`), a `has spectrum` dot, Edit / Delete buttons; project rows also "Save to browser" (`lampLibrary.setScope(id,'browser')`), browser rows "Remove from browser" (if any `$lamps` instance has `custom_lamp_id === id` → `setScope(id,'project')`, else confirm + `remove(id)`). "Add custom lamp" button switches to form view.

**Form view:** fields per spec — name; lamp type select; wavelength (visible when type `other`; disabled with hint "derived from spectrum peak" when a spectrum is attached); IES file input (required; when editing shows current filename with a replace button); `SpectrumFileField` (`recommended` for `krcl_222`/`other`); collapsed Advanced `<details>`: scalingFactor, intensityUnits select, surface W/L/H + units select, housing W/L/H, sourceDensity, intensity map file input; checkbox "Save to browser for future sessions" (checked by default in add mode; in edit mode reflects and controls scope).

**Save flow:**

```ts
async function save() {
  // validation: name non-empty; iesFile present (new) or def.ies exists (edit);
  // for 'other': spectrum present OR wavelength set — else inline error
  const hash = (await getLampContentHash(iesFile, spectrum?.file, spectrum?.columnIndex)).content_hash;
  // ...build EmbeddedFiles via the store's base64 helpers (expose a
  // fileToEmbedded(file): Promise<EmbeddedFile> helper from lampLibrary)...
  if (editingId) {
    await lampLibrary.update(editingId, patch);
    await project.propagateCustomLampEdit(editingId);   // Task 5
  } else {
    await lampLibrary.add({ ...def, scope: saveToBrowser ? 'browser' : 'project', contentHash: hash });
  }
  view = 'list';
}
```

In this task, stub `project.propagateCustomLampEdit` behind `if ('propagateCustomLampEdit' in project)` — no: instead add the real method in `project.ts` now as a no-op that Task 5 fills in, so the call compiles and the test mocks it. A 400 from `getLampContentHash` (bad IES) surfaces as an inline form error — this is the manager's IES validation.

**Delete flow:** compute `usedBy = $lamps.filter(l => l.custom_lamp_id === id)`; if non-empty show `ConfirmDialog` (copy usage from FileManagerModal) listing lamp names + "These lamps will lose their photometry"; on confirm `await project.detachCustomLamp(l.id)` for each (added in Task 5 — add as a no-op stub in project.ts now), then `lampLibrary.remove(id)`.

- [ ] **Step 1: Write failing tests** — render list with mixed-scope defs (two sections, correct rows); add-mode save calls `lampLibrary.add` with `scope:'browser'` by default and the hash from mocked `getLampContentHash`; unchecking the box saves `scope:'project'`; edit-in-place calls `update` (never `add`) — the duplicate-on-replace regression test; `other` without spectrum or wavelength shows validation error and does not save; delete of an in-use def shows the confirm dialog listing the lamp name.
- [ ] **Step 2: Verify failure.**
- [ ] **Step 3: Implement** (Write tool; tabs). Add the two no-op stubs to `project.ts` (`propagateCustomLampEdit`, `detachCustomLamp`) with a comment pointing at Task 5.
- [ ] **Step 4: Green + `pnpm check`.**
- [ ] **Step 5: Commit** — `git commit -m "feat(ui): custom lamp manager modal"`

---

### Task 5: LampInstance.custom_lamp_id + project-store plumbing

**Files:**
- Modify: `ui/src/lib/types/project.ts` (add `custom_lamp_id?: string` next to the existing `ies_file_id` fields; also add `pending_intensity_map_file?: File` and `pending_advanced?: Record<string, unknown>` beside `pending_ies_file`)
- Modify: `ui/src/lib/stores/project.ts`
- Test: extend `ui/src/lib/stores/project.test.ts`

**Interfaces:**
- Consumes: `lampLibrary` (Task 2).
- Produces on the `project` store:

```ts
applyCustomLamp(lampId: string, defId: string): Promise<void>;
propagateCustomLampEdit(defId: string): Promise<void>;   // replaces Task 4 stub
detachCustomLamp(lampId: string): Promise<void>;          // replaces Task 4 stub
```

Implementation:

```ts
async function applyCustomLamp(lampId: string, defId: string): Promise<void> {
  const def = lampLibrary.get(defId);
  if (!def) return;
  const partial: Partial<LampInstance> = {
    custom_lamp_id: defId,
    preset_id: 'custom',
    pending_ies_file: lampLibrary.toIesFile(defId)!,
  };
  if (def.spectrum) {
    partial.pending_spectrum_file = lampLibrary.toSpectrumFile(defId)!;
    partial.pending_spectrum_column_index = def.spectrum.columnIndex ?? 0;
  }
  if (def.lampType === 'other' && def.wavelength != null) partial.wavelength = def.wavelength;
  if (def.intensityMap) partial.pending_intensity_map_file = lampLibrary.toIntensityMapFile(defId)!;
  const adv = advancedFieldsFromDef(def);   // see below
  if (adv) partial.pending_advanced = adv;
  await updateLamp(lampId, partial);
}
```

`advancedFieldsFromDef(def)`: map `scalingFactor`/`intensityUnits`/`surface`/`housing`/`sourceDensity` onto the exact input shape of `updateSessionLampAdvanced` in `client.ts` (read its signature and the generated type it uses; only include keys the def actually sets; return null when none).

In `syncUpdateLamp` (project.ts:519-572 area): after the existing `pending_spectrum_file` upload block, add — in this order —

```ts
if (partial.pending_intensity_map_file) {
  /* uploadSessionLampIntensityMap(id, file) — mirror the ies-upload error/callback pattern */
}
if (partial.pending_advanced) {
  /* updateSessionLampAdvanced(id, partial.pending_advanced) — after files so
     load_ies's surface overwrite can't clobber def-specified dimensions */
}
```

and strip both keys from the plain-update payload the same way `pending_ies_file` is stripped at line 519.

`propagateCustomLampEdit(defId)`: for each `get(lamps)` instance with `custom_lamp_id === defId`, call `applyCustomLamp(l.id, defId)` (re-applies files + fields through the queue).

`detachCustomLamp(lampId)`: clear `custom_lamp_id` and remove photometry/spectrum — replicate exactly what `handleRemoveIes` + `handleRemoveSpectrum` in `LampEditor.svelte` do today (read them; they are the canonical removal flow) and additionally set `custom_lamp_id: undefined`.

- [ ] **Step 1: Write failing tests** — with a mocked `lampLibrary` and mocked client uploads: `applyCustomLamp` sets `custom_lamp_id`/`preset_id`/pending files on the instance; spectrum-less def sends no spectrum; `other` def sets wavelength; `propagateCustomLampEdit` touches only instances referencing the def; `detachCustomLamp` clears `custom_lamp_id`. Follow the mocking patterns already in `project.test.ts` (it mocks `$lib/api/client`).
- [ ] **Step 2: Verify failure.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Green** — `pnpm vitest run src/lib/stores/project.test.ts` + `pnpm check`.
- [ ] **Step 5: Commit** — `git commit -m "feat(ui): apply/propagate/detach custom lamp definitions through sync queue"`

---

### Task 6: Wire manager into menu + page; LampEditor rework

**Files:**
- Modify: `ui/src/lib/components/MenuBar.svelte` (rename Edit item to "Manage Custom Lamps..."; prop can keep its name or be renamed — keep `onShowFileManager` renamed to `onShowLampManager` and update both desktop `:590-609` and mobile `:414-425` blocks)
- Modify: `ui/src/routes/+page.svelte` (state `showLampManager`, `lampManagerInitialType: CustomLampType | null`; mount `LampManagerModal` where `FileManagerModal` was at `:1424-1425`; update the `onShowFileManager` wiring at `:834`; replace `fileStore.init()` at `:557` with `await`-free `lampLibrary.init(wasRestoredFromStorage())`; pass `onOpenLampManager` down to `LampEditor` at `:1040`)
- Modify: `ui/src/lib/components/LampEditor.svelte` (major)
- Test: update `ui/src/lib/components/LampEditor.test.ts`

**Interfaces:**
- Consumes: `LampManagerModal` (Task 4), `applyCustomLamp` (Task 5), `customLamps` store (Task 2).
- Produces: LampEditor prop `onOpenLampManager: (type: CustomLampType) => void`; `+page.svelte` implements it as `lampManagerInitialType = type; showLampManager = true` (via the existing `openOrRestore` dock pattern used at `:834`).

LampEditor changes (Python-helper edits or full Write; tabs):

1. Delete: both hidden file inputs, `handleIesFileUploadToStore`, `handleSpectrumFileUploadToStore`, `handleIesFileSelect`, `handleSpectrumFileSelect`, the column-picker state + markup, `handleRemoveIes`/`handleRemoveSpectrum` buttons UI (the functions move to/are replicated in `detachCustomLamp`; the editor no longer offers per-file removal — lamp swaps happen via the dropdown), the whole `{#if isCustomLamp}` file-upload-section and `{#if canUploadSpectrum}` blocks, all `fileStore`/`$iesFiles`/`$spectrumFiles` imports/usages, `custom_file:` handling, `__upload_ies__`/`__upload__` sentinels, `iesFile`/`spectrumFile`/`selectedIesFileId`/`selectedSpectrumFileId` state.
2. Every lamp type gets the "Select Lamp" dropdown:

```svelte
<select id="preset" bind:value={effectivePresetId} onchange={(e) => handleLampSelect(e.currentTarget.value)}>
	<option value="" disabled>-- Select a lamp --</option>
	{#if lamp_type === 'krcl_222'}
		{#each presets as preset}<option value={preset.id}>{preset.name}</option>{/each}
	{/if}
	{#if effectivePresetId === 'custom'}
		<option value="custom">Custom lamp (uploaded file)</option>
	{/if}
	{#if matchingCustomLamps.length > 0}
		<option disabled>──────────</option>
		{#each matchingCustomLamps as def}<option value={'custom_lamp:' + def.id}>{def.name}</option>{/each}
	{/if}
	<option disabled>──────────</option>
	<option value="__add_custom__">Add custom lamp...</option>
</select>
```

with `let matchingCustomLamps = $derived($customLamps.filter(d => d.lampType === lamp_type));` and `effectivePresetId` initialized from `lamp.custom_lamp_id ? 'custom_lamp:' + lamp.custom_lamp_id : (lamp.preset_id || '')`.

3. Handler:

```ts
async function handleLampSelect(value: string) {
	if (value === '__add_custom__') {
		onOpenLampManager(lamp_type);
		effectivePresetId = lamp.custom_lamp_id ? 'custom_lamp:' + lamp.custom_lamp_id : (lamp.preset_id || '');
		return;
	}
	if (value.startsWith('custom_lamp:')) {
		const defId = value.substring('custom_lamp:'.length);
		effectivePresetId = value;
		preset_id = 'custom';
		await project.applyCustomLamp(lamp.id, defId);
		return;
	}
	preset_id = value;
	effectivePresetId = value;
	project.updateLamp(lamp.id, { custom_lamp_id: undefined });
}
```

(Only krcl_222 reaches the plain-preset branch — 254/other dropdowns contain no preset options.)
4. The `lp_254`/`other` branches that previously rendered file widgets now render the same dropdown; the "(required)" IES messaging becomes an inline hint under the dropdown when the lamp has no photometry (`!lamp.has_ies_file`): "Select or add a custom lamp — an IES file is required."

Test updates in `LampEditor.test.ts`: remove fileStore-dependent tests; keep/adapt the two Task-0 regression tests → "Add custom lamp... calls onOpenLampManager with current type and restores selection"; add "custom lamp options render for matching type only" and "selecting a custom lamp calls project.applyCustomLamp" (mock `$lib/stores/lampLibrary` and the store method).

- [ ] **Step 1: Update/write failing tests** (dropdown contents per type; `__add_custom__` → callback; selection → applyCustomLamp).
- [ ] **Step 2: Verify failure.**
- [ ] **Step 3: Implement MenuBar + +page.svelte + LampEditor.** MenuBar/+page edits via Python helper; LampEditor is >50% changed — full Write is fine.
- [ ] **Step 4: Green** — `pnpm vitest run src/lib/components/LampEditor.test.ts` then full `pnpm test:run` + `pnpm check`.
- [ ] **Step 5: Commit** — `git commit -m "feat(ui): lamp manager wiring + type-filtered custom lamp dropdowns"`

---

### Task 7: Session-recovery re-upload from the library

**Files:**
- Modify: `ui/src/lib/stores/project.ts:248-281` (`reuploadCustomFiles`)
- Test: extend `ui/src/lib/stores/project.test.ts`

**Interfaces:**
- Consumes: `lampLibrary.get/toIesFile/toSpectrumFile/toIntensityMapFile` (Task 2).

Rewrite `reuploadCustomFiles(lamps)` to iterate lamps with `custom_lamp_id`, look the def up in the library (any scope), and re-upload IES + spectrum (+ intensity map when present) with the def's `columnIndex`, keeping the existing error-tolerant per-lamp try/catch shape. Lamps without `custom_lamp_id` are skipped (loaded-but-unlinked lamps were linked in Task 8's load flow; if the def was deleted, log a warn).

- [ ] **Step 1: Failing test** — mock library + upload fns; two lamps (one linked, one not): linked lamp re-uploads with correct files/column, unlinked is skipped, one failing upload doesn't block the next lamp.
- [ ] **Step 2: Verify failure. Step 3: Implement. Step 4: Green + `pnpm check`.**
- [ ] **Step 5: Commit** — `git commit -m "feat(ui): session recovery re-uploads from lamp library"`

---

### Task 8: Load-time hash matching + toast

**Files:**
- Modify: `ui/src/lib/stores/project.ts` (new `linkLoadedCustomLamps(): Promise<number>`)
- Modify: `ui/src/routes/+page.svelte` (call it after `project.loadFromApiResponse(...)` at `:728`; passive toast)
- Test: extend `ui/src/lib/stores/project.test.ts`

**Interfaces:**
- Consumes: `getSessionLampFiles` (Task 1), `lampLibrary.findByHash/add` (Task 2).
- Produces: `linkLoadedCustomLamps(): Promise<number>` — returns count of *newly created* project-scoped defs.

```ts
async function linkLoadedCustomLamps(): Promise<number> {
  const candidates = get(lamps).filter(
    (l) => l.has_ies_file && (!l.preset_id || l.preset_id === 'custom')
  );
  let created = 0;
  const newDefsByHash = new Map<string, string>();  // hash -> def id (collapse within this load)
  for (const l of candidates) {
    try {
      const files = await getSessionLampFiles(l.id);
      if (!files.content_hash || !files.ies_filedata) continue;
      let def = lampLibrary.findByHash(files.content_hash);
      let defId = def?.id ?? newDefsByHash.get(files.content_hash);
      if (!defId) {
        defId = await lampLibrary.add({
          name: l.name || files.ies_filename || 'Custom lamp',
          lampType: l.lamp_type,
          wavelength: l.lamp_type === 'other' ? (l.wavelength ?? undefined) : undefined,
          ies: {
            filename: (files.ies_filename || 'custom') + '.ies',
            dataBase64: btoa(files.ies_filedata),   // filedata is text; see note
          },
          spectrum: files.spectrum ? spectrumDictToEmbedded(files.spectrum) : undefined,
          scope: 'project',
          contentHash: files.content_hash,
        });
        newDefsByHash.set(files.content_hash, defId);
        created++;
      }
      updateLampLocal(l.id, { custom_lamp_id: defId });  // plain store write, no sync echo
    } catch (e) {
      console.warn('[illuminate] custom lamp link failed for', l.id, e);
    }
  }
  return created;
}
```

Notes: `btoa` breaks on non-Latin1 — use the same text→base64 helper the library's `fileToBase64` uses (expose a `textToBase64` from `lampLibrary` or a shared util). `spectrumDictToEmbedded` builds a two-column CSV (`wavelength,intensity` header + zipped rows from the dict's two arrays) and base64s it; re-uploading that CSV parses back to the identical canonical spectrum, so the hash stays stable across future saves. `updateLampLocal`: use whatever plain-store-write path echo application uses in `project.ts` (search for the echo-write helper; do NOT enqueue sync commands — the backend already has these lamps).

+page.svelte: after a successful load,

```ts
const created = await project.linkLoadedCustomLamps();
if (created > 0) {
	lampLibraryNotice = `${created} custom lamp${created === 1 ? '' : 's'} added from file — manage in Edit → Manage Custom Lamps`;
	setTimeout(() => (lampLibraryNotice = null), 6000);
}
```

Render `lampLibraryNotice` as a small fixed-position toast div styled after `SyncErrorToast.svelte`'s container (copy its positioning CSS; neutral/info colors).

- [ ] **Step 1: Failing tests** — mocked `getSessionLampFiles` + library: (a) hash matches existing browser def → instance linked, `add` not called; (b) 4 lamps, same hash, no match → exactly one `add`, all 4 linked, returns 1; (c) distinct hashes → distinct defs; (d) preset lamps and no-photometry lamps skipped (no fetch).
- [ ] **Step 2: Verify failure. Step 3: Implement. Step 4: Green + `pnpm check`.**
- [ ] **Step 5: Commit** — `git commit -m "feat(ui): re-link loaded custom lamps by content hash"`

---

### Task 9: Delete the file pool + final sweep

**Files:**
- Delete: `ui/src/lib/stores/fileStore.ts`, `ui/src/lib/utils/fileDb.ts`, `ui/src/lib/types/fileStore.ts`, `ui/src/lib/components/FileManagerModal.svelte` (+ its test file if one exists)
- Modify: `ui/src/lib/types/project.ts` (remove `ies_file_id`/`spectrum_file_id` and their comments)
- Modify: any residual importers (run `grep -rn "fileStore\|ies_file_id\|spectrum_file_id\|iesFiles\|spectrumFiles\|FileManagerModal" ui/src` and clean every hit — expected: project.ts remnants, +page.svelte, test mocks)
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Delete files, clean all grep hits.** The grep must come back empty (excluding this plan/spec under `docs/`).
- [ ] **Step 2: Changelog** — under `[Unreleased]` / `### Changed`:

```markdown
- Custom lamps are now managed as complete lamp definitions (photometry + spectrum + product settings) in Edit → Manage Custom Lamps, replacing raw file management. Lamp dropdowns list your custom lamps per lamp type, "Add custom lamp..." opens the manager, and the inline file-upload widgets are gone. Definitions can live in this project only or persist in your browser, edits propagate to placed lamps, and loading a .guv file re-links embedded custom lamps to your library by content instead of duplicating them.
```

Plus under `### Fixed`: replacing a custom lamp's file no longer leaves both old and new files in the dropdown with no way to remove them.

- [ ] **Step 3: Full verification** — `cd ui && pnpm test:run && pnpm check`; `cd api && uv run pytest -q` (full suite, it's slow — run once here); `make generate-api` diff must be empty (`git diff --exit-code api/openapi.json ui/src/lib/api/generated`).
- [ ] **Step 4: Commit** — `git commit -m "feat!: replace file pool with custom lamp library"`

---

## Self-review notes (already applied)

- Spectrum canonicalization: hashes are computed server-side from parsed spectra (not raw CSV bytes) in both the stateless and session endpoints, so upload → save → load round-trips match by construction; the client never hashes locally.
- Task 4 calls two `project` methods that Task 5 implements — Task 4 adds them as typed no-op stubs so every task compiles and tests green independently.
- Intensity maps: applied on selection (Task 5) and recovery (Task 7); load-created defs (Task 8) intentionally omit them (spec's out-of-scope note).
