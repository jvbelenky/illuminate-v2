/**
 * App-owned block in the `.guv` envelope. guv_calcs only reads `data` and
 * filters unknown keys, so `illuminate` beside it is invisible to the library
 * and to Python users. Shaped so it could become `illuminate.json` in a
 * container format later.
 */
import { z } from 'zod';
import type { FloorPlanPlacement, HiddenItems, ReportMeta } from '$lib/types/project';

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

const ReportSchema = z.object({
  title: z.string(),
  client: z.string(),
  prepared_by: z.string(),
  notes: z.string(),
});

const HiddenSchema = z.object({
  lamps: z.array(z.string()).default([]),
  zones: z.array(z.string()).default([]),
  objects: z.array(z.string()).default([]),
});

const SidecarSchema = z.object({
  version: z.literal(SIDECAR_VERSION),
  floorplan: z.object({
    placement: PlacementSchema,
    image: z.object({
      mime: z.string(),
      src: z.string().regex(/^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,/),
    }),
  }).optional(),
  report: ReportSchema.optional(),
  hidden: HiddenSchema.optional(),
});

export interface FloorPlanSidecar {
  placement: FloorPlanPlacement;
  image: { mime: string; src: string };
}

/**
 * Add (or omit) the block. Keeps the file pretty-printed like guv_calcs does.
 *
 * With no floor plan this is a pure pass-through: guv_calcs writes its JSON with
 * Python's `json.dumps`, which emits bare `NaN` — legal there, a `SyntaxError`
 * for `JSON.parse` — so saving must never depend on re-parsing the backend's
 * output. Only a save that actually has an image to attach can fail.
 */
export function attachSidecar(
  guvText: string,
  floorplan: FloorPlanSidecar | null,
  report: ReportMeta | null = null,
  hidden: HiddenItems | null = null,
): string {
  if (hidden && !hidden.lamps.length && !hidden.zones.length && !hidden.objects.length) hidden = null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(guvText) as Record<string, unknown>;
  } catch {
    // Hidden items are a view setting, not worth failing a save over
    if (!floorplan && !report) return guvText;
    throw new Error('Could not attach the floor-plan image to this file.');
  }
  delete parsed.illuminate;
  if (floorplan || report || hidden) {
    parsed.illuminate = {
      version: SIDECAR_VERSION,
      ...(floorplan ? { floorplan } : {}),
      ...(report ? { report } : {}),
      ...(hidden ? { hidden } : {}),
    };
  }
  return JSON.stringify(parsed, null, 4);
}

/** The envelope without the app-owned block; returns the input unchanged if it isn't JSON or has no block. */
export function stripSidecar(guvText: string): string {
  try {
    const parsed = JSON.parse(guvText) as Record<string, unknown>;
    if (!('illuminate' in parsed)) return guvText;
    delete parsed.illuminate;
    return JSON.stringify(parsed, null, 4);
  } catch {
    return guvText;
  }
}

/** The validated block; null when absent, malformed, or of an unknown version. */
function readBlock(guvText: string): z.infer<typeof SidecarSchema> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(guvText);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const result = SidecarSchema.safeParse((parsed as Record<string, unknown>).illuminate);
  return result.success ? result.data : null;
}

/** Read the floor plan from the block; null when absent or malformed. */
export function extractSidecar(guvText: string): FloorPlanSidecar | null {
  return readBlock(guvText)?.floorplan ?? null;
}

/** Read the report details from the block; null when absent or malformed. */
export function extractReportMeta(guvText: string): ReportMeta | null {
  return readBlock(guvText)?.report ?? null;
}

/** Read the hidden item ids from the block; null when absent or malformed. */
export function extractHidden(guvText: string): HiddenItems | null {
  return readBlock(guvText)?.hidden ?? null;
}
