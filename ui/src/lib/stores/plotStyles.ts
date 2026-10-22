/**
 * Zones' plots as the app shows them, for the plot windows and for the images
 * the server draws (Export All, the PDF report): the safety limits behind a
 * zone's Limits levels, and each plane's resolved plot style.
 */
import { derived } from 'svelte/store';
import { plotSettings, results, room, zones } from '$lib/stores/project';
import { totalHours, zoneValueFactor } from '$lib/utils/calculations';
import {
  buildColorScale,
  formatPlotValue,
  limitSet,
  resolvePlotSettings,
  valueRange,
  type LimitSet,
} from '$lib/utils/plotScale';
import type { PlotStyle } from '$lib/api/contract';
import type { CalcZone, ZoneDisplayMode, ZonePlotSettings, ZoneResult } from '$lib/types/project';

/** The limits a zone's results carry, by key, with the names the plots give them. */
export const LIMIT_NAMES: Record<string, string> = {
  icnirp: 'ICNIRP',
  acgih_eye: 'ACGIH Eye',
  acgih_skin: 'ACGIH Skin',
};

/**
 * A zone's limits in its own units, for the Limits and percentage levels:
 * the dose at each, or the irradiance reaching it over the zone's exposure
 * time. The calculation gives them for the mix of lamps lighting the zone,
 * each weighed by its own spectrum's limit; where the lamps' limits differ,
 * it also gives a plane's limit at each point, and the levels' lines follow it.
 */
export function zoneLimitSet(zone: CalcZone, result: ZoneResult | null | undefined): LimitSet | null {
  const limits = result?.limits;
  if (!limits) return null;
  const seconds = totalHours(zone.hours ?? 8, zone.minutes ?? 0, zone.seconds ?? 0) * 3600;
  const inUnits = (dose: number) => (zone.dose ? dose : seconds > 0 ? (dose * 1000) / seconds : NaN);
  return limitSet(
    Object.entries(LIMIT_NAMES).flatMap(([key, name]) => {
      const limit = limits[key];
      if (!limit) return [];
      const perPoint = limit.grid ? { ref: limit.ref, grid: limit.grid as (number | null)[][] } : null;
      return [{ key, name, value: inUnits(limit.ref), perPoint }];
    }),
  );
}

/**
 * A plane's plot style for the server, resolved as its plot window resolves
 * it. The server draws the heatmap and the contour plot, so the contour levels
 * are resolved whichever view the plane is shown in. Levels go in the values'
 * stored units (the server plots those); names carry what the window prints,
 * so a level without a name shows its display value.
 */
export function planePlotStyle(
  stored: ZonePlotSettings | undefined,
  values: number[][],
  factor: number,
  colormap: string,
  limits: LimitSet | null,
  displayMode?: ZoneDisplayMode,
): PlotStyle {
  const settings = resolvePlotSettings('plane', stored, displayMode);
  const scale = buildColorScale({ ...settings, view: 'contours' }, valueRange(values.flat(), factor), colormap, limits);
  const f = factor || 1;
  const levels = scale.levels ?? [];
  return {
    view: settings.view === 'contours' ? 'contours' : 'heatmap',
    levels: levels.map((l) => l / f),
    colors: scale.colors,
    labels: levels.map((l, i) => scale.names?.[i] ?? formatPlotValue(l, settings.decimals)),
    level_limits: levels.map((_, i) => (scale.levelLimits?.[i]?.key ?? null) as NonNullable<PlotStyle['level_limits']>[number]),
    filled: settings.filled,
    show_values: settings.showValues,
    decimals: settings.decimals,
    title: settings.title,
  };
}

/** Plot styles of every plane with results, keyed by zone id. */
export const plotStyles = derived(
  [zones, results, plotSettings, room],
  ([$zones, $results, $plotSettings, $room]) => {
    const styles: Record<string, PlotStyle> = {};
    for (const zone of $zones) {
      const stored = $plotSettings[zone.id];
      const result = $results?.zones?.[zone.id];
      if (zone.type !== 'plane' || !result?.values) continue;
      styles[zone.id] = planePlotStyle(
        stored,
        result.values as number[][],
        zoneValueFactor(zone, result),
        $room.colormap || 'plasma',
        zoneLimitSet(zone, result),
        zone.display_mode,
      );
    }
    return styles;
  },
);
