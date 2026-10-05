# PDF Report — Design

**Date:** 2026-10-03
**Branch:** `pdf-report` (worktree `.claude/worktrees/pdf-report`)
**Status:** draft for review

## 1. Purpose

Replace the flat CSV "Generate Report" output with a designed, paginated PDF a
user can hand to someone else as the deliverable of a GUV design. The primary
reader is a facility owner or client receiving the report from a lighting
designer or installer; the same document must also serve an engineer or peer
reviewer (inputs, full statistics, photometrics, methodology) and a compliance
submission (standard cited, TLV tables, per-lamp compliance). Ordering follows
that priority: safety and pathogen reduction first, in plain language, with
engineering detail and compliance tables after.

Success: the PDF reads well with the app closed, never contradicts the
Results panel, and looks intentionally designed rather than auto-dumped.

### Out of scope

- Editing the report after generation, or a report-only preview mode.
- Multi-room projects (the API session holds one room; the report follows it).
- Replacing the per-zone CSV / ZIP exports. The CSV report stays available in
  the Export modal under its current name.
- Desktop (Tauri) packaging of the new system libraries. The desktop build is
  dormant; a note is added to its README.
- Pathogen **groups** and summary statistics (all viruses, respiratory, …) and
  the question of how to weight them. The report lists the individual species
  the user selects; group handling is deferred to a later design.

## 2. Architecture

