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
