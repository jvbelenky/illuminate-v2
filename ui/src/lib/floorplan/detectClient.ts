/**
 * Run auto-detect (outline and interior walls) in a Web Worker: on a plan of
 * about 1000 px it takes 150–400 ms, too long for the main thread. Where
 * workers are unavailable (tests, a worker that fails to load) it runs inline.
 */
import type { DetectMode, DetectOptions } from './autoDetect';
import { detectPlan, type PlanDetectResult } from './interiorWalls';

export interface DetectRequest {
  id: number;
  width: number;
  height: number;
  /** RGBA pixels, row-major. */
  data: Uint8ClampedArray;
  mode: DetectMode;
  opts: DetectOptions;
}

export type DetectReply = { id: number; result: PlanDetectResult } | { id: number; error: string };

let worker: Worker | null = null;
let broken = false;
let nextId = 1;
const pending = new Map<number, { resolve: (r: PlanDetectResult) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (broken || typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./detect.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    broken = true;
    return null;
  }
  worker.onmessage = (e: MessageEvent<DetectReply>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if ('error' in e.data) p.reject(new Error(e.data.error));
    else p.resolve(e.data.result);
  };
  worker.onerror = () => {
    // The worker could not run: everything waiting fails, later calls run inline
    broken = true;
    worker?.terminate();
    worker = null;
    for (const p of pending.values()) p.reject(new Error('detect worker failed'));
    pending.clear();
  };
  return worker;
}

/** The outline and interior walls of an RGBA raster, in its pixels. The pixels are copied to the worker, so a failed worker can fall back inline. */
export function detectPlanAsync(
  img: { width: number; height: number; data: Uint8ClampedArray },
  mode: DetectMode,
  opts: DetectOptions = {},
): Promise<PlanDetectResult> {
  const w = getWorker();
  if (!w) return Promise.resolve().then(() => detectPlan({ ...img, channels: 4 }, mode, opts));
  const id = nextId++;
  return new Promise<PlanDetectResult>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const msg: DetectRequest = { id, width: img.width, height: img.height, data: img.data, mode, opts };
    w.postMessage(msg);
  }).catch(() => detectPlan({ ...img, channels: 4 }, mode, opts));
}
