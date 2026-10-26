# Workspace redesign, Round 2: rulings and deferred items

Round 2 of the workspace redesign: plan `docs/superpowers/plans/2026-10-23-workspace-round-2.md`, spec addendum in `docs/superpowers/specs/2026-10-21-workspace-redesign-design.md`.

Branch `plan-workflow`, commits b65c983..3ed69d3. Every task passed its own review, and the final whole-branch review is clean after one fix wave.

## Rulings made during the round

Each line says what was decided and what it costs if the call was wrong.

**Grid**
- Keep the adaptive grid step, with a stronger line every 5 steps. A fixed 1-unit grid gets unreadably dense when zoomed out on large rooms.

**Editor panel**
- "Buttons a different colour" applies to every secondary button in the editor parts, not just Floorplan.
- Text tokens app-wide are xs 12, sm 13 and base 15 px, the former phone sizes. The part tabs (Floorplan, Structures, Ceiling, Reflectance) stay at 12 px so all four fit in the 300 px column.

**Floorplan**
- The dimension labels read W / L / H, at the user's request.
- Draw outline starts drawing straight away, with no "Start a new outline?" prompt. Cancelling before three corners restores the old outline, and undo covers the rest.

**Standard zones**
- "Hidden by default" means the ▸ Standard zones fold-out is closed. `useStandardZones` is unchanged, so standard zones still calculate.
- Closing the fold-out deselects a selected standard zone.

**Ceiling**
- The PDF report capture excludes the ceiling layout, and the ceiling face ignores `ceilingShown` during capture. Ceiling items are planning-only. Cost if wrong: flip one capture flag.
- Keep-out areas default to Centre for Reference, as structures do and as the mockup shows.
- The "must stay inside the room" check applies only when the shape was inside before the edit. A keep-out or item left outside after the room shrinks can still be edited back in.

**Structures**
- The Corner/Centre Reference is local UI state per editor, defaults to Centre, and is not saved. Ceiling keep-outs work the same way.
- Structure names always show on the 2D plan, as lamp names do. Show label controls the 3D label only.
- The structure editor's × is removed, as in the mockup. The row header closes the editor.

**Lamps**
- The lamp editor's Delete / Copy / Close footer is removed. The ribbon, the Delete and Ctrl+D keys, and the row header cover it.
- The lamp panel's corner × stays for now. Open question: should it go too, to match structures?
- A wall-stuck lamp follows its wall by index only when:
  - the outline was scaled along its axes, or
  - at most two corners moved, and they belong to the lamp's wall plus at most one other wall.
  
  Otherwise it re-attaches by position or unsticks; it never jumps to another wall.

**2D navigation**
- The Shift-drag box in the Lamps context adds to the selection, following the Shift-click convention. Clicking empty space clears it. Cost if wrong: Shift replaces and Shift+Ctrl adds.
- A second finger during a touch edit cancels the edit cleanly, with no commit. Gestures are filtered by the pointer that started them.

## Deferred items

These are known, parked and not blocking.

**Ceiling designer**
- Moving the room outline can leave ceiling items outside the room. They stay editable but aren't moved back in.
- The item list is slow at 2000 items, and 3D draws one mesh per point item; an InstancedMesh would help.
- The 3D tiles follow the committed Move grid offset, not the live drag. The tile lines are faint next to the calc-plane dots.
- The 20 000 total-keep-out-corner cap is checked when a file is read, not while editing; it can't be reached by hand.
- `findBlock` has edge cases on hand-crafted, non-strict JSON files: a non-object or duplicate `illuminate` key.
- There is one unreproduced ceiling e2e flake.

**Saving and opening**
- Opening a file whose results contain bare NaN is still rejected by the `JSON.parse` pre-check in `openProjectFile`. This predates the round. Saving such files now works.

**Lamps and sticking**
- Moving the whole outline without resizing it unsticks wall lamps. Deleting a corner may unstick them too.
- On the preset-placement fallback path, the stick write is its own undo step.
- Two Add lamp details:
  - The Select Lamp dropdown text is truncated beside Details….
  - The inherited explanatory pick hints and placement tooltips could be trimmed.

**Structures**
- The Bottom/Top fields round to `room.precision`, while the Geometry fields round to `UNIT_INFO.roundDecimals`.
- Centre on a custom footprint is the bounding-box centre, not the centroid.
- A 2D reshape resets rotation to 0 (this predates the round). The ribbon's Copy names a copy "object-1 2".
- `copySessionObject` in `api/client.ts` has no callers.

**2D navigation**
- Touch has only been tested with synthetic pointer events, not on real devices.
- In Zoom mode the wheel ignores horizontal-only scroll.
- On a hybrid device, a stale touch owner could make the app ignore one mouse press.

**Tests**
- There is no component test of the 3D label or of RoomViewer's capture mapping.
- A few assertions are weaker than the code; see the ledger.
