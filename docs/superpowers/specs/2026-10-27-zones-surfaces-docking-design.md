# Zones, surfaces and docking: design

Round 3 of the workspace redesign. It builds on `2026-10-21-workspace-redesign-design.md` (the "original spec"), whose phase 3 (surface views and wall planes) was never built.

Mockups, in `.superpowers/brainstorm/515293-1793123103/content/` (git-ignored):
- `zone-editor-v2.html`: the zone editor, surfaces and rows.
- `docking-v3.html`: a working docking prototype the user approved.

`zone-editor.html` is v1; superseded where v2 differs.

## Why

The user called the zone editor "a real mess":
- Its parts don't fit the 300 px column.
- It repeats choices the Add zone card already made.
- It hides the natural way to say where a plane is behind two dropdowns: Reference surface and Normal direction.

The side-by-side 2D/3D split is also overwhelming. The user wants one main view, with the other small and docked, in panels that look and behave like dockable panels in other software.

Success: editing a zone feels like editing a floorplan or a structure. You draw it on the surface you're looking at, and a few fields stay visible. The workspace has one large view and tidy panels the user can rearrange.

The user will refine the zone editor after using it. Build it cleanly and expect a follow-up round; don't polish beyond this document.

## Goals

1. Docking: a main view plus dockable panels.
2. 2D surfaces: Floor, Ceiling and each Wall.
3. Planes that belong to a surface, including angled walls of polygon rooms, with custom outlines on walls.
4. A cleaned-up zone editor.
5. Standard zones hidden in the views by default.

## Non-goals

- Mobile layout. Below the existing narrow breakpoint (768 px), keep today's behaviour *(my call)*.
- Floating or undocked windows, and splitting the main view by dropping a panel into it. The user was asked about the split and said the prototype "looks good" as is.
- Sloped or non-flat ceilings. The surface id stays open to them, as in the original spec.
- Changing what lamps, structures or ceiling items can do in wall views beyond the original spec.
- The user's further zone-editor issues, which come in a later round.

## Anti-goals

- Explanatory text in the UI. Labels, values and chips only (standing rule).
- A dropdown or menu for choosing dock positions. Docking is by dragging.
- A Flat / Upright switch, or any orientation control that duplicates the surface switcher.
- A restricted wall-plane version, such as axis-aligned walls only. Angled walls and drawn outlines must work.

## 1. Views and docking

**Main view**
- One view fills the middle. A **2D | 3D** segmented control sits top-left of it and chooses which view is the main one.
- The other view lives in the **mini view panel**.

**Dockable panels**
- There are three: **Editor** (or Summary after Done), **Results**, and the **mini view** (titled "2D" or "3D").
- Each has the same slim title bar:
  - a grip (⋮⋮), then the title;
  - then, at the right, **–** (minimize) or **▢** (restore);
  - the mini view also has **⇄**, which swaps it with the main view.
- Panels live in two side columns, left and right of the main view.
  - Drag a panel by its bar to above or below any panel in either column. During the drag, a blue insertion line shows where it will land (as in `docking-v3.html`).
  - A column with no panels collapses to zero width. Dragging a panel near that edge of the main view shows a drop line there, so the column can come back *(my call)*.
- Minimizing leaves only the bar in place. The other panels in the column take the space.
- Panel heights within a column:
  - The Editor and Results fill the column.
  - The mini view is about 4:3 at the column width.
  - When the Editor and Results share a column they split it evenly. A draggable divider between panels is the builder's choice.
- The mini view is live: drag to rotate the 3D view (wheel zooms), or drag to pan the 2D view *(user)*. Clicking it does not swap; only ⇄ swaps.

**Defaults and persistence**
- **Width belongs to the panel** *(my call)*. The Editor is 300 px, Results 420 px (300 px on narrower screens, as today), and the mini view 300 px. A column is as wide as its widest panel.
- Default layout: the Editor in the left column; the mini 3D view above Results in the right column; **2D** as the main view.
- Panel order, columns, minimized state and the main-view choice persist per user in `userSettings`. Stored values are validated at use.
- The **View** menu loses its layout list (Side by side, Stacked, the insets and Swap views). It gains:
  - **Swap views**;
  - **Reset panel layout**, which restores the default.

**The mini view**
- It is view-only and has none of its view's toolbar: no Hand/Zoom, no surface switcher, no 3D view or iso buttons, no Open in new window or Save as image, and no Calculate.
- It still follows selection and highlighting.
- In the mini 3D view a plain click does nothing: no selection and no surface picking *(my call)*.
- Each view's full toolbar shows when it is the main view.
- **Calculate** and its Autorecalculate checkbox sit top right of the main view, whichever view that is.

**Existing column collapse**
- The edge collapse buttons (◂ ▸) of the editor and results columns are replaced by minimize.
- The Results column's 420/300 px widths stay as they are today. The left column stays 300 px.

