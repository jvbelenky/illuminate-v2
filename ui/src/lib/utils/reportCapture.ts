/**
 * Drive the 3D scene to produce the images the PDF report needs. There is one
 * WebGL canvas, so captures run strictly in sequence; the camera and the
 * user's visibility are restored even when a capture throws.
 *
 * Report views are JPEG: a rendered scene is 5-10× smaller than as PNG, which
 * keeps the request body (several views, base64) well under the 1 MB default
 * body cap of a reverse proxy such as nginx. Thumbnails stay transparent PNG
 * because they sit on the dialog's dark background.
 */
import type { ViewPreset } from '$lib/components/ViewSnapOverlay.svelte';
import type { IsoSettings } from '$lib/components/CalcVolPlotModal.svelte';
import { isoColorHex } from '$lib/utils/colormaps';

export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
}

export interface VisibilityOverride {
  /** Unset fields keep the user's own visibility. */
  lampIds?: string[];
  zoneIds?: string[];
  objectIds?: string[];
  /** Draw lamps without their photometric webs (positions and fixtures only). */
  hidePhotometricWebs?: boolean;
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
  /** Lamps shown with each volume. */
  lampIds: string[];
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

type Encoding = 'png' | 'jpeg';

/** JPEG quality for report views; visually lossless in print at 1600 px. */
const JPEG_QUALITY = 0.9;

/**
 * Encode the capture canvas as a data URL. A JPEG has no alpha, and the
 * capture is rendered on a transparent background, so it is composited onto
 * white (the report page) first; without that the background would be black.
 */
function grab(api: SceneCaptureApi, targetWidth: number | null, encoding: Encoding): string {
  const canvas = api.canvas();
  if (!canvas) throw new Error('The 3D view is not available for capture');
  api.prepare();
  try {
    const needsOffscreen = encoding === 'jpeg' || (targetWidth != null && targetWidth !== canvas.width);
    if (!needsOffscreen || typeof document === 'undefined') {
      return canvas.toDataURL('image/png');
    }
    const scale = targetWidth == null ? 1 : targetWidth / canvas.width;
    const off = document.createElement('canvas');
    off.width = Math.round(canvas.width * scale);
    off.height = Math.round(canvas.height * scale);
    const ctx = off.getContext('2d');
    if (!ctx) return canvas.toDataURL('image/png');
    if (encoding === 'jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, off.width, off.height);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, off.width, off.height);
    return encoding === 'jpeg' ? off.toDataURL('image/jpeg', JPEG_QUALITY) : off.toDataURL('image/png');
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
  // The plan view is drawn by the server from the room geometry, not captured.
  // Lamps appear without their photometric webs in every view.
  return withScene(api, async () => {
    // Cover: the user's own visibility, the chosen camera
    api.setVisibility({ hidePhotometricWebs: true });
    if (plan.coverView !== 'current') api.setViewImmediate(plan.coverView);
    api.render();
    await settle();
    out.cover = grab(api, width, 'jpeg');

    // One isometric per volume zone: that zone alone, with the lamps, drawn at
    // report levels (½×, 1×, 2× its average) rather than the user's view settings
    for (const { id, mean } of plan.volumes) {
      api.setVisibility({ lampIds: plan.lampIds, zoneIds: [id], objectIds: [], hidePhotometricWebs: true });
      api.setIsoSettings(mean != null && mean > 0 ? { [id]: reportIsoSettings(mean, plan.colormap) } : null);
      api.setViewImmediate('iso-front-left');
      api.render();
      await settle();
      out[`volume:${id}`] = grab(api, width, 'jpeg');
    }
    return out;
  });
}

export async function captureThumbnails(api: SceneCaptureApi, views: CoverChoice[], width: number): Promise<Record<CoverChoice, string>> {
  const out = {} as Record<CoverChoice, string>;
  return withScene(api, async () => {
    // Previews match the report: no photometric webs
    api.setVisibility({ hidePhotometricWebs: true });
    const start = api.getCamera();
    for (const v of views) {
      if (v === 'current') api.setCamera(start);
      else api.setViewImmediate(v);
      api.render();
      await settle();
      out[v] = grab(api, width, 'png');
    }
    return out;
  });
}
