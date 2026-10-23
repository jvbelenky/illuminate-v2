# Workspace Redesign — Phase 1: the Workspace Shell — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sidebar + Plan pop-up with the new three-column workspace (editor · 2D/3D views · results), a landing page with three cards, and a read-only summary, carrying today's editing behaviour into it unchanged.

**Architecture:** The guided-editing state that lives inside `FloorPlanModal.svelte` today moves, almost verbatim, into a `PlanController` class (`.svelte.ts`, Svelte 5 runes). Two kinds of component read it: `PlanPane` (the 2D canvas and its toolbar, in the middle column) and the editor parts (the side-column content, in the left column). `ViewsPane` arranges the 2D and 3D views in the user's chosen layout without ever remounting either. `+page.svelte` wires the controller to the project store through the existing `PlanActions` seam and swaps between `EditorPanel` and `SummaryPanel`.

**Tech Stack:** Svelte 5 / SvelteKit, TypeScript, Vitest 4 + @testing-library/svelte (jsdom), Playwright e2e, Three.js via Threlte (`RoomViewer`).

**Spec:** `docs/superpowers/specs/2026-10-21-workspace-redesign-design.md`. The mockup at `docs/superpowers/mockups/2026-10-21-workspace.html` is the source of truth for look and behaviour where the spec is silent.

## Roadmap (this plan is Phase 1 of 4)

Each phase leaves a working, shippable app. Phases 2–4 get their own plans once the previous phase lands.

1. **Phase 1 (this plan): the shell.** Landing cards, three-column layout, View-menu layouts, editor (stages and parts with Back/Next), 2D pane on the floor, summary. Today's behaviour moves in. `FloorPlanModal`, the sidebar and `RoomEditor` go away.
2. **Phase 2: plan tools and editor polish.**
   - The shared Transform / Edit shape / Draw / Rotate / Flip toolbar for the outline and structures.
   - Geometry fold-outs with Corner/Centre reference, typed lengths while drawing, Display ▾ sections.
   - Structure rows' Display, the lamp dimmer and Stick to ceiling / wall.
   - The floor plan image's Set scale pop-up and image block.
3. **Phase 3: surfaces.**
   - Ceiling and wall views in the 2D pane: the Floor · Ceiling · Walls ▾ switcher and the `[`/`]` keys.
   - 3D surface picking with cycling and the hover chip; part-based 3D highlighting with a dashed outline on the shown surface.
   - Wall-view editing of structures and lamps; zones on walls and the ceiling.
   - The guv-calcs work for planes on angled walls and drawn wall footprints, released and pinned.
4. **Phase 4: the ceiling designer.** Tile grid (sizes, Align, Move grid), ceiling items (add, list, edit, drag/snap, keep-out shapes), visibility toggles, 3D drawing, save/load round-trip.

## Global Constraints

- `.svelte` files use tabs and must never be edited with the Edit tool or `sed`. Use the Write tool for new or rewritten files, and a Python helper (`str.replace` with an assert that the anchor occurs once) for surgical edits. `.ts` files may use Edit.
- No explanatory sentences in the UI: labels, values and chips only. Drop `FloorPlanModal`'s derived hint text (lines ~1078–1105); do not port it.
- Every scene edit goes through `PlanActions` (and from there the project store), so undo (`project.history`) and the sync queue see it. A gesture in flight stays local, and a completed gesture is one `actions.*` call (one undo step), as in today's `FloorPlanModal`.
- Units: everything is in the project's units, never hard-coded feet. Defaults scale per `UNIT_INFO` / `defaultObject`.
- Colours: `--color-primary` / `--color-accent` (brand, part tint), `--color-scene-selected` (orange selection), geometry slate, lamp hue by wavelength.
- UI copy, verbatim from the spec:
  - Stages: "Room", "Lamps", "Zones".
  - Room parts: "Floorplan", "Structures", "Ceiling", "Reflectance".
  - Header: "Edit", plus a "Done" button.
  - Back/Next are named after their target: "← Structures", "Lamps →". On Zones, the Next slot is a "Done" button.
  - Summary heading: "Summary". Its sections: "Room", "Structures", "Lamps", "Calc zones".
  - Landing cards: "Start designing", "Open a .guv file", "See an example".
  - Landing headline: "Illuminate is a tool for modeling germicidal UV efficacy and safety."
  - Layouts: "Side by side", "Stacked", "2D large + 3D inset", "3D large + 2D inset", "Swap views".
  - Room data: obstacles are called "Structures" in the UI; code and the file format keep `objects`.
- No "optional" label on Zones. No "standard" badge on standard zones.
- Desktop at 1440×900 shows controls and their effect without scrolling to see the work. Phone (< 768 px): columns stack with a 16 px gutter and no sideways scrolling.
- Scrolling follows today's app. Opening a row or editing fields leaves the scroll where it is. Adding or copying an item, or selecting it in the 2D or 3D view, scrolls its row into view: `scrollIntoView({ behavior: 'smooth', block: 'start' })`. A re-render never jumps a column to the top.
- `CHANGELOG.md` `[Unreleased]` gets user-facing entries in the task that ships them. Commits carry no `Co-Authored-By` trailer.
- Test commands:
  - One UI file: `cd ui && npx vitest run <path>`
  - All UI: `cd ui && pnpm test:run`
  - Types: `cd ui && pnpm check` (0 errors)
  - e2e: `cd e2e && npx playwright test tests/<file>`

## Review Focus

These five cases are where a person is most likely to get hurt. Each line names the input and what a reasonable person expects; each has a test in the owning task.

1. **Switching layout, or swapping views, must not remount the 3D or 2D view.** Remounting would mean a lost WebGL context, a reset camera, and a lost in-progress drag or draft. Test: Task 2, `keeps each view's DOM node across layout changes`.
2. **Leaving a step with an invalid (red) outline.** This covers stage and part tabs, Back/Next, Done, and a 3D click that switches stage. Each must ask, as today's `leave()` does: keep the last applied outline, or stay. Test: Task 7, `asks before leaving Floorplan with an invalid outline`.
3. **Shortcut keys typed into an editor field.** Delete, Backspace, arrows, M, A, Ctrl+D and Ctrl+A must not reach the canvas while focus is in an input, select or textarea, and must act only on the current stage. Test: Task 4, `ignores shortcut keys typed into a field`.
4. **Reloading with stale state.** The restored session UI state may name a part that does not exist or a selected id that was deleted, and settings saved before this change lack the new fields. These must fall back to defaults (editor at Room › Floorplan, nothing selected, layout `side`), never throw or show a blank column. Tests: Task 1, `falls back to defaults for a corrupt or unknown stored state` and `fills new layout fields for old settings`.
5. **The divider and the inset in a small window.** The split is clamped to 0.2–0.8. A dragged or remembered inset is kept fully inside the views area, including after the window shrinks. Tests: Task 2, `clamps the split` and `keeps the inset inside the area when it shrinks`.

---

## File Structure

New, under `ui/src/lib/workspace/` (layout and editor shell) and `ui/src/lib/plan/` (the guided editing logic moved out of the modal):

