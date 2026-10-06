import { describe, it, expect } from 'vitest';
import { sceneItemColor, roomWireColor, DISABLED_COLOR, SELECTED_COLOR } from './sceneColors';
import { WAVELENGTH_ANCHORS } from './wavelengthColor';

describe('sceneItemColor', () => {
  it('prioritises disabled over hover over selected', () => {
    expect(sceneItemColor('dark', { disabled: true, highlighted: true, selected: true })).toBe(DISABLED_COLOR);
    expect(sceneItemColor('dark', { highlighted: true, selected: true })).toBe('#ffffff');
    expect(sceneItemColor('light', { selected: true })).toBe(SELECTED_COLOR);
  });

  it('uses the given base when idle, else a theme neutral', () => {
    expect(sceneItemColor('dark', {}, '#123456')).toBe('#123456');
    expect(sceneItemColor('dark', {})).not.toBe(sceneItemColor('light', {}));
  });

  it('never reuses a wavelength anchor color for idle zones or the room', () => {
    const anchors = new Set(WAVELENGTH_ANCHORS.map((a) => a.hex));
    for (const t of ['light', 'dark'] as const) {
      expect(anchors.has(sceneItemColor(t, {}))).toBe(false);
      expect(anchors.has(roomWireColor(t))).toBe(false);
    }
  });
});
