/**
 * Drive the 3D scene to produce the PNGs the PDF report needs. There is one
 * WebGL canvas, so captures run strictly in sequence; the camera and the
 * user's visibility are restored even when a capture throws.
 */
import type { ViewPreset } from '$lib/components/ViewSnapOverlay.svelte';
import type { IsoSettings } from '$lib/components/CalcVolPlotModal.svelte';
import { isoColorHex } from '$lib/utils/colormaps';

export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
}

export interface VisibilityOverride {
  lampIds?: string[];
  zoneIds?: string[];
  objectIds?: string[];
}

/** What the Scene exposes for captures (RoomViewer adds `canvas` and `setVisibility`). */
export interface SceneCaptureControls {
  prepare: () => void;
  restore: () => void;
  getCamera: () => CameraState;
  setCamera: (state: CameraState) => void;
  setViewImmediate: (view: ViewPreset) => void;
  render: () => void;
}

export interface SceneCaptureApi extends SceneCaptureControls {
  canvas: () => HTMLCanvasElement | null;
  /** null restores the user's own visibility. */
  setVisibility: (override: VisibilityOverride | null) => void;
  /** Per-zone isosurface settings for the capture; null restores the user's own. */
  setIsoSettings: (override: Record<string, IsoSettings> | null) => void;
}

/**
 * Isosurface levels a report draws for a volume: half, once and twice its
 * average, each to two significant figures. Mirrors `report_iso_levels` in
 * api/api/report/context.py, which prints them in the caption.
 */
export function reportIsoLevels(mean: number | null | undefined): number[] {
  if (mean == null || !Number.isFinite(mean) || mean <= 0) return [];
  return [0.5, 1, 2].map((k) => Number((mean * k).toPrecision(2)));
}

function reportIsoSettings(mean: number, colormap: string): IsoSettings {
  const levels = reportIsoLevels(mean);
  const colors = levels.map((_, i) => isoColorHex(i, levels.length, colormap));
  return { surfaceCount: levels.length, customLevels: levels, customColors: [], resolvedColors: colors };
}

export type CoverChoice = 'current' | 'iso-front-left' | 'top' | 'front';

export const COVER_CHOICES: { id: CoverChoice; label: string }[] = [
  { id: 'current', label: 'Current view' },
  { id: 'iso-front-left', label: 'Headline isometric' },
  { id: 'top', label: 'Plan' },
  { id: 'front', label: 'Front elevation' },
];

export interface CapturePlan {
  coverView: CoverChoice;
  /** Volume zones to picture, with each one's average value (sets its isosurface levels). */
  volumes: { id: string; mean: number | null | undefined }[];
  lampIds: string[];
  objectIds: string[];
  pointZoneIds: string[];
  /** The room's colormap, for the isosurface colours. */
  colormap: string;
  /** Upscale so the capture is at least this many px wide (default 1600). */
  minWidth?: number;
}

const nextFrame = () =>
  new Promise<void>((r) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => r()) : setTimeout(r, 0)));

async function settle() {
  await nextFrame();
  await nextFrame();
}

function grab(api: SceneCaptureApi, targetWidth: number | null): string {
  const canvas = api.canvas();
  if (!canvas) throw new Error('The 3D view is not available for capture');
  api.prepare();
  try {
    if (targetWidth == null || targetWidth === canvas.width || typeof document === 'undefined') {
      return canvas.toDataURL('image/png');
    }
    const scale = targetWidth / canvas.width;
    const off = document.createElement('canvas');
    off.width = Math.round(canvas.width * scale);
    off.height = Math.round(canvas.height * scale);
    const ctx = off.getContext('2d');
    if (!ctx) return canvas.toDataURL('image/png');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, off.width, off.height);
    return off.toDataURL('image/png');
  } finally {
    api.restore();
  }
}

/** Run `fn` with the scene's camera and visibility restored afterwards, success or failure. */
async function withScene<T>(api: SceneCaptureApi, fn: () => Promise<T>): Promise<T> {
  const camera = api.getCamera();
  try {
    return await fn();
  } finally {
    api.setCamera(camera);
    api.setVisibility(null);
    api.setIsoSettings(null);
    api.render();
  }
}

export async function captureReportImages(api: SceneCaptureApi, plan: CapturePlan): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const canvas = api.canvas();
  if (!canvas) throw new Error('The 3D view is not available for capture');
  const width = Math.max(canvas.width, plan.minWidth ?? 1600);
  return withScene(api, async () => {
    // Cover: the user's own visibility, the chosen camera
    if (plan.coverView !== 'current') api.setViewImmediate(plan.coverView);
    api.render();
    await settle();
    out.cover = grab(api, width);

    // Plan: top-down with lamps, objects and points; no planes or volumes
    api.setVisibility({ lampIds: plan.lampIds, zoneIds: plan.pointZoneIds, objectIds: plan.objectIds });
    api.setViewImmediate('top');
    api.render();
    await settle();
    out.plan = grab(api, width);

    // One isometric per volume zone: that zone alone, with the lamps, drawn at
    // report levels (½×, 1×, 2× its average) rather than the user's view settings
    for (const { id, mean } of plan.volumes) {
      api.setVisibility({ lampIds: plan.lampIds, zoneIds: [id], objectIds: [] });
      api.setIsoSettings(mean != null && mean > 0 ? { [id]: reportIsoSettings(mean, plan.colormap) } : null);
      api.setViewImmediate('iso-front-left');
      api.render();
      await settle();
      out[`volume:${id}`] = grab(api, width);
    }
    return out;
  });
}

export async function captureThumbnails(api: SceneCaptureApi, views: CoverChoice[], width: number): Promise<Record<CoverChoice, string>> {
  const out = {} as Record<CoverChoice, string>;
  return withScene(api, async () => {
    const start = api.getCamera();
    for (const v of views) {
      if (v === 'current') api.setCamera(start);
      else api.setViewImmediate(v);
      api.render();
      await settle();
      out[v] = grab(api, width);
    }
    return out;
  });
}
