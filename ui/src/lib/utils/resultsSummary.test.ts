import { describe, it, expect } from 'vitest';
import {
  cadrLps, cadrCfm, speciesWithDataAt, hoursToLimit, hoursFromFraction, fractionOfLimit, doseAtLimit, describeHours, formatSeconds, irradianceFromDose,
} from './resultsSummary';

describe('CADR formulas (guv_calcs CADR_LPS / CADR_CFM)', () => {
  it('converts eACH and volume to lps and cfm', () => {
    // 10 eACH in a 100 m³ room: 10·100·1000/3600 lps; 10·3531.47/60 cfm
    expect(cadrLps(10, 100)).toBeCloseTo(277.78, 2);
    expect(cadrCfm(10, 100)).toBeCloseTo(588.58, 2);
  });
});

describe('speciesWithDataAt', () => {
  const rows = [
    { species: 'Human coronavirus', medium: 'Aerosol', wavelength: 222 },
    { species: 'Influenza virus', medium: 'Aerosol', wavelength: 222 },
    { species: 'Influenza virus', medium: 'Aerosol', wavelength: 254 },
    { species: 'E. coli', medium: 'Surface', wavelength: 222 },
  ];
  it('lists aerosol species with data at the single wavelength, sorted', () => {
    expect(speciesWithDataAt(rows, [222])).toEqual(['Human coronavirus', 'Influenza virus']);
  });
  it('requires data at every wavelength for multi-wavelength installs', () => {
    expect(speciesWithDataAt(rows, [222, 254])).toEqual(['Influenza virus']);
  });
  it('is empty when a wavelength has no aerosol data at all', () => {
    expect(speciesWithDataAt(rows, [222, 280])).toEqual([]);
    expect(speciesWithDataAt(rows, [])).toEqual([]);
  });
});

describe('fractionOfLimit', () => {
  it('judges a single-spectrum dose against one TLV pair', () => {
    const f = fractionOfLimit({ skin: 478.5, eye: 160.7 }, 100, 100)!;
    expect(f.skin).toBeCloseTo(100 / 478.5, 6);
    expect(f.eye).toBeCloseTo(100 / 160.7, 6);
  });
  it('is null without limits or doses', () => {
    expect(fractionOfLimit(null, 100, 100)).toBeNull();
    expect(fractionOfLimit({ skin: 478.5, eye: 160.7 }, null, undefined)).toBeNull();
  });
});

describe('hoursFromFraction', () => {
  it('is 8 h over the fraction of the limit reached in 8 h', () => {
    expect(hoursFromFraction(0.5)).toBe(16);
    expect(hoursFromFraction(2)).toBe(4);
  });
  it('is null for no exposure', () => {
    expect(hoursFromFraction(0)).toBeNull();
    expect(hoursFromFraction(null)).toBeNull();
    expect(hoursFromFraction(undefined)).toBeNull();
  });
});

describe('hoursToLimit', () => {
  it('takes the smaller of the skin and eye hours', () => {
    // skin: 8/(100/478.5) = 38.3 h; eye: 8/(100/160.7) = 12.9 h
    expect(hoursToLimit({ skin: 100 / 478.5, eye: 100 / 160.7 })).toBeCloseTo(12.856, 3);
  });
  it('weighs a weak 254 nm lamp by its own small dose, not by its TLV', () => {
    // 222 nm lamp at 100 mJ/cm² (TLV 160.7) plus a 254 nm lamp at 0.5 mJ/cm² (TLV 6)
    const eye = 100 / 160.7 + 0.5 / 6;
    expect(hoursToLimit({ skin: 0.1, eye })).toBeCloseTo(8 / eye, 3);
    // The old model, 8·6/100.5 = 0.48 h, would have called this a 29-minute room
    expect(hoursToLimit({ skin: 0.1, eye })).toBeGreaterThan(8);
  });
  it('is null without a fraction or exposure', () => {
    expect(hoursToLimit(null)).toBeNull();
    expect(hoursToLimit({ skin: 0, eye: 0 })).toBeNull();
  });
});

describe('doseAtLimit', () => {
  it('is the TLV itself for a single-spectrum room', () => {
    expect(doseAtLimit(100, 100 / 478.5)).toBeCloseTo(478.5, 6);
  });
  it('is undefined without a dose or exposure', () => {
    expect(doseAtLimit(null, 0.5)).toBeUndefined();
    expect(doseAtLimit(100, 0)).toBeUndefined();
    expect(doseAtLimit(100, undefined)).toBeUndefined();
  });
});

describe('describeHours', () => {
  it('says Indefinite with the number from 8 h up, plain hours below', () => {
    expect(describeHours(12.86)).toBe('Indefinite (12.9 h)');
    expect(describeHours(8)).toBe('Indefinite (8.0 h)');
    expect(describeHours(2.04)).toBe('2.0 h');
    expect(describeHours(0.448)).toBe('27 min');
    expect(describeHours(null)).toBe('—');
  });
});

describe('formatSeconds and irradianceFromDose', () => {
  it('formats s, min and h', () => {
    expect(formatSeconds(42)).toBe('42 s');
    expect(formatSeconds(210)).toBe('3.5 min');
    expect(formatSeconds(4320)).toBe('1.2 h');
    expect(formatSeconds(null)).toBe('—');
  });
  it('turns an 8-hour dose back into irradiance', () => {
    // 28.8 mJ/cm² over 8 h = 1 µW/cm²
    expect(irradianceFromDose(28.8)).toBeCloseTo(1, 9);
    expect(irradianceFromDose(null)).toBeNull();
  });
});
