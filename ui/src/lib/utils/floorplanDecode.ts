/**
 * Turn an uploaded floor-plan file into a data URL the modal, thumbnail and 3D
 * floor can draw. Rasters are capped at MAX_LONG_EDGE_PX; SVG is kept verbatim
 * (vector stays crisp and is usually smaller); PDF pages are rasterized with
 * pdf.js, loaded lazily so the main bundle is untouched.
 *
 * SVG is only ever rendered through <image> / Image(), where scripts and
 * external references are inert, so no sanitizing pass is needed.
 */

export const MAX_LONG_EDGE_PX = 2048;
export const MAX_SVG_BYTES = 2 * 1024 * 1024;
export const MAX_DATA_URL_BYTES = 4 * 1024 * 1024;

export interface DecodedFloorPlan {
  mime: string;
  src: string;
  widthPx: number;
  heightPx: number;
  /** PDFs only. */
  pageCount?: number;
}

export class FloorPlanDecodeError extends Error {}

const RASTER_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const EXT_MIMES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  svg: 'image/svg+xml', pdf: 'application/pdf',
};

function mimeOf(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_MIMES[ext] ?? '';
}

export function isSupportedFloorPlanFile(file: File): boolean {
  const m = mimeOf(file);
  return RASTER_MIMES.has(m) || m === 'image/svg+xml' || m === 'application/pdf';
}

export function fitLongEdge(w: number, h: number, max: number): { w: number; h: number } {
  const long = Math.max(w, h);
  if (long <= max) return { w, h };
  const r = max / long;
  return { w: Math.round(w * r), h: Math.round(h * r) };
}

/** Width/height attributes, else 1024 × viewBox aspect, else null. */
export function svgIntrinsicSize(svgText: string): { w: number; h: number } | null {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg') return null;
  const w = parseFloat(root.getAttribute('width') ?? '');
  const h = parseFloat(root.getAttribute('height') ?? '');
  if (w > 0 && h > 0) return { w: Math.round(w), h: Math.round(h) };
  const vb = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) return { w: 1024, h: Math.round((1024 * vb[3]) / vb[2]) };
  return null;
}

function checkResultSize(src: string): void {
  if (src.length > MAX_DATA_URL_BYTES) {
    throw new FloorPlanDecodeError('Image too large after processing (limit 4 MB). Try a smaller or lower-resolution file.');
  }
}

/**
 * jsdom's `File` (as used in tests) lacks `.text()`. `new Response(file).text()`
 * would be the usual fallback, but jsdom's `Response` doesn't recognize jsdom's
 * `File` as blob-like and stringifies it instead, so fall back to `FileReader`.
 */
function readFileTextViaReader(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file.'));
    reader.readAsText(file);
  });
}

async function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return readFileTextViaReader(file);
}

function toBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function decodeSvg(file: File): Promise<DecodedFloorPlan> {
  if (file.size > MAX_SVG_BYTES) throw new FloorPlanDecodeError('SVG files are limited to 2 MB.');
  const text = await readFileText(file);
  const size = svgIntrinsicSize(text);
  if (!size) throw new FloorPlanDecodeError('This file is not a valid SVG drawing.');
  const src = `data:image/svg+xml;base64,${toBase64Utf8(text)}`;
  checkResultSize(src);
  return { mime: 'image/svg+xml', src, widthPx: size.w, heightPx: size.h };
}

function drawToDataUrl(source: CanvasImageSource, w: number, h: number, mime: 'image/png' | 'image/jpeg'): string {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new FloorPlanDecodeError('Could not process the image in this browser.');
  if (mime === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(source, 0, 0, w, h);
  return mime === 'image/jpeg' ? canvas.toDataURL(mime, 0.9) : canvas.toDataURL(mime);
}

async function decodeRaster(file: File, mime: string): Promise<DecodedFloorPlan> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new FloorPlanDecodeError('Could not read this image file.');
  }
  try {
    const { w, h } = fitLongEdge(bitmap.width, bitmap.height, MAX_LONG_EDGE_PX);
    // Line drawings (PNG/GIF) stay lossless; photos/scans go to JPEG.
    const outMime = mime === 'image/png' || mime === 'image/gif' ? 'image/png' : 'image/jpeg';
    const src = drawToDataUrl(bitmap, w, h, outMime);
    checkResultSize(src);
    return { mime: outMime, src, widthPx: w, heightPx: h };
  } finally {
    bitmap.close();
  }
}

async function decodePdf(file: File, page: number): Promise<DecodedFloorPlan> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  // PDFDocumentProxy has no destroy() of its own in this pdf.js major; the
  // loading task owns the worker and is what tears it down. The finally below
  // releases it on every path: success, document-load failure, page/render
  // failure, or an oversized result.
  const loadingTask = pdfjs.getDocument({ data: await file.arrayBuffer() });
  try {
    let doc;
    try {
      doc = await loadingTask.promise;
    } catch {
      throw new FloorPlanDecodeError('Could not read this PDF.');
    }
    const pageCount = doc.numPages;
    const pageNumber = Math.min(Math.max(1, page), pageCount);
    let w: number;
    let h: number;
    let src: string;
    try {
      const pdfPage = await doc.getPage(pageNumber);
      const base = pdfPage.getViewport({ scale: 1 });
      ({ w, h } = fitLongEdge(base.width, base.height, MAX_LONG_EDGE_PX));
      const scale = w / base.width;
      const viewport = pdfPage.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new FloorPlanDecodeError('Could not process the PDF in this browser.');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      await pdfPage.render({ canvas, viewport }).promise;
      src = canvas.toDataURL('image/png');
    } catch (err) {
      if (err instanceof FloorPlanDecodeError) throw err;
      throw new FloorPlanDecodeError('Could not render this PDF page.');
    }
    checkResultSize(src);
    return { mime: 'image/png', src, widthPx: w, heightPx: h, pageCount };
  } finally {
    await loadingTask.destroy();
  }
}

export async function decodeFloorPlanFile(file: File, opts: { page?: number } = {}): Promise<DecodedFloorPlan> {
  const mime = mimeOf(file);
  if (mime === 'image/svg+xml') return decodeSvg(file);
  if (mime === 'application/pdf') return decodePdf(file, opts.page ?? 1);
  if (RASTER_MIMES.has(mime)) return decodeRaster(file, mime);
  throw new FloorPlanDecodeError('Unsupported file type. Use PNG, JPEG, WebP, GIF, SVG or PDF.');
}
