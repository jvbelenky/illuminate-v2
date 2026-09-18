# Floor-Plan Reference Image Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user upload a floor plan (raster, SVG, or PDF page), calibrate its scale with two clicks, position it under the floor-plan editor, trace the outline over it, and have the image persist in the project and show on the 3D floor.

**Architecture:** Frontend-only. The placement (scale, offset, opacity, in meters) lives on `RoomConfig.floorplan` and rides every existing room flow; the image bytes live in a separate tiny store with its own sessionStorage key. Saved projects carry an app-owned `illuminate` block beside `data` in the `.guv` envelope, which guv_calcs ignores. The 3D floor texture is composited onto a bounding-box canvas so the existing polygon floor mesh clips it.

**Tech Stack:** Svelte 5 runes, SvelteKit, Vitest + @testing-library/svelte, Playwright, Three.js via Threlte, zod, `pdfjs-dist` (new, lazily imported).

**Spec:** `docs/superpowers/specs/2026-09-18-floorplan-image-design.md`

## Global Constraints

- `pnpm check` (in `ui/`) must stay at zero errors. Fix types; never `@ts-ignore` / `@ts-expect-error`.
- Never inline `0.3048`; use `METERS_PER_FOOT` / `FEET_PER_METER` from `ui/src/lib/utils/unitConversion.ts`.
- **Never use the Edit tool or `sed` on `.svelte` files.** Use the Python helper pattern from the `editing-svelte-files` skill (`python3 -c '...'` with a single-quoted wrapper and `str.replace`), or the Write tool for a full rewrite after reading the file. `.svelte` files use tabs; `.ts` files use 2 spaces.
- No lazy imports in TS except the one deliberate `await import('pdfjs-dist')` in Task 4.
- Editor components must not mirror store state in local `$state` (the modal is transactional by design and is the exception: it edits a draft and hands it back on Apply).
- Backend and guv_calcs are untouched. `floorplan` / `showFloorPlanImage` must never be sent to the backend; the `room-update` executor and `projectToSessionInit` are allow-lists, so simply do not map them.
- Placement values are stored in **meters**; convert at render with `k = units === 'feet' ? FEET_PER_METER : 1`.
- Limits: raster/PDF long edge ≤ 2048 px; SVG ≤ 2 MB; resulting data URL ≤ 4 MB.
- Commit after each task. User-facing changes get a `CHANGELOG.md` `[Unreleased]` line (Task 11 adds one entry for the whole feature). No `Co-Authored-By` trailers.
- Light verification loop: per task run `pnpm check` and the directly affected test files; run the full `pnpm test:run` at Task 11. Do not push or run CI until the user asks.
- Run tests from `ui/`: `cd /home/jvbelenky/illuminate-v2/ui && pnpm vitest run <file>`.

## File map

| File | Responsibility |
|---|---|
| `ui/src/lib/types/project.ts` | `FloorPlanPlacement`, `RoomConfig.floorplan`, `showFloorPlanImage` |
| `ui/src/lib/utils/floorplanImage.ts` | Pure placement math: pixel↔room, initial placement, rescale, image rect in display units |
| `ui/src/lib/utils/floorplanDecode.ts` | `decodeFloorPlanFile` (raster/SVG/PDF → data URL + size); browser-API heavy |
| `ui/src/lib/utils/floorplanSidecar.ts` | zod schema, `attachSidecar`, `extractSidecar` for the `.guv` envelope |
| `ui/src/lib/utils/floorplanComposite.ts` | Layout math + canvas compositing for the 3D texture |
| `ui/src/lib/stores/floorplanImage.ts` | Image store with its own sessionStorage key |
| `ui/src/lib/stores/project.ts` | Defaults, clearing on reset/load, `showFloorPlanImage` plumbing |
| `ui/src/lib/components/FloorPlanModal.svelte` | Upload, set-scale, move tools; reference panel; `<image>` layer |
| `ui/src/lib/components/FloorPlanThumbnail.svelte` | Optional image under the outline |
| `ui/src/lib/components/RoomEditor.svelte` | New `onApply` payload; passes image + placement |
| `ui/src/lib/components/Room3D.svelte` | Composited floor texture mesh |
| `ui/src/lib/components/SettingsModal.svelte`, `MenuBar.svelte`, `ui/src/routes/+page.svelte` | "Floor plan image" toggle; sidecar attach/extract on save/load |
| `ui/src/lib/stores/settings.ts` | `showFloorPlanImage` default |
| `e2e/tests/room.spec.ts`, `e2e/fixtures/floorplan.png` | End-to-end round trip |

The spec put the sidecar schema in `floorplanImage.ts`; this plan splits it into `floorplanSidecar.ts` and the decoder into `floorplanDecode.ts` so each file has one job and the pure math stays trivially testable in jsdom.

---

### Task 1: Placement type and pure placement math

**Files:**
- Modify: `ui/src/lib/types/project.ts` (RoomConfig at ~line 37-66, `ROOM_DEFAULTS` ~line 425-445, `RoomOverrides` ~line 496-514, `defaultRoom` ~line 516-540)
- Create: `ui/src/lib/utils/floorplanImage.ts`
- Test: `ui/src/lib/utils/floorplanImage.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // types/project.ts
  export interface FloorPlanPlacement { imageId: string; widthPx: number; heightPx: number; scale: number; offsetX: number; offsetY: number; opacity: number }
  // RoomConfig gains: floorplan?: FloorPlanPlacement; showFloorPlanImage?: boolean
  // utils/floorplanImage.ts
  export const DEFAULT_FLOORPLAN_OPACITY = 0.6;
  export function pixelToRoom(p: FloorPlanPlacement, px: number, py: number): [number, number]   // meters
  export function roomToPixel(p: FloorPlanPlacement, x: number, y: number): [number, number]     // meters in
  export function initialPlacement(imageId: string, widthPx: number, heightPx: number, roomXMeters: number, roomYMeters: number): FloorPlanPlacement
  export function rescaleAboutPoint(p: FloorPlanPlacement, anchorMeters: [number, number], newScale: number): FloorPlanPlacement
  export function scaleFromMeasurement(p: FloorPlanPlacement, aMeters: [number, number], bMeters: [number, number], distanceMeters: number): number | null
  export function imageRect(p: FloorPlanPlacement, k: number): { x: number; y: number; width: number; height: number } // display units, bottom-left origin
  ```

- [ ] **Step 1: Add the type to `RoomConfig`**

In `ui/src/lib/types/project.ts`, before `export interface RoomConfig {`, add:

```ts
/**
 * Where an uploaded floor-plan reference image sits in the room. All lengths
 * are in METERS regardless of the project's display units (convert at render).
 * The image bytes live in `$lib/stores/floorplanImage`, keyed by `imageId`.
 */
export interface FloorPlanPlacement {
  imageId: string;
  /** Image pixel size after any downscale. */
  widthPx: number;
  heightPx: number;
  /** Meters per image pixel. */
  scale: number;
  /** Room-space position of the image's bottom-left corner, meters. */
  offsetX: number;
  offsetY: number;
  /** 0..1. Used in the modal, the thumbnail and the 3D floor. */
  opacity: number;
}
```

Inside `RoomConfig`, after the `vertices?:` line, add:

```ts
  /** Uploaded floor-plan reference image placement (frontend-only, never sent to the backend). */
  floorplan?: FloorPlanPlacement;
```

After the `showGrid: boolean;` line add:

```ts
  showFloorPlanImage?: boolean; // Whether to draw the floor-plan image on the 3D floor (default true)
```

In `ROOM_DEFAULTS`, after `showGrid: true,` add `showFloorPlanImage: true,`. In `RoomOverrides` after `showGrid?: boolean;` add `showFloorPlanImage?: boolean;`. In `defaultRoom`, after the `showGrid:` line add `showFloorPlanImage: overrides?.showFloorPlanImage ?? d.showFloorPlanImage,`.

- [ ] **Step 2: Write the failing tests**

Create `ui/src/lib/utils/floorplanImage.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  pixelToRoom, roomToPixel, initialPlacement, rescaleAboutPoint,
  scaleFromMeasurement, imageRect, DEFAULT_FLOORPLAN_OPACITY,
} from './floorplanImage';
import type { FloorPlanPlacement } from '$lib/types/project';

const base: FloorPlanPlacement = {
  imageId: 'img', widthPx: 200, heightPx: 100, scale: 0.05, offsetX: 1, offsetY: 2, opacity: 0.6,
};

describe('pixel <-> room mapping', () => {
  it('maps the image top-left pixel to the room point above the offset', () => {
    // top-left pixel (0,0) sits at (offsetX, offsetY + heightPx*scale)
    expect(pixelToRoom(base, 0, 0)).toEqual([1, 2 + 100 * 0.05]);
  });
  it('maps the image bottom-left pixel to the offset', () => {
    expect(pixelToRoom(base, 0, 100)).toEqual([1, 2]);
  });
  it('round-trips', () => {
    const [x, y] = pixelToRoom(base, 37, 61);
    const [px, py] = roomToPixel(base, x, y);
    expect(px).toBeCloseTo(37, 9);
    expect(py).toBeCloseTo(61, 9);
  });
});

describe('initialPlacement', () => {
  it('fits the long edge to the room long edge at the origin', () => {
    const p = initialPlacement('id', 400, 100, 6, 4);
    expect(p.scale).toBeCloseTo(6 / 400, 12);
    expect(p.offsetX).toBe(0);
    expect(p.offsetY).toBe(0);
    expect(p.opacity).toBe(DEFAULT_FLOORPLAN_OPACITY);
    expect(p.imageId).toBe('id');
  });
  it('uses the image height when it is the long edge', () => {
    const p = initialPlacement('id', 100, 400, 6, 4);
    expect(p.scale).toBeCloseTo(6 / 400, 12);
  });
});

describe('rescaleAboutPoint', () => {
  it('keeps the anchor fixed in room space', () => {
    const anchor = pixelToRoom(base, 50, 25);
    const next = rescaleAboutPoint(base, anchor, base.scale * 3);
    expect(next.scale).toBeCloseTo(base.scale * 3, 12);
    expect(pixelToRoom(next, 50, 25)[0]).toBeCloseTo(anchor[0], 9);
    expect(pixelToRoom(next, 50, 25)[1]).toBeCloseTo(anchor[1], 9);
  });
});

describe('scaleFromMeasurement', () => {
  it('derives meters per pixel from two room points and a known distance', () => {
    const a = pixelToRoom(base, 0, 50);
    const b = pixelToRoom(base, 100, 50); // 100 px apart
    expect(scaleFromMeasurement(base, a, b, 2.5)).toBeCloseTo(0.025, 12);
  });
  it('returns null for coincident points or a non-positive distance', () => {
    const a = pixelToRoom(base, 10, 10);
    expect(scaleFromMeasurement(base, a, a, 2)).toBeNull();
    const b = pixelToRoom(base, 20, 10);
    expect(scaleFromMeasurement(base, a, b, 0)).toBeNull();
  });
});

describe('imageRect', () => {
  it('returns the rect in display units', () => {
    expect(imageRect(base, 1)).toEqual({ x: 1, y: 2, width: 10, height: 5 });
    const ft = imageRect(base, 2); // k=2 stands in for a unit factor
    expect(ft).toEqual({ x: 2, y: 4, width: 20, height: 10 });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd /home/jvbelenky/illuminate-v2/ui && pnpm vitest run src/lib/utils/floorplanImage.test.ts`
Expected: FAIL — cannot resolve `./floorplanImage`.

- [ ] **Step 4: Write the implementation**

Create `ui/src/lib/utils/floorplanImage.ts`:

