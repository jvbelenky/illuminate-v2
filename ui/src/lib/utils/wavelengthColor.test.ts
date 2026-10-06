import { describe, it, expect } from 'vitest';
import {
  wavelengthToColor,
  lampWavelength,
  lampColor,
  lightenColor,
  UNKNOWN_WAVELENGTH_COLOR,
  WAVELENGTH_ANCHORS,
} from './wavelengthColor';

describe('wavelengthToColor', () => {
  it('maps 222 nm to violet and 254 nm to sky blue exactly', () => {
    expect(wavelengthToColor(222)).toBe('#a855f7');
    expect(wavelengthToColor(254)).toBe('#0ea5e9');
  });

  it('returns every anchor color exactly at its wavelength', () => {
    for (const { wl, hex } of WAVELENGTH_ANCHORS) {
      expect(wavelengthToColor(wl)).toBe(hex);
    }
  });

  it('clamps below the first and above the last anchor', () => {
    const first = WAVELENGTH_ANCHORS[0];
    const last = WAVELENGTH_ANCHORS[WAVELENGTH_ANCHORS.length - 1];
    expect(wavelengthToColor(first.wl - 50)).toBe(first.hex);
    expect(wavelengthToColor(last.wl + 100)).toBe(last.hex);
  });

  it('interpolates between anchors as a hex color', () => {
    const c = wavelengthToColor(238);
    expect(c).toMatch(/^#[0-9a-f]{6}$/);
    expect(c).not.toBe('#a855f7');
    expect(c).not.toBe('#0ea5e9');
  });

  it('returns the unknown color for non-finite input', () => {
    expect(wavelengthToColor(NaN)).toBe(UNKNOWN_WAVELENGTH_COLOR);
  });
});

describe('lampWavelength', () => {
  it('derives the wavelength from the lamp type', () => {
    expect(lampWavelength({ lamp_type: 'krcl_222' })).toBe(222);
    expect(lampWavelength({ lamp_type: 'lp_254' })).toBe(254);
    expect(lampWavelength({ lamp_type: 'other', wavelength: 265 })).toBe(265);
  });

  it('returns null for an "other" lamp with no wavelength', () => {
    expect(lampWavelength({ lamp_type: 'other' })).toBeNull();
    expect(lampWavelength({ lamp_type: 'other', wavelength: undefined })).toBeNull();
  });
});

describe('lampColor', () => {
  it('colors by wavelength, falling back to the unknown color', () => {
    expect(lampColor({ lamp_type: 'krcl_222' })).toBe('#a855f7');
    expect(lampColor({ lamp_type: 'other' })).toBe(UNKNOWN_WAVELENGTH_COLOR);
  });
});

describe('lightenColor', () => {
  it('mixes toward white by the given fraction', () => {
    expect(lightenColor('#000000', 0)).toBe('#000000');
    expect(lightenColor('#000000', 1)).toBe('#ffffff');
    expect(lightenColor('#000000', 0.5)).toBe('#808080');
  });

  it('keeps the hue family (lightened violet stays violet-ish)', () => {
    const c = lightenColor('#a855f7', 0.3);
    const n = parseInt(c.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    expect(b).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(g);
  });
});
