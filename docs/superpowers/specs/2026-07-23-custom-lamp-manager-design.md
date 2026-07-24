# Custom Lamp Manager — Design

**Date:** 2026-07-23
**Status:** Approved (approach A: self-contained lamp library)

## Problem

Custom lamp handling is file-centric and leaks storage mechanics into the UI:

- The file pool dedupes by filename only, so replacing a lamp's IES file with a
  differently-named file orphans the old pool entry; both appear in the lamp
  dropdown forever, with no delete affordance there.
- `FileManagerModal.confirmDelete` never actually clears lamp references (the
  ref-clearing loops are empty stubs), leaving dangling `ies_file_id`s.
- Users think in *lamps* (a product: photometry + spectrum + housing), not in
  raw files. The inline upload widgets in LampEditor expose the file plumbing.

## Decision summary

Replace the file pool with a **custom lamp library**. A custom lamp definition
is a self-contained record that embeds its files. The pool
(`fileStore.ts`, `fileDb.ts`, `types/fileStore.ts`, `FileManagerModal.svelte`)
is deleted; no migration (the pool never shipped to production — it exists only
in unreleased 0.1.4 dev builds).

Key semantics, as agreed:

- **Files vs lamps:** raw files stop being a user-visible concept entirely.
- **Dropdowns are type-filtered:** every lamp type gets a "Select Lamp"
  dropdown listing custom lamps whose `lampType` matches; 222nm also lists the
  built-in presets. The upload entry is renamed **"Add custom lamp..."** and
  opens the manager modal (form view, type pre-selected). The inline file
  widgets in LampEditor are removed entirely.
- **Definition edits propagate** to placed instances (re-upload files, re-apply
  product fields). Per-instance Advanced Lamp Settings tweaks survive until the
  next definition edit — last write wins. The Advanced Lamp Settings modal
  itself is unchanged.
- **Two persistence scopes** per definition: `browser` (IndexedDB, survives
  across sessions) and `project` (rides with project state in sessionStorage:
  survives tab-idle/timeout recovery, cleared on refresh, per-tab).
- **Content-hash identity:** definitions carry a SHA-256 hash of their file
  content; .guv loads re-link embedded custom lamps to existing definitions by
  hash instead of duplicating them.

## Data model

`ui/src/lib/types/lampLibrary.ts`:

```ts
interface EmbeddedFile {
  filename: string;
  dataBase64: string;
}

interface CustomLampDef {
  id: string;                    // UUID, client-minted
  name: string;                  // required
  lampType: 'krcl_222' | 'lp_254' | 'other';   // reuse existing union type
  wavelength?: number;           // 'other' only; required iff no spectrum
  ies: EmbeddedFile;             // required
  spectrum?: EmbeddedFile & { columnIndex?: number };
  scalingFactor?: number;
  intensityUnits?: 'mw/sr' | 'uw/cm2';
  surface?: { width?: number; length?: number; height?: number;
              units?: 'meters' | 'feet' };
  housing?: { width?: number; length?: number; height?: number };
  sourceDensity?: number;
  intensityMap?: EmbeddedFile;
  scope: 'browser' | 'project';
  contentHash: string;           // SHA-256 over ies bytes + spectrum bytes + columnIndex
  createdAt: string;
  updatedAt: string;
}
```

Field shapes mirror guv_calcs' product definition (`LAMP_CONFIGS` +
`LampSurface`/`Fixture` params). Position/aim/angle/enabled stay per-instance.
Where a generated contract type exists for a field group (advanced settings
shapes), alias it instead of redeclaring.

`LampInstance` gains `custom_lamp_id?: string` and loses
`ies_file_id`/`spectrum_file_id`. `custom_lamp_id` is frontend-only: it is not
serialized into .guv files; hash matching is the re-linking mechanism.

## Storage

- New store `ui/src/lib/stores/lampLibrary.ts`:
  `init / add / update / remove / get / promote / demote`, plus
  `toIesFile(id)` / `toSpectrumFile(id)` / `toIntensityMapFile(id)` helpers
  reconstructing `File` objects from base64. Derived stores: `customLamps`,
  filtered-by-type helpers.
- Browser-scoped records persist to IndexedDB DB `illuminate-lamp-library`,
  object store `lamps`, keyPath `id` (`ui/src/lib/utils/lampLibraryDb.ts`).
- Project-scoped records persist inside the existing project sessionStorage
  snapshot. sessionStorage is ~5 MB; base64 IES files are typically tens of KB,
  which realistic projects fit comfortably. If a write fails (quota), warn via
  the existing sync-error surface; the definition stays in memory.
- IndexedDB unavailable (private browsing): library operates in-memory for the
  session with a console warning — parity with today's pool behavior.
- The old `illuminate-files` DB is ignored (start clean).

## Manager modal (`LampManagerModal.svelte`)

