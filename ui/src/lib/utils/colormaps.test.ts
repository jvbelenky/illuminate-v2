/**
 * Tests for colormap utilities.
 */

import { describe, it, expect } from 'vitest';
import { valueToColor, getColormapNames, type RGB } from './colormaps';

describe('valueToColor', () => {
  it('returns color at t=0', () => {
    const color = valueToColor(0, 'plasma');
    // Plasma starts with dark purple/blue
    expect(color.r).toBeCloseTo(0.050, 2);
    expect(color.g).toBeCloseTo(0.030, 2);
    expect(color.b).toBeCloseTo(0.528, 2);
  });

  it('returns color at t=1', () => {
    const color = valueToColor(1, 'plasma');
    // Plasma ends with yellow
    expect(color.r).toBeCloseTo(0.940, 2);
    expect(color.g).toBeCloseTo(0.975, 2);
    expect(color.b).toBeCloseTo(0.131, 2);
  });

  it('interpolates at t=0.5', () => {
    const color = valueToColor(0.5, 'plasma');
    // Should be somewhere in the middle (pinkish)
    expect(color.r).toBeCloseTo(0.798, 2);
    expect(color.g).toBeCloseTo(0.280, 2);
    expect(color.b).toBeCloseTo(0.470, 2);
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
    const color = valueToColor(0.5, 'viridis');
    expect(color.r).toBeCloseTo(0.127, 2);
    expect(color.g).toBeCloseTo(0.566, 2);
    expect(color.b).toBeCloseTo(0.551, 2);
  });

  it('works with magma colormap', () => {
    const color = valueToColor(0.5, 'magma');
    expect(color.r).toBeCloseTo(0.716, 2);
    expect(color.g).toBeCloseTo(0.215, 2);
    expect(color.b).toBeCloseTo(0.475, 2);
  });

  it('works with inferno colormap', () => {
    const color = valueToColor(0.5, 'inferno');
    expect(color.r).toBeCloseTo(0.735, 2);
    expect(color.g).toBeCloseTo(0.215, 2);
    expect(color.b).toBeCloseTo(0.330, 2);
  });

  it('works with cividis colormap', () => {
    const color = valueToColor(0.5, 'cividis');
    expect(color.r).toBeCloseTo(0.470, 2);
    expect(color.g).toBeCloseTo(0.470, 2);
    expect(color.b).toBeCloseTo(0.450, 2);
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

  it('returns reversed colormap names', () => {
    const names = getColormapNames();
    expect(names).toContain('viridis_r');
    expect(names).toContain('plasma_r');
    expect(names).toContain('magma_r');
    expect(names).toContain('inferno_r');
    expect(names).toContain('cividis_r');
  });

  it('returns exactly 10 colormaps (5 base + 5 reversed)', () => {
    const names = getColormapNames();
    expect(names).toHaveLength(10);
  });

  it('returns unique names', () => {
    const names = getColormapNames();
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });
});
