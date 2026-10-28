# Changelog

All notable changes to this project will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- The 2D view has a Floor · Ceiling · Walls switcher; [ and ] step through surfaces, and opening a plane switches to its surface
- Walls in the 2D view show the wall face-on, with lamps and structures in front of it projected and faded by distance, and the neighbouring walls named at each end
- In a wall view, drag a lamp or a structure near the wall to slide it along the wall or raise it; a lamp stuck to the wall stays stuck
- Planes are added and drawn on the surface shown in 2D: the floor, the ceiling or any wall. Add zone › Plane on a wall covers the whole wall, on the ceiling it faces down; Draw in the Zones toolbar draws a plane's outline there (or redraws the selected plane's), and on a wall the selected plane's corners and body drag. Wall planes show as a thick line along their wall on the floor view, and at any wall angle in 3D
- Click a surface in the 3D view to show it in 2D; repeated clicks cycle through the surfaces under the cursor, and a chip by the cursor names the one the next click picks. The surface the 2D view shows has a dashed outline in 3D. A 3D click selects a lamp, structure or zone only in its own step (Lamps, Structures, Zones); elsewhere it picks the surface
- One main view with a 2D | 3D switch; the other view, the editor and results are dockable panels: drag them by their bar to either side, minimize them, and swap views from the mini view. View › Reset panel layout restores the default.
- Main view controls are icons: view and surface top-left, Calculate top-right, edit tools bottom-left (also in 3D), units and view tools bottom-right. Side panels can be resized again.
- Standard zones start hidden in the views; they still calculate.
- Planes parallel to a wall (including old XZ and YZ planes) are now recognised as wall planes: the project reports the wall, the distance from it and which way the plane faces
- Planes on the ceiling or a wall follow the room: a ceiling plane keeps its distance below the ceiling when the height changes, and a wall plane stays on its wall when the outline changes (finding it again by position if the walls are renumbered, and a whole-wall plane covering the resized wall); a wall plane whose wall is gone keeps its last place, opens on Floor and is listed in the audit, as is one whose drawn outline no longer fits (it is kept as drawn)
- Hand and Zoom modes for the 2D plan, picked in its top-right corner (in place of + / − / Fit) and remembered between sessions. In Hand, scrolling and a drag on empty space pan; in Zoom, scrolling zooms about the pointer and a drag on empty space draws a box to zoom to. Ctrl/Cmd+scroll and a trackpad pinch always zoom, middle-drag and Space+drag always pan, and double-clicking empty space or pressing F fits the view. On a touchscreen, two fingers pinch to zoom and pan, one finger on empty space follows the mode, a double-tap fits, and a second finger landing while one is dragging an item cancels that drag. In Lamps, Shift + drag on empty space draws a box that adds the lamps inside it to the selection
- Zones: Add zone comes first, then your zones (new ones are added at the end of the list); the standard zones, with their Use standard zones checkbox, are folded under a Standard zones disclosure that starts closed and opens when a standard zone is selected in 3D or on the plan
- Stick to ceiling and Stick to wall in the lamp's panel: a lamp on the ceiling keeps its distance below it when the room's height changes, and a lamp on a wall keeps its place along that wall and its distance from it when the outline changes, so a corner lamp stays in its corner; the move is part of the same undo step. Downlight placements stick to the ceiling, Corner and Edge to the ceiling and a wall, Upper-room to a wall. Typing a new Z unchecks Stick to ceiling, and typing X or Y, dragging the lamp on the plan or nudging it with the arrow keys unchecks Stick to wall. Saved with the project
- Ceiling designer (Room › Ceiling): a tile grid (2×2, 4×2 or 2×4 ft tiles) aligned to a corner or the centre of the room, with Move grid on the 2D plan, and Add to ceiling for smoke detectors, vents, sensors and keep-out areas. On the plan, detectors, vents and sensors snap to the middle of a tile (Alt: free), keep-out areas reshape like a structure footprint, and everything stays inside the room (an item a room change left outside can still be moved or reshaped back in). A keep-out area's X and Y are its centre by default (Reference: Centre or Corner). Copy (also Ctrl+D), Delete (also the Delete key) and undo work as elsewhere, up to 2000 items; the layout is saved with the project
- The ceiling layout shows in the 3D view: tile lines, detectors as discs, vents as squares, sensors as cones and keep-out areas in translucent red, with the selected item in orange. The eyes in Room › Ceiling work there too: hiding the ceiling removes its surface, tiles and items from 3D, hiding the tiles or the items removes just those, and each item has its own eye
- Room › Floorplan: Dimensions (W, L while the room is a rectangle, H, and units) at the top with the floor area · volume under them, then Draw outline and Upload floor plan image; the corner table is folded under a Geometry disclosure. Draw outline starts drawing at once, with no prompt (cancelling before three corners puts the old outline back). Secondary buttons in the editor column stand out from the panel in both themes, and text across the app is a size larger
- Contour plots for calculation planes, in the plot window and in the room view (Display → Contours)
- Contours and isosurfaces are drawn at a list of levels, each with its own color and an optional name that the plot shows in place of the value, shared by the plot window and the room view. Levels can be picked from the data (Auto, keeping however many levels there are), set to the ICNIRP, ACGIH eye and ACGIH skin limits for the lamps' spectra (Limits, on every plane and volume, as a dose or as the irradiance that reaches it over the zone's exposure time), stepped up to one of those limits (% ICNIRP, % ACGIH Eye, % ACGIH Skin: 25, 50, 75 and 100% of it for four levels), or typed in. The levels' menu picks among these. In a room whose lamps have different limits (222 and 254 nm together), the limits are weighed for the mix of light at each point, and a limit's line is drawn where each point reaches that share of its own limit A zone's view, levels, colors, names and decimals are saved with the project
- Plane plots zoom and pan (scroll or pinch, drag, double-click). With Show values on, each cell's number appears once there is room for it, so dense grids can be read by zooming in, and Save Plot is sized so every value is readable
- A plot window's title is a menu of the zones with results; picking one shows that zone in the same window
- Each zone's plot can have its own title, shown over the plot and on Save Plot images
- Contour lines can be dragged: a line under the pointer thickens to show it can be grabbed, and while dragging it follows the pointer, with the value it will take shown beside it
- Export All (with plots) and the PDF report show each plane twice: its heatmap, and its contour plot at the zone's levels (Auto, Limits or typed in), with their colors and names, values if shown, and the plot's title. guv-calcs draws them. A plane's Heatmap/Contours is one setting in the zone editor's Display and its plot window
- Calculation zones on the floor plan: in the Zones step, a selected plane or volume can be moved and reshaped on the 2D plan (reshaping a whole-room zone makes it a drawn one), and calculation points are rings you drag to move, with a dot you drag to aim. Copy, Delete and undo work as elsewhere, as do Delete, Ctrl+D and the arrow keys; the safety zones stay as they are. Switching a zone between plane and volume keeps its shape
- Calculation planes and volumes can be any shape: the API accepts and reports a zone's footprint as a polygon (`vertices`), keeps it through height and z-range changes, units switches, save and load, and masks the grid to it like a polygon room's safety zones. A plane or volume can cover the whole room (the new "Whole room" option, on for new zones), and then follows the room outline when it changes; a volume can span "Floor to ceiling" and then follows the room height
- Lamps on the floor plan: the Lamps step's Add lamp asks for a fixture (a built-in preset or a custom library lamp, or "Add custom lamp…"); choosing one shows the placements (Downlight, Corner, Edge, Upper-room), and each click adds a lamp of that fixture placed automatically (corners and walls take the next free one). On the 2D plan a lamp is drawn as a ring with a dot at its aim point and a dashed line between them. The ribbon under the plan has Move (on by default), Aim, Copy and Delete, with icons, greyed out until there are lamps: Move drags the selected lamps together (the aim moves with them), Aim drags from a lamp to where the selected lamps should all point, and the dot still aims a single lamp. Shift + drag a box on empty space to add lamps to the selection, Shift-click to add or drop one, Ctrl+A for all; arrow keys nudge, Delete removes and Ctrl+D copies the selection, each as one undo step
- Edits on the 2D plan apply as you make them (closing an outline, finishing a drag, placing or deleting a structure, moving or calibrating the floor-plan image), so there is no Apply or Cancel; undo (Ctrl+Z) takes a change back. An outline whose walls cross is shown in red and not applied until it is fixed, and leaving the step then offers to keep the last saved outline. While drawing, Ctrl+Z removes the last corner. Room › Reflectance points out each surface on the plan as you hover its row
- Undo and redo for scene edits: Ctrl+Z (⌘Z) undoes the last change to the room, lamps, calculation zones, structures, reflectance or the floor-plan image, wherever it was made, and Ctrl+Shift+Z or Ctrl+Y redoes it. The Edit menu shows what will be undone. A deleted lamp, zone or obstacle comes back as it was (a lamp with an uploaded IES file asks for the file again). Text fields keep their own typing undo; loading a project, New and changing units start a fresh history

