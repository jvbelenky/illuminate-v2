/**
 * Composite the floor-plan image onto a canvas that covers the room's bounding
 * box, so a texture on the (possibly concave) floor mesh clips it for free:
 * the mesh IS the polygon, and the texture matrix is just bbox -> unit square.
 */
export interface CompositeLayout {
  canvasW: number; canvasH: number;
  drawX: number; drawY: number; drawW: number; drawH: number;
}

export function compositeLayout(
  extentsDisplay: { x: number; y: number },
  rect: { x: number; y: number; width: number; height: number },
  maxPx: number,
): CompositeLayout {
  const long = Math.max(extentsDisplay.x, extentsDisplay.y, 1e-9);
  const pxPerUnit = maxPx / long;
  const canvasW = Math.max(1, Math.round(extentsDisplay.x * pxPerUnit));
  const canvasH = Math.max(1, Math.round(extentsDisplay.y * pxPerUnit));
  return {
    canvasW, canvasH,
    drawX: Math.round(rect.x * pxPerUnit),
    // canvas row 0 is the room's y max
    drawY: Math.round((extentsDisplay.y - (rect.y + rect.height)) * pxPerUnit),
    drawW: Math.round(rect.width * pxPerUnit),
    drawH: Math.round(rect.height * pxPerUnit),
  };
}

/** Returns null where canvas 2D is unavailable (jsdom, headless tests). */
export function compositeFloorPlan(
  image: CanvasImageSource,
  extentsDisplay: { x: number; y: number },
  rect: { x: number; y: number; width: number; height: number },
  maxPx = 2048,
): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const l = compositeLayout(extentsDisplay, rect, maxPx);
  const canvas = document.createElement('canvas');
  canvas.width = l.canvasW;
  canvas.height = l.canvasH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, l.canvasW, l.canvasH);
  ctx.drawImage(image, l.drawX, l.drawY, l.drawW, l.drawH);
  return canvas;
}