Hybrid. The frontend owns everything that only exists in the browser (3D
captures, the user's choices); the backend owns every number and the layout.

```
ReportModal (Svelte)
  ├─ reportCapture.ts ── Scene capture controls ──▶ PNG data URLs
  └─ POST /session/report/pdf  { meta, options, pathogens, images }
                                   │
                        report/ package (api/api/report/)
                          context.py   ─ assembles ReportContext from guv_calcs
                          plots.py     ─ matplotlib → SVG (heatmaps, survival)
                          render.py    ─ Jinja2 template → HTML → WeasyPrint → PDF
                          templates/report.html, report.css, fonts/
                                   │
                              application/pdf
```

Rendering stack: **Jinja2 + WeasyPrint** on the backend. Reasons: print CSS
gives running headers/footers, page numbers and keep-together rules; the
template is plain HTML that can be opened in a browser while iterating;
matplotlib plots embed as SVG and stay crisp; the UI's design language
transfers directly. Cost: Pango/HarfBuzz system packages in the Docker image
and a bundled font.

### 2.1 New dependencies

API (`api/pyproject.toml`): `weasyprint>=62,<70`, `jinja2>=3.1,<4`.
Docker (`Dockerfile`, runtime stage): `apt-get install -y --no-install-recommends
libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz0b libharfbuzz-subset0 fontconfig`
and a WeasyPrint smoke render beside the existing matplotlib warm-up so a
broken image fails at build time, not at first request.
Fonts: one open-licence family with regular, medium and bold weights plus a
tabular-figures feature, bundled under `api/api/report/templates/fonts/` and
referenced with `@font-face` so output is identical on every host. (Candidate:
IBM Plex Sans; the plan picks the exact files.)

`uv.lock` is regenerated once for the new packages. The other instance's
uncommitted `uv.lock` in the main checkout is not touched; the lock change
lands in this branch's commit and is reconciled at merge.

### 2.2 Entry points

- **Results panel → Generate Report** opens the Report modal (was: downloads
  CSV). This is a one-line handler change in `ZoneStatsPanel.svelte`, made
  last, after rebasing onto main, because another session is actively editing
  that file.
- **Export modal → "Report (CSV)"** keeps the CSV download. A "Report (PDF)…"
  button beside it opens the same Report modal.

## 3. The document

Page size follows the room's units: feet → US Letter, metres → A4. Portrait.
Running header: project title (left), "Illuminate" wordmark (right). Running
footer: "Illuminate vX.Y · generated YYYY-MM-DD HH:MM · page n of N". Light
theme; the app accent (`--accent` from `app.css`) used only for section
numerals, status chips and table rules. Tables: units in column headers,
numbers right-aligned with tabular figures, the room's unit system throughout,
the project's `precision` for decimals.

Every section is a numbered `<section>` with `break-before: page` except where
noted. The template never prints "undefined": optional data is wrapped in
`{% if %}` and whole sections drop when they have nothing to say.

| # | Section | Content |
|---|---------|---------|
| — | **Cover** | Title, client/site, prepared by, date; the chosen 3D capture filling most of the page; one line: dimensions, lamp count and wavelengths, standard applied. |
| 1 | **Summary** (one page) | Three stat tiles: eACH‑UV, CADR‑UV (lps and cfm), average fluence. **Occupancy statement** as a coloured status block with the banner's exact wording ("Continuous occupancy is within the TLV" / "Safe to occupy for N hours per day"), listing hours to the ACGIH TLV and the ICNIRP limit for skin and eye. Compact **pathogen table**: the selected species, time to 90/99/99.9 %. "How to read this report" paragraph and key assumptions. |
| 2 | **Room and installation** | Plan-view capture with lamp labels. Dimensions block: X, Y, Z, floor area, volume, shape (rectangle / traced outline, n corners), air changes/h. **Luminaire table**: name, fixture (preset or IES file), wavelength, output %, position, aim, tilt, orientation, enabled. **Surfaces** table (reflectance per surface, enabled flag). **Objects** table when present (name, size, base centre, yaw, reflectance, transmittance). |
| 3 | **Photobiological safety** | Standard applied and a sentence on what it bounds. Skin and eye heatmaps side by side (same colormap, shared scale). Table: hours to TLV, max and average 8‑h dose, max and average irradiance, skin and eye columns. **Per-lamp compliance** table: lamp, skin dose/TLV, eye dose/TLV, status, dimming recommendation ("Dim to S % (minimum M %)", same arithmetic as the panel). check‑lamps warnings. **Ozone** estimate when any 222 nm lamp is present (air changes, decay constant, ppb, threshold). |
| 4 | **Pathogen reduction in air** | Whole-room fluence volume: isosurface capture, mean/max/min fluence, the isosurface levels drawn and their colours. Survival curve for the selected species (matplotlib, light theme). Full pathogen table: species, category, eACH‑UV, CADR lps and cfm, t90, t99, t99.9. Note listing the wavelengths whose data were used and any lamp wavelength with no data. |
| 5 | **Custom calculation zones** (only when any) | Planes: heatmap plus mean/max/min in the zone's units (fluence, or dose with its exposure time). Volumes: mean/max/min plus an isosurface capture of that zone alone. Points: one table of name, position, value. |
| A | **Appendix** | A1 Lamp photometrics: polar plot and spectrum per distinct lamp type (toggle). A2 Methodology in plain language: IES photometry and inverse-square irradiance, reflections if enabled, kinetic model and dataset, TLV weighting (toggle). A3 Design audit items when any. A4 Data references for the species used (reference text and link). A5 Software versions (app, guv‑calcs) and calculation timestamp. |

Status colours match the panel: green for "within TLV" (≥ 8 h), amber for a
limited number of hours. The report never prints "does not comply".

## 4. API contract

`POST /session/report/pdf` → `application/pdf`,
`Content-Disposition: attachment; filename="<slug(title)>_report.pdf"`.
Requires an initialised session with calculated results; 400 when the
whole-room fluence or safety zones have no values (message names what is
missing). Body (Pydantic models in `api/api/v1/schemas.py`, generated into
`ui/src/lib/api/generated/api-types.ts`, aliased in `contract.ts`):

```
ReportRequest
  meta:      ReportMeta      { title: str, client: str = "", prepared_by: str = "", notes: str = "" }
  options:   ReportOptions   { include_lamp_appendix: bool = True,
                               include_methodology: bool = True,
                               page_size: "auto" | "a4" | "letter" = "auto" }
  pathogens: list[str]       # species names; each must have aerosol data at every lamp wavelength
  images:    dict[str, str]  # key → PNG data URL; keys: "cover", "plan", "volume:<zone_id>"
```

Limits: each image ≤ 4 MB decoded, ≤ 12 images, title ≤ 120 chars, notes ≤
2000 chars. Exceeding any → 422, as does a species with no data at the lamps' wavelengths
(the message names it). Images are validated as PNG with Pillow
before embedding; a bad one → 422 naming the key.

The handler runs under `locked_session(session)`; `_log_and_raise` wraps
failures. The safety standard, units, precision, air changes and ozone
constants are read from the room, never from the request.

### 4.1 Report meta persistence

`meta` is kept in the project store (`project.reportMeta`) and in the
app-owned `illuminate` block of the `.guv` envelope beside `floorplan`, via
`floorplanSidecar.ts`'s mechanism generalised to `appSidecar.ts`
(`illuminate.report = { title, client, prepared_by, notes }`). Default title is
the project name. SessionStorage persistence follows the store as today.

## 5. Backend: `api/api/report/`

- `context.py` — `build_report_context(room, request, versions) -> ReportContext`.
  Pure assembly from guv_calcs objects; no I/O except reading zone values.
  Numbers are computed here, once, and the template only formats:
  - **Pathogen numbers come from guv‑calcs's own wiring, not a re-implementation.**
    `room.average_value(zone_id=WHOLE_ROOM_FLUENCE, function=["each_uv",
    "cadr_lps", "cadr_cfm", "log1", "log2", "log3"], species=[...])`, exactly as
    the existing `/disinfection-table` endpoint does. Underneath,
    `zone.calculator.cache.by_wavelength(room.lamps, reduce=np.mean)` sums each
    lamp's cached contribution per wavelength, so a mixed 222 nm + 254 nm
    install yields `{222: F₂₂₂, 254: F₂₅₄}`; `InactivationData` then averages
    k1/k2/f per species per wavelength and the additive multi-wavelength
    functions sum the per-wavelength contributions. Species are limited to
    those with aerosol data at every lamp wavelength (`filter_wavelengths`).
    The survival curve is `room.survival_plot(species=[...])` on the same data.
    The frontend receives the same dictionary as `fluence_by_wavelength` from
    `/calculate`, so the two sides agree by construction.
  - **Hours to the limit use the spectrally weighted dose**, the way
    `check_lamps` judges compliance: for each lamp, dose × 3 / TLV_lamp(standard)
    summed over lamps, then hours = 8 × 3 / max(weighted dose). A small helper
    `weighted_dose_max(room, standard)` in `context.py` evaluates this for both
    ACGIH and ICNIRP from the skin and eye zones' per-lamp caches, mirroring
    the first loop of `guv_calcs.safety.check_lamps` (which only runs for
    `room.standard`). For a single-wavelength install this equals the panel's
    8 × TLV / max dose exactly. For a mixed install the panel today applies
    the most restrictive lamp's TLV to the unweighted summed dose, which is
    conservative but not the standard's additive formulation. **This feature
    fixes the panel too** (§5.1): the helper lives in
    `api/api/v1/safety_helpers.py`, is used by both the report and the
    check‑lamps endpoint, and the panel reads the backend's hours instead of
    computing its own. Occupancy wording uses the same 8 h threshold as today.
  - Per-lamp compliance from `room.check_lamps()`; dimming numbers from the
    panel's arithmetic (`floor(d·100)` minimum, `floor(d·0.9·100)` suggested,
    nudged below the minimum).
  - Ozone from the room's existing estimate when any lamp is 222 nm.