| File | Responsibility |
|---|---|
| `lib/workspace/editorNav.ts` | Stage/part catalogue, Back/Next order, stage→plan-context mapping (pure) |
| `lib/workspace/layoutGeometry.ts` | Layout rules: pane order, which view is large, Calculate host, split/inset clamping (pure) |
| `lib/stores/workspaceUi.ts` | Session-persisted editor-or-summary mode and open stage/part |
| `lib/workspace/ViewsPane.svelte` | Arranges the 2D and 3D snippets per layout; divider; inset; Calculate slot |
| `lib/plan/planActions.ts` | The `PlanActions` and `PlanScene` types (moved from `FloorPlanModal`'s module script, extended) |
| `lib/plan/planController.svelte.ts` | `PlanController`: all guided-editing state and logic from `FloorPlanModal` |
| `lib/plan/PlanPane.svelte` | The 2D pane: `PlanCanvas` + per-context toolbar + canvas snippets + leave-confirm dialog |
| `lib/workspace/parts/FloorplanPart.svelte` | Dimensions row, area/volume, floor plan image block, Start from, Corners |
| `lib/workspace/parts/StructuresPart.svelte` | + Add structure, rows (rename, eye, calc), open structure's panel |
| `lib/workspace/parts/CeilingPart.svelte` | Height (Phase 1 content only) |
| `lib/workspace/parts/LampsPart.svelte` | Add lamp card, lamp rows, open lamp's panel |
| `lib/workspace/parts/ZonesPart.svelte` | Use standard zones, standard rows, Add zone card, zone rows, open zone's panel |
| `lib/workspace/parts/ItemRow.svelte` | One list row: icon/dot slot, name with pencil rename, subtitle, eye + calc toggles |
| `lib/workspace/EditorPanel.svelte` | Header (Edit, Done), stage tabs, part tabs, the open part, Back/Next footer |
| `lib/workspace/SummaryPanel.svelte` | Read-only summary with full-width section buttons and row toggles |
| `lib/workspace/LandingCards.svelte` | The three square cards (content of the start chooser) |
| `lib/workspace/test/WorkspaceHarness.svelte` | In-memory scene + `calls` log hosting `EditorPanel` + `PlanPane` (successor of `FloorPlanModalHarness`) |

Modified:
- `lib/stores/settings.ts` (layout fields)
- `lib/components/MenuBar.svelte` (Layout submenu and Swap views, desktop and mobile copies)
- `lib/components/StartChooserModal.svelte` (hosts `LandingCards`)
- `routes/+page.svelte` (the integration)
- e2e helpers and specs
- `CHANGELOG.md`

Deleted in Task 12:
- `lib/components/FloorPlanModal.svelte`, plus its test and harness
- `lib/components/SidebarStep.svelte`
- `lib/components/RoomEditor.svelte` (only `+page.svelte` uses these)
- Any test files that cover only those

---

### Task 1: Workspace state — navigation catalogue, session UI store, layout settings

**Files:**
- Create: `ui/src/lib/workspace/editorNav.ts`, `ui/src/lib/workspace/editorNav.test.ts`
- Create: `ui/src/lib/stores/workspaceUi.ts`, `ui/src/lib/stores/workspaceUi.test.ts`
- Modify: `ui/src/lib/stores/settings.ts` (interface ~14-66, `SETTINGS_DEFAULTS` ~68-122), `ui/src/lib/stores/settings.test.ts`

**Interfaces:**
- Produces:
  - `type EditorStage = 'room' | 'lamps' | 'zones'`
  - `type RoomPart = 'floorplan' | 'structures' | 'ceiling' | 'reflectance'`
  - `type PlanContext = 'outline' | 'obstacles' | 'ceiling' | 'reflectance' | 'lamps' | 'zones' | 'view'`
  - `interface NavStop { stage: EditorStage; part: RoomPart | null; label: string }`
  - `const STAGES: { id: EditorStage; label: string; n: number }[]`
  - `const ROOM_PARTS: { id: RoomPart; label: string }[]`
  - `const NAV_ORDER: NavStop[]`
  - `function neighbours(stage: EditorStage, part: RoomPart | null): { prev: NavStop | null; next: NavStop | null }`
  - `function planContext(mode: WorkspaceMode, stage: EditorStage, part: RoomPart | null): PlanContext`
  - `type WorkspaceMode = 'editor' | 'summary'`
  - `interface WorkspaceUiState { mode: WorkspaceMode; stage: EditorStage; part: RoomPart }`. `part` is the last Room part, kept even while on Lamps or Zones.
  - `const workspaceUi: Readable<WorkspaceUiState> & { goTo(stage: EditorStage, part?: RoomPart): void; showSummary(): void; showEditor(): void; reset(mode: WorkspaceMode): void }`
  - `type WorkspaceLayout = 'side' | 'stack' | 'pip-2d' | 'pip-3d'`
  - New `UserSettings` fields:
    - `workspaceLayout: WorkspaceLayout` (default `'side'`)
    - `workspaceSwap: boolean` (default `false`)
    - `workspaceSplit: number` (default `0.5`)
    - `workspaceInset: { x: number; y: number } | null`, px from the views area's top-left (default `null`, meaning bottom-right)
    - `workspaceInsetHidden: boolean` (default `false`)

- [ ] **Step 1: Write the failing tests**

`editorNav.test.ts`:
```ts
test('NAV_ORDER runs through the Room parts, then Lamps and Zones', () => {
  expect(NAV_ORDER.map(s => s.label)).toEqual(['Floorplan', 'Structures', 'Ceiling', 'Reflectance', 'Lamps', 'Zones']);
});
test('neighbours names Back/Next after their targets', () => {
  expect(neighbours('room', 'floorplan')).toEqual({ prev: null, next: { stage: 'room', part: 'structures', label: 'Structures' } });
  expect(neighbours('lamps', null).prev?.label).toBe('Reflectance');
  expect(neighbours('lamps', null).next?.label).toBe('Zones');
  expect(neighbours('zones', null).next).toBeNull();
});
test('planContext maps the open step to what the 2D pane edits', () => {
  expect(planContext('editor', 'room', 'floorplan')).toBe('outline');
  expect(planContext('editor', 'room', 'structures')).toBe('obstacles');
  expect(planContext('editor', 'room', 'ceiling')).toBe('ceiling');
  expect(planContext('editor', 'room', 'reflectance')).toBe('reflectance');
  expect(planContext('editor', 'lamps', 'floorplan')).toBe('lamps');
  expect(planContext('editor', 'zones', 'ceiling')).toBe('zones');
  expect(planContext('summary', 'lamps', 'floorplan')).toBe('view');
});
```
`workspaceUi.test.ts` (fresh module per test, with `vi.resetModules()` and a dynamic import; the `sessionStorageMock` from setup is cleared per test):
```ts
test('starts in the editor at Room › Floorplan', async () => {
  const { workspaceUi } = await import('./workspaceUi');
  expect(get(workspaceUi)).toEqual({ mode: 'editor', stage: 'room', part: 'floorplan' });
});
test('goTo keeps the last Room part while on Lamps', ...)  // goTo('room','ceiling'); goTo('lamps') → {mode:'editor', stage:'lamps', part:'ceiling'}
test('showSummary then showEditor returns to where the user left', ...)
test('persists to sessionStorage under illuminate_workspace_ui and restores', ...)
test('falls back to defaults for a corrupt or unknown stored state', async () => {
  sessionStorage.setItem('illuminate_workspace_ui', JSON.stringify({ mode: 'x', stage: 'roof', part: 'attic' }));
  const { workspaceUi } = await import('./workspaceUi');
  expect(get(workspaceUi)).toEqual({ mode: 'editor', stage: 'room', part: 'floorplan' });
  // and for non-JSON:
});
```
`settings.test.ts`:
```ts
test('fills new layout fields for old settings', () => {
  localStorage.setItem('illuminate-settings', JSON.stringify({ units: 'feet' }));  // shape used by the existing load tests
  // reload the module, then:
  expect(get(userSettings)).toMatchObject({ workspaceLayout: 'side', workspaceSwap: false, workspaceSplit: 0.5, workspaceInset: null, workspaceInsetHidden: false });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd ui && npx vitest run src/lib/workspace/editorNav.test.ts src/lib/stores/workspaceUi.test.ts src/lib/stores/settings.test.ts`
Expected: FAIL (modules or fields missing).

- [ ] **Step 3: Implement `editorNav.ts`, `workspaceUi.ts` and the settings fields**

`workspaceUi` is a writable store wrapped like `userSettings`: every change is saved to sessionStorage `illuminate_workspace_ui`. Loading validates each field against the catalogues and falls back field by field. `reset(mode)` sets the defaults with the given mode; the landing page uses it. Settings: add the fields to the interface and to `SETTINGS_DEFAULTS`. `loadSettings` already merges defaults, so it needs no migration.

- [ ] **Step 4: Run the tests and confirm they pass**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/workspace/editorNav.ts ui/src/lib/workspace/editorNav.test.ts ui/src/lib/stores/workspaceUi.ts ui/src/lib/stores/workspaceUi.test.ts ui/src/lib/stores/settings.ts ui/src/lib/stores/settings.test.ts
git commit -m "feat(workspace): editor navigation catalogue, session UI state, layout settings"
```

---

### Task 2: `ViewsPane` — layouts, divider, inset

**Files:**
- Create: `ui/src/lib/workspace/layoutGeometry.ts`, `ui/src/lib/workspace/layoutGeometry.test.ts`
- Create: `ui/src/lib/workspace/ViewsPane.svelte`, `ui/src/lib/workspace/ViewsPane.test.ts`

**Interfaces:**
- Consumes: `WorkspaceLayout` (Task 1).
- Produces (`layoutGeometry.ts`):
  - `type ViewId = '2d' | '3d'`
  - `function paneOrder(layout: WorkspaceLayout, swap: boolean): [ViewId, ViewId]`. Side and stack: `['2d','3d']`, reversed when `swap`. PiP: `[large, inset]`.
  - `function largeView(layout: WorkspaceLayout): ViewId | null`. `'pip-2d'`→`'2d'`, `'pip-3d'`→`'3d'`, otherwise `null`.
  - `function calculateHost(layout: WorkspaceLayout): ViewId`. `'2d'` for `'pip-2d'`, otherwise `'3d'`.
  - `function swapped(layout: WorkspaceLayout, swap: boolean): { layout: WorkspaceLayout; swap: boolean }`. PiP layouts trade places (`pip-2d`↔`pip-3d`); side and stack toggle `swap`.
  - `function clampSplit(v: number): number`, clamped to [0.2, 0.8].
  - `function clampInset(pos: {x:number;y:number}, box: {w:number;h:number}, area: {w:number;h:number}): {x:number;y:number}`. Keeps the box fully inside the area; clamps to 0 when the box is larger than the area.
- Produces (`ViewsPane.svelte` props):
  - Layout state: `layout: WorkspaceLayout`, `swap: boolean`, `split: number`, `inset: {x,y} | null`, `insetHidden: boolean`
  - `onChange(patch: Partial<{ layout: WorkspaceLayout; swap: boolean; split: number; inset: {x,y} | null; insetHidden: boolean }>): void`
  - Snippets: `view2d: Snippet`, `view3d: Snippet`, `calculate: Snippet`
  - Markup contract:
    - Root `.views-pane[data-layout][data-swap]`.
    - Each view sits in `.view-slot[data-view="2d"|"3d"]`, rendered exactly once and never unmounted.
    - The PiP inset slot gets `.is-inset`.
    - Divider `.views-divider` (role separator), rendered for side and stack only.
    - Inset title bar `.inset-bar`, holding `button[data-inset-action="swap"]` (⇄) and `button[data-inset-action="hide"]` (–).
    - Hidden-inset pill `button.inset-show`, labelled "Show 2D" or "Show 3D".
    - The Calculate snippet renders inside the host slot's `.calculate-slot`.

- [ ] **Step 1: Write the failing tests**

`layoutGeometry.test.ts`:
```ts
test('paneOrder', () => {
  expect(paneOrder('side', false)).toEqual(['2d', '3d']);
  expect(paneOrder('side', true)).toEqual(['3d', '2d']);
  expect(paneOrder('pip-3d', false)).toEqual(['3d', '2d']);
});
test('calculateHost follows the 3D view unless 2D is large', () => {
  expect(calculateHost('side')).toBe('3d'); expect(calculateHost('pip-3d')).toBe('3d'); expect(calculateHost('pip-2d')).toBe('2d');
});
test('swapped trades PiP layouts and toggles swap otherwise', () => {
  expect(swapped('pip-2d', false)).toEqual({ layout: 'pip-3d', swap: false });
  expect(swapped('stack', false)).toEqual({ layout: 'stack', swap: true });
});
test('clamps the split', () => { expect(clampSplit(0.05)).toBe(0.2); expect(clampSplit(0.95)).toBe(0.8); expect(clampSplit(0.4)).toBe(0.4); });
test('keeps the inset inside the area when it shrinks', () => {
  expect(clampInset({ x: 900, y: 700 }, { w: 300, h: 250 }, { w: 800, h: 600 })).toEqual({ x: 500, y: 350 });
  expect(clampInset({ x: -20, y: 10 }, { w: 300, h: 250 }, { w: 800, h: 600 })).toEqual({ x: 0, y: 10 });
});
```
`ViewsPane.test.ts`. Render with a small test host that passes `<div data-testid="v2d">`, `<div data-testid="v3d">` and `<button>Calc</button>` snippets. Use `createRawSnippet` or a `.svelte` host in `lib/workspace/test/ViewsPaneHost.svelte`.
```ts
test('keeps each view\'s DOM node across layout changes', async () => {
  // render side; grab getByTestId('v3d'); rerender with layout 'pip-3d', then 'stack', swap true
  expect(screen.getByTestId('v3d')).toBe(first3d);  // same node
  expect(screen.getByTestId('v2d')).toBe(first2d);
});
test('puts Calculate in the 3D slot, or the 2D slot when 2D is large', ...)  // closest('.view-slot').dataset.view
test('the inset swap button and a click on the inset body both swap', ...) // onChange called with { layout: 'pip-2d' } from 'pip-3d'
test('hiding the inset leaves a Show pill that brings it back', ...) // onChange({insetHidden:true}); rerender hidden → 'Show 2D' pill → onChange({insetHidden:false})
test('dragging the divider reports a clamped split; double-click resets to 0.5', ...) // pointer events on .views-divider with a mocked getBoundingClientRect
test('dragging the inset bar reports a clamped position', ...)
```

- [ ] **Step 2: Run and confirm they fail**

Run: `cd ui && npx vitest run src/lib/workspace/layoutGeometry.test.ts src/lib/workspace/ViewsPane.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**

- **Layout:** both slots are absolutely positioned children of the root. Side and stack set each slot's rect from `split` (6 px divider between). PiP fills the large slot, and the inset slot is 30 % wide and `calc(30% + 24px)` tall (min 150 px), at `inset` or bottom-right 14 px. Use pointer events with capture for both drags. Report the final value once on pointerup through `onChange`, and keep the live value local while dragging.
- **Inset chrome:** the inset is opaque, `z-index` above the Calculate slot. The title bar is 24 px, holds the slot name ("2D"/"3D") and the two buttons, and is the drag handle. A click on the inset body (not a drag) swaps.
- **Small widths:** below 768 px the pane forces `stack` regardless of the setting, and hides the divider.

- [ ] **Step 4: Run and confirm they pass**. Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/workspace/layoutGeometry.ts ui/src/lib/workspace/layoutGeometry.test.ts ui/src/lib/workspace/ViewsPane.svelte ui/src/lib/workspace/ViewsPane.test.ts ui/src/lib/workspace/test/ViewsPaneHost.svelte
git commit -m "feat(workspace): ViewsPane arranges the 2D and 3D views in four layouts without remounting them"
```

---

### Task 3: View menu — Layout submenu and Swap views

**Files:**
- Modify: `ui/src/lib/components/MenuBar.svelte`:
  - Props ~9-55 and destructuring ~57-103
  - Desktop View menu ~654-820 (add a `has-submenu` item like theme ~662)
  - Mobile copy ~450-550
- Modify: `ui/src/lib/components/MenuBar.test.ts`

**Interfaces:**
- Consumes: `WorkspaceLayout`.
- Produces: new MenuBar props `workspaceLayout?: WorkspaceLayout`, `onSetWorkspaceLayout?: (l: WorkspaceLayout) => void`, `onSwapViews?: () => void`. The submenu and Swap views render only when `onSetWorkspaceLayout` is given.

- [ ] **Step 1: Write the failing tests** (in `MenuBar.test.ts`, following its existing open-menu pattern)

```ts
test('View › Layout lists the four layouts with a check on the current one', ...)
  // open View, hover/click 'Layout'; items 'Side by side','Stacked','2D large + 3D inset','3D large + 2D inset'; '✓' on 'Stacked' when workspaceLayout='stack'
test('picking a layout calls onSetWorkspaceLayout and closes the menu', ...)  // click '2D large + 3D inset' → called with 'pip-2d'
test('Swap views calls onSwapViews', ...)
test('the mobile menu offers the same entries', ...)
```

- [ ] **Step 2: Run and confirm failure.** Run: `cd ui && npx vitest run src/lib/components/MenuBar.test.ts`. Expected: the new tests FAIL.

- [ ] **Step 3: Implement.** The layout entries are `handleMenuAction` items (they close the menu); Swap views is a plain action item after a `menu-separator`. Mirror both in the mobile section with `mobileAction`.

- [ ] **Step 4: Run and confirm pass.** Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/components/MenuBar.svelte ui/src/lib/components/MenuBar.test.ts
git commit -m "feat(menu): View › Layout and Swap views"
```

---

### Task 4: `PlanController` — move the guided-editing logic out of `FloorPlanModal`

This is a refactor with a safety net. `FloorPlanModal` keeps working and keeps its full test file green while its logic moves into the controller. After this task `FloorPlanModal` is a thin view over a `PlanController`.

**Files:**
- Create: `ui/src/lib/plan/planActions.ts`, `ui/src/lib/plan/planController.svelte.ts`, `ui/src/lib/plan/planController.test.ts`
- Modify: `ui/src/lib/components/FloorPlanModal.svelte`. Move out the module-script types (lines 9-47) and the script logic: draft/commit 114-225, steps 131-141 and 236-276, obstacles 143-158/227-234/278-346, keyboard 347-409, lamps 411-651, image 670-1062.
- Modify: `ui/src/lib/components/test/FloorPlanModalHarness.svelte` (imports only)
- Modify: `ui/src/routes/+page.svelte` (import `PlanActions` from the new path; implementation unchanged)

**Interfaces:**
- Produces (`planActions.ts`):
  - `PlanActions`, exactly today's interface (`FloorPlanModal.svelte:24-47`), plus:
    - `updateRoom(partial: Partial<RoomConfig>): void`
    - `setHidden(kind: 'lamps' | 'zones' | 'objects', id: string, hidden: boolean): void`
  - `interface PlanScene`:
    - Today's modal data props: `vertices`, `units`, `precision`, `lamps`, `objects`, `zones`, `floorplan`, `image`, `roomZ`, `fixtures`
    - Plus `room: RoomConfig` and `hidden: { lamps: Set<string>; zones: Set<string>; objects: Set<string> }`
- Produces (`planController.svelte.ts`): `class PlanController`
  - `constructor(opts: { actions: PlanActions; scene: () => PlanScene; history?: { undo(): void; redo(): void; canUndo: boolean; canRedo: boolean } })`
  - Context (replaces `step`):
    - `context: PlanContext` (`$state`, default `'outline'`)
    - `setContext(c: PlanContext): void`, which does today's `goStep` reset of per-step selection
  - Leaving with an invalid outline (today's `leave()`/`pendingLeave`):
    - `requestLeave(proceed: () => void): void`. Runs `proceed` at once unless `dirty`; otherwise stores it in `pendingLeave`.
    - `pendingLeave: (() => void) | null`
    - `resolveLeave(choice: 'keep-saved' | 'stay'): void`. `'keep-saved'` reverts the draft, then proceeds.
  - Every other piece of `FloorPlanModal` script state and function **keeps its current name**:
    - Draft: `draft`, `tool`, `drawing`, `selectedIndex`, `dirty`, `commitDraft`, `revertDraft`
    - Obstacles: `shapes`, `selectedId`, `selectObstacle`, `startObstacleDraw`, `onDrawEnd`, `updateSelected`, `duplicateSelected`, `deleteSelected`
    - Lamps: `selectedLampIds`, `lampMode`, `placing`, `addPlaced`, `copySelectedLamps`, `deleteSelectedLamps`, plus the marker/marquee handlers
    - Zones: `userZones`, `selectedZoneId`, `drawKind`, `selectZone`, `copySelectedZone`, `deleteSelectedZone`, `startZoneDraw`
    - Image: `placement`, `onFileChosen(file: File)`, `removeImage`, `setOpacity`/`commitOpacity`, `setOffset`, the measure/Set scale functions, `onPlanPointerDown`, `onHostMove`, `onHostPointerUp`, `handleUnitsChange`
    - Keyboard: `onWindowKey(e: KeyboardEvent): void`, `onEscapeKey(): boolean`, `undoInterceptor(): boolean`
  - Mount points:
    - `canvas: PlanCanvasApi | null`, bound by whoever renders `PlanCanvas`
    - `hoveredSurface: 'walls' | string | null`, set by `ReflectanceStep`'s `onHover`
  - Writes go only through `opts.actions`; reads only through `opts.scene()`.

- [ ] **Step 1: Write the failing controller tests**

`planController.test.ts` builds a controller over a plain in-memory scene and a `vi.fn()` actions object. The scene shapes come from the harness defaults.
```ts
test('commitDraft applies a valid outline with one setOutline call', ...)
test('an invalid (self-crossing) outline is held back and marks dirty', ...)  // actions.setOutline not called; ctl.dirty === true
test('requestLeave proceeds at once when clean, and waits when dirty', ...)
test('resolveLeave keep-saved reverts the draft and proceeds; stay keeps it', ...)
test('setContext clears the selections of other contexts', ...) // select obstacle, setContext('lamps') → selectedId null
test('ignores shortcut keys typed into a field', () => {
  // ctl.setContext('lamps'); select a lamp; dispatch Delete with target = an <input> → actions.removeLamp not called
  // same for ArrowLeft (no updateLamp) and 'm' (lampMode unchanged)
});
test('shortcut keys act only on the current context', ...) // context 'obstacles' with a lamp selected earlier: Delete removes nothing lamp-related
```

- [ ] **Step 2: Run and confirm failure.** Run: `cd ui && npx vitest run src/lib/plan/planController.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

- **The move:** move the code into the class as runes fields (`$state`, `$derived`) and methods. Keep the names and the behaviour; only adapt prop reads to `this.scene()` and `step` to `context`.
- **The modal becomes a view:** `FloorPlanModal` creates `new PlanController({ actions, scene: () => ({ ...its props }) })` and renders from it. Its step rail, footer, hint text and Modal shell stay for now, driven by `ctl.context`. They are deleted in Task 12.
- **Keyboard guard:** `onWindowKey` returns early when `e.target` is an `input`, `select`, `textarea` or `[contenteditable]`.

- [ ] **Step 4: Run the new tests and the whole old suite**

Run: `cd ui && npx vitest run src/lib/plan/planController.test.ts src/lib/components/FloorPlanModal.test.ts && pnpm check`
Expected: PASS. All 987 lines of `FloorPlanModal.test.ts` stay green. `pnpm check` reports 0 errors.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/plan ui/src/lib/components/FloorPlanModal.svelte ui/src/lib/components/test/FloorPlanModalHarness.svelte ui/src/routes/+page.svelte
git commit -m "refactor(plan): guided-editing state moves into PlanController; FloorPlanModal becomes a view over it"
```

---

### Task 5: `PlanPane` — the 2D pane

**Files:**
- Create: `ui/src/lib/plan/PlanPane.svelte`, `ui/src/lib/workspace/test/WorkspaceHarness.svelte`, `ui/src/lib/plan/PlanPane.test.ts`

**Interfaces:**
- Consumes: `PlanController` (Task 4).
- Produces:
  - `PlanPane` props: `{ controller: PlanController; readonly?: boolean }`. `readonly` is for the summary: no handles, no toolbar, nothing draggable.
  - Root `.plan-pane`, containing `PlanCanvas` (its `svg.plan`).
  - A toolbar row `.plan-toolbar` under the canvas, driven by `controller.context`:
    - `outline`: Draw / Edit corners (plus Move image when an image is loaded)
    - `obstacles`: the obstacle tools
    - `lamps`: the Move · Aim · Copy · Delete ribbon (today's `FloorPlanModal` 1135-1151)
    - `zones`: Copy · Delete
    - `reflectance`, `ceiling`, `view`: no toolbar
  - The `underlay`/`overlay`/`hud` snippets move from `FloorPlanModal` 1201-1297, unchanged.
  - The leave-confirm dialog (today's 1509-1519) renders when `controller.pendingLeave` is set. So do the image prompts (1520-1566).
  - `<svelte:window onkeydown={controller.onWindowKey}>`, and `setUndoInterceptor(controller.undoInterceptor)` on mount.
  - `WorkspaceHarness.svelte`: copy of `FloorPlanModalHarness` (in-memory scene, `calls` log, the same `PlanActions`). It renders `<PlanPane>` now and `<EditorPanel>` once Task 7 exists. Its props are `{ context?: PlanContext; readonly?: boolean }`, so tests start in a given context.

- [ ] **Step 1: Write the failing tests** — port from `FloorPlanModal.test.ts` the describe blocks that concern only the canvas and toolbar, swapping the modal for `WorkspaceHarness`:
  - "upload flow": fit, guides, pan/zoom, grid snap, Space-pan
  - "after calibration": right-angle wall snapping
  - "applies as you go": apply-on-drag-end, invalid outlines, Ctrl+Z while drawing
  - "lamps": canvas parts only (marquee/Shift, Move, Aim, ring/dot drags, Delete, arrows)
  - "calc zones": canvas parts only

  Plus:
```ts
test('shows the toolbar for the current context', ...)  // context 'lamps' → buttons Move, Aim, Copy, Delete; context 'reflectance' → no .plan-toolbar
test('readonly shows no handles or toolbar and ignores drags', ...)
```

- [ ] **Step 2: Run and confirm failure.** Run: `cd ui && npx vitest run src/lib/plan/PlanPane.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** `PlanPane.svelte` with the Write tool, moving the markup named above out of `FloorPlanModal`. `FloorPlanModal` can render `<PlanPane controller={ctl}/>` for its canvas region, so it keeps passing until Task 12.

- [ ] **Step 4: Run and confirm pass.** Run: `cd ui && npx vitest run src/lib/plan/PlanPane.test.ts src/lib/components/FloorPlanModal.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/plan/PlanPane.svelte ui/src/lib/plan/PlanPane.test.ts ui/src/lib/workspace/test/WorkspaceHarness.svelte ui/src/lib/components/FloorPlanModal.svelte
git commit -m "feat(plan): PlanPane, the 2D canvas and its toolbar as a standalone pane"
```

---

### Task 6: Editor parts — Floorplan, Structures, Ceiling, Lamps, Zones (and the shared row)

**Files:**
- Create: `ui/src/lib/workspace/parts/ItemRow.svelte`, `FloorplanPart.svelte`, `StructuresPart.svelte`, `CeilingPart.svelte`, `LampsPart.svelte`, `ZonesPart.svelte`
- Create: `ui/src/lib/workspace/parts/parts.test.ts`

**Interfaces:**
- Consumes: `PlanController`, `PlanScene`, `PlanActions`.
- Produces:
  - `ItemRow` props:
    - `{ id: string; name: string; subtitle?: string; open: boolean; hidden: boolean; enabled: boolean }`
    - `{ onToggleOpen(): void; onRename(name: string): void; onToggleHidden(): void; onToggleEnabled(): void }`
    - Snippet `lead?: Snippet` (wavelength dot or type icon)
  - `ItemRow` markup:
    - Root `.editor-row[data-id]`, carrying `.open` and `.off` (excluded from calc) when they apply.
    - The pencil `button.rename` shows only when `open`. In the rename input, Enter or blur saves, and Esc cancels.
    - Two `button.icon-toggle`: the eye, then the calculator. Use today's sidebar SVGs and labels: "Hide …" / "Show …", "Exclude … from calculations" / "Include … in calculations".
  - `FloorplanPart { controller }`:
    - Width / Length / Height / Units in one row of plain number inputs with no spinners. Width and Length are disabled when `scene.room.shape === 'polygon'`. Units go through `controller.handleUnitsChange`.
    - Floor area and Volume as label + value text, from `polygonArea(scene.vertices)` × `scene.roomZ`.
    - The reference-image block, moved from `FloorPlanModal`'s outline side column, with the `<input type=file>` living here.
    - Start from: "Floor plan image…", and "3D model…" disabled with a "later" chip.
    - The existing vertex table, inside a collapsed `disc`-style disclosure titled "Corners". Phase 2 replaces it with Geometry.
  - `StructuresPart { controller; objectPanel?: Snippet<[SceneObject, () => void]> }`:
    - The "+ Add structure" button calls `actions.addObstacle(defaultObject(scene.room, scene.units))`, then selects the new id and scrolls its row into view.
    - Rows are `ItemRow`s.
    - The open row renders `objectPanel(obj, deselect)`.
  - `CeilingPart { controller }`: Height (`actions.updateRoom({ z })`).
  - `LampsPart { controller; lampPanel?: Snippet<[LampInstance, () => void]>; onAddCustomLamp?: () => void }`:
    - The Add lamp card, moved from `FloorPlanModal`'s lamps side column.
    - Rows: `ItemRow` with a wavelength dot (grey when excluded), and the italic fixture name as the subtitle.
    - With exactly one lamp selected, render `lampPanel(lamp, deselect)`.
  - `ZonesPart { controller; zonePanel?: Snippet<[CalcZone, () => void]> }`:
    - The "Use standard zones" checkbox (`actions.updateRoom({ useStandardZones })`).
    - The standard zones as rows, shown only while the box is checked.
    - The "Add zone" card: Plane · Volume · Point, each with `CalcTypeIllustration`.
      - Plane: a whole-room plane at the standard eye height for the project's units (as today's `refreshStandardZones` computes it), with `fit_room: true`.
      - Volume: a whole-room, floor-to-ceiling volume, `fit_room: true`.
      - Point: room centre at eye height, aimed level.
    - User zone rows.
    - The open zone renders `zonePanel(zone, deselect)`.
  - Every part reads `controller.scene()` and writes through `controller.actions` (expose `actions` as a public readonly field in Task 4 if not already there).

- [ ] **Step 1: Write the failing tests** (`parts.test.ts`, via `WorkspaceHarness` in the matching context). Port the "obstacles", "lamps" (Add lamp and list) and "calc zones" (list, standard zones) side-column blocks from `FloorPlanModal.test.ts`, plus:
```ts
test('Floorplan shows area and volume as text and disables width/length for a polygon room', ...)
test('+ Add structure adds one default box, selects it and opens its panel', ...) // calls includes addObstacle with shape 'box'; row .editor-row.open
test('rows rename with the pencil: Enter saves, Esc cancels', ...)  // updateObstacle(id,{name:'Desk'}) once; Esc → no call
test('the eye and calculator toggle hidden and enabled', ...)  // setHidden('objects', id, true); updateObstacle(id,{enabled:false})
test('Use standard zones off hides the standard rows', ...)
test('Add zone › Plane adds a whole-room plane at eye height', ...) // addZone('plane', {fit_room:true, height: 5.906} for feet) — exact value per refreshStandardZones
```

- [ ] **Step 2: Run and confirm failure.** Run: `cd ui && npx vitest run src/lib/workspace/parts/parts.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement the parts** with the Write tool, moving the side-column markup out of `FloorPlanModal` 1301-1489 into them. `FloorPlanModal` may render the parts in its side column, so its own tests keep passing.

- [ ] **Step 4: Run and confirm pass.** Run: `cd ui && npx vitest run src/lib/workspace/parts/parts.test.ts src/lib/components/FloorPlanModal.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/workspace/parts ui/src/lib/components/FloorPlanModal.svelte
git commit -m "feat(workspace): editor parts for the room, structures, ceiling, lamps and zones"
```

---

### Task 7: `EditorPanel` — header, stages, parts, Back/Next

**Files:**
- Create: `ui/src/lib/workspace/EditorPanel.svelte`, `ui/src/lib/workspace/EditorPanel.test.ts`
- Modify: `ui/src/lib/workspace/test/WorkspaceHarness.svelte` (renders `EditorPanel` beside `PlanPane`, both bound to the same controller and to `workspaceUi`)

**Interfaces:**
- Consumes: `workspaceUi`, `neighbours`, `planContext`, `STAGES`, `ROOM_PARTS` (Task 1); the parts (Task 6); `ReflectanceStep` (existing, `{ onShowReflectanceSettings, onHover }`).
- Produces:
  - `EditorPanel` props: `{ controller: PlanController; onDone(): void; onShowReflectanceSettings(): void; onAddCustomLamp?(): void; lampPanel?; zonePanel?; objectPanel? }` (the snippets are forwarded to the parts)
  - Header: `.editor-head` with the text "Edit" and `button.editor-done` "Done".
  - Stage tabs: `button.editor-stage[data-stage]` with `aria-selected`, showing the stage number and label.
  - Part tabs: `button.editor-part[data-part]`, on Room only.
  - Footer:
    - `button.editor-back` "← {prev.label}"
    - `button.editor-next` "{next.label} →", or on Zones a `button.editor-next.editor-done` "Done"
  - Every navigation (tabs, Back/Next, Done) goes through `controller.requestLeave(() => …)`, then `workspaceUi.goTo(...)` (or `onDone`), then `controller.setContext(planContext(...))`.
  - Opening Ceiling does not change the 2D surface in Phase 1. Phase 3 adds that.
  - The panel body keeps its scroll position across part re-renders. A navigation to another part or stage scrolls the body to the top, as a page change.

- [ ] **Step 1: Write the failing tests**

```ts
test('starts at Room › Floorplan with Back hidden and Next "Structures →"', ...)
test('Next and Back walk Floorplan → Structures → Ceiling → Reflectance → Lamps → Zones', ...) // the context follows: obstacles, ceiling, reflectance, lamps, zones
test('stage tabs jump straight to a stage and remember the last Room part', ...)
test('on Zones the Next slot is Done and calls onDone', ...)
test('asks before leaving Floorplan with an invalid outline', async () => {
  // make the harness draft self-crossing (as the 'applies as you go' test does), click 'Structures →'
  // → the confirm dialog shows; 'Stay' keeps Floorplan; 'keep the saved outline' (today's button text) moves to Structures and the draft equals the saved outline
});
test('Done in the header also asks before leaving with an invalid outline', ...)
```

- [ ] **Step 2: Run and confirm failure.** Run: `cd ui && npx vitest run src/lib/workspace/EditorPanel.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** `EditorPanel.svelte` with the Write tool, matching the mockup's editor column (small "Edit" heading, numbered stage tabs, part pills, footer buttons).

- [ ] **Step 4: Run and confirm pass.** Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/workspace/EditorPanel.svelte ui/src/lib/workspace/EditorPanel.test.ts ui/src/lib/workspace/test/WorkspaceHarness.svelte
git commit -m "feat(workspace): EditorPanel with stage and part tabs and Back/Next named after their targets"
```

---

### Task 8: `SummaryPanel`

**Files:**
- Create: `ui/src/lib/workspace/SummaryPanel.svelte`, `ui/src/lib/workspace/SummaryPanel.test.ts`

**Interfaces:**
- Consumes: `PlanScene`, `PlanActions`, `ItemRow` (with `open` always false and no rename).
- Produces:
  - `SummaryPanel` props: `{ scene: PlanScene; actions: PlanActions; onEdit(stage: EditorStage, part?: RoomPart): void }`
  - Heading: `h3` "Summary". There is no Edit button.
  - Section buttons: `button.summary-section[data-edit]`, with `data-edit` one of `room:floorplan`, `room:structures`, `lamps`, `zones` and labels "Room", "Structures", "Lamps", "Calc zones". Bordered, with a primary border on hover; no chevron, no shadow, no count.
  - Room facts as label/value rows:
    - "Dimensions": `W × L × H {unit}` for a box, or `{n}-corner outline · {H} {unit} high`
    - "Floor area"
    - "Volume"
    - "Reflections": "On · R {min}–{max}" (a single value when all are equal) or "Off"
  - Structures: names only, with the eye and calculator.
  - Lamps: dot, name, italic fixture, eye, calculator.
  - Calc zones: type icon, name, eye, calculator. Standard zones appear only when `room.useStandardZones`.

- [ ] **Step 1: Write the failing tests**

```ts
test('shows Dimensions, Floor area, Volume and Reflections for a box room', ...) // e.g. '24 × 20 × 9 ft', '480 ft²', '4,320 ft³', 'On · R 0.05–0.08'
test('describes a polygon room by its corner count', ...)  // '5-corner outline · 9 ft high'
test('section buttons open the matching editor step', ...) // click 'Structures' → onEdit('room','structures'); 'Calc zones' → onEdit('zones')
test('row toggles work from the summary', ...)  // eye → setHidden; calculator → updateLamp(id,{enabled:false})
test('standard zones are listed only while Use standard zones is on', ...)
```

- [ ] **Step 2: Run and confirm failure.** Run: `cd ui && npx vitest run src/lib/workspace/SummaryPanel.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with the Write tool.
- [ ] **Step 4: Run and confirm pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/workspace/SummaryPanel.svelte ui/src/lib/workspace/SummaryPanel.test.ts
git commit -m "feat(workspace): read-only summary with section buttons and row toggles"
```

---

### Task 9: Landing cards

**Files:**
- Create: `ui/src/lib/workspace/LandingCards.svelte`
- Modify: `ui/src/lib/components/StartChooserModal.svelte` (body only; keep `StartChoice`, the props and "Don't show this again")
- Create or modify: `ui/src/lib/components/StartChooserModal.test.ts`

**Interfaces:**
- Produces:
  - `LandingCards` props: `{ onChoose(choice: StartChoice): void; busy?: boolean }`
  - Three `button.landing-card[data-choice]`, with `data-choice` in `'empty' | 'open' | 'typical'`, in the order Start designing · Open a .guv file · See an example.
  - Square cards side by side; on a phone they stack as rows. Each has a pictogram in today's `.option` style.
  - The headline sits above the cards.
  - The modal's title is removed, so only the headline shows. The "Don't show this again" checkbox stays.

- [ ] **Step 1: Write the failing tests**

```ts
test('offers Start designing, Open a .guv file and See an example in that order', ...)
test('each card reports its choice', ...)  // empty / open / typical
test('Don\'t show this again still turns off showStartChooser', ...)
```
- [ ] **Step 2: Run and confirm failure.** Run: `cd ui && npx vitest run src/lib/components/StartChooserModal.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with the Write tool, following `docs/superpowers/mockups/2026-10-21-landing.html`.
- [ ] **Step 4: Run and confirm pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/workspace/LandingCards.svelte ui/src/lib/components/StartChooserModal.svelte ui/src/lib/components/StartChooserModal.test.ts
git commit -m "feat(landing): three square cards: Start designing, Open a .guv file, See an example"
```

---

### Task 10: Wire the workspace into `+page.svelte`

**Files:**
- Modify: `ui/src/routes/+page.svelte`, with a Python helper for every edit:
  - Desktop branch 1873-1892 and mobile branch 1816-1872
  - `configureContent`/`objectsList` snippets 1250-1809
  - Plan modal state and functions 110-127, 221-235, and the mount 1916-1946
  - `handleStartChoice` 912-948
  - `processClickBatch` 619-681
  - The MenuBar props 1198-1248
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: everything above.
- Produces (behaviour):
  - **One controller:** the page creates a single `PlanController`. Its actions are today's `planActions` plus `updateRoom` and `setHidden`. Its scene is built from the stores, including `hidden` from `$project.hidden` and `room` from `$room`.
  - **Desktop columns:**
    - Left: `ResizablePanel side="left"` holding `EditorPanel` (mode `editor`) or `SummaryPanel` (mode `summary`).
    - Middle: `<ViewsPane>` with `view2d = <PlanPane controller readonly={mode==='summary'}>`, `view3d = <RoomViewer …>` (today's props), and `calculate = <CalculateButton/>`.
    - Right: today's results `ResizablePanel`, unchanged.
  - **Mobile:** keep the three tabs. "configure" shows the editor or summary; "viewer" shows `ViewsPane`, which forces stack below 768 px. Keep the mobile Calculate bar.
  - **Snippets:** `lampPanel` and `zonePanel` stay as today's `planLampPanel`/`planZonePanel`. `objectPanel` renders `<ObjectEditor object room onClose onCopy/>` without `onEditFootprint`.
  - **Layout settings:** read from and written to `userSettings` (`workspaceLayout`, …) through `ViewsPane.onChange` and the MenuBar props from Task 3. Picking a layout resets `split` to 0.5 and `insetHidden` to false, as in the mockup. Swap views uses `swapped(...)`.
  - **Mode:**
    - Done → `workspaceUi.showSummary()`.
    - Summary section → `workspaceUi.goTo(stage, part)`, then `controller.setContext(...)`.
    - The controller's context always follows `planContext(get(workspaceUi))`, set once on mount and after every change.
  - **Landing:**
    - `empty` → `workspaceUi.reset('editor')`, then `goTo('room','floorplan')`.
    - `typical` → today's example setup, then `workspaceUi.showSummary()`.
    - `open` → `openProject()`; once a file has loaded, `showSummary()`.
    - "Don't show this again" behaves as today.
  - **3D clicks:**
    - In editor mode, `processClickBatch` keeps its cycling order. Instead of opening sidebar editors it:
      - calls `controller.requestLeave(...)`
      - switches stage/part: lamp → `lamps`; object → `room`/`structures`; zone → `zones`
      - selects the item in the controller (`selectedLampIds = [id]`, `selectObstacle(id)`, `selectZone(id)`)
      - scrolls `.editor-row[data-id="…"]` into view (`{ behavior: 'smooth', block: 'start' }`)
    - In summary mode, 3D clicks select nothing.
  - **Removed:**
    - `FloorPlanModal` mount, `roomPlanOpen`, `openPlan*`, `SidebarStep`/`configureContent`
    - `editingLamps`/`editingZones`/`editingObjects`/`closeAllEditors`, and the "Edit floor plan" / "Place on plan…" / "Edit on plan…" entry points
  - **CHANGELOG `[Unreleased]`:** under Changed, one entry describing the new workspace:
    - landing cards
    - the editor column with Room / Lamps / Zones and Back/Next
    - 2D and 3D side by side with four layouts in View › Layout plus Swap views
    - Done → summary
    - the Plan pop-up and the sidebar replaced

- [ ] **Step 1: Make the edits** with the Python helper. Then run `cd ui && pnpm check`. Expected: 0 errors.
- [ ] **Step 2: Run the UI suite.** Run: `cd ui && pnpm test:run`. Expected: all files pass. `FloorPlanModal.test.ts` still passes because the component still exists (unused by the page).
- [ ] **Step 3: Check it by hand in the dev server** (`make frontend` and `make backend`, or `pnpm dev` with the per-worktree ports). At 1440×900:
  - The landing shows three cards.
  - Start designing opens Room › Floorplan with 2D and 3D side by side.
  - Draw an outline in the 2D pane; it appears in 3D.
  - Next through every part.
  - Done shows the summary, and a section button returns to the editor.
  - Each View › Layout entry and Swap views work. Drag the divider and the inset; reload, and they come back.
  - Clicking a lamp in 3D opens Lamps with that lamp selected and its row in view.
  - At 390×844 the tabs work and nothing scrolls sideways.
- [ ] **Step 4: Commit**

```bash
git add ui/src/routes/+page.svelte CHANGELOG.md
git commit -m "feat(workspace): the page becomes editor · 2D/3D views · results, with landing cards and a summary"
```

---

### Task 11: e2e — update helpers and specs for the workspace

**Files:**
- Modify: `e2e/helpers/room.ts`, `e2e/helpers/objects.ts`, `e2e/helpers/lamps.ts`, `e2e/helpers/zones.ts`, `e2e/helpers/reflections.ts`
- Modify specs:
  - `e2e/tests/guided.spec.ts`
  - `e2e/tests/room.spec.ts`
  - `e2e/tests/plan-zones.spec.ts`
  - `e2e/tests/plan-lamps.spec.ts`
  - `e2e/tests/objects.spec.ts`
  - `e2e/tests/save-load.spec.ts:152`
  - `e2e/tests/plot-settings.spec.ts:170`
  - `e2e/tests/mobile.spec.ts`
- Create: `e2e/helpers/workspace.ts`

**Interfaces:**
- Produces (`helpers/workspace.ts`):
  - `openStep(page: Page, stage: 'room' | 'lamps' | 'zones', part?: 'floorplan' | 'structures' | 'ceiling' | 'reflectance'): Promise<void>`. If the summary shows, it clicks the matching `button.summary-section` first; then it clicks `button.editor-stage[data-stage]` and, if a part is given, `button.editor-part[data-part]`.
  - `planSvg(page): Locator`, returning `.plan-pane svg.plan`.
  - `finishEditing(page)`, which clicks `button.editor-done`.
- The old helpers keep their names and signatures where callers rely on them:
  - `expandRoomPanel` becomes `openStep(page,'room','floorplan')`.
  - `expandObjectsPanel` becomes `openStep(page,'room','structures')`.
  - `closePlan` becomes a no-op or `finishEditing`, whichever the call sites need.
  - `.floor-plan-modal svg.plan` becomes `planSvg(page)`.
  - `addObject` clicks "+ Add structure" and, where a drawn footprint is needed, uses the 2D toolbar's Draw.
  - Room-dimension helpers read the Floorplan part's inputs.

- [ ] **Step 1: Update the helpers and specs**, replacing modal and sidebar selectors as listed. The `guided.spec.ts` start-chooser tests use the new card labels and expect:
  - Start designing: `.editor-part[data-part="floorplan"][aria-selected="true"]`
  - See an example: `.summary-panel`
- [ ] **Step 2: Run the touched specs.** Run: `cd e2e && npx playwright test tests/guided.spec.ts tests/room.spec.ts tests/plan-zones.spec.ts tests/plan-lamps.spec.ts tests/objects.spec.ts tests/save-load.spec.ts tests/plot-settings.spec.ts tests/mobile.spec.ts`. Expected: all pass.
- [ ] **Step 3: Run the full e2e suite.** Run: `cd e2e && npx playwright test`. Expected: all pass. Known flaky specs from memory `project_e2e_suite_health`: re-run once before treating a failure as real, and report any that stay red.
- [ ] **Step 4: Commit**

```bash
git add e2e
git commit -m "test(e2e): drive the workspace editor instead of the Plan pop-up and sidebar"
```

---

### Task 12: Remove the retired components

**Files:**
- Delete:
  - `ui/src/lib/components/FloorPlanModal.svelte` and `FloorPlanModal.test.ts`
  - `ui/src/lib/components/test/FloorPlanModalHarness.svelte`
  - `ui/src/lib/components/SidebarStep.svelte`, plus its test if one exists
  - `ui/src/lib/components/RoomEditor.svelte`, plus its test if one exists
- Modify: whatever still imports them (expected: nothing after Task 10)

- [ ] **Step 1: Check coverage.** For each describe block in `FloorPlanModal.test.ts`, find its ported counterpart in `planController.test.ts`, `PlanPane.test.ts`, `parts.test.ts` or `EditorPanel.test.ts`. Port any block that has none into the matching file. The step rail and the modal footer are the exceptions: `EditorPanel.test.ts` replaces them.
- [ ] **Step 2: Delete the files.** Then run `grep -rn "FloorPlanModal\|SidebarStep\|RoomEditor" ui/src`. Expected: no matches outside comments, which you should also fix.
- [ ] **Step 3: Run the full checks.** Run: `cd ui && pnpm check && pnpm test:run`. Expected: 0 errors, and all files pass.
- [ ] **Step 4: Commit**

```bash
git add -A ui/src
git commit -m "refactor: remove FloorPlanModal, SidebarStep and RoomEditor, now replaced by the workspace"
```