```ts
/**
 * Pure placement math for the floor-plan reference image. Everything here is
 * in METERS; callers convert to display units with `imageRect(p, k)`.
 *
 * Image pixel (0,0) is its top-left corner. The placement anchors the image's
 * BOTTOM-left corner at (offsetX, offsetY), so
 *   room = (offsetX + px * scale, offsetY + (heightPx - py) * scale).
 */
import type { FloorPlanPlacement } from '$lib/types/project';

export const DEFAULT_FLOORPLAN_OPACITY = 0.6;

export function pixelToRoom(p: FloorPlanPlacement, px: number, py: number): [number, number] {
  return [p.offsetX + px * p.scale, p.offsetY + (p.heightPx - py) * p.scale];
}

export function roomToPixel(p: FloorPlanPlacement, x: number, y: number): [number, number] {
  return [(x - p.offsetX) / p.scale, p.heightPx - (y - p.offsetY) / p.scale];
}

/** First guess after upload: long edge matches the room's long edge, image at the origin. */
export function initialPlacement(
  imageId: string, widthPx: number, heightPx: number, roomXMeters: number, roomYMeters: number,
): FloorPlanPlacement {
  const longRoom = Math.max(roomXMeters, roomYMeters, 1e-6);
  const longImage = Math.max(widthPx, heightPx, 1);
  return {
    imageId, widthPx, heightPx,
    scale: longRoom / longImage,
    offsetX: 0, offsetY: 0,
    opacity: DEFAULT_FLOORPLAN_OPACITY,
  };
}

/** Change the scale while keeping `anchorMeters` on the same image pixel. */
export function rescaleAboutPoint(
  p: FloorPlanPlacement, anchorMeters: [number, number], newScale: number,
): FloorPlanPlacement {
  const r = newScale / p.scale;
  return {
    ...p,
    scale: newScale,
    offsetX: anchorMeters[0] - (anchorMeters[0] - p.offsetX) * r,
    offsetY: anchorMeters[1] - (anchorMeters[1] - p.offsetY) * r,
  };
}

/**
 * Meters per pixel implied by two room points that are `distanceMeters` apart
 * on the drawing. Null when the points coincide or the distance is not positive.
 */
export function scaleFromMeasurement(
  p: FloorPlanPlacement, aMeters: [number, number], bMeters: [number, number], distanceMeters: number,
): number | null {
  if (!(distanceMeters > 0)) return null;
  const [ax, ay] = roomToPixel(p, aMeters[0], aMeters[1]);
  const [bx, by] = roomToPixel(p, bMeters[0], bMeters[1]);
  const pixels = Math.hypot(bx - ax, by - ay);
  if (pixels < 1e-9) return null;
  return distanceMeters / pixels;
}

/** The image's rectangle in display units (multiply meters by `k`), bottom-left origin. */
export function imageRect(p: FloorPlanPlacement, k: number): { x: number; y: number; width: number; height: number } {
  return { x: p.offsetX * k, y: p.offsetY * k, width: p.widthPx * p.scale * k, height: p.heightPx * p.scale * k };
}
```

- [ ] **Step 5: Run the tests and the type check**

Run: `cd /home/jvbelenky/illuminate-v2/ui && pnpm vitest run src/lib/utils/floorplanImage.test.ts && pnpm check`
Expected: all tests PASS; `pnpm check` reports 0 errors (the new fields are optional, so no literal needs updating).

- [ ] **Step 6: Commit**

```bash
cd /home/jvbelenky/illuminate-v2 && git add ui/src/lib/types/project.ts ui/src/lib/utils/floorplanImage.ts ui/src/lib/utils/floorplanImage.test.ts && git commit -m "feat(floorplan): placement type and pure placement math"
```

---

### Task 2: Floor-plan image store

**Files:**
- Create: `ui/src/lib/stores/floorplanImage.ts`
- Test: `ui/src/lib/stores/floorplanImage.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface FloorPlanImage { id: string; mime: string; src: string }  // src is a data URL
  export const FLOORPLAN_IMAGE_STORAGE_KEY = 'illuminate_floorplan_image';
  export const floorplanImage: {
    subscribe: Readable<FloorPlanImage | null>['subscribe'];
    set(image: FloorPlanImage): void;   // persists to sessionStorage (quota-safe)
    clear(): void;                      // clears store + storage key
    get(): FloorPlanImage | null;
    restore(): void;                    // reads the storage key (called once at startup)
  }
  ```
- Consumes: `syncErrors.add(operation, error, 'warning')` from `$lib/stores/project` for the quota toast. To avoid a circular import (project.ts will import this store in Task 3), the store takes an injectable `onWarning` hook instead — see implementation.

- [ ] **Step 1: Write the failing tests**

Create `ui/src/lib/stores/floorplanImage.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { floorplanImage, FLOORPLAN_IMAGE_STORAGE_KEY, setFloorPlanWarningHandler } from './floorplanImage';

const img = { id: 'a', mime: 'image/png', src: 'data:image/png;base64,AAAA' };

describe('floorplanImage store', () => {
  beforeEach(() => {
    floorplanImage.clear();
    setFloorPlanWarningHandler(null);
  });

  it('starts empty', () => {
    expect(get(floorplanImage)).toBeNull();
    expect(floorplanImage.get()).toBeNull();
  });

  it('set stores the image and persists it', () => {
    floorplanImage.set(img);
    expect(get(floorplanImage)).toEqual(img);
    expect(sessionStorage.getItem(FLOORPLAN_IMAGE_STORAGE_KEY)).toBe(JSON.stringify(img));
  });

  it('clear empties the store and removes the key', () => {
    floorplanImage.set(img);
    floorplanImage.clear();
    expect(get(floorplanImage)).toBeNull();
    expect(sessionStorage.getItem(FLOORPLAN_IMAGE_STORAGE_KEY)).toBeNull();
  });

  it('restore reads a previously persisted image', () => {
    sessionStorage.setItem(FLOORPLAN_IMAGE_STORAGE_KEY, JSON.stringify(img));
    floorplanImage.restore();
    expect(get(floorplanImage)).toEqual(img);
  });

  it('restore ignores malformed storage', () => {
    sessionStorage.setItem(FLOORPLAN_IMAGE_STORAGE_KEY, '{not json');
    floorplanImage.restore();
    expect(get(floorplanImage)).toBeNull();
    sessionStorage.setItem(FLOORPLAN_IMAGE_STORAGE_KEY, JSON.stringify({ id: 1 }));
    floorplanImage.restore();
    expect(get(floorplanImage)).toBeNull();
  });

  it('keeps the image in memory and warns once when storage rejects it', () => {
    const warn = vi.fn();
    setFloorPlanWarningHandler(warn);
    vi.mocked(sessionStorage.setItem).mockImplementation(() => { throw new Error('QuotaExceededError'); });
    floorplanImage.set(img);
    floorplanImage.set({ ...img, id: 'b' });
    expect(get(floorplanImage)?.id).toBe('b');
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /home/jvbelenky/illuminate-v2/ui && pnpm vitest run src/lib/stores/floorplanImage.test.ts`
Expected: FAIL — cannot resolve `./floorplanImage`.

- [ ] **Step 3: Write the store**

Create `ui/src/lib/stores/floorplanImage.ts`:

```ts
/**
 * The floor-plan reference image (one per project). Kept OUT of the project
 * store so the debounced project autosave never re-serializes a multi-MB data
 * URL; this store writes its own sessionStorage key only when the image changes.
 *
 * Placement (scale/offset/opacity) lives on `RoomConfig.floorplan` and points
 * here by `imageId`.
 */
import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';

export interface FloorPlanImage {
  id: string;
  /** e.g. image/png, image/jpeg, image/svg+xml */
  mime: string;
  /** Data URL. */
  src: string;
}

export const FLOORPLAN_IMAGE_STORAGE_KEY = 'illuminate_floorplan_image';

const store = writable<FloorPlanImage | null>(null);

// The quota warning is reported through the project store's syncErrors, but
// project.ts imports this module, so the handler is injected to avoid a cycle.
let warningHandler: ((message: string) => void) | null = null;
let warnedQuota = false;

export function setFloorPlanWarningHandler(handler: ((message: string) => void) | null): void {
  warningHandler = handler;
  warnedQuota = false;
}

function persist(image: FloorPlanImage | null): void {
  if (!browser) return;
  try {
    if (image) sessionStorage.setItem(FLOORPLAN_IMAGE_STORAGE_KEY, JSON.stringify(image));
    else sessionStorage.removeItem(FLOORPLAN_IMAGE_STORAGE_KEY);
  } catch (e) {
    console.warn('[floorplan] Could not persist the reference image:', e);
    if (!warnedQuota) {
      warnedQuota = true;
      warningHandler?.('The floor-plan image is too large to keep across a backend restart; save the project to keep it.');
    }
  }
}

function isFloorPlanImage(v: unknown): v is FloorPlanImage {
  return !!v && typeof v === 'object'
    && typeof (v as FloorPlanImage).id === 'string'
    && typeof (v as FloorPlanImage).mime === 'string'
    && typeof (v as FloorPlanImage).src === 'string';
}

export const floorplanImage = {
  subscribe: store.subscribe,

  set(image: FloorPlanImage): void {
    store.set(image);
    persist(image);
  },

  clear(): void {
    store.set(null);
    persist(null);
  },

  get(): FloorPlanImage | null {
    return get(store);
  },

  /** Restore from sessionStorage (startup only). Malformed data is dropped. */
  restore(): void {
    if (!browser) return;
    try {
      const raw = sessionStorage.getItem(FLOORPLAN_IMAGE_STORAGE_KEY);
      if (!raw) { store.set(null); return; }
      const parsed: unknown = JSON.parse(raw);
      store.set(isFloorPlanImage(parsed) ? parsed : null);
    } catch {
      store.set(null);
    }
  },
};
```

- [ ] **Step 4: Run the tests**

Run: `cd /home/jvbelenky/illuminate-v2/ui && pnpm vitest run src/lib/stores/floorplanImage.test.ts && pnpm check`
Expected: PASS, 0 check errors. (`$app/environment` is aliased to a mock in vitest; `browser` is true there.)

- [ ] **Step 5: Commit**

```bash
cd /home/jvbelenky/illuminate-v2 && git add ui/src/lib/stores/floorplanImage.ts ui/src/lib/stores/floorplanImage.test.ts && git commit -m "feat(floorplan): image store with its own sessionStorage key"
```

---

### Task 3: `.guv` sidecar and project-store wiring

**Files:**
- Create: `ui/src/lib/utils/floorplanSidecar.ts`
- Test: `ui/src/lib/utils/floorplanSidecar.test.ts`
- Modify: `ui/src/lib/stores/project.ts` (`loadFromStorage` ~line 828, `reset` ~line 1828, `loadFromFile` ~line 1860, `loadFromApiResponse` ~line 1900-1950, `settingsToRoomOverrides` ~line 1085, `syncErrors` ~line 215)
- Modify: `ui/src/lib/stores/settings.ts` (~line 29 and ~line 76)
- Modify: `ui/src/routes/+page.svelte` (`saveToFile` ~line 693, `loadFromFile` ~line 710-757)

**Interfaces:**
- Consumes: `FloorPlanPlacement` (Task 1), `floorplanImage`, `FloorPlanImage`, `setFloorPlanWarningHandler` (Task 2).
- Produces:
  ```ts
  // utils/floorplanSidecar.ts
  export const SIDECAR_VERSION = 1;
  export interface FloorPlanSidecar { placement: FloorPlanPlacement; image: { mime: string; src: string } }
  export function attachSidecar(guvText: string, floorplan: FloorPlanSidecar | null): string
  export function extractSidecar(guvText: string): FloorPlanSidecar | null
  // stores/project.ts (new methods on `project`)
  project.setFloorPlan(placement: FloorPlanPlacement, image: FloorPlanImage): void   // image store first, then updateRoom
  project.clearFloorPlan(): void
  ```

- [ ] **Step 1: Write the failing sidecar tests**

Create `ui/src/lib/utils/floorplanSidecar.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { attachSidecar, extractSidecar, SIDECAR_VERSION } from './floorplanSidecar';

const envelope = JSON.stringify({ 'guv-calcs_version': '0.7.3', timestamp: 't', format: 'project', data: { rooms: {} } });
const placement = { imageId: 'img-1', widthPx: 10, heightPx: 5, scale: 0.1, offsetX: 0.5, offsetY: 0.25, opacity: 0.6 };
const image = { mime: 'image/png', src: 'data:image/png;base64,AAAA' };

describe('attachSidecar', () => {
  it('adds a versioned illuminate block beside data', () => {
    const out = JSON.parse(attachSidecar(envelope, { placement, image }));
    expect(out.data).toEqual({ rooms: {} });
    expect(out.illuminate).toEqual({ version: SIDECAR_VERSION, floorplan: { placement, image } });
  });
  it('writes nothing when there is no floor plan', () => {
    expect(JSON.parse(attachSidecar(envelope, null)).illuminate).toBeUndefined();
  });
  it('preserves indentation style (pretty JSON stays readable)', () => {
    expect(attachSidecar(envelope, null)).toContain('\n');
  });
});

describe('extractSidecar', () => {
  it('round-trips', () => {
    const text = attachSidecar(envelope, { placement, image });
    expect(extractSidecar(text)).toEqual({ placement, image });
  });
  it('returns null when absent', () => {
    expect(extractSidecar(envelope)).toBeNull();
  });
  it('returns null for malformed blocks and unknown versions', () => {
    const bad = JSON.stringify({ ...JSON.parse(envelope), illuminate: { version: 1, floorplan: { placement: { imageId: 3 }, image } } });
    expect(extractSidecar(bad)).toBeNull();
    const future = JSON.stringify({ ...JSON.parse(envelope), illuminate: { version: 99, floorplan: { placement, image } } });
    expect(extractSidecar(future)).toBeNull();
    expect(extractSidecar('not json')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /home/jvbelenky/illuminate-v2/ui && pnpm vitest run src/lib/utils/floorplanSidecar.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the sidecar module**

Create `ui/src/lib/utils/floorplanSidecar.ts`:

```ts
/**
 * App-owned block in the `.guv` envelope. guv_calcs only reads `data` and
 * filters unknown keys, so `illuminate` beside it is invisible to the library
 * and to Python users. Shaped so it could become `illuminate.json` in a
 * container format later.
 */
