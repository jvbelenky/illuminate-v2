# Floor-Plan Reference Image — Design

Date: 2026-09-18

## Goal

Let a user upload a floor plan (raster image, SVG, or PDF page), calibrate its scale
against a known dimension, position it under the floor-plan editor's canvas, and trace
the room outline over it. The image is saved with the project, restored on reload, and
shown as a translucent texture on the floor of the 3D view.

## Decisions (from the brainstorm)

| Question | Decision |
|---|---|
| Role of the file | Trace-over reference **and** persisted with the project |
| Where it persists | App-owned `illuminate` block in the `.guv` envelope; no guv_calcs change |
| New file type (`.illum`)? | No. One `.guv` stays the only file. The sidecar is shaped so it could become `illuminate.json` in a container later |
| 3D view | Yes: floor texture, clipped to the outline, with a show/hide toggle |
| File types | PNG, JPEG, WebP, GIF, SVG (kept as vector), PDF (rasterized on the client with pdf.js, lazily loaded) |
| Calibration | Two-point scale (click two points, type the distance) + drag to position |
| Image bytes | Separate small store, not on the room config (approach B) |

### Why the sidecar is safe

`guv_calcs.io.parse_guv_file` passes a dict straight through, `Project.from_dict`
filters to known constructor keys, and `Room.from_dict` uses `init_from_dict`, which
filters likewise. A sibling key beside `data` in the envelope is invisible to the library
and to Python users, who can keep calling `Project.load()` on the file unchanged. The
frontend already holds the raw JSON text on both `saveSession()` (returns text) and
`loadSession(rawJson)` (posts text), so the block can be added and stripped there.

## Data model

```ts
// ui/src/lib/types/project.ts
export interface FloorPlanPlacement {
  /** Key into the floor-plan image store. */
  imageId: string;
  /** Image pixel size after any downscale. */
  widthPx: number;
  heightPx: number;
  /** Meters per image pixel. */
  scale: number;
  /** Room-space position of the image's bottom-left corner, in meters. */
  offsetX: number;
  offsetY: number;
  /** 0..1, default 0.6. Used in the modal, the thumbnail and the 3D floor. */
  opacity: number;
}

// RoomConfig additions
floorplan?: FloorPlanPlacement;
showFloorPlanImage: boolean; // 3D toggle, frontend-only like showGrid; default true
```

- Placement is stored in **meters** regardless of the project's units and converted at
  render time with `METERS_PER_FOOT` / `FEET_PER_METER` from `unitConversion.ts`. The
  units-change flow is untouched.
- Pixel → room: `x = offsetX + px * scale`, `y = offsetY + (heightPx - py) * scale`
  (image origin is top-left; room y is up). Room → pixel is the inverse. Both live in a
  pure utility with tests.
- No rotation field. It can be added later; absent means 0.
- `floorplan` and `showFloorPlanImage` are **never** sent to the backend. The
  `room-update` executor in `stores/project.ts` is an allow-list, so nothing needs
  stripping; the fields simply aren't mapped. `projectToSessionInit` likewise.

### Image store

`ui/src/lib/stores/floorplanImage.ts` — a writable holding `null | { id, mime, src }`
where `src` is a data URL. API: `set(image)`, `clear()`, `get()`; `subscribe` for the
renderers. One image per project. The id is a fresh UUID minted on upload, and the
placement's `imageId` must match, so a stale placement (e.g. storage drift) is
detectable.

## Persistence

### sessionStorage

- Placement rides the existing project autosave (`saveToStorage`).
- The image store writes its own key (`illuminate-floorplan-image`) only when the image
  changes, in try/catch. If `setItem` throws (quota), one toast says the image will not
  survive a backend restart; the in-memory image stays and the session continues.
- `loadFromStorage` restores both. A placement whose image is missing is **kept**; the
  modal shows a "reference image not available — upload it again to restore" state and,
  if the re-uploaded file has the same `widthPx`/`heightPx`, reuses the placement
  (calibration is the expensive part). Otherwise the upload starts a fresh placement.
- The refresh-clears-storage rule applies to the image key too.

### `.guv` sidecar

Save (frontend, after `saveSession()` returns text):

```json
{
  "guv-calcs_version": "...", "timestamp": "...", "format": "project",
  "data": { ... },
  "illuminate": {
    "version": 1,
    "floorplan": {
      "placement": { "imageId": "...", "widthPx": 1800, "heightPx": 1200,
                     "scale": 0.0052, "offsetX": 0, "offsetY": 0, "opacity": 0.6 },
      "image": { "mime": "image/png", "src": "data:image/png;base64,..." }
    }
  }
}
```

