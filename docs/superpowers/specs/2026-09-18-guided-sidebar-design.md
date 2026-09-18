# Guided sidebar and visual refresh — design

**Date:** 2026-09-18
**Status:** approved direction (Approach A); built iteratively in a worktree for feel before final review

## Problem

A new user landing on Illuminate sees a room, three equal "Configure" panels, a grey
Calculate button and no results panel. Nothing says what to do first. The only saturated
colour is the floor-plan Edit button, the least likely first action. Standard zones are
presented as user-owned objects with eye / calc / delete toggles. The Calculate button
communicates its state by colour alone. The Results panel, the clearest part of the app,
is hidden until the first calculation.

The audience is both first-time evaluators (sizing GUV for one room) and daily
practitioners, evaluators first. Practitioners get an expert layout that flattens the
guidance away.

## Design

### 1. Next-step engine (`ui/src/lib/stores/nextStep.ts`)

A pure function `computeNextStep(input)` plus a derived store `nextStep`. Input is
project state only (lamps, results, staleness, calculation status, compliance summary,
audit items, auto-recalculate). First matching state wins:

| id | title | detail | action id |
|---|---|---|---|
| `no-lamps` | Add a lamp to begin | Place a lamp in the room to see what it does. | `add-lamp` |
| `lamps-excluded` | Every lamp is excluded from the calculation | Include at least one lamp. | `include-lamps` |
| `lamp-needs-model` | Choose a model for {lamp} | A lamp needs photometry before it can be calculated. | `open-lamp:{id}` |
| `calculating` | Calculating… | (progress) | none |
| `calc-error` | Calculation failed | {message} | `calculate` |
| `stale` | Design changed since the last calculation | (auto-recalc on: "Recalculating…") | `calculate` |
| `never-calculated` | Ready to calculate | Run the simulation to see fluence and safety results. | `calculate` |
| `non-compliant` | Exposure exceeds the TLV | Skin / eye dose over the limit; dimming or repositioning needed. | `review-safety` |
| `near-limit` | Within 10% of the TLV | Consider a margin before installing. | `review-safety` |
| `warnings` | {first warning message} | n more in the audit | `open-audit` |
| `compliant` | Design complies with TLVs | Export a report or keep refining. | `generate-report` |

Actions are ids, not closures. `NextStepCard.svelte` maps ids to page handlers via a
single `onAction(id)` prop.

### 2. Shared derivations

- `ui/src/lib/stores/compliance.ts`: derived from `results`/`zones`/`room` — skin/eye
  max, non-compliant / near-limit flags, overall status. `ZoneStatsPanel` reads it
  instead of computing its own copy.
- `ui/src/lib/stores/audit.ts`: `computeAuditItems(input)` (pure) + `auditItems`
  derived store + a `positionWarnings` writable refreshed by `refreshPositionWarnings()`.
  `AuditModal` renders from the store; the results header and the next-step card read
  the same list.
- `ui/src/lib/stores/calculationStatus.ts`: `lastError` (string | null) and
  `isCalculating`, set by `performCalculation` callers so any component can show them.

### 3. Sidebar structure (desktop and mobile "Configure" tab)

```
[ NextStepCard ]                      always visible; primary button
1  Room       4 × 6 × 2.7 m · rectangle   ✓   collapsed summary; click to expand RoomEditor
2  Lamps      Lamp 1 · Aerolamp DevKit          list + editor; "Add lamp" secondary button
3  Calculate  [ Calculate ]  Up to date ✓      labeled states; auto-recalc toggle
Advanced ▸    custom calc zones · standard-zone grid · reflections
```

- `SidebarStep.svelte`: numbered shell with title, one-line summary, status glyph,
  collapsible body. Status: `done` / `attention` / `idle`.
- Room step is collapsed by default (defaults are sensible); Lamps open; Calculate open.
- `CalculateButton` gains a `layout="sidebar"` mode: full-width button, state label
  text ("Calculate", "Recalculate", "Up to date"), error line underneath, auto-recalc
  toggle. Same classes as today so e2e (`button.calculate-btn`, `.up-to-date`) hold.
- Standard zones move out of the list. Under Advanced: "Standard zones" row with the
  use-standard-zones toggle and one "Grid…" affordance per zone that opens the existing
  ZoneEditor read-only view. Custom zones keep their list + editor under Advanced.
- Per-row icon toggles (eye, calc-enable, delete) render at reduced opacity and become
  fully visible on hover / focus-within / expanded.
- Existing e2e selectors kept: `.panel-header` with text Lamps / Calc Zones, `.panel-content`,
  `button:has-text("Add Lamp")`, `button:has-text("Add Zone")`, `.item-list-item[data-lamp-id]`,
  `.item-list-item[data-zone-id]:not(.standard-zone)`, `.inline-editor`, `h3:has-text("Room")`.

### 4. First-load chooser (`StartChooserModal.svelte`)

Shown once per browser on a fresh project (no lamps, not restored from sessionStorage,
no `?preview_lamp`). Three cards:

- **Typical room, one lamp** — adds one lamp with the first built-in 222 nm preset,
  placed as a downlight via the backend placement endpoint, then calculates.
- **Empty room** — dismisses.
- **Open a project file** — triggers the .guv file picker.

"Don't show this again" checkbox → `userSettings.showStartChooser = false`. Also
reachable from Help → Getting started.

### 5. Expert layout

`userSettings.sidebarLayout: 'guided' | 'expert'`, View → Layout submenu. Expert:
no next-step card, no step numbers, all sections open, standard zones listed inline as
today, Calculate stays in the sidebar. Guided is the default.

### 6. Visual refresh

- Split the accent: `--color-primary` (indigo-violet, UV-adjacent) for primary actions,
  focus rings, selected states; `--color-accent` (existing pink-red) stays for brand and
  the mobile tab highlight; `--color-danger` for delete / non-compliant.
- One sidebar type scale: step titles 0.95rem/600, summaries base/muted, section labels
  xs/uppercase.
- Cards: one surface (`--color-bg-secondary`), 1px border, `--radius-md`; nested rows use
  `--color-bg-tertiary`. No nested card-in-card-in-card.
- Light theme base lifted slightly so the viewer and sidebar read as one surface.

## Out of scope

Menu bar reorganisation, results panel layout, the floor-plan modal, mobile tab order.

## Testing

- Unit: `nextStep.test.ts` (every state and priority), `audit.test.ts`, `compliance.test.ts`,
  `NextStepCard.test.ts`, `StartChooserModal.test.ts`, updated `ZoneStatsPanel.test.ts`.
- e2e: existing suites must pass unchanged; add `guided.spec.ts` covering chooser →
  typical room → results, and expert-layout toggle.