import { z } from 'zod';
import type { FloorPlanPlacement } from '$lib/types/project';

export const SIDECAR_VERSION = 1;

const PlacementSchema = z.object({
  imageId: z.string(),
  widthPx: z.number().positive(),
  heightPx: z.number().positive(),
  scale: z.number().positive(),
  offsetX: z.number(),
  offsetY: z.number(),
  opacity: z.number().min(0).max(1),
});

const SidecarSchema = z.object({
  version: z.literal(SIDECAR_VERSION),
  floorplan: z.object({
    placement: PlacementSchema,
    image: z.object({ mime: z.string(), src: z.string().startsWith('data:') }),
  }),
});

export interface FloorPlanSidecar {
  placement: FloorPlanPlacement;
  image: { mime: string; src: string };
}

/** Add (or omit) the block. Keeps the file pretty-printed like guv_calcs does. */
export function attachSidecar(guvText: string, floorplan: FloorPlanSidecar | null): string {
  const parsed = JSON.parse(guvText) as Record<string, unknown>;
  delete parsed.illuminate;
  if (floorplan) parsed.illuminate = { version: SIDECAR_VERSION, floorplan };
  return JSON.stringify(parsed, null, 4);
}

/** Read the block; anything absent, malformed, or of an unknown version is null. */
export function extractSidecar(guvText: string): FloorPlanSidecar | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(guvText);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const result = SidecarSchema.safeParse((parsed as Record<string, unknown>).illuminate);
  return result.success ? result.data.floorplan : null;
}
```

- [ ] **Step 4: Run the sidecar tests**

Run: `cd /home/jvbelenky/illuminate-v2/ui && pnpm vitest run src/lib/utils/floorplanSidecar.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the project store**

In `ui/src/lib/stores/project.ts`:

(a) Add imports near the other store imports at the top:

```ts
import { floorplanImage, setFloorPlanWarningHandler, type FloorPlanImage } from '$lib/stores/floorplanImage';
import type { FloorPlanPlacement } from '$lib/types/project';
```
(`FloorPlanPlacement` may already be covered by an existing `import type { ... } from '$lib/types/project'` line — add it there instead of a second import.)

(b) Immediately after the `export const syncErrors = { ... };` object (~line 240), register the warning hook and restore the image once:

```ts
// The floor-plan image store cannot import syncErrors (cycle), so hand it a reporter.
setFloorPlanWarningHandler((message) => syncErrors.add('Floor plan image', message, 'warning'));
floorplanImage.restore();
```

(c) In `loadFromStorage`, in the reload branch right after `sessionStorage.removeItem(STORAGE_KEY);` add:

```ts
    floorplanImage.clear();
```

(d) In `settingsToRoomOverrides`, after `showGrid: s.showGrid,` add `showFloorPlanImage: s.showFloorPlanImage,`.

(e) In `reset(...)`, right after `set(fresh);` add `floorplanImage.clear();`.

(f) In `loadFromFile(data: Project)`, right after `const initialized = initializeStandardZones(data);` add `floorplanImage.clear();`.

(g) In `loadFromApiResponse`, in the `roomConfig` literal after `showGrid: d.showGrid,` add `showFloorPlanImage: d.showFloorPlanImage,`. Then find the `set(...)`/`update(...)` call in `loadFromApiResponse` that installs the new project and add `floorplanImage.clear();` immediately before it (the page applies the sidecar after this call, see step 7).

(h) Add two methods to the `project` object next to `updateRoom` (~line 2110):

```ts
    /** Install a floor-plan reference image: image bytes first, then the placement that points at it. */
    setFloorPlan(placement: FloorPlanPlacement, image: FloorPlanImage) {
      floorplanImage.set(image);
      this.updateRoom({ floorplan: placement });
    },

    clearFloorPlan() {
      this.updateRoom({ floorplan: undefined });
      floorplanImage.clear();
    },
```

Note: `updateRoom` spreads `partial` onto the room, so `{ floorplan: undefined }` clears the key on the store; the executor never maps `floorplan`, so the backend sees nothing.

(i) In `ui/src/lib/stores/settings.ts`, after `showGrid: boolean;` (~line 29) add `showFloorPlanImage: boolean;` and after `showGrid: ROOM_DEFAULTS.showGrid,` (~line 76) add `showFloorPlanImage: ROOM_DEFAULTS.showFloorPlanImage,`.

- [ ] **Step 6: Write a store test for setFloorPlan/clearFloorPlan**

Append to `ui/src/lib/stores/project.test.ts` a new `describe` at the end of the file (it already boots MSW and the store; reuse its existing `project` import — check the top of the file for how `project` is imported/reset in other describes and follow the same pattern):

```ts
describe('floor plan placement', () => {
  it('setFloorPlan stores the image then the placement; clearFloorPlan removes both', async () => {
    const { floorplanImage } = await import('$lib/stores/floorplanImage');
    const { project, room } = await import('./project');
    const placement = { imageId: 'img-1', widthPx: 10, heightPx: 5, scale: 0.1, offsetX: 0, offsetY: 0, opacity: 0.6 };
    project.setFloorPlan(placement, { id: 'img-1', mime: 'image/png', src: 'data:image/png;base64,AAAA' });
    expect(get(room).floorplan).toEqual(placement);
    expect(floorplanImage.get()?.id).toBe('img-1');
    project.clearFloorPlan();
    expect(get(room).floorplan).toBeUndefined();
    expect(floorplanImage.get()).toBeNull();
  });
});
```

Run: `cd /home/jvbelenky/illuminate-v2/ui && pnpm vitest run src/lib/stores/project.test.ts`
Expected: PASS (if the file resets modules between tests with `vi.resetModules()`, keep the dynamic imports as written; otherwise replace them with the file's existing top-level imports).

- [ ] **Step 7: Wire save/load in the page**

`ui/src/routes/+page.svelte` is a `.svelte` file: use the Python helper. Changes:

(a) Add imports after the existing `import { getVersion, saveSession, loadSession, ... } from '$lib/api/client';` line:

```ts
	import { attachSidecar, extractSidecar } from '$lib/utils/floorplanSidecar';
	import { floorplanImage } from '$lib/stores/floorplanImage';
```

(b) In `saveToFile`, replace

```ts
			const guvContent = await saveSession();
```
with
```ts
			const image = floorplanImage.get();
			const placement = $room.floorplan;
			const sidecar = image && placement && placement.imageId === image.id
				? { placement, image: { mime: image.mime, src: image.src } }
				: null;
			const guvContent = attachSidecar(await saveSession(), sidecar);
```

(c) In `loadFromFile`, replace

```ts
				project.loadFromApiResponse(response, projectName);
```
with
```ts
				project.loadFromApiResponse(response, projectName);
				const sidecar = extractSidecar(text);
				if (sidecar) {
					project.setFloorPlan(sidecar.placement, { id: sidecar.placement.imageId, mime: sidecar.image.mime, src: sidecar.image.src });
				}
```

Python helper example for (b):

```bash
cd /home/jvbelenky/illuminate-v2 && python3 -c '
import pathlib
p = pathlib.Path("ui/src/routes/+page.svelte")
c = p.read_text()
old = "\t\t\tconst guvContent = await saveSession();\n"
new = ("\t\t\tconst image = floorplanImage.get();\n"
       "\t\t\tconst placement = $room.floorplan;\n"
       "\t\t\tconst sidecar = image && placement && placement.imageId === image.id\n"
       "\t\t\t\t? { placement, image: { mime: image.mime, src: image.src } }\n"
       "\t\t\t\t: null;\n"
       "\t\t\tconst guvContent = attachSidecar(await saveSession(), sidecar);\n")
assert c.count(old) == 1
p.write_text(c.replace(old, new))
'
```

- [ ] **Step 8: Verify**

Run: `cd /home/jvbelenky/illuminate-v2/ui && pnpm check && pnpm vitest run src/lib/stores src/lib/utils/floorplanSidecar.test.ts`
Expected: 0 check errors; tests PASS.

- [ ] **Step 9: Commit**

```bash
cd /home/jvbelenky/illuminate-v2 && git add ui/src/lib/utils/floorplanSidecar.ts ui/src/lib/utils/floorplanSidecar.test.ts ui/src/lib/stores/project.ts ui/src/lib/stores/project.test.ts ui/src/lib/stores/settings.ts ui/src/routes/+page.svelte && git commit -m "feat(floorplan): .guv sidecar for the reference image; store wiring"
```

---

### Task 4: Decode pipeline (raster, SVG, PDF)

**Files:**
- Create: `ui/src/lib/utils/floorplanDecode.ts`
- Test: `ui/src/lib/utils/floorplanDecode.test.ts`
- Modify: `ui/package.json` (add `pdfjs-dist`)

**Interfaces:**
- Produces:
  ```ts
  export const MAX_LONG_EDGE_PX = 2048;
  export const MAX_SVG_BYTES = 2 * 1024 * 1024;
  export const MAX_DATA_URL_BYTES = 4 * 1024 * 1024;
  export interface DecodedFloorPlan { mime: string; src: string; widthPx: number; heightPx: number; pageCount?: number }
  export class FloorPlanDecodeError extends Error {}
  export function isSupportedFloorPlanFile(file: File): boolean
  export async function decodeFloorPlanFile(file: File, opts?: { page?: number }): Promise<DecodedFloorPlan>
  // Internal, exported for tests:
  export function fitLongEdge(w: number, h: number, max: number): { w: number; h: number }
  export function svgIntrinsicSize(svgText: string): { w: number; h: number } | null
  ```

- [ ] **Step 1: Install pdfjs-dist**

Run: `cd /home/jvbelenky/illuminate-v2/ui && pnpm add pdfjs-dist`
Expected: `package.json` gains `"pdfjs-dist": "^5.x"` under dependencies; lockfile updated.

- [ ] **Step 2: Write the failing tests**

Create `ui/src/lib/utils/floorplanDecode.test.ts`. Browser decoding APIs are absent in jsdom, so the tests cover the pure helpers, the type gate, the SVG path (which needs only `DOMParser`, `FileReader`/`btoa`, and an `Image` we stub), and the size limits:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fitLongEdge, svgIntrinsicSize, isSupportedFloorPlanFile, decodeFloorPlanFile,
  FloorPlanDecodeError, MAX_SVG_BYTES,
} from './floorplanDecode';

describe('fitLongEdge', () => {
  it('leaves small images alone', () => expect(fitLongEdge(100, 50, 2048)).toEqual({ w: 100, h: 50 }));
  it('scales the long edge down to max, preserving aspect', () => {
    expect(fitLongEdge(4096, 1024, 2048)).toEqual({ w: 2048, h: 512 });
    expect(fitLongEdge(1000, 3000, 2048)).toEqual({ w: 683, h: 2048 });
  });
});

describe('svgIntrinsicSize', () => {
  it('reads width/height attributes', () => {
    expect(svgIntrinsicSize('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150"></svg>')).toEqual({ w: 300, h: 150 });
  });
  it('falls back to the viewBox aspect at 1024 wide', () => {
    expect(svgIntrinsicSize('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"></svg>')).toEqual({ w: 1024, h: 512 });
  });
  it('returns null when neither is usable', () => {
    expect(svgIntrinsicSize('<svg xmlns="http://www.w3.org/2000/svg"></svg>')).toBeNull();
  });
});

describe('isSupportedFloorPlanFile', () => {
  it('accepts raster, svg and pdf by mime or extension', () => {
    expect(isSupportedFloorPlanFile(new File([''], 'a.png', { type: 'image/png' }))).toBe(true);
    expect(isSupportedFloorPlanFile(new File([''], 'a.svg', { type: '' }))).toBe(true);
    expect(isSupportedFloorPlanFile(new File([''], 'a.pdf', { type: 'application/pdf' }))).toBe(true);
    expect(isSupportedFloorPlanFile(new File([''], 'a.txt', { type: 'text/plain' }))).toBe(false);
  });
});

