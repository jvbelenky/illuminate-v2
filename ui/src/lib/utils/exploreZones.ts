import type { CalcZone, ZoneResult } from '$lib/types/project';
import { doseConversionFactor } from './calculations';

export type ExploreZoneType = 'plane' | 'volume' | 'point';

export interface ExploreZoneOption {
  id: string;
  name: string;
  /** Mean irradiance / fluence rate in µW/cm², whatever mode the zone was calculated in. */
  meanFluence: number;
  zoneType: ExploreZoneType;
}

/**
 * Zones the data explorer can derive survival/eACH numbers from.
 *
 * Dose-mode zones are included with their mean converted back to µW/cm², so a
 * surface plane left in dose mode (the usual setup for surfaces, and SkinLimits)
 * is still selectable. EyeLimits is left out: its values are field-of-view
 * limited eye exposure, not the irradiance a surface receives.
 */
export function buildExploreZoneOptions(
  zones: CalcZone[],
  resultZones: Record<string, ZoneResult> | undefined
): ExploreZoneOption[] {
  if (!resultZones) return [];
  const options: ExploreZoneOption[] = [];
  for (const z of zones) {
    if (z.enabled === false || z.id === 'EyeLimits') continue;
    const result = resultZones[z.id];
    const mean = result?.statistics?.mean;
    if (mean == null) continue;
    const toIrradiance = doseConversionFactor(false, 0, result.doseAtCalcTime, result.hoursAtCalcTime);
    options.push({ id: z.id, name: z.name || z.id, meanFluence: mean * toIrradiance, zoneType: z.type });
  }
  return options;
}

/** Zone type whose fluence is meaningful for a medium ('Surface' → planes, 'Aerosol' → volumes). */
export function zoneTypeForMedium(medium: string): ExploreZoneType | undefined {
  if (medium === 'Surface') return 'plane';
  if (medium === 'Aerosol') return 'volume';
  return undefined;
}
