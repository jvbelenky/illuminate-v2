import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fitLongEdge, svgIntrinsicSize, isSupportedFloorPlanFile, decodeFloorPlanFile,
  FloorPlanDecodeError, MAX_SVG_BYTES,
} from './floorplanDecode';

describe('fitLongEdge', () => {
  it('leaves small images alone', () => expect(fitLongEdge(100, 50, 2048)).toEqual({ w: 100, h: 50 }));
  it('scales the long edge down to max, preserving aspect', () => {
    expect(fitLongEdge(4096, 1024, 2048)).toEqual({ w: 2048, h: 512 });
    expect(fitLongEdge(1000, 3000, 2048)).toEqual({ w: 683, h: 2048 });
  });
});

describe('svgIntrinsicSize', () => {
  it('reads width/height attributes', () => {
    expect(svgIntrinsicSize('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150"></svg>')).toEqual({ w: 300, h: 150 });
  });
  it('falls back to the viewBox aspect at 1024 wide', () => {
    expect(svgIntrinsicSize('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"></svg>')).toEqual({ w: 1024, h: 512 });
  });
  it('returns null when neither is usable', () => {
    expect(svgIntrinsicSize('<svg xmlns="http://www.w3.org/2000/svg"></svg>')).toBeNull();
  });
});

describe('isSupportedFloorPlanFile', () => {
  it('accepts raster, svg and pdf by mime or extension', () => {
    expect(isSupportedFloorPlanFile(new File([''], 'a.png', { type: 'image/png' }))).toBe(true);
    expect(isSupportedFloorPlanFile(new File([''], 'a.svg', { type: '' }))).toBe(true);
    expect(isSupportedFloorPlanFile(new File([''], 'a.pdf', { type: 'application/pdf' }))).toBe(true);
    expect(isSupportedFloorPlanFile(new File([''], 'a.txt', { type: 'text/plain' }))).toBe(false);
  });
});

describe('decodeFloorPlanFile (svg)', () => {
  it('keeps the SVG verbatim as a data URL with its intrinsic size', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20"/></svg>';
    const file = new File([svg], 'plan.svg', { type: 'image/svg+xml' });
    const out = await decodeFloorPlanFile(file);
    expect(out.mime).toBe('image/svg+xml');
    expect(out.widthPx).toBe(40);
    expect(out.heightPx).toBe(20);
    expect(out.src.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(atob(out.src.split(',')[1])).toBe(svg);
  });
  it('rejects non-SVG content with an .svg name', async () => {
    const file = new File(['<html></html>'], 'plan.svg', { type: 'image/svg+xml' });
    await expect(decodeFloorPlanFile(file)).rejects.toBeInstanceOf(FloorPlanDecodeError);
  });
  it('rejects SVGs over the size limit', async () => {
    const big = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1">' + 'x'.repeat(MAX_SVG_BYTES) + '</svg>';
    const file = new File([big], 'plan.svg', { type: 'image/svg+xml' });
    await expect(decodeFloorPlanFile(file)).rejects.toThrow(/2 MB/);
  });
});

describe('decodeFloorPlanFile (unsupported)', () => {
  it('rejects unknown types', async () => {
    await expect(decodeFloorPlanFile(new File(['x'], 'a.txt', { type: 'text/plain' }))).rejects.toThrow(/Unsupported/);
  });
});