describe('decodeFloorPlanFile (svg)', () => {
  it('keeps the SVG verbatim as a data URL with its intrinsic size', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20"/></svg>';
    const file = new File([svg], 'plan.svg', { type: 'image/svg+xml' });
    const out = await decodeFloorPlanFile(file);
    expect(out.mime).toBe('image/svg+xml');
    expect(out.widthPx).toBe(40);
    expect(out.heightPx).toBe(20);
    expect(out.src.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(atob(out.src.split(',')[1])).toBe(svg);
  });
  it('rejects non-SVG content with an .svg name', async () => {
    const file = new File(['<html></html>'], 'plan.svg', { type: 'image/svg+xml' });
    await expect(decodeFloorPlanFile(file)).rejects.toBeInstanceOf(FloorPlanDecodeError);
  });
  it('rejects SVGs over the size limit', async () => {
    const big = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1">' + 'x'.repeat(MAX_SVG_BYTES) + '</svg>';
    const file = new File([big], 'plan.svg', { type: 'image/svg+xml' });
    await expect(decodeFloorPlanFile(file)).rejects.toThrow(/2 MB/);
  });
});

describe('decodeFloorPlanFile (unsupported)', () => {
  it('rejects unknown types', async () => {
    await expect(decodeFloorPlanFile(new File(['x'], 'a.txt', { type: 'text/plain' }))).rejects.toThrow(/Unsupported/);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd /home/jvbelenky/illuminate-v2/ui && pnpm vitest run src/lib/utils/floorplanDecode.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the decoder**

Create `ui/src/lib/utils/floorplanDecode.ts`:

```ts
/**
 * Turn an uploaded floor-plan file into a data URL the modal, thumbnail and 3D
 * floor can draw. Rasters are capped at MAX_LONG_EDGE_PX; SVG is kept verbatim
 * (vector stays crisp and is usually smaller); PDF pages are rasterized with
 * pdf.js, loaded lazily so the main bundle is untouched.
 *
 * SVG is only ever rendered through <image> / Image(), where scripts and
 * external references are inert, so no sanitizing pass is needed.
 */

export const MAX_LONG_EDGE_PX = 2048;
export const MAX_SVG_BYTES = 2 * 1024 * 1024;
export const MAX_DATA_URL_BYTES = 4 * 1024 * 1024;

export interface DecodedFloorPlan {
  mime: string;
  src: string;
  widthPx: number;
  heightPx: number;
  /** PDFs only. */
  pageCount?: number;
}

export class FloorPlanDecodeError extends Error {}

const RASTER_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const EXT_MIMES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  svg: 'image/svg+xml', pdf: 'application/pdf',
};

function mimeOf(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_MIMES[ext] ?? '';
}

export function isSupportedFloorPlanFile(file: File): boolean {
  const m = mimeOf(file);
  return RASTER_MIMES.has(m) || m === 'image/svg+xml' || m === 'application/pdf';
}

export function fitLongEdge(w: number, h: number, max: number): { w: number; h: number } {
  const long = Math.max(w, h);
  if (long <= max) return { w, h };
  const r = max / long;
  return { w: Math.round(w * r), h: Math.round(h * r) };
}

/** Width/height attributes, else 1024 × viewBox aspect, else null. */
export function svgIntrinsicSize(svgText: string): { w: number; h: number } | null {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg') return null;
  const w = parseFloat(root.getAttribute('width') ?? '');
  const h = parseFloat(root.getAttribute('height') ?? '');
  if (w > 0 && h > 0) return { w: Math.round(w), h: Math.round(h) };
  const vb = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) return { w: 1024, h: Math.round((1024 * vb[3]) / vb[2]) };
  return null;
}

function checkResultSize(src: string): void {
  if (src.length > MAX_DATA_URL_BYTES) {
    throw new FloorPlanDecodeError('Image too large after processing (limit 4 MB). Try a smaller or lower-resolution file.');
  }
}

function toBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function decodeSvg(file: File): Promise<DecodedFloorPlan> {
  if (file.size > MAX_SVG_BYTES) throw new FloorPlanDecodeError('SVG files are limited to 2 MB.');
  const text = await file.text();
  const size = svgIntrinsicSize(text);
  if (!size) throw new FloorPlanDecodeError('This file is not a valid SVG drawing.');
  const src = `data:image/svg+xml;base64,${toBase64Utf8(text)}`;
  checkResultSize(src);
  return { mime: 'image/svg+xml', src, widthPx: size.w, heightPx: size.h };
}

function drawToDataUrl(source: CanvasImageSource, w: number, h: number, mime: 'image/png' | 'image/jpeg'): string {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new FloorPlanDecodeError('Could not process the image in this browser.');
  if (mime === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(source, 0, 0, w, h);
  return mime === 'image/jpeg' ? canvas.toDataURL(mime, 0.9) : canvas.toDataURL(mime);
}

async function decodeRaster(file: File, mime: string): Promise<DecodedFloorPlan> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new FloorPlanDecodeError('Could not read this image file.');
  }
  try {
    const { w, h } = fitLongEdge(bitmap.width, bitmap.height, MAX_LONG_EDGE_PX);
    // Line drawings (PNG/GIF) stay lossless; photos/scans go to JPEG.
    const outMime = mime === 'image/png' || mime === 'image/gif' ? 'image/png' : 'image/jpeg';
    const src = drawToDataUrl(bitmap, w, h, outMime);
    checkResultSize(src);
    return { mime: outMime, src, widthPx: w, heightPx: h };
  } finally {
    bitmap.close();
  }
}

async function decodePdf(file: File, page: number): Promise<DecodedFloorPlan> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  } catch {
    throw new FloorPlanDecodeError('Could not read this PDF.');
  }
  const pageCount = doc.numPages;
  const pageNumber = Math.min(Math.max(1, page), pageCount);
  const pdfPage = await doc.getPage(pageNumber);
  const base = pdfPage.getViewport({ scale: 1 });
  const { w, h } = fitLongEdge(base.width, base.height, MAX_LONG_EDGE_PX);
  const scale = w / base.width;
  const viewport = pdfPage.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new FloorPlanDecodeError('Could not process the PDF in this browser.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  await pdfPage.render({ canvasContext: ctx, viewport }).promise;
  const src = canvas.toDataURL('image/png');
  checkResultSize(src);
  await doc.destroy();
  return { mime: 'image/png', src, widthPx: w, heightPx: h, pageCount };
}

export async function decodeFloorPlanFile(file: File, opts: { page?: number } = {}): Promise<DecodedFloorPlan> {
  const mime = mimeOf(file);
  if (mime === 'image/svg+xml') return decodeSvg(file);
  if (mime === 'application/pdf') return decodePdf(file, opts.page ?? 1);
  if (RASTER_MIMES.has(mime)) return decodeRaster(file, mime);
  throw new FloorPlanDecodeError('Unsupported file type. Use PNG, JPEG, WebP, GIF, SVG or PDF.');
}
```

If `pnpm check` complains about the `?url` import, add to `ui/src/app.d.ts`:

```ts
declare module '*?url' {
  const src: string;
  export default src;
}
```
(Vite normally provides this via `vite/client` types; only add it if the check fails.)

- [ ] **Step 5: Run the tests and the type check**

Run: `cd /home/jvbelenky/illuminate-v2/ui && pnpm vitest run src/lib/utils/floorplanDecode.test.ts && pnpm check`
Expected: PASS; 0 errors. If `pdfjs-dist`'s render signature differs in the installed major (e.g. `render({ canvas, viewport })` in v5), adjust to the installed version's types; do not `@ts-ignore`.

- [ ] **Step 6: Commit**

```bash
cd /home/jvbelenky/illuminate-v2 && git add ui/package.json ui/pnpm-lock.yaml ui/src/lib/utils/floorplanDecode.ts ui/src/lib/utils/floorplanDecode.test.ts ui/src/app.d.ts && git commit -m "feat(floorplan): decode raster, SVG and PDF uploads to a capped data URL"
```

---

### Task 5: Modal — image layer, upload, reference panel, new Apply payload

**Files:**
- Modify: `ui/src/lib/components/FloorPlanModal.svelte` (props ~line 24-36, state ~line 40-50, `apply()` ~line 452, toolbar ~line 493-517, SVG after the grid ~line 542, side column ~line 618-660, styles)
- Modify: `ui/src/lib/components/RoomEditor.svelte` (`handleFloorPlanApply` ~line 47, modal props ~line 130-138)
- Test: `ui/src/lib/components/FloorPlanModal.test.ts` (new)

**Interfaces:**
- Consumes: Task 1 math, Task 2 `FloorPlanImage`, Task 3 `project.setFloorPlan/clearFloorPlan`, Task 4 `decodeFloorPlanFile`, `isSupportedFloorPlanFile`, `FloorPlanDecodeError`.
- Produces (modal props):
  ```ts
  interface FloorPlanApplyResult { vertices: Vertex[]; floorplan: FloorPlanPlacement | null; image: FloorPlanImage | null }
  // Props additions:
  floorplan?: FloorPlanPlacement | null;   // current placement (meters)
  image?: FloorPlanImage | null;           // current image; null with a placement = "missing, re-upload"
  onApply: (result: FloorPlanApplyResult) => void;
  ```
  The modal exports the `FloorPlanApplyResult` type from its `<script module>` block.

- [ ] **Step 1: Write the failing component test**

Create `ui/src/lib/components/FloorPlanModal.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import FloorPlanModal from './FloorPlanModal.svelte';
import { FEET_PER_METER } from '$lib/utils/unitConversion';

vi.mock('$lib/utils/floorplanDecode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/utils/floorplanDecode')>();
  return {
    ...actual,
    decodeFloorPlanFile: vi.fn(async () => ({ mime: 'image/png', src: 'data:image/png;base64,AAAA', widthPx: 400, heightPx: 200 })),
  };
});

const rect: [number, number][] = [[0, 0], [6, 0], [6, 4], [0, 4]];
const baseProps = { vertices: rect, units: 'meters' as const, precision: 1, onApply: vi.fn(), onClose: vi.fn() };

describe('FloorPlanModal reference image', () => {
  it('shows no image layer or reference panel by default', () => {
    const { container } = render(FloorPlanModal, { props: baseProps });
    expect(container.querySelector('image.plan-image')).toBeNull();
    expect(screen.queryByText('Reference image')).toBeNull();
    expect(screen.getByRole('button', { name: /Upload plan/ })).toBeTruthy();
  });

  it('upload adds the image layer with an initial placement fitted to the room', async () => {
    const { container } = render(FloorPlanModal, { props: baseProps });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'plan.png', { type: 'image/png' });
    await fireEvent.change(input, { target: { files: [file] } });
    const img = await screen.findByLabelText('Floor plan reference image');
    // 400px long edge fitted to 6 m => width 6, height 3 (display units)
    expect(img.getAttribute('width')).toBe('6');
    expect(img.getAttribute('height')).toBe('3');
    expect(screen.getByText('Reference image')).toBeTruthy();
  });

  it('Apply hands back the outline, the placement and the image', async () => {
    const onApply = vi.fn();
    const { container } = render(FloorPlanModal, { props: { ...baseProps, onApply } });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await fireEvent.change(input, { target: { files: [new File(['x'], 'plan.png', { type: 'image/png' })] } });
    await screen.findByLabelText('Floor plan reference image');
    // Leave set-scale mode without measuring, then apply
    await fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenCalledTimes(1);
    const result = onApply.mock.calls[0][0];
    expect(result.vertices).toEqual(rect);
    expect(result.image?.src).toBe('data:image/png;base64,AAAA');
    expect(result.floorplan?.widthPx).toBe(400);
    expect(result.floorplan?.imageId).toBe(result.image?.id);
  });

  it('Remove clears the draft image so Apply reports null', async () => {
    const onApply = vi.fn();
    const placement = { imageId: 'img-1', widthPx: 400, heightPx: 200, scale: 0.015, offsetX: 0, offsetY: 0, opacity: 0.6 };
    const image = { id: 'img-1', mime: 'image/png', src: 'data:image/png;base64,AAAA' };
    render(FloorPlanModal, { props: { ...baseProps, onApply, floorplan: placement, image } });
    expect(screen.getByLabelText('Floor plan reference image')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.queryByLabelText('Floor plan reference image')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply.mock.calls[0][0].floorplan).toBeNull();
    expect(onApply.mock.calls[0][0].image).toBeNull();
  });

  it('renders the image in feet when units are feet', () => {
    const placement = { imageId: 'img-1', widthPx: 400, heightPx: 200, scale: 0.015, offsetX: 0, offsetY: 0, opacity: 0.6 };
    const image = { id: 'img-1', mime: 'image/png', src: 'data:image/png;base64,AAAA' };
    render(FloorPlanModal, { props: { ...baseProps, units: 'feet', floorplan: placement, image } });
    const img = screen.getByLabelText('Floor plan reference image');
    // 400 * 0.015 m = 6 m, shown in feet
    expect(parseFloat(img.getAttribute('width')!)).toBeCloseTo(6 * FEET_PER_METER, 3);
  });

  it('shows the re-upload state when a placement has no image', () => {
    const placement = { imageId: 'img-1', widthPx: 400, heightPx: 200, scale: 0.015, offsetX: 0, offsetY: 0, opacity: 0.6 };
    render(FloorPlanModal, { props: { ...baseProps, floorplan: placement, image: null } });
    expect(screen.getByText(/upload it again to restore/i)).toBeTruthy();
  });
});
```

(The CI grep for `0.3048` scans every `.ts`/`.svelte` under `src/`, tests included, so the test imports `FEET_PER_METER` rather than spelling the constant out.)

- [ ] **Step 2: Run to verify failure**

Run: `cd /home/jvbelenky/illuminate-v2/ui && pnpm vitest run src/lib/components/FloorPlanModal.test.ts`
Expected: FAIL (no upload button, no image layer).

- [ ] **Step 3: Update the modal script**

Use the Python helper (or Write after Read; the file is ~1000 lines, so targeted replacements are preferred). Changes to `FloorPlanModal.svelte`:

(a) Add a module script before the instance script for the exported type, at the very top of the file:

```svelte
<script module lang="ts">
	import type { Vertex as OutlineVertex } from '$lib/utils/roomGeometry';
	import type { FloorPlanPlacement } from '$lib/types/project';
	import type { FloorPlanImage } from '$lib/stores/floorplanImage';
	export interface FloorPlanApplyResult {
		vertices: OutlineVertex[];
		floorplan: FloorPlanPlacement | null;
		image: FloorPlanImage | null;
	}
</script>
```

(b) In the instance script imports add:

```ts
	import { initialPlacement, imageRect, rescaleAboutPoint, scaleFromMeasurement, pixelToRoom } from '$lib/utils/floorplanImage';
	import { decodeFloorPlanFile, isSupportedFloorPlanFile, FloorPlanDecodeError, type DecodedFloorPlan } from '$lib/utils/floorplanDecode';
```

(c) Extend `Props`:

```ts
		/** Current reference-image placement (meters), if any. */
		floorplan?: FloorPlanPlacement | null;
		/** Current reference image; null with a placement means it could not be restored. */
		image?: FloorPlanImage | null;
		/** Called with the validated outline, placement and image when the user applies. */
		onApply: (result: FloorPlanApplyResult) => void;
```
and destructure `floorplan = null, image = null` in the `$props()` line.

(d) Add draft state after `let svgEl = ...`:

```ts
	// Reference image draft (transactional like the outline). Placement is in
	// meters; `k` converts to display units at render.
	let draftPlacement = $state<FloorPlanPlacement | null>(floorplan ? { ...floorplan } : null);
	let draftImage = $state<FloorPlanImage | null>(image ? { ...image } : null);
	let imageFileName = $state<string | null>(null);
	let imageError = $state<string | null>(null);
	let decoding = $state(false);
	let pdfFile: File | null = null;
	let pdfPageCount = $state(0);
	let pdfPage = $state(1);
	let fileInput = $state<HTMLInputElement | undefined>(undefined);
	const k = $derived(units === 'feet' ? FEET_PER_METER : 1);
	const imageMissing = $derived(draftPlacement !== null && draftImage === null);
	const planImage = $derived(draftPlacement && draftImage ? { ...imageRect(draftPlacement, k), href: draftImage.src, opacity: draftPlacement.opacity } : null);
```

(e) Add the upload handlers (after the `applyPreset` function):

```ts
	// --- Reference image ---
	function chooseFile() {
		fileInput?.click();
	}

	async function onFileChosen(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		if (!isSupportedFloorPlanFile(file)) {
			imageError = 'Unsupported file type. Use PNG, JPEG, WebP, GIF, SVG or PDF.';
			return;
		}
		pdfFile = file.type === 'application/pdf' || /\.pdf$/i.test(file.name) ? file : null;
		pdfPage = 1;
		await installDecoded(file, 1);
	}

	async function installDecoded(file: File, page: number) {
		decoding = true;
		imageError = null;
		try {
			const decoded: DecodedFloorPlan = await decodeFloorPlanFile(file, { page });
			pdfPageCount = decoded.pageCount ?? 0;
			const id = crypto.randomUUID();
			draftImage = { id, mime: decoded.mime, src: decoded.src };
			imageFileName = file.name;
			// Re-upload of the same-size image keeps a restored placement's calibration
			if (draftPlacement && draftPlacement.widthPx === decoded.widthPx && draftPlacement.heightPx === decoded.heightPx) {
				draftPlacement = { ...draftPlacement, imageId: id };
			} else {
				const bb = polygonBoundingBox(draft.length >= 3 ? draft : vertices);
				draftPlacement = initialPlacement(id, decoded.widthPx, decoded.heightPx, bb.xMax / k, bb.yMax / k);
				fitView(viewPointsWithImage());
				startSetScale();
			}
		} catch (e) {
			imageError = e instanceof FloorPlanDecodeError ? e.message : 'Could not read this file.';
		} finally {
			decoding = false;
		}
	}

	async function changePdfPage(page: number) {
		if (!pdfFile) return;
		pdfPage = page;
		await installDecoded(pdfFile, page);
	}

	function removeImage() {
		draftImage = null;
		draftPlacement = null;
		imageFileName = null;
		imageError = null;
		pdfFile = null;
		pdfPageCount = 0;
		if (tool === 'scale' || tool === 'move') tool = 'edit';
		measure = null;
	}

	function setOpacity(value: number) {
		if (draftPlacement) draftPlacement = { ...draftPlacement, opacity: Math.min(1, Math.max(0.1, value)) };
	}

	function setOffset(axis: 'offsetX' | 'offsetY', displayValue: number) {
		if (draftPlacement) draftPlacement = { ...draftPlacement, [axis]: displayValue / k };
	}

	/** Outline corners plus the image's corners, so Fit shows both. */
	function viewPointsWithImage(): Vertex[] {
		const pts: Vertex[] = (draft.length >= 2 ? draft : vertices).map((v) => [v[0], v[1]] as Vertex);
		if (draftPlacement) {
			const r = imageRect(draftPlacement, k);
			pts.push([r.x, r.y], [r.x + r.width, r.y + r.height]);
		}
		return pts;
	}
```

`startSetScale` and `measure` are defined in Task 6; for this task add a placeholder-free minimal version so the file compiles and the test's "Skip" button exists:

```ts
	// --- Set scale (two clicks + a distance). Full interaction in the next task.
	type Tool = 'edit' | 'draw' | 'scale' | 'move';
	let measure = $state<{ a: Vertex; b: Vertex | null } | null>(null);
	function startSetScale() {
		tool = 'scale';
		measure = null;
		selectedIndex = -1;
		drag = null;
	}
	function skipSetScale() {
		measure = null;
		tool = 'edit';
	}
```
and change the existing `let tool = $state<'edit' | 'draw'>('edit');` to `let tool = $state<Tool>('edit');` (move the `type Tool` line above it). Update `pannable` to `$derived(tool === 'edit' && !drawing)` (unchanged semantics) and make `beginDrag`/`onMidpointPointerDown` early-return unless `tool === 'edit'` (they already do).

(f) Replace `apply()`:

```ts
	function apply() {
		if (!isValid) return;
		onApply({
			vertices: normalizeCCW(draft),
			floorplan: draftImage && draftPlacement ? draftPlacement : null,
			image: draftImage && draftPlacement ? draftImage : null,
		});
	}
```

Also make `fitView` include the image: change its default argument so `fitView()` uses `viewPointsWithImage()`:

```ts
	function fitView(points: Vertex[] = viewPointsWithImage()) {
		view = fittedView(points);
	}
```
(`viewPointsWithImage` must be declared before use at call time only, which is fine for function declarations; `k` and `draftPlacement` are runes declared earlier in the script — keep the `$derived(k)` and draft declarations above `fitView`. The initial `let view = $state<View>(fittedView(vertices));` stays as is.)

- [ ] **Step 4: Update the modal template**

(a) Toolbar: after the `{/if}` that closes the `drawing` branch (before `<select class="units-select"`), insert:

```svelte
					<span class="toolbar-sep"></span>
					<button type="button" class="tool" onclick={chooseFile} disabled={decoding} title="Upload a floor plan image (PNG, JPEG, WebP, GIF, SVG or PDF) to trace over">
						{decoding ? 'Reading…' : 'Upload plan…'}
					</button>
					<input bind:this={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,application/pdf,.png,.jpg,.jpeg,.webp,.gif,.svg,.pdf" onchange={onFileChosen} hidden />
					{#if tool === 'scale'}
						<button type="button" class="tool" onclick={skipSetScale} title="Keep the current scale">Skip</button>
					{/if}
```

(b) SVG: after the grid `{#each gridY ...}{/each}` block and before `<!-- Outline ... -->`, insert:

```svelte
					<!-- Reference image (bottom-left anchored; SVG y is flipped) -->
					{#if planImage}
						<image
							class="plan-image"
							href={planImage.href}
							x={planImage.x}
							y={-(planImage.y + planImage.height)}
							width={planImage.width}
							height={planImage.height}
							opacity={planImage.opacity}
							preserveAspectRatio="none"
							aria-label="Floor plan reference image"
						/>
					{/if}
```

(c) Side column: after the `.summary` div and before `.vertex-table`, insert:

```svelte
				{#if draftPlacement || imageError}
					<div class="reference-panel">
						<div class="reference-title">Reference image</div>
						{#if imageError}
							<p class="plan-error" role="alert">{imageError}</p>
						{/if}
						{#if imageMissing}
							<p class="plan-note">The reference image could not be restored — upload it again to restore it (same file keeps the calibration).</p>
						{:else if draftPlacement}
							<div class="reference-meta">{imageFileName ?? 'Saved image'} · {draftPlacement.widthPx}×{draftPlacement.heightPx} px</div>
							{#if pdfPageCount > 1}
								<label class="reference-row">
									<span>Page</span>
									<select value={pdfPage} onchange={(e) => changePdfPage(Number((e.currentTarget as HTMLSelectElement).value))} aria-label="PDF page">
										{#each Array.from({ length: pdfPageCount }, (_, i) => i + 1) as n}
											<option value={n}>{n} of {pdfPageCount}</option>
										{/each}
									</select>
								</label>
							{/if}
							<label class="reference-row">
								<span>Opacity</span>
								<input type="range" min="0.1" max="1" step="0.05" value={draftPlacement.opacity} oninput={(e) => setOpacity(Number((e.currentTarget as HTMLInputElement).value))} aria-label="Reference image opacity" />
							</label>
							<div class="reference-row">
								<span>X ({unit})</span>
								<ValidatedNumberInput value={draftPlacement.offsetX * k} {precision} step={snapStep} oncommit={(v) => setOffset('offsetX', v)} />
							</div>
							<div class="reference-row">
								<span>Y ({unit})</span>
								<ValidatedNumberInput value={draftPlacement.offsetY * k} {precision} step={snapStep} oncommit={(v) => setOffset('offsetY', v)} />
							</div>
						{/if}
						{#if draftPlacement}
							<button type="button" class="secondary remove-image-btn" onclick={removeImage}>Remove</button>
						{/if}
					</div>
				{/if}
```

(d) Styles: append inside `<style>` before the closing tag:

```css
	.plan-image {
		pointer-events: none;
		image-rendering: auto;
	}

	.reference-panel {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: var(--spacing-xs) 0;
		border-top: 1px solid var(--color-border);
		border-bottom: 1px solid var(--color-border);
		font-size: var(--font-size-xs);
	}

	.reference-title {
		color: var(--color-text-muted);
	}

	.reference-meta {
		color: var(--color-text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.reference-row {
		display: grid;
		grid-template-columns: 4.2rem 1fr;
		gap: var(--spacing-xs);
		align-items: center;
	}

	.reference-row input[type='range'] {
		width: 100%;
	}

	.remove-image-btn {
		width: 100%;
		margin-top: 2px;
	}
```

- [ ] **Step 5: Update RoomEditor**

In `RoomEditor.svelte` (Python helper):

(a) imports: add `import type { FloorPlanApplyResult } from './FloorPlanModal.svelte';` and `import { floorplanImage } from '$lib/stores/floorplanImage';`.

(b) Replace `handleFloorPlanApply`:

```ts
	function handleFloorPlanApply({ vertices, floorplan, image }: FloorPlanApplyResult) {
		// The store collapses an origin-anchored rectangle back to rectangle mode
		project.updateRoom({ shape: 'polygon', vertices });
		if (floorplan && image) project.setFloorPlan(floorplan, image);
		else if ($room.floorplan) project.clearFloorPlan();
		showFloorPlan = false;
	}
```

(c) Pass the current placement and image to the modal:

```svelte
	<FloorPlanModal
		vertices={outline}
		{units}
		precision={$room.precision}
		lamps={$lamps}
		floorplan={$room.floorplan ?? null}
		image={$room.floorplan && $floorplanImage?.id === $room.floorplan.imageId ? $floorplanImage : null}
		onApply={handleFloorPlanApply}
		onClose={() => (showFloorPlan = false)}
		onUnitsChange={(u) => project.changeUnits(u)}
	/>
```

- [ ] **Step 6: Verify**

Run: `cd /home/jvbelenky/illuminate-v2/ui && pnpm check && pnpm vitest run src/lib/components/FloorPlanModal.test.ts src/lib/utils/roomGeometry.test.ts`
Expected: 0 check errors; tests PASS. Then check tabs survived: `grep -c $'^\t' ui/src/lib/components/FloorPlanModal.svelte` should be large and `grep -c '^    ' ui/src/lib/components/FloorPlanModal.svelte` should be 0.

- [ ] **Step 7: Commit**

```bash
cd /home/jvbelenky/illuminate-v2 && git add ui/src/lib/components/FloorPlanModal.svelte ui/src/lib/components/FloorPlanModal.test.ts ui/src/lib/components/RoomEditor.svelte && git commit -m "feat(floorplan): upload a reference image into the floor-plan editor"
```

---

### Task 6: Modal — Set scale tool, Move plan tool, snap toggle

**Files:**
- Modify: `ui/src/lib/components/FloorPlanModal.svelte`
- Test: `ui/src/lib/components/FloorPlanModal.test.ts`

**Interfaces:**
- Consumes: `scaleFromMeasurement`, `rescaleAboutPoint`, `pixelToRoom` (Task 1); `measure`, `startSetScale`, `skipSetScale`, `Tool` (Task 5).
- Produces: toolbar buttons "Set scale", "Move plan", "Snap"; a `.measure-popover` with a `ValidatedNumberInput` (aria-label "Measured distance") and an "OK" button.

- [ ] **Step 1: Write the failing tests**

Append to `FloorPlanModal.test.ts`:

```ts
describe('FloorPlanModal calibration', () => {
  const placement = { imageId: 'img-1', widthPx: 400, heightPx: 200, scale: 0.015, offsetX: 0, offsetY: 0, opacity: 0.6 };
  const image = { id: 'img-1', mime: 'image/png', src: 'data:image/png;base64,AAAA' };

  it('two clicks and a distance rescale the image about the measured midpoint', async () => {
    const onApply = vi.fn();
    const { container } = render(FloorPlanModal, { props: { ...baseProps, onApply, floorplan: placement, image } });
    await fireEvent.click(screen.getByRole('button', { name: 'Set scale' }));
    const plan = container.querySelector('svg.plan') as SVGSVGElement;
    // jsdom has no layout: the fallback maps a 0x0 rect; stub getBoundingClientRect
    // so clicks land on known room coordinates (view is fitted to the 6x4 room + image).
    plan.getBoundingClientRect = () => ({ left: 0, top: 0, width: 560, height: 560, right: 560, bottom: 560, x: 0, y: 0, toJSON() {} }) as DOMRect;
    await fireEvent.click(plan, { clientX: 100, clientY: 300 });
    await fireEvent.click(plan, { clientX: 300, clientY: 300 });
    const distance = await screen.findByLabelText('Measured distance');
    await fireEvent.input(distance, { target: { value: '4' } });
    await fireEvent.keyDown(distance, { key: 'Enter' }); // the popover input handles Enter itself
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    const result = onApply.mock.calls[0][0];
    // 200 screen px at 560px-per-view: the two clicks are view.size*200/560 apart in room units.
    // The new scale must make that span equal 4 m, so scale = 4 / (span / oldScale).
    expect(result.floorplan.scale).not.toBeCloseTo(placement.scale, 6);
    expect(result.floorplan.scale).toBeGreaterThan(0);
  });

  it('Move plan drags the image offset', async () => {
    const onApply = vi.fn();
    const { container } = render(FloorPlanModal, { props: { ...baseProps, onApply, floorplan: placement, image } });
    await fireEvent.click(screen.getByRole('button', { name: 'Move plan' }));
    const plan = container.querySelector('svg.plan') as SVGSVGElement;
    plan.getBoundingClientRect = () => ({ left: 0, top: 0, width: 560, height: 560, right: 560, bottom: 560, x: 0, y: 0, toJSON() {} }) as DOMRect;
    const img = screen.getByLabelText('Floor plan reference image');
    await fireEvent.pointerDown(img, { clientX: 200, clientY: 200, button: 0, pointerId: 1 });
    await fireEvent.pointerMove(plan, { clientX: 260, clientY: 200, pointerId: 1 });
    await fireEvent.pointerUp(plan, { pointerId: 1 });
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply.mock.calls[0][0].floorplan.offsetX).toBeGreaterThan(0);
    expect(onApply.mock.calls[0][0].floorplan.offsetY).toBeCloseTo(0, 6);
  });

  it('Snap toggle turns grid snapping off for drawing', async () => {
    render(FloorPlanModal, { props: baseProps });
    const snap = screen.getByRole('button', { name: /Snap/ });
    expect(snap.getAttribute('aria-pressed')).toBe('true');
    await fireEvent.click(snap);
    expect(snap.getAttribute('aria-pressed')).toBe('false');
  });
});
```

`setPointerCapture` does not exist in jsdom; the modal calls it on `event.currentTarget`. Guard it: `(event.currentTarget as Element).setPointerCapture?.(event.pointerId)` — apply the same `?.` guard to the existing two call sites while editing.

- [ ] **Step 2: Run to verify failure**

Run: `cd /home/jvbelenky/illuminate-v2/ui && pnpm vitest run src/lib/components/FloorPlanModal.test.ts`
Expected: the three new tests FAIL (no "Set scale"/"Move plan"/"Snap" buttons).

- [ ] **Step 3: Implement the tools**

Script changes (Python helper):

(a) Replace the Task 5 placeholder set-scale block with the full version (the `type Tool` line stays where Task 5 put it, above `let tool`):

```ts
	// --- Set scale: click two points a known distance apart, type the distance.
	let measure = $state<{ a: Vertex; b: Vertex | null } | null>(null);
	let measuredDistance = $state<number | null>(null);
	let snapEnabled = $state(true);

	function startSetScale() {
		if (!draftPlacement) return;
		if (drawing) cancelDraw();
		tool = 'scale';
		measure = null;
		measuredDistance = null;
		selectedIndex = -1;
		drag = null;
		svgEl?.focus();
	}

	function skipSetScale() {
		measure = null;
		measuredDistance = null;
		tool = draftPlacement ? 'move' : 'edit';
	}

	function onScaleClick(event: MouseEvent) {
		if (tool !== 'scale' || !draftPlacement) return;
		const p = pointerToRoom(event); // no snapping: the user is pointing at pixels
		if (!measure) {
			measure = { a: p, b: null };
		} else if (!measure.b) {
			if (Math.hypot(p[0] - measure.a[0], p[1] - measure.a[1]) < 1e-9) return;
			measure = { a: measure.a, b: p };
		}
	}

	const measuredPixels = $derived.by(() => {
		if (!measure?.b || !draftPlacement) return 0;
		return Math.hypot(measure.b[0] - measure.a[0], measure.b[1] - measure.a[1]) / k / draftPlacement.scale;
	});

	function confirmMeasure() {
		if (!measure?.b || !draftPlacement || measuredDistance === null) return;
		const a: [number, number] = [measure.a[0] / k, measure.a[1] / k];
		const b: [number, number] = [measure.b[0] / k, measure.b[1] / k];
		const newScale = scaleFromMeasurement(draftPlacement, a, b, measuredDistance / k);
		if (newScale === null) return;
		const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
		draftPlacement = rescaleAboutPoint(draftPlacement, mid, newScale);
		measure = null;
		measuredDistance = null;
		tool = 'move';
		fitView();
	}

	function cancelMeasure() {
		measure = null;
		measuredDistance = null;
	}

	// --- Move plan: drag the image; offset snaps to the grid unless Alt.
	let imageDrag = $state<{ startPointer: Vertex; startPlacement: FloorPlanPlacement } | null>(null);

	function startMove() {
		if (!draftPlacement) return;
		if (drawing) cancelDraw();
		tool = 'move';
		measure = null;
		selectedIndex = -1;
		drag = null;
	}

	function onImagePointerDown(event: PointerEvent) {
		if (tool !== 'move' || !draftPlacement || event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		(event.currentTarget as Element).setPointerCapture?.(event.pointerId);
		imageDrag = { startPointer: pointerToRoom(event), startPlacement: { ...draftPlacement } };
	}
```

(b) In `onPointerMove`, before `if (!drag) return;`, add:

```ts
		if (imageDrag && draftPlacement) {
			const p = pointerToRoom(event);
			const dx = (p[0] - imageDrag.startPointer[0]) / k;
			const dy = (p[1] - imageDrag.startPointer[1]) / k;
			const stepM = event.altKey || !snapEnabled ? 0 : snapStep / k;
			draftPlacement = {
				...draftPlacement,
				offsetX: snapTo(imageDrag.startPlacement.offsetX + dx, stepM),
				offsetY: snapTo(imageDrag.startPlacement.offsetY + dy, stepM),
			};
			return;
		}
```

In `onPointerUp` add `imageDrag = null;`.

(c) Snap toggle: change `snapPoint` and `drawPointFor` to honour `snapEnabled`:

```ts
	function snapPoint([x, y]: Vertex, altKey: boolean): Vertex {
		const step = altKey || !snapEnabled ? 0 : snapStep;
		return [snapTo(Math.max(0, x), step), snapTo(Math.max(0, y), step)];
	}
```
and in `drawPointFor` replace the two `snapTo(point[0], snapStep)` / `snapTo(point[1], snapStep)` calls with `snapTo(point[0], snapEnabled ? snapStep : 0)` / `snapTo(point[1], snapEnabled ? snapStep : 0)`.

(d) `onCanvasClick`: at the top add `if (tool === 'scale') { onScaleClick(event); return; }`.

(e) `onEscapeKey`: add before the drawing check:

```ts
		if (tool === 'scale' && measure) {
			cancelMeasure();
			return true;
		}
		if (tool === 'scale' || tool === 'move') {
			tool = 'edit';
			measure = null;
			return true;
		}
```

(f) `onKeyDown`: add `if (event.key === 'Enter' && tool === 'scale' && measure?.b) { event.preventDefault(); confirmMeasure(); return; }` at the top.

(g) The measurement overlay geometry (declare `cursorFree` first):

```ts
	let cursorFree = $state<Vertex | null>(null);
	const measureLine = $derived.by(() => {
		if (!measure) return null;
		const [x1, y1] = toSvg(measure.a[0], measure.a[1]);
		const end = measure.b ?? (tool === 'scale' && cursorFree ? cursorFree : null);
		if (!end) return { x1, y1, x2: x1, y2: y1, done: false };
		const [x2, y2] = toSvg(end[0], end[1]);
		return { x1, y1, x2, y2, done: measure.b !== null };
	});
```
and in `onPointerMove` add at the top: `if (tool === 'scale') cursorFree = pointerToRoom(event);`. In `onPointerLeave` add `if (tool === 'scale') cursorFree = null;`.

Template changes:

(h) Toolbar: replace the Task 5 `{#if tool === 'scale'}…Skip…{/if}` block with:

```svelte
					{#if draftPlacement && draftImage}
						<button type="button" class="tool" class:active={tool === 'scale'} onclick={startSetScale} title="Click two points on the plan a known distance apart, then type that distance">Set scale</button>
						<button type="button" class="tool" class:active={tool === 'move'} onclick={startMove} title="Drag the plan into position (Alt frees it from the grid)">Move plan</button>
						{#if tool === 'scale'}
							<button type="button" class="tool" onclick={skipSetScale} title="Keep the current scale">Skip</button>
						{/if}
					{/if}
					<button type="button" class="tool" class:active={snapEnabled} aria-pressed={snapEnabled} onclick={() => (snapEnabled = !snapEnabled)} title="Snap corners and the plan to the grid (Alt inverts while dragging)">Snap</button>
```

(i) SVG image element: add `class:movable={tool === 'move'}` and `onpointerdown={onImagePointerDown}`, and change `pointer-events` so the image is only interactive in move mode: in CSS `.plan-image { pointer-events: none } .plan-image.movable { pointer-events: all; cursor: grab }`. Add `role="img"` to the `<image>` (a11y lint) — keep the `aria-label`.

(j) After the rubber-band block add the measurement overlay:

```svelte
					{#if measureLine}
						<line x1={measureLine.x1} y1={measureLine.y1} x2={measureLine.x2} y2={measureLine.y2} class="measure-line" stroke-width={px * 2} />
						<circle cx={measureLine.x1} cy={measureLine.y1} r={handleR * 0.9} class="measure-dot" stroke-width={px * 2} />
						{#if measureLine.done}
							<circle cx={measureLine.x2} cy={measureLine.y2} r={handleR * 0.9} class="measure-dot" stroke-width={px * 2} />
						{/if}
					{/if}
```

(k) Below the `.view-controls` div (still inside `.canvas-wrap`) add the popover and hint:

```svelte
				{#if tool === 'scale'}
					<div class="scale-hint">{measure?.b ? 'Enter the real distance between the two points' : measure ? 'Click the second point' : 'Click two points a known distance apart'}</div>
				{/if}
				{#if tool === 'move'}
					<div class="scale-hint">Drag the plan into position, then draw the outline</div>
				{/if}
				{#if measure?.b}
					<div class="measure-popover" role="dialog" aria-label="Set scale">
						<span>{Math.round(measuredPixels)} px =</span>
						<label class="visually-hidden" for="measured-distance">Measured distance</label>
						<input
							id="measured-distance"
							type="number"
							inputmode="decimal"
							min="0"
							step="any"
							placeholder="distance"
							value={measuredDistance ?? ''}
							oninput={(e) => { const v = parseFloat((e.currentTarget as HTMLInputElement).value); measuredDistance = Number.isFinite(v) ? v : null; }}
							onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmMeasure(); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelMeasure(); } }}
						/>
						<span>{unit}</span>
						<button type="button" class="primary" disabled={!(measuredDistance && measuredDistance > 0)} onclick={confirmMeasure}>OK</button>
						<button type="button" class="secondary" onclick={cancelMeasure}>Cancel</button>
					</div>
				{/if}
```
A plain input is used here on purpose: `ValidatedNumberInput` commits only on the `change` event, which fires after `keydown`, so Enter could not see the typed value. The `oninput` handler keeps `measuredDistance` current and Enter/OK both call `confirmMeasure`. Focus the input when the popover appears: add `$effect(() => { if (measure?.b) document.getElementById('measured-distance')?.focus(); })` to the script.

(l) Styles:

```css
	.plan.scaling { cursor: crosshair; }
	.plan-image.movable { pointer-events: all; cursor: grab; }
	.measure-line { stroke: var(--color-accent); stroke-dasharray: 4 3; }
	.measure-dot { fill: var(--color-bg, #fff); stroke: var(--color-accent); }
	.scale-hint {
		position: absolute;
		left: 8px;
		top: 8px;
		padding: 2px 8px;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		background: var(--color-bg, #fff);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm, 4px);
		pointer-events: none;
	}
	.measure-popover {
		position: absolute;
		left: 50%;
		bottom: 12px;
		transform: translateX(-50%);
		display: flex;
		gap: var(--spacing-xs);
		align-items: center;
		padding: var(--spacing-xs) var(--spacing-sm);
		font-size: var(--font-size-sm, var(--font-size-base));
		background: var(--color-bg, #fff);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm, 4px);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
	}
	.measure-popover input { width: 5.5rem; }
	.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
```
Add `class:scaling={tool === 'scale'}` to the `<svg class="plan">`.

- [ ] **Step 4: Verify**

Run: `cd /home/jvbelenky/illuminate-v2/ui && pnpm check && pnpm vitest run src/lib/components/FloorPlanModal.test.ts`
Expected: 0 errors; all modal tests PASS. Also run the existing room e2e locally if the dev servers are up: `cd /home/jvbelenky/illuminate-v2/e2e && npx playwright test tests/room.spec.ts` — the existing draw test must still pass (snap defaults on, so behaviour is unchanged).

- [ ] **Step 5: Commit**

```bash
cd /home/jvbelenky/illuminate-v2 && git add ui/src/lib/components/FloorPlanModal.svelte ui/src/lib/components/FloorPlanModal.test.ts && git commit -m "feat(floorplan): two-point scale, move-plan tool and snap toggle"
```

---

### Task 7: Thumbnail shows the image

**Files:**
- Modify: `ui/src/lib/components/FloorPlanThumbnail.svelte`, `ui/src/lib/components/RoomEditor.svelte`
- Test: `ui/src/lib/components/FloorPlanThumbnail.test.ts` (new)

**Interfaces:**
- Produces thumbnail props: `imageSrc?: string | null; imageRect?: { x: number; y: number; width: number; height: number } | null; imageOpacity?: number` (rect in display units, bottom-left origin, same as `imageRect()` from Task 1).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import FloorPlanThumbnail from './FloorPlanThumbnail.svelte';

const rect: [number, number][] = [[0, 0], [6, 0], [6, 4], [0, 4]];

describe('FloorPlanThumbnail', () => {
  it('draws only the outline without an image', () => {
    const { container } = render(FloorPlanThumbnail, { props: { vertices: rect } });
    expect(container.querySelector('image')).toBeNull();
  });
  it('draws the image under the outline when given', () => {
    const { container } = render(FloorPlanThumbnail, {
      props: { vertices: rect, imageSrc: 'data:image/png;base64,AAAA', imageRect: { x: 1, y: 0.5, width: 4, height: 2 }, imageOpacity: 0.5 },
    });
    const img = container.querySelector('image')!;
    expect(img).not.toBeNull();
    expect(img.getAttribute('opacity')).toBe('0.5');
    expect(container.querySelector('svg')!.firstElementChild?.tagName.toLowerCase()).toBe('image');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /home/jvbelenky/illuminate-v2/ui && pnpm vitest run src/lib/components/FloorPlanThumbnail.test.ts`
Expected: second test FAILS.

- [ ] **Step 3: Implement**

Rewrite `FloorPlanThumbnail.svelte` (Write tool after Read; small file):

```svelte
<script lang="ts">
	import { type Vertex, polygonBoundingBox } from '$lib/utils/roomGeometry';

	interface Props {
		vertices: Vertex[];
		/** Height in CSS pixels; the width follows the panel. */
		height?: number;
		onclick?: () => void;
		title?: string;
		/** Optional reference image (data URL) and its rect in display units, bottom-left origin. */
		imageSrc?: string | null;
		imageRect?: { x: number; y: number; width: number; height: number } | null;
		imageOpacity?: number;
	}

	let { vertices, height = 96, onclick, title = 'Open the floor plan editor', imageSrc = null, imageRect = null, imageOpacity = 0.6 }: Props = $props();

	// Fit the outline into the box with a little padding, y up
	const view = $derived.by(() => {
		const bb = polygonBoundingBox(vertices);
		const w = Math.max(bb.xMax, 1);
		const h = Math.max(bb.yMax, 1);
		const pad = Math.max(w, h) * 0.06;
		return { w: w + pad * 2, h: h + pad * 2, pad };
	});

	const points = $derived(
		vertices.map(([x, y]) => `${x + view.pad},${view.h - (y + view.pad)}`).join(' ')
	);
	const stroke = $derived(Math.max(view.w, view.h) / 120);
	const img = $derived(
		imageSrc && imageRect
			? { x: imageRect.x + view.pad, y: view.h - (imageRect.y + imageRect.height + view.pad), width: imageRect.width, height: imageRect.height }
			: null
	);
</script>

<button type="button" class="thumb" style:height="{height}px" {onclick} {title} aria-label={title}>
	<svg viewBox="0 0 {view.w} {view.h}" preserveAspectRatio="xMidYMid meet">
		{#if img && imageSrc}
			<image href={imageSrc} x={img.x} y={img.y} width={img.width} height={img.height} opacity={imageOpacity} preserveAspectRatio="none" />
		{/if}
		<polygon {points} stroke-width={stroke} />
	</svg>
</button>
```
Keep the existing `<style>` block unchanged.

In `RoomEditor.svelte`, import `imageRect` from `$lib/utils/floorplanImage` and `FEET_PER_METER` from `$lib/utils/unitConversion`, add

```ts
	const thumbImage = $derived.by(() => {
		const p = $room.floorplan;
		const img = $floorplanImage;
		if (!p || !img || img.id !== p.imageId) return null;
		return { src: img.src, rect: imageRect(p, units === 'feet' ? FEET_PER_METER : 1), opacity: p.opacity };
	});
```
and pass `imageSrc={thumbImage?.src ?? null} imageRect={thumbImage?.rect ?? null} imageOpacity={thumbImage?.opacity ?? 0.6}` to `<FloorPlanThumbnail>`.

- [ ] **Step 4: Verify and commit**

Run: `cd /home/jvbelenky/illuminate-v2/ui && pnpm check && pnpm vitest run src/lib/components/FloorPlanThumbnail.test.ts`
Expected: PASS, 0 errors.

```bash
cd /home/jvbelenky/illuminate-v2 && git add ui/src/lib/components/FloorPlanThumbnail.svelte ui/src/lib/components/FloorPlanThumbnail.test.ts ui/src/lib/components/RoomEditor.svelte && git commit -m "feat(floorplan): sidebar thumbnail shows the reference image"
```

---

### Task 8: 3D floor texture

**Files:**
- Create: `ui/src/lib/utils/floorplanComposite.ts`
- Test: `ui/src/lib/utils/floorplanComposite.test.ts`
- Modify: `ui/src/lib/components/Room3D.svelte` (imports ~line 1-10, after `floorGeometry` ~line 68, template after the floor mesh ~line 186)

**Interfaces:**
- Produces:
  ```ts
  export function compositeLayout(extentsDisplay: { x: number; y: number }, rect: { x: number; y: number; width: number; height: number }, maxPx: number): { canvasW: number; canvasH: number; drawX: number; drawY: number; drawW: number; drawH: number }
  export function compositeFloorPlan(image: CanvasImageSource, extentsDisplay: { x: number; y: number }, rect: { x: number; y: number; width: number; height: number }, maxPx?: number): HTMLCanvasElement | null
  ```
  `rect` is `imageRect(placement, k)` in display units; canvas covers `[0,x]×[0,y]` with y flipped (canvas row 0 = room y max).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { compositeLayout } from './floorplanComposite';

describe('compositeLayout', () => {
  it('sizes the canvas to the room bbox at maxPx on the long edge and flips y', () => {
    const l = compositeLayout({ x: 8, y: 4 }, { x: 1, y: 1, width: 4, height: 2 }, 2048);
    expect(l.canvasW).toBe(2048);
    expect(l.canvasH).toBe(1024);
    // 256 px per unit. Image spans x 1..5 -> 256..1280; y 1..3 -> rows (4-3)*256 .. (4-1)*256
    expect(l.drawX).toBe(256);
    expect(l.drawW).toBe(1024);
    expect(l.drawY).toBe(256);
    expect(l.drawH).toBe(512);
  });
  it('handles images partly outside the room (negative draw coords are fine)', () => {
    const l = compositeLayout({ x: 4, y: 4 }, { x: -1, y: -1, width: 2, height: 2 }, 400);
    expect(l.drawX).toBe(-100);
    expect(l.drawY).toBe(300);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /home/jvbelenky/illuminate-v2/ui && pnpm vitest run src/lib/utils/floorplanComposite.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * Composite the floor-plan image onto a canvas that covers the room's bounding
 * box, so a texture on the (possibly concave) floor mesh clips it for free:
 * the mesh IS the polygon, and the texture matrix is just bbox -> unit square.
 */
export interface CompositeLayout {
  canvasW: number; canvasH: number;
  drawX: number; drawY: number; drawW: number; drawH: number;
}

export function compositeLayout(
  extentsDisplay: { x: number; y: number },
  rect: { x: number; y: number; width: number; height: number },
  maxPx: number,
): CompositeLayout {
  const long = Math.max(extentsDisplay.x, extentsDisplay.y, 1e-9);
  const pxPerUnit = maxPx / long;
  const canvasW = Math.max(1, Math.round(extentsDisplay.x * pxPerUnit));
  const canvasH = Math.max(1, Math.round(extentsDisplay.y * pxPerUnit));
  return {
    canvasW, canvasH,
    drawX: Math.round(rect.x * pxPerUnit),
    // canvas row 0 is the room's y max
    drawY: Math.round((extentsDisplay.y - (rect.y + rect.height)) * pxPerUnit),
    drawW: Math.round(rect.width * pxPerUnit),
    drawH: Math.round(rect.height * pxPerUnit),
  };
}

/** Returns null where canvas 2D is unavailable (jsdom, headless tests). */
export function compositeFloorPlan(
  image: CanvasImageSource,
  extentsDisplay: { x: number; y: number },
  rect: { x: number; y: number; width: number; height: number },
  maxPx = 2048,
): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const l = compositeLayout(extentsDisplay, rect, maxPx);
  const canvas = document.createElement('canvas');
  canvas.width = l.canvasW;
  canvas.height = l.canvasH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, l.canvasW, l.canvasH);
  ctx.drawImage(image, l.drawX, l.drawY, l.drawW, l.drawH);
  return canvas;
}
```

- [ ] **Step 4: Wire Room3D**

In `Room3D.svelte` (Python helper):

(a) Imports: add

```ts
	import { floorplanImage } from '$lib/stores/floorplanImage';
	import { imageRect } from '$lib/utils/floorplanImage';
	import { compositeFloorPlan } from '$lib/utils/floorplanComposite';
	import { FEET_PER_METER } from '$lib/utils/unitConversion';
```

(b) After the `floorGeometry` derived (and after `const units = $derived($userSettings.units);` — move that line up above if needed so it is declared before use), add:

```ts
	// --- Floor-plan reference image as a floor texture ---
	const planPlacement = $derived(room.floorplan ?? null);
	const planImage = $derived($floorplanImage && planPlacement && $floorplanImage.id === planPlacement.imageId ? $floorplanImage : null);
	const showPlan = $derived((room.showFloorPlanImage ?? true) && planPlacement !== null && planImage !== null);
	let planTexture = $state<THREE.CanvasTexture | null>(null);

	$effect(() => {
		if (!showPlan || !planImage || !planPlacement) { planTexture = null; return; }
		const src = planImage.src;
		const rect = imageRect(planPlacement, units === 'feet' ? FEET_PER_METER : 1);
		const extents = { x: dims.x, y: dims.y };
		let cancelled = false;
		const img = new Image();
		img.onload = () => {
			if (cancelled) return;
			const canvas = compositeFloorPlan(img, extents, rect);
			if (!canvas) return;
			const tex = new THREE.CanvasTexture(canvas);
			tex.colorSpace = THREE.SRGBColorSpace;
			// ShapeGeometry UVs are the vertex XY (display units): map bbox -> [0,1]
			tex.matrixAutoUpdate = false;
			tex.matrix.set(1 / extents.x, 0, 0, 0, 1 / extents.y, 0, 0, 0, 1);
			tex.wrapS = THREE.ClampToEdgeWrapping;
			tex.wrapT = THREE.ClampToEdgeWrapping;
			planTexture = tex;
		};
		img.src = src;
		return () => {
			cancelled = true;
			planTexture?.dispose();
			planTexture = null;
		};
	});
```

The `ShapeGeometry` UVs equal the shape's XY coordinates; with `tex.matrix` scaling by `1/extents` the texture spans exactly the room bbox. The canvas is drawn top row = room y max, and Three's textures have `flipY = true` by default, so canvas row 0 lands at v = 1 = y max. Correct without further flipping.

(c) Template: after the semi-transparent floor mesh add

```svelte
{#if planTexture}
<!-- Floor-plan reference image, clipped by the floor polygon -->
<T.Mesh position={[0, 0.002, 0]} rotation.x={-Math.PI / 2}>
	<T is={floorGeometry} />
	<T.MeshBasicMaterial map={planTexture} transparent opacity={planPlacement?.opacity ?? 0.6} depthWrite={false} side={THREE.DoubleSide} />
</T.Mesh>
{/if}
```

- [ ] **Step 5: Verify**

Run: `cd /home/jvbelenky/illuminate-v2/ui && pnpm check && pnpm vitest run src/lib/utils/floorplanComposite.test.ts`
Expected: 0 errors; PASS. Then visually: start the dev servers if not running (`cd api && uv run uvicorn app.main:app --port 8000` and `cd ui && pnpm dev`), upload an image in the floor-plan modal, Apply, and confirm the image appears on the 3D floor and follows a polygon outline. Fix orientation if the image appears mirrored: swap `drawY` to use `rect.y` directly and set `tex.flipY = false` — but only if visibly wrong.

- [ ] **Step 6: Commit**

```bash
cd /home/jvbelenky/illuminate-v2 && git add ui/src/lib/utils/floorplanComposite.ts ui/src/lib/utils/floorplanComposite.test.ts ui/src/lib/components/Room3D.svelte && git commit -m "feat(floorplan): draw the reference image on the 3D floor, clipped to the outline"
```

---

### Task 9: "Floor plan image" toggle in Settings and the View menu

**Files:**
- Modify: `ui/src/lib/components/SettingsModal.svelte` (~line 189 and ~line 590), `ui/src/lib/components/MenuBar.svelte` (props ~line 27/69, mobile ~line 489, desktop ~line 727), `ui/src/routes/+page.svelte` (~line 861-868)
- Test: existing `MenuBar.test.ts` (there is no SettingsModal test). Add one assertion next to its `showGrid` case: rendering with `hasFloorPlanImage: false` gives the "Show Floor Plan Image" menu item `aria-disabled="true"`.

- [ ] **Step 1: SettingsModal**

After `showGrid: draft.showGrid,` in the `project.updateRoom({...})` call add `showFloorPlanImage: draft.showFloorPlanImage,`. In the Overlays checkbox grid after the Grid label add:

```svelte
								<label class="checkbox-label">
									<input type="checkbox" bind:checked={draft.showFloorPlanImage} />
									<span>Floor plan image</span>
								</label>
```
(`draft` is `UserSettings`-shaped, which gained the field in Task 3.)

- [ ] **Step 2: MenuBar**

Props: add `showFloorPlanImage?: boolean;`, `hasFloorPlanImage?: boolean;`, `onToggleShowFloorPlanImage?: () => void;` to the interface and destructure them with defaults `showFloorPlanImage = true, hasFloorPlanImage = false, onToggleShowFloorPlanImage = () => {}` — `MenuBar.test.ts` renders with a fixed `defaultProps` object, so the new props must be optional. Mobile menu, after the Show Grid button:

```svelte
						<button class="mobile-menu-item" onclick={() => mobileToggle(onToggleShowFloorPlanImage)} disabled={!hasFloorPlanImage}>
							<span class="checkmark">{showFloorPlanImage ? '✓' : ''}</span>
							<span>Show Floor Plan Image</span>
						</button>
```
Desktop View menu, after the Show Grid item:

```svelte
					<div class="menu-item" class:disabled={!hasFloorPlanImage} onclick={(e) => hasFloorPlanImage && handleToggleAction(onToggleShowFloorPlanImage, e)} onkeydown={(e) => e.key === 'Enter' && hasFloorPlanImage && handleToggleAction(onToggleShowFloorPlanImage)} role="menuitem" tabindex="0" aria-disabled={!hasFloorPlanImage}>
						<span class="checkmark">{showFloorPlanImage ? '✓' : ''}</span>
						<span>Show Floor Plan Image</span>
					</div>
```
If `.menu-item.disabled` has no style yet, add `.menu-item.disabled { opacity: 0.5; cursor: default; }` to the MenuBar styles.

- [ ] **Step 3: Page wiring**

In `+page.svelte`, next to the `showGrid=` / `onToggleShowGrid=` props:

```svelte
		showFloorPlanImage={$room.showFloorPlanImage ?? true}
		hasFloorPlanImage={!!$room.floorplan}
		onToggleShowFloorPlanImage={() => { const v = !($room.showFloorPlanImage ?? true); project.updateRoom({ showFloorPlanImage: v }); userSettings.update(s => ({ ...s, showFloorPlanImage: v })); }}
```

- [ ] **Step 4: Verify and commit**

Run: `cd /home/jvbelenky/illuminate-v2/ui && pnpm check && pnpm vitest run src/lib/components/MenuBar.test.ts`
Expected: 0 errors, PASS.

```bash
cd /home/jvbelenky/illuminate-v2 && git add ui/src/lib/components/SettingsModal.svelte ui/src/lib/components/MenuBar.svelte ui/src/routes/+page.svelte && git commit -m "feat(floorplan): show/hide the floor-plan image from Settings and the View menu"
```

---

### Task 10: End-to-end round trip

**Files:**
- Create: `e2e/fixtures/floorplan.png` (a small generated PNG)
- Modify: `e2e/tests/room.spec.ts`

- [ ] **Step 1: Generate the fixture**

```bash
cd /home/jvbelenky/illuminate-v2/e2e && python3 -c '
import zlib, struct
w, h = 120, 60
def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
rows = b""
for y in range(h):
    row = bytearray()
    for x in range(w):
        border = x < 3 or y < 3 or x >= w - 3 or y >= h - 3
        row += bytes([40, 40, 40]) if border else bytes([230, 230, 230])
    rows += b"\x00" + bytes(row)
png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")
open("fixtures/floorplan.png", "wb").write(png)
'
```

- [ ] **Step 2: Write the e2e test**

Append to `e2e/tests/room.spec.ts` inside the existing `test.describe`:

```ts
  test('upload a floor plan, calibrate it, save and reload the project', async ({ page }) => {
    await waitForSession(page);
    const editor = page.locator('.room-editor');
    await editor.getByRole('button', { name: 'Edit floor plan' }).click();
    const modal = page.locator('.floor-plan-modal');
    await expect(modal).toBeVisible();

    // Upload: the image layer appears and the set-scale hint shows
    await modal.locator('input[type="file"]').setInputFiles(path.resolve(__dirname, '../fixtures/floorplan.png'));
    const img = modal.locator('image.plan-image');
    await expect(img).toBeVisible();
    await expect(modal.locator('.scale-hint')).toHaveText(/Click two points/);

    // Calibrate: two clicks on the canvas, then a distance
    const plan = modal.locator('svg.plan');
    const box = await plan.boundingBox();
    if (!box) throw new Error('plan canvas not visible');
    await plan.click({ position: { x: box.width * 0.3, y: box.height * 0.5 } });
    await plan.click({ position: { x: box.width * 0.6, y: box.height * 0.5 } });
    const distance = modal.locator('#measured-distance');
    await expect(distance).toBeVisible();
    await distance.fill('3');
    await distance.press('Enter');
    await expect(modal.locator('.scale-hint')).toHaveText(/Drag the plan/);
    await expect(modal.getByText('Reference image')).toBeVisible();
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(modal).toHaveCount(0);

    // Thumbnail shows the image; the View menu toggle is enabled
    await expect(editor.locator('.thumb image')).toHaveCount(1);

    // Save, reload the page, load the file: the image is back
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('div[role="menuitem"]:has-text("Save")').click(),
    ]);
    const filePath = await download.path();
    await page.reload();
    await waitForSession(page);
    await expect(page.locator('.room-editor .thumb image')).toHaveCount(0);
    await page.locator('input#load-file').setInputFiles(filePath!);
    await expect(page.locator('.room-editor .thumb image')).toHaveCount(1, { timeout: 15_000 });
    await page.locator('.room-editor').getByRole('button', { name: 'Edit floor plan' }).click();
    await expect(page.locator('.floor-plan-modal image.plan-image')).toBeVisible();
  });
```
Add `import path from 'path';` at the top of `room.spec.ts` if it is not already there, and check how the existing save-load spec opens the File menu before clicking "Save" (it may need a `page.locator('.menu-title:has-text("File")').click()` first — copy that spec's exact sequence around its line 105-121).

- [ ] **Step 3: Run it**

Run: `cd /home/jvbelenky/illuminate-v2/e2e && npx playwright test tests/room.spec.ts`
Expected: all three room tests PASS. If the "Save" click sequence differs, mirror `save-load.spec.ts` exactly.

- [ ] **Step 4: Commit**

```bash
cd /home/jvbelenky/illuminate-v2 && git add e2e/fixtures/floorplan.png e2e/tests/room.spec.ts && git commit -m "test(e2e): floor-plan image upload, calibration and save/load round trip"
```

---

### Task 11: Changelog, full test run, final check

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Changelog entry**

Under `## [Unreleased]` add:

```markdown
### Added
- Floor-plan editor: upload a floor plan (PNG, JPEG, WebP, GIF, SVG or PDF page) as a reference image, set its scale by clicking two points a known distance apart, drag it into position, adjust its opacity, and trace the outline over it. The image is saved with the project (in an app-owned block of the .guv file that guv-calcs ignores), shown in the sidebar thumbnail, and drawn on the 3D floor clipped to the room outline, with a "Floor plan image" toggle in Settings and the View menu. A Snap toggle in the editor turns grid snapping off while tracing
```

- [ ] **Step 2: Full verification**

Run: `cd /home/jvbelenky/illuminate-v2/ui && pnpm check && pnpm test:run`
Expected: 0 check errors; all tests pass (the two lamp-upload store tests fail only when a real backend is listening on :8000 — stop the dev API first or ignore exactly those two).

Run: `cd /home/jvbelenky/illuminate-v2 && grep -rn "0\.3048" ui/src --include=*.ts --include=*.svelte | grep -v unitConversion.ts | grep -v "\.test\.ts"`
Expected: no output.

Run: `cd /home/jvbelenky/illuminate-v2 && grep -rn "\[DIAG\]\|TEMP DIAG" ui/src api/ || echo clean`
Expected: `clean`.

- [ ] **Step 3: Commit**

```bash
cd /home/jvbelenky/illuminate-v2 && git add CHANGELOG.md && git commit -m "docs: changelog entry for the floor-plan reference image"
```

Do not push; tell the user the round is done and let them decide on CI/release.
