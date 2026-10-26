/**
 * App-owned block in the `.guv` envelope. guv_calcs only reads `data` and
 * filters unknown keys, so `illuminate` beside it is invisible to the library
 * and to Python users. Shaped so it could become `illuminate.json` in a
 * container format later.
 */
import { z } from 'zod';
import type { FloorPlanPlacement, HiddenItems, LampStick, ReportMeta, ZonePlotSettings } from '$lib/types/project';
import { LampStickMapSchema } from './lampSticking';
import { CeilingLayoutSchema, type CeilingLayout } from '$lib/ceiling/ceilingLayout';

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

const PlotSettingsSchema = z.object({
  view: z.enum(['heatmap', 'contours', 'iso']).optional(),
  levelsSource: z.enum(['auto', 'limits', 'pct-icnirp', 'pct-acgih-eye', 'pct-acgih-skin', 'custom']).optional(),
  levelCount: z.number().int().min(1).max(10).optional(),
  levels: z.array(z.number()).optional(),
  colors: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable()).optional(),
  labels: z.array(z.string().max(60).nullable()).optional(),
  filled: z.boolean().optional(),
  showValues: z.boolean().optional(),
  title: z.string().max(200).optional(),
  decimals: z.number().int().min(0).max(6).optional(),
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
  // A bad plots entry drops the plot settings, not the floor plan beside them
  plots: z.record(z.string(), PlotSettingsSchema).optional().catch(undefined),
  // Likewise a bad ceiling layout drops only itself
  ceilingLayout: CeilingLayoutSchema.optional().catch(undefined),
  // Stick to ceiling / wall by lamp id; a bad entry drops only itself
  lamps: LampStickMapSchema.optional().catch(undefined),
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
 * output. When it isn't strict JSON, the block is spliced into the text.
 */
export function attachSidecar(
  guvText: string,
  floorplan: FloorPlanSidecar | null,
  report: ReportMeta | null = null,
  hidden: HiddenItems | null = null,
  plots: Record<string, ZonePlotSettings> | null = null,
  ceilingLayout: CeilingLayout | null = null,
  lamps: Record<string, LampStick> | null = null,
): string {
  if (hidden && !hidden.lamps.length && !hidden.zones.length && !hidden.objects.length) hidden = null;
  if (plots && !Object.keys(plots).length) plots = null;
  if (lamps && !Object.keys(lamps).length) lamps = null;
  const block = floorplan || report || hidden || plots || ceilingLayout || lamps
    ? {
      version: SIDECAR_VERSION,
      ...(floorplan ? { floorplan } : {}),
      ...(report ? { report } : {}),
      ...(hidden ? { hidden } : {}),
      ...(plots ? { plots } : {}),
      ...(ceilingLayout ? { ceilingLayout } : {}),
      ...(lamps ? { lamps } : {}),
    }
    : null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(guvText) as Record<string, unknown>;
  } catch {
    // Not strict JSON (Python's bare NaN): splice the block into the text as is
    if (!block) return guvText;
    return spliceBlock(guvText, block);
  }
  delete parsed.illuminate;
  if (block) parsed.illuminate = block;
  return JSON.stringify(parsed, null, 4);
}

/**
 * Where a top-level `"illuminate": {...}` entry sits in an object's text, with
 * the comma that joins it to its neighbour, found by scanning (so the rest of
 * the text never has to be strict JSON). Null when there is none.
 */
function findBlock(text: string): { start: number; end: number; value: string } | null {
  let depth = 0;
  let lastComma = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      const close = endOfString(text, i);
      if (close < 0) return null;
      if (depth === 1 && text.slice(i, close + 1) === '"illuminate"') {
        let j = close + 1;
        while (j < text.length && /\s/.test(text[j])) j++;
        if (text[j] !== ':') { i = close; continue; }
        j++;
        while (j < text.length && /\s/.test(text[j])) j++;
        if (text[j] !== '{') return null;
        const valueEnd = endOfObject(text, j);
        if (valueEnd < 0) return null;
        // Take one joining comma: the one before, or else the one after
        let start = i, end = valueEnd + 1;
        if (lastComma >= 0 && text.slice(lastComma + 1, i).trim() === '') start = lastComma;
        else {
          let k = end;
          while (k < text.length && /\s/.test(text[k])) k++;
          if (text[k] === ',') end = k + 1;
        }
        return { start, end, value: text.slice(j, valueEnd + 1) };
      }
      i = close;
    } else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
    else if (ch === ',' && depth === 1) lastComma = i;
  }
  return null;
}

/** Index of the quote closing the string that opens at `i`; -1 if unterminated. */
function endOfString(text: string, i: number): number {
  for (let j = i + 1; j < text.length; j++) {
    if (text[j] === '\\') j++;
    else if (text[j] === '"') return j;
  }
  return -1;
}

/** Index of the brace closing the object that opens at `i`; -1 if unbalanced. */
function endOfObject(text: string, i: number): number {
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    const ch = text[j];
    if (ch === '"') {
      j = endOfString(text, j);
      if (j < 0) return -1;
    } else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

/** The text with its top-level `illuminate` entry replaced by `block`. */
function spliceBlock(text: string, block: object): string {
  const found = findBlock(text);
  const base = found ? text.slice(0, found.start) + text.slice(found.end) : text;
  const close = base.lastIndexOf('}');
  const open = base.indexOf('{');
  if (close < 0 || open < 0 || close < open) throw new Error('Could not attach the app data (floor plan, report details, ceiling layout) to this file.');
  const body = base.slice(open + 1, close).trimEnd();
  const entry = `"illuminate": ${JSON.stringify(block, null, 4).replace(/\n/g, '\n    ')}`;
  return `${base.slice(0, open + 1)}${body}${body.trim() ? ',' : ''}\n    ${entry}\n${base.slice(close)}`;
}

/** The envelope without the app-owned block; returns the input unchanged if it isn't JSON or has no block. */
export function stripSidecar(guvText: string): string {
  try {
    const parsed = JSON.parse(guvText) as Record<string, unknown>;
    if (!('illuminate' in parsed)) return guvText;
    delete parsed.illuminate;
    return JSON.stringify(parsed, null, 4);
  } catch {
    const found = findBlock(guvText);
    return found ? guvText.slice(0, found.start) + guvText.slice(found.end) : guvText;
  }
}

/** The validated block; null when absent, malformed, or of an unknown version. */
function readBlock(guvText: string): z.infer<typeof SidecarSchema> | null {
  let raw: unknown;
  try {
    const parsed = JSON.parse(guvText);
    if (!parsed || typeof parsed !== 'object') return null;
    raw = (parsed as Record<string, unknown>).illuminate;
  } catch {
    // Not strict JSON (bare NaN from the backend): the block itself still is
    const found = findBlock(guvText);
    if (!found) return null;
    try {
      raw = JSON.parse(found.value);
    } catch {
      return null;
    }
  }
  const result = SidecarSchema.safeParse(raw);
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

/** Read the per-zone plot settings from the block; null when absent or malformed. */
export function extractPlotSettings(guvText: string): Record<string, ZonePlotSettings> | null {
  return readBlock(guvText)?.plots ?? null;
}

/** Read the ceiling designer's layout from the block; null when absent or malformed. */
export function extractCeilingLayout(guvText: string): CeilingLayout | null {
  return (readBlock(guvText)?.ceilingLayout as CeilingLayout | undefined) ?? null;
}

/** Read each lamp's stick state by id from the block; null when absent or malformed. */
export function extractLampSticking(guvText: string): Record<string, LampStick> | null {
  return readBlock(guvText)?.lamps ?? null;
}