### 5.1 Weighted hours-to-limit in check‑lamps

`CheckLampsResponse` gains `hours_to_limit_by_standard: dict[str, HoursToLimit]`
keyed `ACGIH` / `ICNIRP`, each `{skin: float | None, eye: float | None}`,
computed as 8 × 3 / max(weighted dose) from the skin and eye zones' per-lamp
caches with each lamp's own TLV under that standard (lamps without a TLV are
skipped with the existing warning). `tlvs_by_standard` is kept for display.
The frontend's `ZoneStatsPanel.svelte` and `OccupancyBanner.svelte` use the
new field for the hours cells and the banner; `hoursToLimit()` in
`resultsSummary.ts` remains only as the fallback when the field is absent
(an older backend) and gains a comment saying so. Single-wavelength rooms
show the same numbers as before; mixed rooms change. CHANGELOG records it
under Fixed.

- `plots.py` — `plane_svg(zone, theme="light", shared_scale=None)`,
  `survival_svg(data, species)`, `lamp_polar_svg(lamp)`, `lamp_spectrum_svg(lamp)`.
  All return SVG strings via `fig.savefig(format="svg")`, close their figures,
  and use a print palette (white background, dark text, the app colormap).
  Skin and eye heatmaps share one colour scale.
- `render.py` — `render_pdf(ctx) -> bytes`. Jinja2 `Environment` with
  autoescape, filters `num(value, places)`, `hours`, `seconds`, `unit`; loads
  `templates/report.html` + `report.css`; WeasyPrint `HTML(string=...).write_pdf()`
  with a `base_url` pointing at the templates directory so fonts and the
  wordmark SVG resolve. WeasyPrint is imported lazily inside this module so
  the rest of the API starts even if the system libraries are missing, and
  the endpoint returns 503 with a clear message in that case.
