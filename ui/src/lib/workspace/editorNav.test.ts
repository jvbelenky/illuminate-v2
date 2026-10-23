import { describe, test, expect } from 'vitest';
import { NAV_ORDER, neighbours, planContext } from './editorNav';

describe('editorNav', () => {
  test('NAV_ORDER runs through the Room parts, then Lamps and Zones', () => {
    expect(NAV_ORDER.map(s => s.label)).toEqual(['Floorplan', 'Structures', 'Ceiling', 'Reflectance', 'Lamps', 'Zones']);
  });
  test('neighbours names Back/Next after their targets', () => {
    expect(neighbours('room', 'floorplan')).toEqual({ prev: null, next: { stage: 'room', part: 'structures', label: 'Structures' } });
    expect(neighbours('lamps', null).prev?.label).toBe('Reflectance');
    expect(neighbours('lamps', null).next?.label).toBe('Zones');
    expect(neighbours('zones', null).next).toBeNull();
  });
  test('planContext maps the open step to what the 2D pane edits', () => {
    expect(planContext('editor', 'room', 'floorplan')).toBe('outline');
    expect(planContext('editor', 'room', 'structures')).toBe('obstacles');
    expect(planContext('editor', 'room', 'ceiling')).toBe('ceiling');
    expect(planContext('editor', 'room', 'reflectance')).toBe('reflectance');
    expect(planContext('editor', 'lamps', 'floorplan')).toBe('lamps');
    expect(planContext('editor', 'zones', 'ceiling')).toBe('zones');
    expect(planContext('summary', 'lamps', 'floorplan')).toBe('view');
  });
});