- The block is only written when a placement and image exist.
- Load: the frontend parses the file text, pulls `illuminate` out (validated with a zod
  schema in `ui/src/lib/utils/floorplanImage.ts`, not the generated API contract, since
  it is not an API type), posts the text unchanged (the backend ignores the key), and
  after the load response sets the image store and the room's `floorplan` and
  `showFloorPlanImage`. Absent, malformed, or wrong-version block ⇒ no image, no error.
- `version` is the sidecar's own version. Bump on breaking shape changes; the loader
  ignores versions it does not know.

### Reset / new project / load

`reset()`, the new-project path, and `loadFromFile()` clear the image store before
applying the new state. The backend session and the reinit protocol never see the image.

## Floor-plan modal

The modal stays transactional. It gains a draft placement and a draft image next to the
draft outline. `onApply` becomes

```ts
onApply: (result: { vertices: Vertex[]; floorplan: FloorPlanPlacement | null; image: FloorPlanImage | null }) => void;
```

Apply commits all three in one `updateRoom` plus one image-store write (image first, so a
subscriber never sees a placement whose image is missing). Cancel discards everything,
including an upload made during the session.

### Toolbar

`[Presets…] | Draw outline | Upload plan… | Set scale | Move plan | Snap [on/off] | units`

- **Upload plan…** opens a file input (`accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,application/pdf"`).
- **Set scale** and **Move plan** are tools like `draw`, mutually exclusive with it, and
  only shown when a draft image exists.
- **Snap** toggles grid snapping globally for the modal (Alt still inverts it). Tracing
  makes holding Alt tedious. Defaults on.

### After upload

1. Image is placed with `offsetX = offsetY = 0` and `scale` chosen so the image's long
   edge equals the room's current bounding-box long edge.
2. The modal enters **Set scale** with the hint "Click two points a known distance
   apart". Clicks are not grid-snapped in this mode (the user is pointing at pixels).
3. After the second click a small popover anchored at the second point asks for the
   distance in the current units (`ValidatedNumberInput`, Enter confirms, Escape cancels
   the measurement, not the modal).
4. `scale = distanceMeters / pixelDistance`. The **midpoint of the two clicked points
   stays fixed in room space** (offset is recomputed), so the plan doesn't jump.
5. Tool switches to **Move plan** with the hint "Drag the plan into position, then draw
   the outline". Move drags the image; the offset snaps to the grid step unless Alt.

### Side column: "Reference image" panel

File name and pixel size; opacity slider (0.1–1); X/Y offset fields in display units;
for PDFs a page picker ("Page 2 of 5") that re-renders; **Remove** (clears draft image
and placement). Shown below the area summary and above the corner table; the corner
table keeps its scroll.

### Rendering

One SVG `<image href={src} x y width height opacity preserveAspectRatio="none">`
placed after the grid and before the outline, converted to display units at render.
While a measurement is in progress, the two points and the segment between them are
drawn in the accent colour with the pixel length shown until the distance is entered.
Set-scale and move tools use `cursor: crosshair` / `grab`.

`FloorPlanThumbnail` draws the same `<image>` under the outline when a placement and
image exist (gets two optional props).

## 3D floor texture

Three.js clipping planes are half-spaces and cannot express a concave outline, so the
image is **composited onto an offscreen canvas that covers the room's bounding box**
(`[0, room.x] × [0, room.y]` in display units), drawn at its placement, everything else
transparent. That canvas becomes a `THREE.CanvasTexture` on a second mesh that reuses the
existing `floorGeometry` (`ShapeGeometry` UVs are the vertex XY, so the texture matrix is
the bbox → unit-square scale). The polygon geometry clips the image for free.

- Recomposited in a `$derived` when the image, placement, or room extents change; long
  edge capped at 2048 px. Guarded so jsdom (no canvas 2D) skips it.
- Own `MeshBasicMaterial` (unlit, so the drawing reads as drawn), `transparent`,
  `opacity = placement.opacity`, `depthWrite = false`, positioned at `y = 0.002`, between
  the existing floor (`0.001`) and everything else.
- Visible when `room.showFloorPlanImage && room.floorplan && image`. Toggle added next to
  the grid toggle in `SettingsModal` and the View menu in `MenuBar`, disabled when there
  is no image.
- Texture is disposed when replaced.

## Upload pipeline

`ui/src/lib/utils/floorplanImage.ts`:

```ts
export interface DecodedFloorPlan { mime: string; src: string; widthPx: number; heightPx: number }
export async function decodeFloorPlanFile(file: File, opts?: { page?: number }): Promise<DecodedFloorPlan & { pageCount?: number }>;
```

