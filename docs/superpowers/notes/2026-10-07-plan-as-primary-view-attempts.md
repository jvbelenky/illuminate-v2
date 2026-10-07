# Plan as the primary view: attempts set aside (2026-10-06 → 10-07)

`plan-workflow` was reset to `20aa292` (the guided Plan **modal**, with the
Outline, Obstacles, Lamps and Calc zones steps), which the user preferred. Everything
built after it is kept on the branch **`plan-primary-view-archive`** (tip
`62bac6a`). Nothing there is merged.

## What came after the modal, in order

| Commits | Version | What it did | What the user said |
|---|---|---|---|
| `6f2c228`, `a2ede3f` | Specs | "Plan as the primary view" design and implementation plan (`docs/superpowers/specs/2026-10-06-plan-as-primary-view-design.md`, `plans/2026-10-06-plan-as-primary-view.md` on the archive branch) | Asked for it at the time: plan as the primary interface, not a modal; flipping 2D↔3D should rotate the 3D camera to top-down then enter "2D mode", like SolidWorks |
| `64e3e6d`, `cf2cfce`, `8045a23`, `9bd60d6` | **A: plan as a 2D mode of the main view** | Modal removed. `RoomViewer` got `viewMode` '3d' / 'plan' with a camera hand-off (`Scene.setView(..., {axisAligned})`, `utils/viewFraming.ts`, `PlanCanvas.showRect/getVisibleRect`). The sidebar steps (Floorplan, Lamps, Obstacles, Calc zones, Reflectance) drove the plan's tools via a shared `planSelection` store. Blocking step prompts (`utils/stepPrompts.ts`) with a "Done with … · Next step" pill. App still opened in 3D | Accepted for a while; later found "not opinionated enough" and the left side "very busy" |
| `3b45d16`, `815ba20`, `01293dc` | **B1: lamps redesign** | `utils/lampMounting.ts` (ceiling-down / ceiling-angled / wall / corner placement and moves), `utils/beamFootprint.ts` (beam patch on the floor), `utils/lampAim.ts`; "Add lamp ▾" pop-up with fixture + mounting; Move/Aim modes; a floating lamp card beside the selected lamp | Pop-up "lamp mini menu" was not an efficient use of space; Move/Aim make no sense before a lamp is placed |
| `52469b2` | **B2: several lamps** | Ctrl-click / Shift-drag selection, Ctrl+A, group move/nudge/copy/delete, group card (align, space evenly, fixture for all), Array… fills a dragged rectangle (`utils/lampArrange.ts`, host `addLamps`/`copyLamps` batched as one undo) | No objection recorded; went with the rest |
| `62bac6a` (WIP) | **C: guided layout** | Left = workflow rail only (`WorkflowStep`, shared `ItemRow`), one current step with Back/Next, Calculate pinned at the bottom with a `ResultsSummary` (fluence, safety, up to date); right = settings of the selection or step, plus Results tab. Then: open on the plan, room thumbnail removed, lamp toolbar dropdowns instead of the pop-up | "Bit confusing": opening on 3D with a clickable mini plan made no sense. After the changes: "I don't like this", revert to the modal |

## Takeaways for a next attempt

- The user liked how the **modal** felt visually and its guided, one-step-at-a-time
  flow. Prefer small changes to the modal over restructuring the main layout.
- Things the user liked along the way and might want back on top of the modal:
  the results summary idea (pinned under Calculate, so auto-recalculate can be
  watched); "Add" for a calc zone making a whole-room plane; reflectance opening
  the existing reflectance window; contextual prompts after lamps.
- Pieces on the archive branch that are self-contained and could be reused:
  `lampMounting.ts`, `beamFootprint.ts`, `lampAim.ts`, `lampArrange.ts` (all
  unit-tested), the Array grid, multi-select, the unique "Lamp N" naming fix,
  and a `LampEditor` fix (Advanced settings save after the editor closes used
  `lamp.id` of an unmounted editor).
- Test infra on the archive branch: `e2e/playwright.local.config.ts` style runs
  need the branch API (`uv run --no-sources uvicorn app.main:app --port 8001`)
  and UI on 5174 with `VITE_API_URL` and `E2E_API_URL` set.