### Changed
- Zone editor rebuilt: no type switch or presets; a plane shows its distance from its surface with Flip, Draw and Fit buttons, and folds Geometry, Grid points and Display away; rows show only the name.
- A plane drawn on the floor starts at eye height (1.8 m), as Add puts it
- A wall plane's plot window is drawn as seen from inside the room, with Along and Up axes
- Delete and Ctrl+D work on a plane selected on its wall in the wall view
- The open structure's panel is redesigned like the lamp's: Bottom, Top and Floor to ceiling show at once (greyed out while it spans floor to ceiling). Geometry holds X and Y with a Reference (Centre, or the Corner where its width and length start), Width and Length along the structure's own sides (the reference point stays put; a drawn shape is stretched), Rotation, Pitch and Roll, and the corner table. Display holds Show label, which puts the structure's name over it in the 3D view; it is one undo step and is saved with the project. Reflectance and transmittance are set in Room › Reflectance. The Delete, Copy and Close buttons and the delete confirmation are gone: the 2D toolbar and the Delete key (or Ctrl+D) do this, and undo brings a deleted structure back
- The 2D plan draws its lamp dots, labels, corner and "+" handles and edge lengths at a fixed size on screen (text 11 px, lamp dots 13 px across, handles 10 px or more) in any pane width, instead of shrinking in a narrow pane
- The open lamp's panel is redesigned to fit the editor column: under the fixture come a Dimmer (0–100%, the lamp's scaling factor) and four placement pictograms (Downlight, Corner, Edge, Upper-room) that re-place the lamp, cycling corners and walls as before. Position, aim point (each with its pick button), tilt, orientation and rotation are folded under Geometry, all shown together, and Show label and Show photometric web under Display. The Delete, Copy and Close buttons and the delete confirmation are gone: the 2D toolbar and the Delete key (or Ctrl+D) do this, the lamp's row closes its panel, and undo brings a deleted lamp back. The aim presets (Down, Corner, Edge, Horizontal) and the Set Tilt/Orientation switch are gone. An aim point typed onto the lamp itself is no longer sent (the server refused it); it is shown in red until the next coordinate moves it off the lamp. The Horizontal placement is now called Upper-room everywhere, including Settings' default placement
- The 2D plan shows a plain grid: faint lines with a stronger one every five steps, and no rulers, numbers or shaded area outside the room
- A new workspace replaces the left sidebar and the Plan pop-up. The start page offers three cards: Start designing, Open a .guv file and See an example. The left column is an editor with three stages, Room (Floorplan, Structures, Ceiling, Reflectance), Lamps and Zones, and Back/Next buttons named after the step they go to. The middle shows one main view (2D or 3D) with the other as a dockable mini view, and the panel layout is remembered. Done shows a summary of the room, structures, lamps and calc zones, whose section buttons go back to that step. A 3D click selects a lamp, structure or zone in its own step; elsewhere it picks the surface. Obstacles are now called structures
- The plane, volume and point plot windows are one fixed size whatever the zone or view, with their settings in a side panel. A plane is shown as a heatmap or contours, a volume as isosurfaces. The view, decimals and isosurface levels moved there from the window's footer and the zone editor; the Numeric view is now a Values option in the plane window's Show row, on the heatmap or contours
- Opening or switching to a large volume's plot no longer freezes the page for seconds; the window appears at once, with a spinner while its isosurfaces are drawn
- Plot windows are titled with the zone's name (such as "Eye Dose (8 Hours)") rather than its id ("EyeLimits")
- Standard eye and skin planes sit at exactly 1.8 m (1.9 m under UL 8802) in every unit: 5.906 ft rather than 5.9 ft, 70.87 in rather than 70.9 in
- Isosurface levels are picked from the bulk of the data (1–2–5 steps), so a lamp's hot spot no longer stretches them, and a volume can have up to ten

