import { describe, it, expect } from 'vitest';
import { reportFixtureNames } from './reportFixtureNames';
import type { LampInstance } from '$lib/types/project';
import type { CustomLampDef } from '$lib/types/lampLibrary';

const lamp = (over: Partial<LampInstance>) =>
  ({ id: 'L', lamp_type: 'lp_254', x: 0, y: 0, z: 0, aimx: 0, aimy: 0, aimz: 0, scaling_factor: 1, enabled: true, ...over }) as LampInstance;
const def = (id: string, name: string) => ({ id, name }) as CustomLampDef;

describe('reportFixtureNames', () => {
  it('names a library lamp by its definition (seeded from the IES filename)', () => {
    const names = reportFixtureNames(
      [lamp({ id: 'a', preset_id: 'custom', custom_lamp_id: 'd1', ies_filename: 'old.ies' })],
      [def('d1', 'UR-Fixture-2024.ies')],
    );
    expect(names).toEqual({ a: 'UR-Fixture-2024.ies' });
  });

  it('falls back to the uploaded IES filename', () => {
    expect(reportFixtureNames([lamp({ id: 'a', preset_id: 'custom', ies_filename: 'wall_unit.ies' })], [])).toEqual({ a: 'wall_unit.ies' });
  });

  it('leaves preset lamps and nameless custom lamps to the report', () => {
    const names = reportFixtureNames(
      [lamp({ id: 'p', preset_id: 'ushio_b1', ies_filename: 'x.ies' }), lamp({ id: 'c', preset_id: 'custom' }), lamp({ id: 'gone', preset_id: 'custom', custom_lamp_id: 'missing' })],
      [],
    );
    expect(names).toEqual({});
  });

  it('trims and caps the name at the API limit', () => {
    const names = reportFixtureNames([lamp({ id: 'a', preset_id: 'custom', ies_filename: `  ${'x'.repeat(200)}  ` })], []);
    expect(names.a).toHaveLength(120);
  });
});