- `routers`: `report_routers.py` registers the endpoint on the session router
  alongside the existing CSV `/report`.

## 6. Frontend

### 6.1 `ReportModal.svelte`

Opened from the two entry points (§2.2). Uses the existing `Modal` shell and
the full-screen sheet behaviour on phones. Contents, top to bottom:

1. **Details**: title (default project name), client/site, prepared by, notes.
   Bound to `project.reportMeta` through the store's `updateReportMeta`, no
   local mirror of store state (per CLAUDE.md).
2. **Cover view**: four thumbnails — Current view, Headline isometric
   (`iso-front-left`), Plan (`top`), Front (`front`) — rendered when the modal
   opens; radio selection; Current view is the default. Thumbnails re-render
   when the user re-opens the modal, never live.
3. **Pathogens**: reuses `PathogenMultiSelect.svelte` unchanged (species with
   data at the lamps' wavelengths, grouped by category for browsing; ticking a
   category header ticks its species, it does not create a group entry).
   Pre-selected: the user's compared species (`userSettings.resultSpecies`)
   plus the summary species when it is an individual species, so the report
   matches what they were looking at. At least one species is required.
4. **Include**: lamp photometric appendix, methodology notes. Remembered in
   `userSettings`.
5. **Generate PDF** button with a status line: "Capturing views…" →
   "Rendering PDF…" → download via the existing `downloadBlob`. Disabled while
   results are stale (same `isStale` the panel uses) with a hint to recalculate.
   Errors use `AlertDialog`.

### 6.2 `reportCapture.ts`

```
captureReportImages(scene: CaptureControls, plan: {
  coverView: 'current' | ViewPreset,
  volumeZoneIds: string[],
  size: { width, height }
}): Promise<Record<string, string>>
```

For each required image: save camera and visibility, apply the preset (or
leave the camera alone for `current`), set `visibleZoneIds` to the subset
(cover: all visible as now; plan: lamps + objects + points; `volume:<id>`:
lamps + that zone), wait two animation frames, read `canvas.toDataURL`, then
restore. Runs sequentially so the single WebGL canvas is never read mid-frame.
Returns `{ cover, plan, 'volume:<id>'… }`. The Scene exposes the controls it
already has (`onCaptureControlReady`, `onViewControlReady`, visibility props);
one new control is added: `setVisibility(subset)` with `restore()`.
The capture resolution is the canvas size up-scaled to at least 1600 px wide
through the renderer's pixel ratio for the duration of the capture, so the
cover is print-sharp.

### 6.3 Store and types

- `ReportMeta` type and `reportMeta` field on the project state; persisted
  in sessionStorage and the `.guv` sidecar; `updateReportMeta()` is a plain
  store write (no backend sync — the backend only sees it in the request).
- `client.ts`: `postSessionReportPdf(body): Promise<Blob>` using the
  generated contract type; `CheckLampsResult` picks up the new field from the
  regenerated contract.
- `ZoneStatsPanel.svelte` / `OccupancyBanner.svelte`: read
  `hours_to_limit_by_standard` (§5.1). Done at integration time with the
  Generate Report handler swap (§9).

## 7. guv‑calcs

No changes. The report uses guv‑calcs 0.7.3 as pinned. Group statistics and
their weighting are deferred (§1).

## 8. Testing

**Backend (`api/tests/`)**
- `test_report_context.py`: fixture room (two lamps at 222 nm, standard
  zones calculated at coarse spacing, one custom plane, one volume, one
  point). Asserts section presence/absence rules, unit handling (feet and
  metres), per-species eACH/CADR/times, dimming arithmetic, occupancy
  wording thresholds, 422 on oversized or non-PNG images and on an unknown
  species.
