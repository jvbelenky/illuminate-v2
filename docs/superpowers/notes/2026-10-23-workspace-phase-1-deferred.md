# Workspace Phase 1 — rulings and deferred items

Saved from the subagent-driven ledger when Phase 1 finished (2026-10-23). Inputs for Phase 2.

## Rulings

- Ruling 1: `WorkspaceLayout` is exported from `ui/src/lib/stores/settings.ts`, beside the settings field that uses it. `layoutGeometry.ts` and MenuBar import it from there. Why: it is a settings value type, and this avoids a store→workspace import cycle. Cost if wrong: one import path to move.
- Ruling 2: Task 4 also adds `updateRoom` (calling `project.updateRoom`) and `setHidden` (calling `project.setHidden`) to `+page.svelte`'s `planActions` object and to the harness. Why: the interface change would otherwise break `pnpm check`, which T4 requires to pass. Cost if wrong: none; these are thin passthroughs.
- Task 4: Ruling: hosting obligations are load-bearing for Task 5/10 — whoever renders the canvas must host the followSource effect and register setUndoInterceptor exactly once; PlanStep import must be re-homed in Task 12 — carried into context.md — cost if wrong: draft stops following undo/units.
- Task 5: Ruling: Escape — standalone PlanPane must route Escape to ctl.onEscapeKey() (via its window keydown), with a prop so FloorPlanModal (which gets Escape from Modal) does not double-handle — spec: Esc cancels drawing — cost if wrong: Esc does nothing in the workspace. To be sent in the fix round with review findings.
- Task 6: Ruling: user-added Plane height uses roundToUnit(fromMeters(1.8, units)) (5.91 ft) like ZoneEditor's head-height preset, not 5.906 — frontend has no standard-zone eye-height function (backend decides) — cost if wrong: plane 0.004 ft higher than the standard plane.
- Task 6: Ruling: standard zone rows must open (zonePanel with the standard zone; page passes isStandard ZoneEditor) as the old sidebar did — plan goal is today's behaviour unchanged — to be sent in fix round — cost if wrong: an extra open state on standard rows.
- Task 9: Ruling: Important finding 'e2e guided.spec.ts targets removed .option markup' — conflicts with plan text: Task 11 Step 1 explicitly updates guided.spec start-chooser tests to the new card labels; e2e isn't run between tasks — scheduled, not fixed here — cost if wrong: e2e red until Task 11 (already expected, since Task 10 also changes the page).
- Task 10: review 1 — Needs fixes. Ruling: plan-mandated findings (lamp/zone panels lack onCopy; LampEditor pick={false}) — fix both: the spec's scroll rule and the plan goal 'today's behaviour unchanged' (the old sidebar passed onCopy and pick=true) outrank the brief's 'stay as today's planLampPanel/planZonePanel' — cost if wrong: two props to revert.
- Task 10: Ruling: square-fit 2D view in narrow panes is fixed in this task (PlanCanvas fits to the element's aspect ratio) — spec constraint 'desktop 1440×900 shows controls and their effect' — cost if wrong: PlanCanvas view math change touches modal tests (they must stay green).
- Task 10: Ruling: layer eye toggles stay removed (spec has no layer eyes; per-item eyes remain) — report to user as a deliberate removal — cost if wrong: re-add a layer toggle later.
- Task 10: Ruling: 2D fit keeps the room anchored bottom-left (no centring) — existing tests and the non-negative-coordinates design of the floor-plan feature require it — cost if wrong: spare space sits above/right of the room instead of around it.
- Task 11: Ruling: fix the preset→custom lamp-type IES fetch bug in app code now (clear has_ies_file / skip photometric fetches for modelless lamps, with a unit test) and delete LAMP_TYPE_SWITCH_NO_IES — the workspace makes every new lamp start from a fixture so users hit it on every type switch; masking it in e2e hides a user-facing error — cost if wrong: small LampEditor/Lamp3D change outside the e2e scope.
- Final: Ruling: column widths — set ResizablePanel defaults to left 340 / right 370 (mockup 300|1fr|370; LampEditor needs ~320) — constraint "controls and their effect together at 1440×900" — cost if wrong: user drags panels or we retune two numbers.
- Final: Ruling: declined-to-judge list accepted as Phase 2–4 scope or prior rulings; none added to the fix wave.
- Final: Ruling: dead code — remove controller members unreachable from the UI that duplicate ObjectEditor (toggleFullHeight, commitBottom/Top/Reflectance/Transmittance/Name) and the unused cornersOpen; keep zone-draw (startZoneDraw, onDrawEnd zone branch) and point-place (setPlacing/placeAt/placing/placeCursor, PlanActions.addLamp) with a "kept for Phase 3" comment; keep FloorPlanThumbnail with a note for the Phase 2 image block — cost if wrong: a little dead code lingers until Phase 3.
- Final: Ruling: mobile Layout menu entries (Minor 14) and the remaining T-minors marked "can wait" in the final triage are deferred to Phase 2 — cost if wrong: a misleading tick on phones.
- Final: Ruling reversed by user — panels keep old proportions (left 420, right $results ? 420 : 300); I8 dropped, fix agent told.

## Deferred minors and open checks

- Task 1: ⚠️ items resolved by controller — setup.ts clears session/localStorage mocks in beforeEach; loadSettings merges defaults (existing behaviour, test passes).
- Task 1: minor (deferred): stored layout settings (layout/split/inset) not validated on load — carried into Task 2 (sanitize at use).
- Task 1: minor (deferred): reset test does not assert persistence; planContext part=null fallback untested; JSON.parse result implicitly any.
- Task 2: minor (deferred): pointercancel commits instead of reverting; divider focusable but no keyboard/aria-valuenow; swap-flag branch untested & misnamed test; Calculate snippet remounts when host moves; LAYOUTS untyped string array; hidden-inset pill position vs Calculate.
- Task 2: ⚠️ for Task 10: 3D slot hidden via display:none when it is a hidden inset — verify RoomViewer/WebGL re-measures on show (carry into Task 10 dispatch).
- Task 2: minor (deferred): narrow stack may leave a 6px divider gap in slot geometry; Calculate position duplicated as inline style vs scoped CSS.
- Task 3: ⚠️ resolved — page wiring and CHANGELOG are Task 10 per plan.
- Task 3: minor (deferred): redundant assertion in first layout test; mobile test lacks close/unchecked asserts; Layout submenu mouse-only (same as Theme); no mobile divider before Theme.
- Task 4: ⚠️ resolved — implementer reported 66/66 + 1604/1604 + check 0 (test evidence in report).
- Task 4: minor (deferred): eager scene() closure tracks all of $project (harmless now; hosts should build scene with getters); 1025-line controller (split later); unit-test scene is plain object.
- Task 5: minor (deferred): toolbar CSS duplicated in modal+pane until Task 12; toolbar title tooltips are explanatory sentences (trim later); interceptor effect closes over untracked ctl (comment); Edit corners state derived, undocumented.
- Task 5: minor (deferred): readonly test comment inaccurate / circle.plan-lamp assertion vacuous; standalone Escape ignores event.defaultPrevented — confirm behaviour with an open ConfirmDialog in Task 10.
- Task 6: minor (deferred): 'Standard' heading near no-badge rule (heading kept — spec: 'the Standard heading already says it'); one-way bound dim inputs don't resync after clamp; add errors only console.error; test name overclaims; no blur-rename test; side-column duplicated with modal until Task 12.
- Task 6: ⚠️ for Task 10: verify real addZone accepts aim_*/z_min/z_max/fit_room geometry and updateZone enabled on standard zones; scene().hidden/room reactive in page scene.
- Task 6: minor (deferred): standard zone selection sets selectedZoneId but selectedZone derives from userZones only — page's zonePanel must use the snippet's zone arg (carry to Task 10); LampsPart scrolls current selection if addPlaced no-ops.
- Task 7: minor (deferred): body scroll preservation/reset untested; tablist lacks aria-controls/tabpanel/arrow keys; hard-coded #fff in .editor-done; pointless ctl alias.
- Task 7: minor (deferred): two misnamed tests (EditorPanel.test.ts:118 'Back asks too…' exercises Next; :141 title says Lamps); leave dialog says 'outline' even for dirty zone/obstacle drafts (pre-existing modal behaviour).
- Task 8: minor (deferred): area/volume Math.round loses precision for small metric rooms (check FloorplanPart consistency in final review); 'None' chips; {:else} treats unknown sections as zones / string-split casts; dot/icon markup duplicated; obstacle/zone toggles untested.
- Task 9: minor (deferred): StartChoice type circular type-only import (move to shared .ts); no busy test / 'Setting up…' label untested; stroke widths differ slightly from mockup; CHANGELOG entry owned by Task 10; no :focus-visible lift.
- Task 10: minor (deferred): page overrides RoomViewer min-height / PlanPane height / ResizablePanel padding from outside; summaryAfterLoad left true on cancelled picker; 3D zone click while drawing a footprint skips cancel.
- Task 10: minor (deferred, final-review triage): at 1440×900 side-by-side the middle column is ~600px (left panel 420 + results 420), so the 2D slot is ~270px wide; the mockup's columns are narrower — consider mockup default widths.
- Task 10: minor (deferred): copy/pick wiring has browser-only coverage, no unit test.
- Task 11: minor (deferred): Phase 3 must restore drawn-plane (L-shaped, 6 vertices) and click-to-place-point e2e coverage; counts read from store (less UI row coverage); openStep doc comment; helper placement.
- Task 11: minor (deferred): lamp-type fix has no CHANGELOG Fixed entry (bug also on main); full e2e not re-run after fix (4 affected specs pass).
- Task 12: minor (deferred): FloorPlanThumbnail + test now unused (remove or reuse in Phase 2 image block); ui/coverage/components/index.html tracked generated file lists RoomEditor; RoomEditor polygon X-stretch test dropped by design (W/L disabled for polygons).
- Task 12: minor (deferred): replacement comments name 'the editor panel' as the Escape-forwarding host; actually +page.svelte passes handleEscape={false} — say 'the page'.
- Final: re-review — all findings addressed, I8 unchanged; minors: stale pointer-down in slotDown; refit after corner drag while not userMoved; M16 untested; 3D inset covers x-axis labels in 2D-large. Final review clean.
