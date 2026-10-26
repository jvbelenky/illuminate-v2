/**
 * Which items show their name label (structures for now). Frontend-only: kept
 * in the project store, the autosave, the undo snapshot and the `.guv`
 * sidecar, never sent to the backend. Absent until a label is on.
 */
import { z } from 'zod';
import type { LabelSet } from '$lib/types/project';

const MAX_LABEL_IDS = 10000;

export const LabelSetSchema = z.object({
  objects: z.array(z.string().max(200)).max(MAX_LABEL_IDS).default([]),
});

/** ``labels`` with ``id`` turned on or off; undefined once no label is on. */
export function withLabel(labels: LabelSet | undefined, kind: keyof LabelSet, id: string, on: boolean): LabelSet | undefined {
  const rest = (labels?.[kind] ?? []).filter((x) => x !== id);
  const next: LabelSet = { objects: labels?.objects ?? [] };
  next[kind] = on ? [...rest, id] : rest;
  return next.objects.length ? next : undefined;
}

/** A loaded label set (file or autosave), keeping only ids of items that exist; undefined when none is left or it is malformed. */
export function parseLabels(raw: unknown, exists: { objects: { id: string }[] }): LabelSet | undefined {
  const result = LabelSetSchema.safeParse(raw);
  if (!result.success) return undefined;
  const ids = new Set(exists.objects.map((o) => o.id));
  const objects = [...new Set(result.data.objects)].filter((id) => ids.has(id));
  return objects.length ? { objects } : undefined;
}
