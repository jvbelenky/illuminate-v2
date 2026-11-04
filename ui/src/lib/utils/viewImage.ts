/**
 * The main view's Open in new tab and Save as image, shared by the 2D plan
 * (an SVG drawn to a canvas) and the 3D view (its WebGL canvas).
 */

/**
 * Show a PNG data URL alone in a new tab, centred on a dark ground. An image made
 * asynchronously passes the tab opened at the click (`win`), so no popup blocker stops it.
 */
export function openImageInTab(dataUrl: string, title: string, win: Window | null = window.open('', '_blank')): void {
  if (!win) return;
  win.document.title = title;
  const body = win.document.body;
  body.style.margin = '0';
  body.style.background = '#1a1a1a';
  body.style.display = 'flex';
  body.style.alignItems = 'center';
  body.style.justifyContent = 'center';
  body.style.height = '100vh';
  const img = win.document.createElement('img');
  img.src = dataUrl;
  img.style.maxWidth = '100%';
  img.style.maxHeight = '100%';
  body.appendChild(img);
}

/** Download a blob under a file name. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Presentation properties copied inline, so the SVG draws the same outside the page's stylesheets. */
const SVG_STYLE_PROPS = [
  'fill', 'fill-opacity', 'stroke', 'stroke-opacity', 'stroke-width', 'stroke-dasharray',
  'stroke-linecap', 'stroke-linejoin', 'opacity', 'visibility', 'display', 'paint-order',
  'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline', 'color',
];

/** A data URL for an image `href` (blob: and same-origin URLs), so it survives serialization; null on failure. */
async function inlineHref(href: string): Promise<string | null> {
  if (href.startsWith('data:')) return href;
  try {
    const blob = await (await fetch(href)).blob();
    return await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Draw an on-screen SVG to a canvas `scale` times its size, on `background`:
 * a copy with its computed styles inlined and its images embedded.
 */
export async function svgToCanvas(svg: SVGSVGElement, background: string, scale = 1): Promise<HTMLCanvasElement | null> {
  const rect = svg.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  const copy = svg.cloneNode(true) as SVGSVGElement;
  const src = [svg, ...svg.querySelectorAll('*')];
  const dst = [copy, ...copy.querySelectorAll('*')];
  src.forEach((el, i) => {
    const out = dst[i] as SVGElement;
    const cs = getComputedStyle(el);
    const style = SVG_STYLE_PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';');
    out.setAttribute('style', style);
  });
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.setAttribute('width', String(w));
  copy.setAttribute('height', String(h));
  copy.style.background = 'none';
  for (const img of copy.querySelectorAll('image')) {
    const href = img.getAttribute('href') ?? img.getAttribute('xlink:href');
    if (!href) continue;
    const data = await inlineHref(href);
    if (data) img.setAttribute('href', data);
    else img.remove();
  }
  const xml = new XMLSerializer().serializeToString(copy);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('The plan could not be drawn'));
    image.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}
