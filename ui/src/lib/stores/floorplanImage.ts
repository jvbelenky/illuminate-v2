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