### Fixed
- Typing a grid spacing for a reflective surface or obstacle face could give one more point than the calculation itself would use (a 6 m wall at 0.7 m became 9 points, not 8), and a spacing wider than the surface gave 2 points rather than 1. The point count now follows the same rule as the calculation
- Switching a room between meters and feet (or any other unit) could change its results by a few percent, and by much more at single points near a lamp or an obstacle: calculation grids were laid out slightly differently in each unit, and a few geometric edge cases were decided by rounding noise. Results are now the same in every unit
- Opening a polygon-room project whose standard zones (Whole Room Fluence, Eye and Skin Dose) covered the floor plan's bounding box rather than the room kept those zones, so points outside the room pulled the averages down until the room was next edited; the same project could show results about 15–20% apart. Opening a project now fits the standard zones to the room
- Closing a zone's editor right after changing it (within a tenth of a second) dropped the change; it is now saved
- Changing a zone's exposure time one field at a time could leave calculations using a different time than the editor showed: setting hours to 0 (on the way to, say, 15 minutes) was rejected by the server, and the next field then kept the server's old hours, so 0 h 15 min was calculated as 8 h 15 min. The editor now sends hours, minutes and seconds together, and an all-zero time is outlined in red and not sent until it is valid
- A calculation zone's editor no longer writes stale values back: with a zone's editor open, a change made elsewhere (a room resize nudging the zone into bounds, undo) was reverted by the editor's old copy on its next save. The editor now refreshes from the zone first
- The lamp editor no longer keeps its own copy of a lamp's position, aim, rotation and type: it shows the lamp as stored and writes each edit straight back. A lamp moved or re-aimed elsewhere (a placement button, the floor plan, undo) shows its new values at once, and a stale value in the editor can no longer overwrite it a moment later
- Switching a preset lamp to another lamp type no longer requests photometry it doesn't have, which used to log errors
- An old ceiling plane no longer drops to the floor when its Below ceiling or Flip is changed
- A point pick (Place, Aim, View direction, Target) is cancelled when its zone's panel closes, another zone opens, or the 3D view goes back to the mini view, so it can no longer land on another zone

## [0.6.1] - 2026-10-19

### Added
- File → Save As… (Ctrl/Cmd+Shift+S), and Ctrl/Cmd+S for Save. In Chrome and Edge, Open and Save As remember the file, and Save writes back to it instead of downloading a new copy; the tab shows the file's name. In Firefox and Safari, Save As asks for a file name and downloads under it. Save As renames the project to the file's name
- Lamps, zones and obstacles hidden with their eye icon stay hidden when the project is saved and reopened. Hiding or showing one counts as an unsaved change

### Fixed
- Polygon rooms: exporting a calculation plane to CSV, and Export All (ZIP), failed. Planes and volumes now export on their full bounding grid, with the cells outside the room outline left blank
- A disabled lamp came back enabled after saving and reopening the project
- A calculation point with a limited field of view (such as 80° × 120°) now looks where it is aimed. The field of view was applied as a band around the plane perpendicular to the aim, so a point aimed between two lamps could read 0, and a point aimed at one lamp could count the other one instead
- Reflected light now respects the field of view of eye-directional and eye-target planes and of calculation points; it was filtered by the plane's own orientation instead. With reflectance on, these zones' results change. Changing a zone's field of view or weighting also refreshes its reflected light, which used to keep its old values until a full recalculation
- Changing the reflectance resolution of a single room surface no longer breaks the next calculation
- A project file whose preset lamps carry no embedded photometry (hand-edited, or written by another tool) now loads the preset's photometry; those lamps were silently left out of calculations
- Switching a zone to Dose in its editor could silently revert to irradiance when another change to that zone (such as its display mode) was still saving

### Changed
- Calculations run on guv-calcs 0.10.0, which brings the fixes above
- Recalculating after adding, moving, disabling or removing an obstacle reuses the results it doesn't affect, instead of recalculating the whole room

## [0.6.0] - 2026-10-14

