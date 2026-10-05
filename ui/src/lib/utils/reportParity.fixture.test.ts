/**
 * Writes the TypeScript results the Python report must reproduce
 * (api/tests/test_results_parity.py reads the JSON this test emits).
 */
import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { eachUV, logReductionTime } from './survival-math';
import { cadrLps, cadrCfm } from './resultsSummary';
import { calculateHoursToTLV } from './calculations';

const OUT = resolve(__dirname, '../../../../api/tests/fixtures/results_parity.json');

describe('results parity fixture', () => {
  it('writes the TypeScript results the Python side must reproduce', () => {
    const cases = [
      { name: '222 only', irrad: [1.5], k1: [1.2], k2: [0], f: [0], volume_m3: 64.8 },
      { name: '254 only', irrad: [0.8], k1: [0.9], k2: [0.1], f: [0.05], volume_m3: 64.8 },
      { name: 'mixed 222+254', irrad: [1.5, 0.8], k1: [1.2, 0.9], k2: [0, 0.1], f: [0, 0.05], volume_m3: 120 },
    ].map((c) => {
      const each = eachUV(c.irrad, c.k1, c.k2, c.f);
      return {
        ...c,
        each_uv: each,
        cadr_lps: cadrLps(each, c.volume_m3),
        cadr_cfm: cadrCfm(each, c.volume_m3),
        t90: logReductionTime(1, c.irrad, c.k1, c.k2, c.f),
        t99: logReductionTime(2, c.irrad, c.k1, c.k2, c.f),
        t999: logReductionTime(3, c.irrad, c.k1, c.k2, c.f),
      };
    });
    const hours = [{ max_dose: 100, tlv: 478.5 }, { max_dose: 800, tlv: 160.7 }].map((h) => ({ ...h, hours: calculateHoursToTLV(h.max_dose, h.tlv) }));
    mkdirSync(resolve(OUT, '..'), { recursive: true });
    writeFileSync(OUT, JSON.stringify({ cases, hours }, null, 2) + '\n');
    // Additivity across wavelengths: the mixed case is the sum of its parts
    expect(cases[2].each_uv).toBeCloseTo(cases[0].each_uv + (0.9 * 0.95 + 0.1 * 0.05) * 0.8 * 3.6, 9);
  });
});