- **Raster** (PNG, JPEG, WebP, GIF): `createImageBitmap`, downscale to ≤ 2048 px long
  edge on a canvas if larger; re-encode as PNG for PNG/GIF sources (line drawings) and
  JPEG at 0.9 otherwise.
- **SVG**: read as text, must parse via `DOMParser` to an `svg` root, ≤ 2 MB; stored
  verbatim as a `data:image/svg+xml;base64` URL. Pixel size from loading it into an
  `Image` (falls back to 1024 × viewBox aspect when the SVG has no intrinsic size).
  Rendered only ever through `<image>` / `Image`, never inlined into the DOM, so scripts
  and external references are inert.
- **PDF**: `pdfjs-dist` behind `await import(...)`, worker via Vite `?url`. Renders the
  chosen page (default 1) to PNG at the 2048 px cap. `pageCount` returned for the picker.
  The `File` is kept in the modal's memory while it is open for re-rendering; only the
  rendered PNG is stored.
- Result data URL > 4 MB ⇒ error "Image too large after processing (limit 4 MB)".
  Unsupported type and decode failures produce inline errors in the reference panel.

Dependency: `pdfjs-dist` (runtime). No other new packages.

## Error handling

| Situation | Behaviour |
|---|---|
| Unsupported file type / decode failure | Inline error in the reference panel; draft unchanged |
| Result over 4 MB | Inline error; draft unchanged |
| sessionStorage quota on image write | One toast; in-memory image kept |
| Restored placement with no image | Modal shows re-upload state; placement reused on size match |
| `.guv` sidecar missing / malformed / unknown version | Loaded without an image, silently |
| Two-point distance ≤ 0 or points coincide | Popover validation; measurement stays open |

## Testing

- **Unit** (`vitest`): pixel↔room mapping and two-point rescale keeping the midpoint
  fixed; sidecar attach/extract round trip incl. absent, malformed and future-version
  blocks; image store persistence with a mocked quota failure; `decodeFloorPlanFile` with
  tiny PNG/SVG fixtures, PDF path with `pdfjs-dist` mocked.
- **Component**: `FloorPlanModal` upload → set scale → apply yields the expected
  placement; cancel discards the upload; existing modal tests unchanged. `Room3D`
  compositing guarded so jsdom skips it.
- **e2e** (`e2e/`): extend the room spec — upload a small PNG, set the scale, apply,
  save the `.guv`, reload it, assert the image is back in the modal and the 3D toggle is
  enabled.
- No API changes, so `make generate-api` and the `contract` CI job are unaffected.
  `pnpm check` must stay at zero errors.

## Files

| File | Change |
|---|---|
| `ui/src/lib/types/project.ts` | `FloorPlanPlacement`, `RoomConfig.floorplan`, `showFloorPlanImage` |
| `ui/src/lib/stores/floorplanImage.ts` | new: image store + sessionStorage key |
| `ui/src/lib/stores/project.ts` | defaults, reset/load clearing, sidecar attach/extract in save/load, `showFloorPlanImage` in settings overrides |
| `ui/src/lib/utils/floorplanImage.ts` | new: decode pipeline, placement math, sidecar schema |
| `ui/src/lib/components/FloorPlanModal.svelte` | upload, set-scale, move tools; reference panel; `<image>` |
| `ui/src/lib/components/FloorPlanThumbnail.svelte` | optional image under the outline |
| `ui/src/lib/components/RoomEditor.svelte` | new `onApply` payload; pass image/placement |
| `ui/src/lib/components/Room3D.svelte` | composited floor texture mesh |
| `ui/src/lib/components/SettingsModal.svelte`, `MenuBar.svelte` | "Floor plan image" toggle |
| `ui/package.json` | `pdfjs-dist` |
| `CHANGELOG.md` | Unreleased entry |

## Out of scope

- **Rotation of the reference image** (deliberate first-cut decision, 2026-09-18). Skewed
  scans will fight the draw tool's 45° wall snapping, so this is the likely first
  follow-up. Planned shape when it lands: a `rotationDeg` placement field about the
  image's bottom-left anchor (absent ⇒ 0, so v1 sidecars stay valid), an "Align this line
  with the X/Y axis" option in the set-scale popover, a numeric field in the reference
  panel, an SVG `transform` on the `<image>`, and `ctx.rotate` in the 3D compositing.
- Multiple images; automatic outline extraction from vector files; storing the original
  PDF; a `.illum` container format (see decisions).
