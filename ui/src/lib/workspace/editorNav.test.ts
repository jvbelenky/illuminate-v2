import { describe, test, expect } from 'vitest';
import { NAV_ORDER, neighbours, planContext, stageDone } from './editorNav';

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
  test('stageDone: Room with an outline, Lamps with every included lamp modelled, Zones with a zone of your own', () => {
    const lamp = (has_ies_file: boolean, enabled = true) => ({ has_ies_file, enabled });
    const base = { hasOutline: true, lamps: [lamp(true)], userZoneCount: 1 };
    expect(stageDone('room', base)).toBe(true);
    expect(stageDone('room', { ...base, hasOutline: false })).toBe(false);
    expect(stageDone('lamps', base)).toBe(true);
    expect(stageDone('lamps', { ...base, lamps: [] })).toBe(false);
    expect(stageDone('lamps', { ...base, lamps: [lamp(true), lamp(false)] })).toBe(false);
    // An excluded lamp with no model does not hold the step back
    expect(stageDone('lamps', { ...base, lamps: [lamp(true), lamp(false, false)] })).toBe(true);
    expect(stageDone('zones', base)).toBe(true);
    expect(stageDone('zones', { ...base, userZoneCount: 0 })).toBe(false);
  });
});
