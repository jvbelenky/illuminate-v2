/**
 * The worker entry point, fed what the import window sends for the user's
 * bedroom plan (user report: "auto-detect still fails"). The seeds and scales
 * are the ones the real window posted (recorded from Chromium): the scale set
 * on the 152" bottom wall in inches, in meters (the unit left at its default)
 * and in feet; and the 90° turned frame.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { decodePng } from '$lib/test/decodePng';
import type { DetectReply, DetectRequest } from './detectClient';
import type { Pt } from './autoDetect';
import type { PlanDetectResult } from './interiorWalls';

const png = decodePng('src/lib/test/fixtures/user-bedroom-plan.png');

/** The plan turned 90° (the window's ⟲ 90°): input (x, y) lands at (y, W - x). */
function turned(): { width: number; height: number; data: Uint8ClampedArray } {
  const W = png.width, H = png.height;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let Y = 0; Y < W; Y++) for (let X = 0; X < H; X++) {
    const sx = W - 1 - Y, sy = X;
    const s = (sy * W + sx) * 4, d = (Y * H + X) * 4;
    for (let c = 0; c < 4; c++) data[d + c] = png.data[s + c];
  }
  return { width: H, height: W, data };
}

let handler: (e: MessageEvent<DetectRequest>) => void;
const posted: DetectReply[] = [];

beforeAll(async () => {
  await import('./detect.worker');
  handler = self.onmessage as typeof handler;
});
beforeEach(() => {
  vi.spyOn(self, 'postMessage').mockImplementation(((m: DetectReply) => { posted.push(m); }) as typeof self.postMessage);
});
afterEach(() => {
  posted.length = 0;
  vi.restoreAllMocks();
});

function run(req: Omit<DetectRequest, 'id'>): PlanDetectResult {
  handler({ data: { id: 1, ...req } } as MessageEvent<DetectRequest>);
  const reply = posted.pop()!;
  if ('error' in reply) throw new Error(reply.error);
  return reply.result;
}

/** The eight inner-face corners in the window's raster (plain frame). */
const FACES: Pt[] = [[80, 162], [336, 162], [336, 269], [717, 269], [717, 166], [914, 166], [914, 535], [80, 535]];

function expectBedroom({ outline, walls }: PlanDetectResult, faces = FACES) {
  // The stub wall up from the bottom is the one interior wall
  expect(walls).toHaveLength(1);
  expect(outline, 'an outline').not.toBeNull();
  expect(outline!.length).toBe(8);
  for (const [ex, ey] of faces) {
    expect(outline!.some(([x, y]) => Math.abs(x - ex) <= 6 && Math.abs(y - ey) <= 6), `corner ${ex},${ey} in ${JSON.stringify(outline)}`).toBe(true);
  }
}

// Seeds the window sent for clicks on the bed, the desk area, open floor, by the door and by the stub wall
const SEEDS: Pt[] = [[189.8, 359.8], [469.3, 419.4], [599.3, 329.5], [799.8, 249.3], [649.2, 499.6], [849.6, 479.0]];
// 152 over the 638 px from the bottom-left circle to the stub's circle
const SCALES: Record<string, number> = { inches: 165.25, meters: 4.197, feet: 13.77 };

describe('detect.worker: the import window\'s requests for the user\'s bedroom plan', () => {
  for (const [unit, pxPerM] of Object.entries(SCALES)) {
    it(`scale set in ${unit}: One room from every click, and Whole space`, () => {
      for (const seed of SEEDS) expectBedroom(run({ ...png, mode: { mode: 'room', seed }, opts: { pxPerM } }));
      expectBedroom(run({ ...png, mode: { mode: 'floor' }, opts: { pxPerM } }));
    });
  }

  it('no scale yet (Auto-detect before Set scale): One room from every click, and Whole space', () => {
    for (const seed of SEEDS) expectBedroom(run({ ...png, mode: { mode: 'room', seed }, opts: { pxPerM: null } }));
    expectBedroom(run({ ...png, mode: { mode: 'floor' }, opts: {} }));
  });

  it('turned 90°: the same room in the turned frame', () => {
    const t = turned();
    const faces = FACES.map(([x, y]) => [y, png.width - x] as Pt);
    for (const seed of [[418.8, 485.5], [249.7, 155.0]] as Pt[]) {
      expectBedroom(run({ ...t, mode: { mode: 'room', seed }, opts: { pxPerM: 165.25 } }), faces);
    }
    expectBedroom(run({ ...t, mode: { mode: 'floor' }, opts: { pxPerM: 4.197 } }), faces);
  });
});