## 2. Surfaces in 2D

This follows the original spec's tables "2D surfaces", "Wall view" and "3D picking", which stay binding:

- **Switcher.** **Floor · Ceiling · Walls ▾** sits in the main 2D view's toolbar. `[` and `]` step through the surfaces.
  - The Walls ▾ list here is fine: the "no dropdown" ruling was about dock positions.
  - The surface id is `floor`, `ceiling` or `wall:<index>`.
- **Ceiling view.** It uses plan coordinates and shows the outline from above.
  - The existing Ceiling part keeps working there.
  - Opening Room › Ceiling switches to it *(my call)*.
- **Wall view.** An elevation of the wall seen from inside: along the wall (0 at the wall's first corner, in CCW order) and up from the floor.
  - Structures and lamps in front of the wall are projected onto it, fading with distance.
  - Neighbouring walls are labelled at each end.
  - Editable there:
    - structures (slide and height);
    - lamps (slide and height);
    - wall planes (draw, drag the body, drag corners).
- **3D picking.** Clicking a surface in the 3D main view sets the 2D surface.
  - Clicks cycle through stacked surfaces as the original spec says.
  - A hover chip names the surface the next click picks.
- **Highlighting.** The 3D shows the 2D view's surface with a subtle dashed outline.
- **Room changes.** If the viewed wall disappears (the outline loses a corner), the view falls back to Floor.

## 3. Planes on surfaces (guv-calcs and API)

**What guv-calcs already has**
- `SurfaceGrid` (`src/guv_calcs/geometry/grid.py`) is a generic plane: origin, u and v vectors, a `Polygon2D` outline in (u,v), and an inset offset. Grid points, normals and FOV filtering all go through it, whatever the plane's angle.
- Room walls already use `SurfaceGrid.from_wall` and `CalcPlane.from_face` at any angle, for reflectance.
- What is axis-aligned only: `from_legacy`, `update_legacy`, `set_height`, `set_ref_surface`, `set_direction` and the x1..y2 properties. These raise on, or mean nothing for, slanted planes.

**guv-calcs changes**

Work in a `plan-workflow` worktree of `~/guv-calcs`. Agents may commit and push main there once `make test` passes. No release or version bump.

- A wall plane covering part of a wall: a sub-rectangle given by along-wall and up ranges.
- A wall plane with a custom `Polygon2D` outline in (along, up) coordinates.
- Both take:
  - a wall (its two floor corners, or a face id plus `RoomDimensions`);
  - a normal offset (the distance from the wall into the room);
  - spacing or num_points;
  - offset.
- Contract:
  - The normal points into the room for a CCW outline, by default. Flip reverses it.
  - Geometry round-trips through `to_dict` / `from_dict`.
  - Polygon results mask to NaN holes, as for floor outlines.
- Watch out: wall-local v points down from the ceiling in `from_wall`, so local t = z_top − up. Winding and normal direction need tests.
- An outline must lie inside its wall rectangle (with a tolerance) and be a simple polygon.
- Constructor names and signatures are the builder's choice.
- Then `make bump-guv-calcs` in illuminate.

**API changes** (`api/api/v1`)
- Zone input and output gain a plane **surface**: `floor`, `ceiling` or `wall:<id>`, using the backend wall ids (`south`… or `wall_N`).
  - Wall planes are built through the new constructors, not `from_legacy`.
  - Floor and ceiling planes keep using the existing path.
- For wall planes:
  - `vertices` are (along, up) pairs, converted both ways;
  - the response reports the surface, the normal offset and the outline in wall coordinates, not world x1..y2.
  - `_is_footprint_zone` stops requiring `ref_surface == "xy"`.
- Height, ref-surface and bounds updates must not reach `update_legacy` for wall planes. Move them through `geometry.update(...)`, as polygon planes already do.
- Existing XZ/YZ planes in saved files keep loading *(my call)*:
  - On load, a vertical plane parallel to a wall maps to the nearest parallel wall, with its distance as From wall. This includes planes that sit some way into the room.
    - If its normal points toward that wall rather than into the room, it is stored flipped.
    - Its x/z (or y/z) bounds become an along/up outline on that wall.
  - Horizontal planes with ref_surface xy map to Floor, keeping their height. A downward-facing xy plane whose height equals the room height maps to Ceiling.
  - A vertical plane parallel to no wall keeps its legacy geometry and opens on Floor. This can happen on angled polygon walls. Its editor shows Calculation, Grid points and Display, with its geometry read-only. Copy and Delete still work.
- **Following the room** *(my call)*. Surface planes store their position relative to their surface:
  - A ceiling plane keeps its Below ceiling distance when the room height changes, as stuck lamps do.
  - A wall plane follows its wall by index, as stuck lamps do.
  - A Fit to room or Fit to wall plane refits to the new outline, height and wall length.
  - A drawn outline that no longer fits its wall is kept. It is flagged in the audit like other out-of-room items and stays editable. This follows the Round 2 "stranded items stay editable" ruling. So guv-calcs warns instead of raising when an outline leaves its wall, and the API passes it through.
  - If the wall is gone, the plane keeps its last geometry, opens on Floor, and is flagged.

**Semantics to keep in mind**
- The FOV filters (vertical and horizontal) are relative to the plane normal. On a wall plane, "vertical" means straight out from the wall.
- Keep that behaviour; it matches guv-calcs. Don't relabel it.

## 4. Zone editor

**Rows**
- The icon, the name, the eye and the calculator toggle.
- No subtitle: delete `zoneSummary` from the row.

**Removed**
- The Type switch: the Add zone card already chose the type.
- The Floor / Work Surface / Head Height presets.
- The Whole room checkbox.
- The Reference surface and Normal direction dropdowns.
- The Delete / Copy / Close footer: the plan's Copy / Delete ribbon, the Delete and Ctrl+D keys, and the row header cover it, as for lamps and structures.
- The explanatory help texts.

**Plane**

Top to bottom:
1. **Calculation** select, as today.
2. The distance from its surface, with a **⇅ Flip** button beside it *(my call; flips the normal)*:
   - **Height** on the floor;
   - **Below ceiling** on the ceiling;
   - **From wall** on a wall, defaulting to 0.
3. Under a divider, full-width buttons:
   - **Draw on floor / ceiling / wall**;
   - **Fit to room**, or **Fit to wall** on a wall.

   Fit replaces the Whole room checkbox, and drawing clears the fit.
4. **▸ Geometry**: the corners table, as in Floorplan; Corner/Centre reference as in structures.
5. **▸ Grid points**, closed by default:
   - a **Points | Spacing** segmented control;
   - two fields (X × Y, or Across × Up on a wall);
   - the resulting spacing as a value;
   - an **Inset | On edge** segmented control, replacing Grid Offset.
6. **▸ Display**, closed by default:
   - the Value display select;
   - Exposure time when it applies;
   - a segmented control: **Heatmap | Numeric | Contours | Markers | None** for planes, and **Iso | Numeric | Markers | None** for volumes;
   - Show label.

A closed fold-out shows its current value at the right (for example "10 × 12", "Irradiance").

Behaviour:
- **Add plane** creates the plane on the surface the 2D view shows:
  - Floor: whole room at 1.8 m (eye height).
  - Ceiling: whole room, 0 below the ceiling, facing down.
  - Wall: the whole wall, 0 from it, facing into the room; the view stays on the wall.
- **Opening** a plane switches the 2D view to its surface.
- **Draw** draws the outline on that surface, with the same tools as Draw outline.

**Volume**
- **Bottom / Top** fields like a structure.
- **Draw on floor** and **Fit to room**.
- Then ▸ Geometry · ▸ Grid points (three axes) · ▸ Display.
- "Floor to ceiling" is what Fit gives you. There is no separate checkbox.

**Point**
- **Position** and **Aim at**: full-width X / Y / Z rows that fit the column.
- **Place** and **Aim** buttons, which pick on the 2D view (or the 3D main view).
- ▸ Display and ▸ Advanced (custom flags and FOV, as today).

**Standard zones**
- A standard zone's editor stays as it is today (grid resolution only), restyled to the same fold-outs.

**Layout and styling**
- Everything fits the 300 px column at the current font tokens: no clipping, no horizontal overflow.
- Buttons use the filled secondary style from Round 2 (`.plan-btn`).

## 5. Standard zones

- New projects start with the standard zones' **eye off**, hidden in 2D and 3D. So does turning "Use standard zones" on.
- They still calculate when "Use standard zones" is on.
- Existing projects and the bundled examples open as saved *(user)*. No file-format marker and no migration.

## Constraints

- **Never edit `.svelte` files with Edit or sed.** Use a Python helper with asserted unique anchors, or Write.
- No Co-Authored-By trailers.
- Update CHANGELOG `[Unreleased]` with user-facing changes.
- Frontend-only state (the dock layout is a user setting, not project state) does not go in the `.guv` sidecar.
- The undo snapshot covers every scene edit, including plane surface changes and drawn wall outlines.
- In illuminate, merging and pushing are the user's call. In guv-calcs, agents may push main once green.
- The units registry (`UNIT_INFO`) and the meters-authoritative standard-zone heights stay as they are.

## Left to the builder

- Component boundaries: a dock-layout store, a `DockPanel` component, and how `ViewsPane` changes.
- Wall-view projection and fade rules, within the original spec.
- guv-calcs constructor names, and the API field names beyond `surface` and wall `vertices`.
- The order of work.
  - Suggested: guv-calcs and API first; then docking; then surfaces in 2D; then the zone editor; then standard zones.
  - Each step should leave a working app.
