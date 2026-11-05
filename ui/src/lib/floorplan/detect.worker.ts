/// <reference lib="webworker" />
// Auto-detect off the main thread: the outline and the interior walls of one
// aligned raster (see detectClient.ts).
import { detectPlan } from './interiorWalls';
import type { DetectRequest, DetectReply } from './detectClient';

self.onmessage = (e: MessageEvent<DetectRequest>) => {
  const { id, width, height, data, mode, opts } = e.data;
  let reply: DetectReply;
  try {
    reply = { id, result: detectPlan({ width, height, data, channels: 4 }, mode, opts) };
  } catch (err) {
    reply = { id, error: String(err) };
  }
  (self as unknown as Worker).postMessage(reply);
};
