import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  gridSpacing,
  gridColors,
  gridFadeDistance,
  gridLineValues,
  isSectionLine,
  planGridLines,
  rulerTicks,
  formatTick,
  rulerColors,
  GRID_MIN_GAP_PX,
} from './viewGrid';


describe('grid spacing', () => {
  it('is one cell per metre or foot, a section every 5 cells, in every unit', () => {
    expect(gridSpacing('meters')).toEqual({ cell: 1, section: 5 });
    expect(gridSpacing('centimeters')).toEqual({ cell: 100, section: 500 });
    expect(gridSpacing('millimeters')).toEqual({ cell: 1000, section: 5000 });
    expect(gridSpacing('feet')).toEqual({ cell: 1, section: 5 });
    expect(gridSpacing('inches')).toEqual({ cell: 12, section: 60 });
  });

  it('lists the multiples of the step within a range, exactly', () => {
    expect(gridLineValues(-1.5, 2.2, 1)).toEqual([-1, 0, 1, 2]);
    expect(gridLineValues(0, 0.3, 0.1)).toEqual([0, 0.1, 0.2, 0.3]);
    expect(gridLineValues(3, 1, 1)).toEqual([]);
  });

  it('splits the plan grid into cell and section lines', () => {
    const s = gridSpacing('meters');
    const { cells, sections } = planGridLines(-2, 11, s, 0.01);
    expect(sections).toEqual([0, 5, 10]);
    expect(cells).toEqual([-2, -1, 1, 2, 3, 4, 6, 7, 8, 9, 11]);
    expect(isSectionLine(10, s)).toBe(true);
    expect(isSectionLine(3, s)).toBe(false);
  });

  it('leaves out a family whose lines would sit closer than the minimum gap on screen', () => {
    const s = gridSpacing('meters');
    // 1 m is 2 px: cells go, sections (10 px) stay
    const far = planGridLines(0, 100, s, 1 / 2);
    expect(far.cells).toEqual([]);
    expect(far.sections.length).toBeGreaterThan(0);
    // 5 m below the gap: nothing
    const farther = planGridLines(0, 100, s, 5 / (GRID_MIN_GAP_PX - 1));
    expect(farther).toEqual({ cells: [], sections: [] });
  });

  it('fades over five times the room\'s longest side, as 3D', () => {
    expect(gridFadeDistance(6)).toBe(30);
  });

  it('has the 3D colours per theme', () => {
    expect(gridColors('light')).toEqual({ cell: '#b0b0b0', section: '#909090' });
    expect(gridColors('dark')).toEqual({ cell: '#4a4a6a', section: '#6a6a8a' });
    expect(rulerColors('light')).toEqual({ line: '#666666', text: '#333333' });
    expect(rulerColors('dark')).toEqual({ line: '#888888', text: '#cccccc' });
  });
});

describe('ruler ticks', () => {
  it('steps 1, 2, 2.5 or 5 times a power of ten, from 0 to the length', () => {
    expect(rulerTicks(6)).toEqual([0, 2, 4, 6]);
    expect(rulerTicks(4)).toEqual([0, 1, 2, 3, 4]);
    expect(rulerTicks(2.7)).toEqual([0, 1, 2]);
    expect(rulerTicks(12)).toEqual([0, 2.5, 5, 7.5, 10]);
    expect(rulerTicks(600)).toEqual([0, 200, 400, 600]);
    expect(rulerTicks(0)).toEqual([0]);
  });

  it('labels at the room precision', () => {
    expect(formatTick(2, 1)).toBe('2.0');
    expect(formatTick(2.5, 0)).toBe('3');
  });
});

describe('one module for both views', () => {
  const src = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');

  it('the 3D scene, rulers and axes and the 2D canvas all take their look from viewGrid', () => {
    const scene = src('../components/Scene.svelte');
    const room3d = src('../components/Room3D.svelte');
    const axes = src('../components/RoomAxes.svelte');
    const canvas = src('../components/PlanCanvas.svelte');
    for (const s of [scene, room3d, axes, canvas]) expect(s).toMatch(/from '\$lib\/utils\/viewGrid'/);
    // No grid or ruler colour, tick generator or spacing of their own
    for (const s of [scene, room3d, canvas]) {
      expect(s).not.toMatch(/#b0b0b0|#4a4a6a|#909090|#6a6a8a/);
      expect(s).not.toMatch(/niceSteps/);
    }
    expect(room3d).not.toMatch(/#666666|#888888/);
    expect(scene).toMatch(/gridSpacing\(units\)/);
    expect(canvas).toMatch(/gridSpacing\(units\)/);
    // The 2D plan draws no dimension rulers and no XYZ marker
    expect(canvas).not.toMatch(/rulers|axesMarker|xyz-marker/);
  });
});