### Added
- Lamps are colored by wavelength so different lamp types are told apart at a glance: 222 nm lamps are violet, 254 nm lamps blue, and other wavelengths take a color along the same ramp (e.g. teal for 265–270 nm UVC LEDs). The color shows on the lamp in the 3D view, its dot in the floor plan, a dot beside its name in the Lamps list (hover for the wavelength), and the lamp markers in the zone plot windows. The efficacy plot's wavelength colors use the same ramp. Selecting or hovering a lamp now brightens it instead of changing its color, and the room wireframe, calculation zones, floor-plan outline and sidebar room thumbnail switch to neutral slate tones so they don't compete with lamp colors (a selected zone, obstacle or floor-plan corner is orange in both the 3D view and the floor plan, a color no common lamp wavelength uses)
- The app's accent color (buttons, focus, selection, checkboxes) is the brand red again instead of violet, since violet now means a 222 nm lamp
- Custom lamp form: a wider layout with a preview column showing the photometric distribution (polar plot), the total power in mW and the 3D fixture. Scaling offers the same methods as Advanced Lamp Settings (to total power, max irradiance or center irradiance, or by a factor), defaulting to total power with the file's figure filled in; the choice is saved with the custom lamp and applied wherever it is used. Advanced Lamp Settings' scaling also defaults to total power
- The custom lamp form shows the lamp as three cards, Photometry, Spectrum and Fixture, each with its file, a picture and its key figures: the photometric distribution with total power; the spectrum on a relative-intensity scale with its peak (or, without a spectrum file, the lamp type's nominal line, marked as assumed, or for an "other" lamp the wavelength you enter); and a 3D sketch of the fixture with its mounting, luminous opening and luminaire housing. Edit opens that card's page (scaling is set on the Photometry page), which you leave with Back (or Escape); Cancel and Save lamp stay on the overview. The Spectrum page can also change the lamp type, and the storage option now says a saved lamp is only available to you.
- Fixture settings for custom lamps. The Fixture card marks the fixture worked out from the IES file "Auto-detected" until you change it in its editor (also in the Lamp Fixture tab of Advanced Lamp Settings). The editor shows how the fixture is mounted (ceiling, wall or floor) and an L / W / H grid (in any length unit) for the luminous opening and the luminaire housing; its Advanced section holds which horizontal angle of the file points into the room (wall mounts), which side of the housing is mounted, its rotation, and the photometric center's offset from the mounting point. Intensity units moved into the main custom lamp form, and the form's own Advanced section is gone: source density and the intensity map are set per lamp in Advanced Lamp Settings. A live 3D preview shows the housing, the mounting surface, and the luminous opening and light distribution in the lamp's wavelength color. Four-way fixtures like ceiling-mounted upper-room units no longer have to pretend to shine "down". The housing drawn in the room, wall and ceiling clearance during placement, and the room-fit check all use this layout. Following IES LM-63, the file's width/length/height describe the luminous opening, not the fixture: the housing starts as that opening (including the height of sources with luminous sides, such as four-way upper-room units), always contains it, and by default the opening sits flush with the front of the housing. Lamp position is still the photometric center, so calculations are unchanged
- Custom lamps can be edited per placed lamp in Advanced Lamp Settings. The Photometric and Spectral Info tab now has a wavelength field (for custom-wavelength lamps) and a spectrum file field: attach, replace (with the column picker for multi-column files) or remove the spectrum of this one lamp, without changing the custom lamp definition or other lamps that use it. The exposure limits and plots refresh once the change reaches the server. The Luminous Opening tab gains a Height field for the emitting surface. Editing the definition in the lamp library still re-applies it to every lamp using it, replacing these per-lamp edits

### Fixed
- Total power was overcounted for IES files with unevenly spaced angles, such as upper-room fixtures sampled finely around the horizontal: a Lumalier 150 file read 4535 mW instead of 273 mW. This also affected scaling to a total power.
- The custom lamp form's total power, and the file's max and center irradiance shown for scaling, now follow the chosen intensity units: µW/cm² reads 10× mW/sr, as the lamp does once placed. They were always shown as mW/sr.
- A lamp set to "Other (custom wavelength)" with no wavelength entered yet no longer breaks the session. When the session was rebuilt (for example after leaving the tab idle), the server rejected that lamp with "wavelength is required for 'other' lamp type", the whole session failed to start, and no lamp's photometry loaded. Such a lamp is now accepted; it simply has no exposure limits until a wavelength or spectrum is given
- Switching a lamp's type to "Other (custom wavelength)" now uses the wavelength shown in the lamp editor. Before, the server quietly kept the lamp's previous 222 or 254 nm, so exposure limits and results used a wavelength the editor didn't show, and could change when the session was rebuilt
- The lamp Details Info tab for a custom-wavelength lamp with no wavelength or spectrum yet now asks you to enter one, instead of showing the error "no photometric or wavelength data"; the exposure limits appear as soon as you do
- The floorplan "How long is this line?" prompt keeps its text on one line; the units dropdown no longer takes up most of the space
- On phones and tablets, dragging or pinching the 3D view could also scroll or zoom the page. It happened after any switch between perspective and orthographic view (switching dropped the 3D view's touch handling for the rest of the session), and for gestures that began on the view's overlay buttons. The whole view area now keeps touch gestures to itself
- Scrolling the mouse wheel on a length field after a unit change now moves in sensible steps: a converted value such as 8.2021 ft scrolls to 8.3 and 8.4 (or down to 8.2) in steps of the unit's natural increment, instead of crawling by 0.0001 or carrying the stray digits along (8.3021). Applies to room dimensions, zone extents, lamp, point and object positions, and the floor-plan coordinates; fields with a declared step (reflectance, object angles) now snap to that step too
- When Save in the custom lamp form fails (for example a custom-wavelength lamp with neither a wavelength nor a spectrum), the reason now appears just above the Save button instead of at the top of the scrolled-away form, and the missing field is scrolled into view and focused
- Changing units in the floor-plan editor no longer zooms the view: with a freshly uploaded plan and no outline yet, switching from ft to in zoomed in to a one-inch square. The view now keeps the same area on screen. Zoom limits are physical sizes too, so the wheel no longer snaps the view in millimeters. Changing units during Set scale no longer cancels it: the measured line and the typed distance are converted, and the "How long is this line?" popover has its own units menu for typing the known length in any unit
- The Explore Data zone menu now lists calculation planes for surface data: planes in dose mode (including the skin-dose plane) were left out, so a surface plane usually could not be picked. Their mean is converted back to µW/cm². The menu groups zones into Surfaces (planes) and Air (volumes), and narrowing the Medium filter to Surface or Aerosol switches to a matching zone, so surface survival curves use a plane's fluence instead of the whole-room volume's. Picking one of two zones with the same mean fluence no longer jumps to the other
- Plots could fail with a "ParseException" when two were drawn at once, for example a PDF report generated in the first minute after the server starts, while preset lamp plots are pre-rendered in the background. Matplotlib is not thread-safe, so all plotting now runs one figure at a time
- Generate PDF failed with "Report generation failed" (400) for L-shaped and other polygon rooms: the skin and eye heatmaps could not draw a plane whose points only cover the inside of the outline. They now draw the room's outline with the area outside it left blank
- The PDF report names custom lamps by their model instead of "Custom fixture": the custom-lamp definition's name (which defaults to the IES filename), else the uploaded IES filename, else the lamp's own name, else the IES file's luminaire keyword
- Uploading an IES file with a dense angle grid (for example a UV-Flow file with 181 × 73 angles) froze the browser tab when the Orientation & Mounting picker drew its 3D preview. The picker now loads such files in about a second, in the lamp manager and on the advanced Fixture tab
- Generate PDF could fail with a timeout on the server: the browser gave the request 30 seconds, while the report took longer on a small server because it rebuilt the pathogen inactivation dataset seven times. The dataset is now built once (about twice as fast), the request is allowed up to 10 minutes like a calculation, and a timeout reads as "the server did not answer in time" instead of "signal timed out"
- Generate PDF failed behind a reverse proxy with nginx's raw "413 Request Entity Too Large" page in the dialog: the captured 3D views were sent as PNG and the request body ran to several megabytes. The views are now sent as JPEG (composited on white, 5-10× smaller; the API accepts both), and a proxy's HTML error page is shown as a plain message, such as "The request was too large for the server to accept (HTTP 413)". The production nginx still needs `client_max_body_size` raised above its 1 MB default for large rooms with many volume zones

### Changed
- Calculations run on guv-calcs 0.9.0 (with photompy 0.3.1), which brings the fixture layout (mounting face, photometric center offset, housing around the luminous opening) and the total power fix.
- The custom lamp form is wider and more compact, so the whole form fits on one screen: Name and Lamp Type share a row, the IES and spectrum files (and the wavelength, for custom-wavelength lamps) share the next, and long file names are shortened with an ellipsis (hover for the full name). The fixture editor shows its controls beside the 3D preview, with a one-line Ceiling / Wall / Floor toggle
- PDF report: the plan view is drawn to scale from the room geometry (outline, luminaire positions with aim arrows, objects, calculation points) instead of a screenshot of the 3D view; the 3D views no longer show photometric webs; the pathogen page shows the survival curves and the eACH/CADR table without a second isosurface view; custom zone plots sit two per row with their captions; calculation points list their aim point; and the lamp appendix puts each spectrum beside its photometric distribution
- The photometric center depth control is hidden from the Orientation & Mounting picker for now, because it could not be set to a negative value (photometric center in front of the emitting face). Depths saved in existing custom lamps and projects are still applied
- Photometric webs in the 3D view no longer swallow the room for very powerful fixtures. Up to half the room's smallest dimension a web is drawn at its usual size (1 m per 100 mW of optical power), so the built-in presets look as before. Above that it keeps growing with power on a logarithmic scale, reaching the room's length for multi-watt fixtures and stopping there. The fixture box, emitting-surface points and aim line keep their physical size
- The custom-lamp Orientation & Mounting picker now asks how the fixture is mounted (Down, Up, or Sideways) instead of which IES-frame direction the beam leaves in, with a "Detected from file" tag on the suggestion. Sideways picks the file's strongest side automatically and exposes a small "Beam side in file" select to override it. The 3D view is a preview only: the six clickable handles and lobe-click picking are gone, and a labelled light arrow shows the beam as mounted. The Centered depth button explains that it needs a housing height
- The lamp editor no longer shows the "Position and aim appear once a model is chosen" note while a lamp has no model; the position and aim fields simply appear when a model is picked

## [0.5.1] - 2026-10-05

### Changed
- Autorecalculate is off and its checkbox (under the Calculate button and in Settings > Behavior) is hidden on phones, where each automatic run jumped from the settings being edited to the Results tab; the saved preference still applies on wider screens
- The status bar keeps only the last-calculated time, the calculation progress bar and the version info; the Ready dot, the next-step/TLV message and the lamp, zone and obstacle counts are gone, and the Results tab no longer repeats the calculated-at time

### Added
- Reports: Generate Report produces a designed PDF — cover with a chosen 3D view, a one-page summary (eACH‑UV, CADR, average fluence, the occupancy statement with hours to the ACGIH and ICNIRP limits, selected pathogens), room and luminaire tables with a plan view, photobiological safety with skin and eye heatmaps and per-lamp compliance, pathogen reduction with the fluence isosurfaces and survival curve, custom zones, and an appendix with lamp photometrics and methodology. A Report dialog takes the title, client, preparer and notes (saved with the project), the cover view, and the pathogens to include; if the room has not been calculated, or has changed since, Generate PDF runs the calculation first. The CSV report is a Download CSV button in the same dialog and remains in the Export modal
- Custom lamps can declare where their beam points in the IES file (down, up, or horizontal toward 0°/90°/180°/270°) and how deep the photometric center sits in the housing. An Orientation & Mounting picker in the lamp manager form and on the advanced Fixture tab shows the photometric web in 3D with six clickable handles, pre-selects the direction suggested from the file, and slides the housing box as the depth changes. Aim, tilt and orientation then follow the beam, so wall-mounted upper-room 254 nm fixtures (Lumalier-style files with the beam at θ = 90°) can be aimed horizontally like any other lamp; applying such a definition to a lamp still aimed straight down places it on a wall aiming across the room

### Fixed
- Fixtures whose IES states a luminous height (e.g. the UV-Flow) drew their housing box hanging below the photometric point; the box is now centered on the luminous volume. The advanced Fixture tab also reported the housing height as the luminous depth

## [0.5.0] - 2026-10-05

### Changed
- The Guided / Expert sidebar choice is gone (View → Sidebar). The sidebar is always the numbered, collapsible layout; the per-zone include/exclude toggle is always available, and a lamp's placement fields appear once it has photometry

### Added
- Floor-plan editor: each lamp dot is labelled with the lamp's name
- Results: the Air changes per hour and Clean air delivery rate tiles show their label above the number, like Time to inactivation
- The app opens in the dark theme unless you have chosen light from the View menu (it no longer follows the system preference)
- Reflectance per surface: the Reflectance step is now an All surfaces card (reflectance and transmittance, 0.078 prefilled, "mixed" when the planes differ) over quickset rows for Room walls and each obstacle, plus a full-width Edit surfaces… button. The reflectance modal groups planes as Room walls (open) and one collapsible group per obstacle, each with its own quickset; every row shows reflectance, transmittance (greyed for room walls, which never transmit) and the absorbance left over, and obstacle faces (bottom, top, each side) take their own values. Obstacles are drawn as blue wireframes like the main view, and clicking a surface or obstacle face in the preview expands its group and focuses its input; clicking the same spot again cycles through the planes under the cursor (obstacle faces first, then the room surfaces behind them), as in the main 3D view. Per-surface grid spacing or point counts, and the grid dots in the preview, appear only while Edit grid resolution is ticked under the preview; Advanced holds max iterations and threshold. The 222 nm / 254 nm preset buttons are gone (0.078 is simply the default), and a new obstacle starts at 0.078 like the room surfaces instead of 0
- Lamp editor: an "Other (custom wavelength)" lamp now shows its wavelength in a Wavelength (nm) row (editable in place; locked with a "from spectrum peak" note when a spectrum defines it) with a Spectrum... button that opens the lamp's own library definition for attaching or replacing the spectrum file (Save or Cancel return to the editor), and the lamp's row in the list shows the wavelength after the file name ("lamp.ies · 265 nm")
- Rooms can be edited in centimeters, millimeters and inches as well as meters and feet. The unit selects (room step, floor-plan editor, Settings default units, lamp manager surface units) list all five; switching converts every length through the backend, and the sidebar summary, rulers, plan canvas and reports label areas and volumes with the right unit (cm², in³, …). Each unit has its own input step (1 cm, 10 mm, 1 in, 0.1 m/ft), plan-drawing snap (10 cm or 3 in), floor-grid cell (1 m or 1 ft) and default decimal precision; switching units moves the room's precision to the new unit's default unless you had chosen your own. A lamp-library definition saved in one unit applies correctly to a session in any other
- Project files saved in a unit the app does not offer (yards) load converted to meters

### Fixed
- Results: the safety summary card takes its green or amber tint and edge from the theme's own colours, so it stands out in the light theme as it does in the dark one
- Calculations failed with "too many indices for array" once a hand-drawn (non-rectangular) obstacle or a polygon room had reflections enabled: guv-calcs' interreflection assumed every reflecting surface was a rectangular grid (fixed in guv-calcs, unreleased)
- 3D view: an unselected obstacle is drawn in the room's wireframe blue instead of grey, so it reads as part of the room like the walls and calculation zones
- Safety: the occupancy card's time to the ACGIH and ICNIRP limits, the Hours to TLV cells and the 2D plot's TLV line judged the room's whole dose against the lowest TLV of any lamp present, so a 254 nm lamp contributing almost nothing made a compliant 222 nm room read as safe for minutes while the next-step card still said it complied. They now use the same spectrum-weighted sum as guv_calcs and the compliance flags: each lamp's dose counts against that lamp's own TLV
- Lamp list: a lamp without photometry always reads "222nm - no photometry", "254nm - no photometry" or "Custom - no photometry" (it used to say "no model chosen" or "custom, no photometry yet"), and that status and the model subtitle now keep a gap from the row's buttons instead of running into them
- The strip of list background that showed beneath an expanded lamp, zone or object editor is gone
- Session init applied each standard zone's display mode and enabled flag and then recreated all three standard zones for the next one, so Whole Room Fluence always came back hidden ("None") and a disabled Eye or Skin zone came back enabled after a reload or a backend timeout recovery
- Lamp placement, the Work Surface / Head Height presets, the default spacing of a new zone and the 3D view's lifts and markers were fixed meter-sized numbers applied in whatever unit was active (so in feet a wall offset was 0.1 ft, not 10 cm); they are now converted into the current unit
- 3D view: the floor-plan image is lifted above the floor in proportion to the room's size and given a polygon offset, so the floor grid no longer bleeds through it at grazing angles or in large rooms
- Standard calculation zones in a traced room whose outline does not start at the origin were drawn shifted towards (0, 0) (a guv-calcs extents fix; the zones' points were always computed in the right place)

### Changed
- Calculations run on guv-calcs 0.8.1, which brings the per-face obstacle grid resolution, obstacle listing in reports, outward-facing obstacle normals, the occlusion fixes the obstacle features rely on, and interreflection that handles polygon-masked reflector grids
- Whole Room Fluence is drawn as an isosurface by default (guv_calcs creates it hidden, "None"); the Settings volume display default applies to it like any other volume
- Results: Photobiological Safety, Pathogen Reduction in Air and Ozone Generation fold away by default (click the heading to open); Pathogen Reduction in Air is now a comparison: a full-width "Explore pathogen data…" button, a dropdown to tick the pathogens to compare (grouped by category, remembered as your result species), and a table of eACH and time to 99% per pathogen with the survival curves beneath. The Summary's pathogen dropdown offers groups ("All airborne pathogens", "All viruses", "All bacteria", … whichever have data at the lamps' wavelengths) that show the median across the group's species, labelled as such
- 3D view: a calculation plane lying on the floor is lifted just above the floor grid and floor-plan image so it no longer flickers against them

- On phones every modal opens as a full-screen sheet with a back button instead of a floating window: no dragging or minimizing, the body scrolls, and the app's tab bar steps aside while a sheet is open. The 2D plot fits the screen width (scrolling sideways only if the TLV scale still doesn't fit) and its footer stacks its controls; the efficacy swarm plot's controls wrap
- Results: the Summary opens with two cards, air changes per hour and clean air delivery rate (CFM with LPS beside it), then a time-to-inactivation card (90%, 99%, 99.9% labels over the times), all for the pathogen chosen in the dropdown under them (default Human coronavirus, from the pathogens with inactivation data at the lamps' wavelengths); then a plain row with the average fluence and its Show plot button, and an occupancy card that always weighs both limits, whatever standard the safety zones use: "Within ACGIH and ICNIRP limits all day" or "Within the ACGIH limit all day" (green), or "Safe to occupy for N h per day (ACGIH limit)" (yellow), with the time to each limit in two columns beneath, green from 8 hours up and yellow below. Cards are tinted rather than outlined; Generate Report sits at the bottom of the Summary. The banner states how long the space can be occupied per day: green "Continuous occupancy is within the TLV" with "Indefinite (N h)" from 8 hours up, yellow "Safe to occupy for N hours per day" below that; it never says "does not comply". Hours to the ACGIH TLV and to the ICNIRP limit are both listed, whichever standard is selected. Exact doses moved to the Photobiological Safety table, which now also shows the average 8‑hour dose and the maximum and average irradiance for skin and eye, with the Show Plot buttons
- Floor-plan editor: the New button reads "New outline" and asks before clearing corners that are already there; after the scale is set (or skipped) with no outline, a dialog offers to start tracing ("Place at least three points"); while drawing the hint reads "Esc cancels, Enter completes"; a wall snaps square only within 4° (was 8°) and never when it is shorter than about 30 px on screen

### Added
- Objects: draw an object's footprint. "Draw object…" beside Add Object opens a plan editor (the same canvas as the floor-plan editor: grid, snapping, draw-by-clicking, drag corners, midpoint insert) showing the room outline, floor-plan image, lamps and other objects; click out the footprint where the object stands, set its name, height, reflectance and transmittance, and Apply adds an extruded object. "Edit footprint…" in an extruded object's editor reshapes it, and "Convert to polygon…" turns a box into an editable polygon
- Objects: place obstacles such as desks, partitions and cabinets in the room so they block and reflect light. An Objects panel in the sidebar adds a box (size, position, yaw, reflectance and transmittance, with pitch and roll under Advanced), toggles it in and out of the calculation, copies, renames and deletes it; objects are drawn as solid grey blocks in the 3D view (click to select), saved with the project, converted with the room's units, included in the position check and nudge, and extruded-polygon objects authored in Python load, render and edit (their footprint is read-only for now). Changing an object marks the results stale and the next calculation redoes the shadowing
- Floor-plan editor: upload a floor plan (PNG, JPEG, WebP, GIF, SVG or PDF page) as a reference image, set its scale by clicking two points a known distance apart, drag it into position, adjust its opacity, and trace the outline over it. The image is saved with the project (in an app-owned block of the .guv file that guv-calcs ignores), shown in the sidebar thumbnail, and drawn on the 3D floor clipped to the room outline, with a "Floor plan image" toggle in Settings and the View menu. A Snap toggle in the editor turns grid snapping off while tracing. A very large image stays available for the tab but isn't kept across a backend restart — save the project to keep it
- Floor-plan editor: corners, walls and midpoints stay editable while Move plan is active, and clicking the active Move plan / Set scale button returns to editing; Snap off now frees new walls from the 45° steps as well as the grid (Shift still forces an angle); tool buttons use the secondary style so only Apply carries the accent colour; the upload button reads "Upload floorplan…"
- Floor-plan editor: the toolbar is split into captioned Outline and Floorplan groups, the floorplan steps are numbered (1 Upload, 2 Set scale, 3 Move plan) and shown disabled until an image is loaded, and a hint line under the toolbar always says what to do next
- Floor-plan editor: uploading a floorplan now starts a new room — the old outline is cleared, the modal chains Set scale into Trace outline over the drawing, a notice names the file (Cancel restores the old outline), and a "From floorplan…" button on the Room panel opens the editor straight into the file picker
- Floor-plan editor: the uploaded plan sits on the origin and stays there when its scale is set (rescaling keeps (0,0) fixed instead of the midpoint of the two clicks), so no part of the room drifts below the axes where it could not be traced; the steps are 1 Upload, 2 Set scale, 3 Trace outline, with Move plan as an optional nudge
- Floor-plan editor: wall-angle snapping is now opinionated — with Snap on, a new wall snaps to a right angle anywhere within 30° of one and to 45° otherwise (it used to snap only within 5°); the rubber-band, measurement and angle-arc dashes are sized in screen pixels instead of room units
- 3D view: the floor-plan image no longer z-fights with the floor grid
- Floor-plan editor: the Move plan tool is gone — drag the handle on the plan's bottom-left corner to move it; the second Set scale click snaps to a right angle from the first; the Snap toggle is a magnet icon beside the zoom controls; hints are shorter and the "new room" notice and "Reference image" title are dropped; the angle readout is a faint wedge centred on the corner instead of a dashed arc; dashes are tighter. The Room panel keeps a single Edit button in the standard colour
- Floor-plan editor: angle snapping is gentle again — only a nearly square corner (within 8°) is pulled to 90°, everything else is freehand (Shift forces 45° steps, Alt frees), and the Snap toggle is gone; Set scale cannot be skipped for a newly uploaded plan (Trace outline waits for a confirmed scale); in the 3D view the plan is drawn in full rather than clipped to the room outline
- Floor-plan editor: the Rectangle / L / T / U presets are replaced by a single New outline button that clears the shape and starts drawing; finishing or cancelling with fewer than three corners restores the previous outline
- Floor-plan editor: the canvas is anchored at the origin (spare space goes up and right, since coordinates can't be negative); the toolbar is "Floorplan (optional)": 1 Upload floorplan…, 2 Set scale, 3 Trace outline, then Clear; buttons share one height and the step numbers are larger
- Floor-plan editor: the Set scale prompt sits at the top of the canvas with a title and accent border; the grid and axes always run to the canvas edge; placing a corner near the edge no longer re-zooms the view; faint guidelines pull the cursor into line with existing corners so outlines close square; the drawing button is "New" (disabled while drawing) and Enter / the first corner closes, Escape cancels — the Finish and Cancel buttons and the "Drawing…" note are gone; guidelines disappear once the outline closes
- Floor-plan editor: scrolling (two-finger trackpad or mouse wheel) pans the canvas and pinch or Ctrl+scroll zooms; Space+drag pans in any mode, including while placing corners
- Floor-plan editor: grid snapping is light, like the angle snap — a corner, wall or the plan's handle within a few pixels of a visible grid line lands on it, anything else stays exactly where it was placed (Alt still frees); a guideline shows the grid line being snapped to, and a nearby corner still wins over a grid line
- Floor-plan editor: the toolbar is just New, Upload floorplan… and Set scale, usable in any order; uploading no longer clears the outline, it offers Set scale (Escape dismisses it); the step numbers, captions and Trace outline button are gone; the idle hint line is blank; grid snapping targets whole metres or feet (or the finer grid when zoomed in) rather than the auto-scaled grid spacing, and the first corner snaps without a guideline
- Floor-plan editor: uploading a floorplan over an existing outline asks whether to clear the old corners (Clear / Keep), then asks whether to set the scale now (Set scale now / Later)
- Floor-plan editor: click the plan to select it (dashed highlight), then drag it anywhere to move it; a small x / y readout with inputs sits at its corner while selected, Escape or clicking elsewhere deselects. The side panel's X / Y rows and the corner handle are gone

### Fixed
- A request carrying a non-finite number (NaN or Infinity) now returns a proper 422 validation error instead of a 500

### Added
- Guided sidebar: five numbered steps in the order a design is built: 1 Floorplan, 2 Obstacles, 3 Reflectance (walls and obstacles together), 4 Lamps, 5 Calc Zones. A collapsed step shows a one-line summary when it has something to say. The status bar names the next thing to do (add a lamp, choose a model, calculate, review safety, export a report)
- Floorplan step: dimensions, the minimap right under them, and one line with the floor area, the volume and the Edit button
- The Results panel is open from the start, narrow while empty and wider once results arrive; its empty state carries the next-step hint (add a lamp, choose a model, ready to calculate)
- Start chooser on a fresh project: an example room (13 × 20 ft with a bare Ushio B1 already placed and calculated), an empty room (opens the floor-plan editor straight away), or a project file. "Don't show this again" and Help → Getting Started
- Objects are called obstacles everywhere in the interface (step title, buttons, status bar, menu, editor); file formats and ids are unchanged
- View → Sidebar → Guided / Expert. Expert restores the flat, always-open layout with every per-row toggle, including on standard zones

### Changed
- Plan editor: the floor-plan editor gains an Obstacles layer (a layer rail switches between Outline and Obstacles). Draw an obstacle by clicking its corners; it is selected at once and can be moved by dragging, reshaped by its corners and walls, nudged with the arrow keys, copied (Ctrl+D) and deleted. The side panel lists the obstacles and, for the selected one, its name, floor to ceiling or bottom and top, reflectance and transmittance, with the corner table under "Corners". New obstacles reach floor to ceiling. Apply commits the outline and every obstacle change together; Cancel discards all of it. Applying the outline with no obstacles yet offers "Add obstacles" / "No obstacles to add". The separate footprint editor is gone; the sidebar's "Add obstacle…" and "Edit on plan…" both open this layer, and the plan thumbnail shows obstacle footprints
- Applying the Plan editor with an unchanged outline no longer writes the room, so lamps, zones and obstacles are not nudged and the calculation is not marked stale
- Reflectance is its own step: the Enable reflections toggle, a Walls… button with the wall reflectance summary, and a reflectance / transmittance pair per object, so every surface in the room is set in one place
- Object height is a bottom and a top (or "Floor to ceiling") instead of a base Z and a height; an object marked floor to ceiling follows the room height when that changes
- A new lamp shows only its type and model until it has photometry; position, aim and rotation appear once a model is chosen (guided layout)
- Standard zones no longer show calc-enable and delete toggles in the guided layout; they are the app's zones, not the user's
- Row toggles (show/hide, include, delete) stay quiet until the row is hovered, focused or open
- Visual refresh: a violet primary colour carries actions, focus rings, selection and the Calculate button; the pink-red accent is reserved for the brand and red for danger. Light theme lifted slightly so the sidebar and viewer read as one surface
- Help describes the three-step flow

## [0.4.1] - 2026-09-18

### Changed
- Floor-plan editor: while drawing, each new wall shows its angle to the previous wall and snaps to 45° steps (Shift forces the nearest step, Alt frees the cursor); the toolbar is Rectangle / L / T / U presets then Draw / Finish / Cancel, and zoom (+ / −) and Fit live as controls on the canvas. Corner numbers in the vertex table are plain labels and the remove buttons are subtle until hovered; the modal has proper padding and never scrolls as a whole (the corner list scrolls instead, with Add corner staying put); Add corner splits the longest wall; +/−/Fit sit quietly in the canvas corner; and the modal has its own units switch

### Fixed
- Converting a polygon room whose outline didn't touch the axes back to a rectangle (e.g. by typing its four corners) produced a rectangle offset from the origin, so the room's Y extent came out wrong

## [0.4.0] - 2026-09-18

### Changed
- guv-calcs bumped to 0.7.3

### Added
- Polygon rooms: the room panel shows a floor-plan thumbnail and an "Edit floor plan…" button that opens a floor-plan editor. Draw an outline by clicking corners (each new wall shows its angle to the previous wall and snaps to 45° steps; Enter or clicking the first corner closes it), then drag corners or whole walls, add corners on a wall's + handle, or type exact coordinates; wall lengths and the floor area are shown live and changes only take effect on Apply. The canvas fits the outline, with scroll-wheel zoom, drag-to-pan, and +/−/Fit controls. The X / Y fields always show the room's overall extents; for a polygon room, changing one stretches the floor plan along that axis. In the 3D view the standard zones follow the outline (extruded outline wireframe, markers clipped to the floor plan) and the room's bounding box is drawn only as a faint reference. Lamps, zones, reflectance surfaces (walls are listed as Wall 1..n), lamp placement (downlight, corner, edge), the 3D view, save/load and unit switching all follow the outline. Standard zones are clipped to the outline, so results outside the room are neither computed nor shown. (guv-calcs 0.7.3: adds `Room.set_polygon`, carries wall reflectances across shape changes by edge, and rebuilds standard zones from the polygon.)

## [0.3.0] - 2026-09-01

### Changed
- Adding, moving, or editing a lamp that has no photometry yet no longer marks the calculation stale (Calculate button stays blue) — such a lamp can't affect any result. It turns red as soon as the lamp gets a preset or custom lamp definition. (guv-calcs 0.7.2)

### Fixed
- Selecting a preset for a lamp that had no photometry left the Calculate button blue (up to date) instead of red. The backend echoed `has_ies_file: false` for the just-configured lamp because it read the flag from the discarded pre-preset lamp object, so the frontend never registered the lamp as calculable

## [0.2.0] - 2026-07-29

### Added
- Custom lamp manager (Edit → Manage Custom Lamps): build reusable lamp definitions — IES photometry, spectrum, and product settings — and apply them to placed lamps from the "Select Lamp" dropdown, which lists built-in presets alongside your custom lamps for that lamp type. Definitions can stay with the project or persist in your browser, edits propagate to placed lamps, and loading a .guv file re-links its embedded custom lamps to your library by content instead of duplicating them.
- Warning before leaving the page with unsaved changes
- Calculation zone units and dose time are now editable straight from the Results panel: click the units to swap between µW/cm² and mJ/cm², or click the dose time to type a new duration ("1h 30m", "90m" and "1:30:00" all work)

### Changed
- Dose times now always display hours, minutes and seconds ("8h 0m 0s" rather than "8h")
- Photometry is now supplied by selecting a custom lamp definition. Every lamp type uses the same "Select Lamp" dropdown, and the lamp editor's inline IES/spectrum upload widgets are gone — uploads happen in the lamp manager.
- Zone and lamp IDs are now assigned by the app and are short and readable (`zone-1`, `lamp-1`) instead of long random strings. A zone keeps its identity when its type changes — type switches no longer recreate the zone under a new ID

### Fixed
- The luminous opening in the Lamp Fixture tab's 3D preview was drawn rotated 90 degrees, so it cut across the fixture housing instead of lying flat inside it
- CADR values in the pathogen efficacy data modal were ~35x too large in feet mode — room volume is now converted to cubic meters before the CADR math
- Edits could be lost, reordered, or corrupted under concurrency. Backend sync now runs through a serialized command queue backed by a per-session lock: rapid edits to the same lamp or zone keep their order and can't race a delete, concurrent requests can't corrupt each other's state, and edits made before session initialization finishes are queued and delivered once it's ready instead of vanishing. Transient "session busy" responses retry automatically; an edit attempted during a running calculation reports "session busy" rather than racing it.
- The 3D scene burned CPU/GPU continuously while idle: label billboards forced a full redraw on every animation frame, and calc plane zones rebuilt their marker mesh (2,500 points per standard zone in a default room) on every store update even in heatmap mode where markers are never drawn. Rendering is now driven by camera and scene changes, and the marker mesh is built only when markers are shown.
- Loading an old .guv file turned preset lamps into custom ones; lamps are now re-linked to the real preset by their saved display name, preserving placement, scaling and enabled state
- Changing a calc zone's type (plane/volume/point) could drop the click or leave the edit unsaved on slower connections
- Grid values (num_x/num_y/num_z and spacings) went stale after changing a calc zone's type
- `ref_surface` (xy/xz/yz) reset to 'xy' when standard zones were refreshed after room changes
- Only the first of multiple custom zones of the same type (e.g. two CalcPlanes) survived session init, due to an ID collision
- Lamp "Show Label" and "Show Photometric Web" toggles reverted when toggled quickly or under load
- New calc zones ignored saved minutes/seconds dose-time preferences — only hours carried over
- All Zod response schemas now pass through unknown keys, preventing silent data loss when the backend returns fields the frontend schema doesn't yet model
- API error responses no longer include internal exception details; validation messages still pass through

## [0.1.3] - 2026-04-08

### Fixed
- Loading .guv files now correctly restores directional/point zones (calc_mode, position, aim point, view_direction, etc. were silently dropped by incomplete Zod validation schema); adds the missing `aim_x`/`aim_y`/`aim_z` fields to `LoadedZoneSchema`

## [0.1.2] - 2026-04-07

No functional changes — version bump only.

## [0.1.1] - 2026-04-07

### Added
- Point-and-click position and aim point picking for lamps (matches calcpoint interface)
- App version displayed in status bar (`illuminate v0.1.x | guv-calcs 0.7.x`)
- Dynamic "How To Cite" citation with guv-calcs version
- Playwright e2e test suite (smoke, room, lamps, zones, calculate, save/load, mobile)
- Version-tagged Docker deployments with rollback support (`bash deploy.sh rollback <version>`)
- Auto-patch-bump on deploy when no release tag exists on HEAD

### Fixed
- IES file validation now accepts older LM-63-1986 format files, files with BOM, and leading blank lines (via guv-calcs bump)
- Calc zone editor no longer closes when switching between zone types (plane/volume/point)
- Value Display label now correctly shows "Fluence Rate" only for actual fluence calculations
- Zone update race condition from mutating `calc_zones` dict during iteration
- Zone update crashes, height tracking, and point calc_mode bugs
- `view_direction` / `view_target` mutual exclusivity conflict
- Point-and-click placement/aiming no longer opens scene objects underneath the click target
- CalcPoint3D marker uses sqrt-based scaling instead of linear, preventing oversized markers in large rooms
- Add missing `aim_x`/`aim_y`/`aim_z` fields to `SessionZoneState` backend schema
- Zone spacing/num_points display now always shows fresh backend values when toggling modes
- IES fixture test path now derived from installed guv_calcs package (portable across environments)
- Remove redundant `tuple()` wrapping for `view_direction`/`view_target` (guv_calcs handles conversion internally)
- Output schemas now use `tuple` for `view_direction`/`view_target` to match guv_calcs types

### Changed
- CI uses `--locked` for reproducible API dependency installs
- File upload tests re-enabled in CI

## [0.1.0] - 2026-03-24

Initial versioned release. Retroactive summary of features present at tagging.

### Added
- Room geometry editor with 2D polygon drawing
- Lamp placement with corner, edge, horizontal, and downlight modes
- Mass lamp operations: batch placement, aiming, and height adjustment
- Calculation volume (CalcVol) 3D visualization with isosurface rendering
- Zone statistics panel with fluence rate plots
- Session persistence via sessionStorage with auto-recovery
- Docker single-image production build
- Security headers middleware (CSP, X-Frame-Options, etc.)

### Dependencies
- guv_calcs == 0.6.5