Launched from **Edit → "Manage Custom Lamps..."** (replaces "Manage Custom
Files...") and from "Add custom lamp..." in LampEditor dropdowns. Docked modal,
`dockId="lamp-manager"`.

**List view** — two sections: *Saved in browser* and *This project only*. Each
row: name, type badge, spectrum indicator, edit + delete actions. Project rows
get **"Save to browser"** (promote); browser rows get **"Remove from browser"**
(demote to project scope if any current lamp instance references the
definition via `custom_lamp_id`, delete outright if none does — nothing placed
ever breaks from a demotion). "Add custom lamp" button on top.

**Form view** (add/edit):

- Name (required)
- Lamp type (same three options as LampEditor's selector)
- Wavelength — shown for `other`; required iff no spectrum file attached
  (guv_calcs derives wavelength from spectrum peak); hint text when derived
- IES file (required) — file input, replace-in-place, current filename shown
- Spectrum file — marked *recommended* for 222nm/other; multi-column CSVs go
  through the column picker (extracted from LampEditor into a shared component
  along with `parseSpectrumFile` usage)
- Collapsed **Advanced** section: scaling factor, intensity units, luminous
  opening W/L/H + units, housing W/L/H, source density, intensity map file
- Checkbox **"Save to browser for future sessions"** — default ON for
  hand-created lamps
- Save validates: name, IES present, wavelength-or-spectrum for `other`

Replacing a file inside a definition edits in place — never a second entry.
On save of an edited definition, changes propagate (below). Deleting a
definition that placed lamps reference shows a confirm dialog listing them and
stating they will lose their photometry; on confirm, instance refs are cleared
and IES/spectrum removals are enqueued to the backend.

## LampEditor changes

Removed entirely: the inline file-upload sections, hidden file inputs,
upload/remove handlers, `$iesFiles`/`$spectrumFiles` dropdowns, `custom_file:`
option values, in-component column picker.

"Select Lamp" dropdown per type:

- **krcl_222:** built-in presets — divider — matching custom lamps — divider —
  "Add custom lamp..."
- **lp_254 / other:** matching custom lamps — "Add custom lamp..."

Selecting a custom lamp sets `custom_lamp_id`, applies the definition
(pending file uploads + product fields), and for `other` sets the wavelength.
The "Custom lamp (uploaded file)" fallback option remains for loaded lamps not
linked to any definition.

## Sync, propagation, recovery, load

All backend traffic uses existing endpoints (IES/spectrum/intensity-map
upload + removal, advanced-settings update) through the sync queue's existing
`pending_*` mechanics. One **new read-only endpoint**:

- `GET /session/lamps/{lamp_id}/files` → base64 IES + spectrum (+ filenames,
  spectrum column metadata if available) for a session lamp — the same data
  `to_dict` embeds in .guv saves. Requires contract regeneration
  (`make generate-api`). Non-mutating: no `locked_session` needed, but follow
  the existing read-handler conventions.

Flows:

- **Selection/placement:** store mutation sets `custom_lamp_id` + pending
  files → sync queue uploads, then applies product fields the definition
  specifies.
- **Definition edit:** `lampLibrary.update()` finds placed instances with that
  `custom_lamp_id` and enqueues the same updates for each.
- **Session recovery:** `reuploadCustomFiles` is rewritten to iterate lamps
  with `custom_lamp_id`, pulling files from the library (both scopes).
- **.guv load:** after the session loads, for each lamp with custom photometry
  (`has_ies_file` true and `preset_id` of `'custom'` or empty — built-in
  presets are skipped) the frontend fetches its files, computes the content
  hash, then:
  - hash matches an existing definition (browser preferred over project) →
    link the instance, create nothing;
  - several loaded lamps share an unmatched hash → one new project-scoped
    definition, all instances linked;
  - otherwise → one new project-scoped definition. Name from lamp/file name.
  A passive toast reports "N custom lamps added from file"; no interrupting
  dialog. Loaded lamps never auto-persist to the browser.

## Error handling

- Spectrum / intensity-map parse errors: inline in the manager form.
- Upload failures: existing `syncErrors` surface.
- Malformed IES: caught by the backend at upload, as today; the manager does
  extension-level checks only.
- Quota/IndexedDB failures: warn, degrade to in-memory.

## Testing

- `lampLibrary` store: CRUD, promote/demote, persistence round-trip (mocked
  IndexedDB + sessionStorage), hash computation.
- `LampManagerModal`: add, edit-in-place replaces file without duplication,
  delete with in-use warning, scope checkbox behavior, wavelength-or-spectrum
  validation.
- `LampEditor`: dropdown contents per lamp type, "Add custom lamp..." opens
  manager, selection applies definition.
- Propagation: definition edit → placed lamp receives pending upload/update.
- Recovery: re-upload sourced from library.
- Load matching: match / collapse-identical / create-new paths (hash fixtures).
- Backend: tests for the new files endpoint (with/without spectrum, 404s).
- Suites: `pnpm test:run`, `pnpm check`, API tests; contract regeneration
  committed.

## Out of scope

- Migrating the dev-only `illuminate-files` pool.
- "Import a loaded lamp into the library" beyond the automatic project-scoped
  add (promotion is manual, in the manager).
- Server-side hash computation in the load response (optimization if loads
  ever feel slow).
- Fixture shape (cylindrical/spherical) — guv_calcs supports it; UI keeps
  rectangular default for now.
