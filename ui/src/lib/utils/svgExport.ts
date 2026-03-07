/**
 * Shared utilities for exporting SVG plots as PNG images.
 */

/** Read CSS custom properties commonly used for SVG export styling. */
export function getExportStyles() {
  const styles = getComputedStyle(document.documentElement);
  return {
    bgColor: styles.getPropertyValue('--color-bg-secondary').trim() || '#1a1a2e',
    textColor: styles.getPropertyValue('--color-text').trim() || '#e0e0e0',
    textMuted: styles.getPropertyValue('--color-text-muted').trim() || '#888',
    borderColor: styles.getPropertyValue('--color-border').trim() || '#333',
    fontMono: styles.getPropertyValue('--font-mono').trim() || 'monospace',
    fontSans:
      styles.getPropertyValue('--font-sans').trim() ||
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  };
}

export type ExportStyles = ReturnType<typeof getExportStyles>;

/** Create an offscreen canvas filled with a background color. */
export function createExportCanvas(
  width: number,
  height: number,
  bgColor: string,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2d context');
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, width, height);
  return { canvas, ctx };
}

/** Serialize an SVG element and draw it onto a canvas context. */
export async function drawSvgOnCanvas(
  ctx: CanvasRenderingContext2D,
  svg: SVGSVGElement,
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<void> {
  const svgStr = new XMLSerializer().serializeToString(svg);
  const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = URL.createObjectURL(svgBlob);

  await new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, x, y, width, height);
      URL.revokeObjectURL(svgUrl);
      resolve();
    };
    img.onerror = () => {
      URL.revokeObjectURL(svgUrl);
      reject(new Error('Failed to load SVG image'));
    };
    img.src = svgUrl;
  });
}

/** Download a canvas element as a PNG file. */
export function downloadCanvasAsPng(canvas: HTMLCanvasElement, filename: string) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
}
