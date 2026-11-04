import { describe, it, expect } from 'vitest';
import { sceneItemColor, roomWireColor, DISABLED_COLOR, selectedColor, hoverColor, sceneItemBaseColor, ceilingColors } from './sceneColors';
import { WAVELENGTH_ANCHORS } from './wavelengthColor';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const appCss = readFileSync(resolve(__dirname, '../../app.css'), 'utf8');

describe('sceneItemColor', () => {
  it('prioritises disabled over selected over hover', () => {
    expect(sceneItemColor('dark', { disabled: true, highlighted: true, selected: true })).toBe(DISABLED_COLOR);
    expect(sceneItemColor('dark', { highlighted: true, selected: true })).toBe('#38bdf8');
    expect(sceneItemColor('light', { selected: true })).toBe('#0284c7');
    expect(sceneItemColor('dark', { selected: true })).toBe('#38bdf8');
  });

  it('draws a hovered item in a fainter cyan, between the selection cyan and the idle neutral', () => {
    for (const t of ['light', 'dark'] as const) {
      const hover = sceneItemColor(t, { highlighted: true });
      expect(hover).toBe(hoverColor(t));
      expect(hover).not.toBe(selectedColor(t));
      expect(hover).not.toBe(sceneItemBaseColor(t));
    }
    expect(hoverColor('dark')).toBe('#73c7ef');
  });

  it('draws ceiling items in the idle neutral, not the warning amber', () => {
    for (const t of ['light', 'dark'] as const) {
      expect(ceilingColors(t).point).toBe(sceneItemBaseColor(t));
      expect(['#fbbf24', '#ca8a04']).not.toContain(ceilingColors(t).point);
    }
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

describe('CSS scene tokens', () => {
  // The floor plan reads these from app.css; the 3D scene from this module.
  function token(theme: 'dark' | 'light', name: string): string | undefined {
    const block = theme === 'dark'
      ? appCss.slice(appCss.indexOf('[data-theme="dark"]'), appCss.indexOf('[data-theme="light"]'))
      : appCss.slice(appCss.indexOf('[data-theme="light"]'));
    return block.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim();
  }

  it('match roomWireColor, selectedColor and sceneItemBaseColor in both themes', () => {
    for (const t of ['dark', 'light'] as const) {
      expect(token(t, 'color-scene-wire')).toBe(roomWireColor(t));
      expect(token(t, 'color-scene-selected')).toBe(selectedColor(t));
      expect(token(t, 'color-scene-item')).toBe(sceneItemBaseColor(t));
    }
  });
});