- `test_report_pdf.py`: renders the fixture to PDF; asserts page count within
  a range, that `pdfminer`/`pypdf` text extraction contains the title, each
  section heading and the eACH value; checks no "None" or "nan" appears.
  Skipped with a clear reason when WeasyPrint's libraries are absent.
- `test_results_parity.py`: a JSON fixture of inputs → expected outputs
  recorded from the TypeScript utilities (`survival-math.ts`,
  `resultsSummary.ts`, `calculations.ts`) for eACH, CADR, t90/t99/t99.9 and
  hours-to-TLV; the Python context must reproduce each to 1e-6 relative. The
  fixture is generated by a Vitest test that writes it
  (`ui/src/lib/utils/reportParity.fixture.test.ts`), so both sides reference
  one file. Cases: a 222 nm-only room, a 254 nm-only room and a mixed
  222 + 254 room for the pathogen numbers; hours-to-TLV parity cases are
  single-wavelength only (where the old formula and the weighted one agree),
  and a separate backend test pins the mixed-install weighted value against a
  hand-computed expectation and asserts check‑lamps and the report return the
  same hours.

**Frontend (`ui/`)**
- `ZoneStatsPanel.test.ts` / `OccupancyBanner.test.ts`: hours cells and the
  banner use `hours_to_limit_by_standard` when present and fall back when
  absent.
- `ReportModal.test.ts`: default title, meta round-trip through the store,
  pathogen pre-selection, disabled state when stale, request body shape.
- `reportCapture.test.ts`: with a mocked canvas and controls, asserts the
  preset/visibility sequence, restoration on success and on failure, and the
  returned keys.
- `appSidecar.test.ts`: report meta round-trips through the `.guv` envelope
  with and without a floor plan.
- `pnpm check` stays at zero errors; the contract job stays green
  (`make generate-api` committed).

**End-to-end (`e2e/`)**: one Playwright flow against the dev stack: load a
sample project, calculate, open Generate Report, pick the headline view,
generate, assert a PDF download whose first bytes are `%PDF` and whose size
exceeds a floor.

**Docker**: the image build's smoke render covers WeasyPrint; CI's existing
`[DIAG]` grep, `0.3048` grep and contract check apply unchanged.

## 9. Risks and mitigations

- **Concurrent edits to `ZoneStatsPanel.svelte` and `PathogenSummary.svelte`
  by another session.** This branch touches `ZoneStatsPanel.svelte` in two
  places (Generate Report handler; hours-to-limit source) and
  `OccupancyBanner.svelte` in one, all at integration time after rebasing
  onto main; `PathogenMultiSelect` is reused, not modified.
- **WebGL capture returns a blank frame** when the canvas is not visible or
  the tab is in the background. Capture waits two frames and checks the PNG
  is not uniform before accepting it; on failure the modal reports which view
  failed and offers to generate without that image (the template handles a
  missing image with a neutral placeholder and a note).
- **Large images in the request.** 4 MB per image × up to 12 is bounded;
  captures are JPEG-free PNG at a fixed width, typically 300–900 KB each.
- **WeasyPrint render time** for a report with many SVG heatmaps: measured in
  the plan; expected 1–3 s. The endpoint runs in a threadpool like other
  sync handlers; the modal shows progress.
- **Font licensing**: the chosen family's OFL licence file is committed next
  to the font files.

## 10. Changelog entry (to add at the first user-facing commit)

> Added — Reports: Generate Report produces a designed PDF — cover with a
> chosen 3D view, a one-page summary (eACH‑UV, CADR, average fluence, the
> occupancy statement with hours to the ACGIH and ICNIRP limits, selected
> pathogens), room and luminaire tables with a plan view, photobiological
> safety with skin and eye heatmaps and per-lamp compliance, pathogen
> reduction with the fluence isosurfaces and survival curve, custom zones,
> and an appendix with lamp photometrics and methodology. A Report dialog
> takes the title, client, preparer and notes (saved with the project), the
> cover view, and the pathogens to include. The CSV report remains
> in the Export modal.
>
> Fixed — Results: hours to the TLV and the occupancy banner now come from the
> spectrally weighted dose (each lamp's dose weighted by its own limit, then
> summed), the way compliance is judged, so a room mixing 222 nm and 254 nm
> lamps no longer applies the stricter lamp's limit to the whole dose.
> Single‑wavelength rooms are unchanged.
