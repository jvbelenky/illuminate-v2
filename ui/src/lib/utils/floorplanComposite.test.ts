import { describe, it, expect } from 'vitest';
import { compositeLayout } from './floorplanComposite';

describe('compositeLayout', () => {
  it('sizes the canvas to the room bbox at maxPx on the long edge and flips y', () => {
    const l = compositeLayout({ x: 8, y: 4 }, { x: 1, y: 1, width: 4, height: 2 }, 2048);
    expect(l.canvasW).toBe(2048);
    expect(l.canvasH).toBe(1024);
    // 256 px per unit. Image spans x 1..5 -> 256..1280; y 1..3 -> rows (4-3)*256 .. (4-1)*256
    expect(l.drawX).toBe(256);
    expect(l.drawW).toBe(1024);
    expect(l.drawY).toBe(256);
    expect(l.drawH).toBe(512);
  });
  it('handles images partly outside the room (negative draw coords are fine)', () => {
    const l = compositeLayout({ x: 4, y: 4 }, { x: -1, y: -1, width: 2, height: 2 }, 400);
    expect(l.drawX).toBe(-100);
    expect(l.drawY).toBe(300);
  });
});
