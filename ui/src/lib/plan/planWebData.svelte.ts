/**
 * Photometric-web vertices for the 2D view, fetched once per web (keyed as
 * the 3D view keys them, `photometricWebCacheKey`) and shared by every plan
 * pane. Reading is reactive: a pane asking for a web not yet loaded gets
 * null, and redraws when it arrives.
 */
import { SvelteMap } from 'svelte/reactivity';
import type { LampInstance } from '$lib/types/project';
import { getPhotometricWeb, getSessionLampPhotometricWeb } from '$lib/api/client';
import { photometricWebSource, photometricWebCacheKey } from '$lib/components/photometricWeb';
import type { LengthUnit } from '$lib/utils/unitConversion';

const MAX = 128;
/** Loaded vertices by web key; null when the fetch failed (not retried for that key). */
const cache = new SvelteMap<string, number[][] | null>();
const pending = new Set<string>();

async function load(key: string, lamp: LampInstance, units: LengthUnit) {
  try {
    const data = photometricWebSource(lamp) === 'preset'
      ? await getPhotometricWeb({
          preset_id: lamp.preset_id!,
          scaling_factor: lamp.scaling_factor,
          units,
          source_density: lamp.source_density,
          source_width: lamp.source_width,
          source_length: lamp.source_length,
        })
      : await getSessionLampPhotometricWeb(lamp.id);
    cache.set(key, data.vertices ?? null);
  } catch {
    cache.set(key, null);
  } finally {
    pending.delete(key);
    if (cache.size > MAX) {
      const first = cache.keys().next().value;
      if (first !== undefined) cache.delete(first);
    }
  }
}

/** The web's key and its vertices (null while loading, failed, or when the lamp has no photometry). */
export function planWebVertices(lamp: LampInstance, units: LengthUnit): { key: string; vertices: number[][] | null } {
  const key = photometricWebCacheKey(lamp, units);
  if (key === 'none') return { key, vertices: null };
  if (cache.has(key)) return { key, vertices: cache.get(key) ?? null };
  if (!pending.has(key)) {
    pending.add(key);
    // Out of the reactive read that asked for it
    queueMicrotask(() => load(key, lamp, units));
  }
  return { key, vertices: null };
}
