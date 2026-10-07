/** A fixture the plan can put on a lamp: a built-in preset, a custom library lamp, or "same as" a placed lamp. */
export interface FixtureOption {
  key: string;
  label: string;
  group: string;
}

/** The fixture key of a placed lamp ('' when it has none yet). */
export function fixtureKeyOf(lamp: { preset_id?: string; custom_lamp_id?: string }): string {
  if (lamp.custom_lamp_id) return `custom:${lamp.custom_lamp_id}`;
  if (lamp.preset_id && lamp.preset_id !== 'custom') return `preset:${lamp.preset_id}`;
  return '';
}
