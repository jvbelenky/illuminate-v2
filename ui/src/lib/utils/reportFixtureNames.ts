/**
 * Model names for the PDF report's lamp table. The backend knows a preset's
 * name, but a custom lamp's model name lives only in the browser: the
 * custom-lamp library definition it was applied from (named after its IES file
 * unless the user renamed it), or the IES file uploaded to the lamp directly.
 */
import type { LampInstance } from '$lib/types/project';
import type { CustomLampDef } from '$lib/types/lampLibrary';

/** The API's per-name cap (ReportRequest.fixture_names). */
const MAX_NAME_LENGTH = 120;

export function reportFixtureNames(lamps: LampInstance[], defs: CustomLampDef[]): Record<string, string> {
  const defName = new Map(defs.map((d) => [d.id, d.name]));
  const out: Record<string, string> = {};
  for (const lamp of lamps) {
    const isCustom = !!lamp.custom_lamp_id || !lamp.preset_id || lamp.preset_id === 'custom';
    if (!isCustom) continue;
    const name = ((lamp.custom_lamp_id && defName.get(lamp.custom_lamp_id)) || lamp.ies_filename || '').trim();
    if (name) out[lamp.id] = name.slice(0, MAX_NAME_LENGTH);
  }
  return out;
}
