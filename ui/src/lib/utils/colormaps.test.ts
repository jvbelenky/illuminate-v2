/**
 * Tests for colormap utilities.
 */

import { describe, it, expect } from 'vitest';
import { valueToColor, getColormapNames, COLORMAP_CATEGORIES, type RGB } from './colormaps';

describe('valueToColor', () => {
  it('returns color at t=0 for plasma', () => {
    const color = valueToColor(0, 'plasma');
    expect(color.r).toBeCloseTo(0.050, 1);
    expect(color.g).toBeCloseTo(0.030, 1);
    expect(color.b).toBeCloseTo(0.528, 1);
  });

  it('returns color at t=1 for plasma', () => {
    const color = valueToColor(1, 'plasma');
    expect(color.r).toBeCloseTo(0.940, 1);
    expect(color.g).toBeCloseTo(0.975, 1);
    expect(color.b).toBeCloseTo(0.131, 1);
  });

  it('interpolates at t=0.5', () => {
    const color = valueToColor(0.5, 'plasma');
    // With 16-point sampling, the midpoint should be close to the matplotlib value
    expect(color.r).toBeGreaterThan(0.5);
    expect(color.r).toBeLessThan(1.0);
  });

  it('clamps values below 0', () => {
    const colorNeg = valueToColor(-0.5, 'plasma');
    const colorZero = valueToColor(0, 'plasma');
    expect(colorNeg).toEqual(colorZero);
  });

  it('clamps values above 1', () => {
    const colorAbove = valueToColor(1.5, 'plasma');
    const colorOne = valueToColor(1, 'plasma');
    expect(colorAbove).toEqual(colorOne);
  });

  it('handles reversed colormaps', () => {
    const normal = valueToColor(0, 'plasma');
    const reversed = valueToColor(1, 'plasma_r');

    // Reversed colormap at t=1 should equal normal at t=0
    expect(reversed.r).toBeCloseTo(normal.r, 5);
    expect(reversed.g).toBeCloseTo(normal.g, 5);
    expect(reversed.b).toBeCloseTo(normal.b, 5);
  });

  it('falls back to plasma for unknown colormap', () => {
    const unknown = valueToColor(0.5, 'nonexistent');
    const plasma = valueToColor(0.5, 'plasma');
    expect(unknown).toEqual(plasma);
  });

  it('works with viridis colormap', () => {
    const color = valueToColor(0, 'viridis');
    expect(color.r).toBeCloseTo(0.267, 1);
    expect(color.g).toBeCloseTo(0.004, 1);
    expect(color.b).toBeCloseTo(0.329, 1);
  });

  it('works with rainbow colormap', () => {
    // Rainbow should have distinct colors at different t values
    const start = valueToColor(0, 'rainbow');
    const mid = valueToColor(0.5, 'rainbow');
    const end = valueToColor(1, 'rainbow');
    // Start and end should be different
    expect(Math.abs(start.r - end.r) + Math.abs(start.g - end.g) + Math.abs(start.b - end.b)).toBeGreaterThan(0.1);
    // Mid should be different from both
    expect(Math.abs(mid.r - start.r) + Math.abs(mid.g - start.g) + Math.abs(mid.b - start.b)).toBeGreaterThan(0.1);
  });

  it('works with jet colormap', () => {
    const color = valueToColor(0.5, 'jet');
    // Jet at 0.5 should be roughly green-cyan area
    expect(color.g).toBeGreaterThan(0.5);
  });
});

describe('getColormapNames', () => {
  it('returns base colormap names', () => {
    const names = getColormapNames();
    expect(names).toContain('viridis');
    expect(names).toContain('plasma');
    expect(names).toContain('magma');
    expect(names).toContain('inferno');
    expect(names).toContain('cividis');
  });

  it('includes sequential and misc colormaps', () => {
    const names = getColormapNames();
    expect(names).toContain('rainbow');
    expect(names).toContain('jet');
    expect(names).toContain('gist_rainbow');
    expect(names).toContain('hot');
    expect(names).toContain('cool');
  });

  it('does not include _r variants (handled by reverse toggle)', () => {
    const names = getColormapNames();
    const reversed = names.filter(n => n.endsWith('_r'));
    expect(reversed).toHaveLength(0);
  });

  it('returns 54 base colormaps', () => {
    const names = getColormapNames();
    expect(names).toHaveLength(54);
  });

  it('returns unique names', () => {
    const names = getColormapNames();
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });
});

describe('COLORMAP_CATEGORIES', () => {
  it('has three categories', () => {
    const categories = Object.keys(COLORMAP_CATEGORIES);
    expect(categories).toContain('Perceptually Uniform');
    expect(categories).toContain('Sequential');
    expect(categories).toContain('Miscellaneous');
  });

  it('category names map to valid colormaps', () => {
    const allNames = getColormapNames();
    for (const names of Object.values(COLORMAP_CATEGORIES)) {
      for (const name of names) {
        expect(allNames).toContain(name);
      }
    }
  });
});
