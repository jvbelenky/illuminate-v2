/**
 * A zone's color scale: continuous across the data range for a heatmap,
 * banded at a list of levels for contours and isosurfaces. One scale per zone,
 * used by its plot window and the room view alike.
 *
 * Level values are in the zone's display units (after the dose factor).
 */
import type { PlotLevelsSource, PlotView, ZoneDisplayMode, ZonePlotSettings } from '$lib/types/project';
import { isoColorHex, valueToColor, type RGB } from './colormaps';

export const MAX_LEVELS = 10;
const AUTO_LEVEL_COUNT = 4;

export type ZoneKind = 'plane' | 'volume';

export interface ResolvedPlotSettings {
  view: PlotView;
  levelsSource: PlotLevelsSource;
  levelCount: number;
  levels: number[];
  colors: (string | null)[];
  labels: (string | null)[];
  filled: boolean;
  showValues: boolean;
  /** The custom title; null for the default. */
  title: string | null;
  decimals: number;
}

export interface ValueRange {
  min: number;
  max: number;
  /** The bulk of the data (5th to 99.5th percentile), which auto levels span. */
  lo?: number;
  hi?: number;
}

export function planeViews(): PlotView[] {
  return ['heatmap', 'contours'];
}

/** Contours and isosurfaces are drawn at levels; they have no continuous form. */
export function viewNeedsLevels(view: PlotView): boolean {
  return view === 'contours' || view === 'iso';
}

/**
 * The stored settings with defaults filled in and impossible combinations
 * fixed. A plane displayed in the room as a heatmap or contours is plotted
 * that way too: its display mode is the one setting for both.
 */
export function resolvePlotSettings(
  kind: ZoneKind,
  settings: ZonePlotSettings | undefined,
  displayMode?: ZoneDisplayMode,
): ResolvedPlotSettings {
  const s = settings ?? {};
  const view: PlotView = kind === 'volume'
    ? 'iso'
    : displayMode === 'heatmap' || displayMode === 'contours'
      ? displayMode
      : s.view && planeViews().includes(s.view) ? s.view : 'heatmap';
  const levels = (s.levels ?? []).filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  const levelsSource = s.levelsSource === 'custom' && levels.length === 0 ? 'auto' : (s.levelsSource ?? 'auto');
  return {
    view,
    levelsSource,
    levelCount: Math.min(MAX_LEVELS, Math.max(1, Math.round(s.levelCount ?? AUTO_LEVEL_COUNT))),
    levels,
    colors: s.colors ?? [],
    labels: s.labels ?? [],
    filled: s.filled ?? true,
    showValues: kind === 'plane' && (s.showValues ?? false),
    title: s.title?.trim() || null,
    decimals: Math.min(6, Math.max(0, Math.round(s.decimals ?? 2))),
  };
}

/** Finite min and max of the values, and the span of their bulk; null when there are none. */
export function valueRange(values: Iterable<number>, factor = 1): ValueRange | null {
  const finite: number[] = [];
  for (const v of values) if (Number.isFinite(v)) finite.push(v * factor);
  if (finite.length === 0) return null;
  const sorted = Float64Array.from(finite).sort();
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];
  return { min: sorted[0], max: sorted[sorted.length - 1], lo: at(0.05), hi: at(0.995) };
}

export function roundSig(v: number, digits = 3): number {
  return v === 0 ? 0 : Number(v.toPrecision(digits));
}

/**
 * `count` levels spread through the bulk of the data, so a lamp's hot spot or
 * a dark corner doesn't stretch them: round values on the 1–2–5 sequence, then
 * a finer one, then evenly spaced on a log scale when neither has enough.
 */
export function autoLevels(range: ValueRange | null, count = AUTO_LEVEL_COUNT): number[] {
  if (!range || !(range.max > 0)) return [];
  const hi = range.hi && range.hi > 0 ? range.hi : range.max;
  const lo = Math.max(range.lo ?? range.min, hi * 1e-6);
  if (!(hi > lo)) return [roundSig(hi)];
  const spread = (candidates: number[]) => {
    if (count === 1) return [candidates[Math.floor(candidates.length / 2)]];
    return Array.from({ length: count }, (_, k) => candidates[Math.round((k * (candidates.length - 1)) / (count - 1))]);
  };
  for (const steps of [[1, 2, 5], [1, 1.5, 2, 3, 5, 7]]) {
    const candidates: number[] = [];
    for (let e = Math.floor(Math.log10(lo)) - 1; e <= Math.ceil(Math.log10(hi)); e++) {
      for (const m of steps) {
        const v = roundSig(m * 10 ** e);
        if (v > lo && v < hi) candidates.push(v);
      }
    }
    if (candidates.length >= count) return spread(candidates);
  }
  // Log-spaced inside (lo, hi), to two significant figures, nudged apart if rounding merges two
  const levels: number[] = [];
  for (let k = 1; k <= count; k++) {
    let v = roundSig(lo * (hi / lo) ** (k / (count + 1)), 2);
    while (levels.length && v <= levels[levels.length - 1]) v = roundSig(v * 1.05, 3);
    levels.push(v);
  }
  return levels;
}

/**
 * Where a level came from a limit: which one, and, in a room whose lamps have
 * different limits, the limit at each point of the plane (as a dose, with the
 * dose it is weighed to over the plane), so the level's line can be drawn
 * where each point reaches the same fraction of its own limit.
 */
export interface LevelLimit {
  key: string;
  perPoint: { ref: number; grid: (number | null)[][] } | null;
}

/** A limit in a zone's units, by name. */
export interface NamedLimit {
  name: string;
  value: number;
  /** Its key in the zone's results ('icnirp', 'acgih_eye', 'acgih_skin'). */
  key?: string;
  perPoint?: LevelLimit['perPoint'];
}

/** The levels Limits sets, ascending, each with its name. */
export interface LimitSet {
  levels: number[];
  labels: string[];
  /** The limit behind each level. */
  levelLimits: (LevelLimit | null)[];
  /** Every limit, coinciding ones included, for the percentage presets. */
  named: NamedLimit[];
}

function levelLimit(limit: NamedLimit): LevelLimit | null {
  return limit.key ? { key: limit.key, perPoint: limit.perPoint ?? null } : null;
}

/** The named limits in a zone's units, ascending, any that coincide given once. */
export function limitSet(limits: NamedLimit[]): LimitSet | null {
  const entries: { level: number; label: string; limit: NamedLimit }[] = [];
  const named: NamedLimit[] = [];
  for (const limit of limits) {
    if (!(Number.isFinite(limit.value) && limit.value > 0)) continue;
    const level = roundSig(limit.value);
    named.push({ ...limit, value: level });
    if (!entries.some((e) => e.level === level)) entries.push({ level, label: limit.name, limit });
  }
  if (entries.length === 0) return null;
  entries.sort((a, b) => a.level - b.level);
  return {
    levels: entries.map((e) => e.level),
    labels: entries.map((e) => e.label),
    levelLimits: entries.map((e) => levelLimit(e.limit)),
    named,
  };
}

/** The level presets that are fractions of one limit: 25, 50, 75, 100% of it for four levels. */
export const PERCENT_PRESETS: { source: PlotLevelsSource; limit: string }[] = [
  { source: 'pct-icnirp', limit: 'ICNIRP' },
  { source: 'pct-acgih-eye', limit: 'ACGIH Eye' },
  { source: 'pct-acgih-skin', limit: 'ACGIH Skin' },
];

/** Whether the levels come from the limits, so follow them as they change. */
export function isLimitSource(source: PlotLevelsSource): boolean {
  return source === 'limits' || PERCENT_PRESETS.some((p) => p.source === source);
}

/** The levels and names a limit-based source sets now; null without the limit it needs. */
export function limitLevels(s: Pick<ResolvedPlotSettings, 'levelsSource' | 'levelCount'>, limits: LimitSet | null | undefined): LimitSet | null {
  if (!limits) return null;
  if (s.levelsSource === 'limits') return limits;
  const preset = PERCENT_PRESETS.find((p) => p.source === s.levelsSource);
  const limit = preset && limits.named.find((l) => l.name === preset.limit);
  if (!preset || !limit) return null;
  const n = s.levelCount;
  const steps = Array.from({ length: n }, (_, i) => (i + 1) / n);
  return {
    levels: steps.map((f) => roundSig(f * limit.value)),
    labels: steps.map((f) => `${roundSig(f * 100, 3)}% ${preset.limit}`),
    levelLimits: steps.map(() => levelLimit(limit)),
    named: limits.named,
  };
}

/**
 * The levels in force: typed in, fractions of the limit, or picked from the
 * data. Levels from the limits recompute where the limits are known (the plot
 * window) and otherwise use the levels stored when they were last set (the room view).
 */
export function resolveLevels(s: ResolvedPlotSettings, range: ValueRange | null, limits?: LimitSet | null): number[] {
  if (s.levelsSource === 'custom' && s.levels.length) return s.levels;
  if (isLimitSource(s.levelsSource)) {
    const set = limitLevels(s, limits);
    if (set?.levels.length) return set.levels;
    if (s.levels.length) return s.levels;
  }
  return autoLevels(range, s.levelCount);
}

/** One color per level: the override where set, else evenly spaced along the colormap. */
export function levelColors(count: number, overrides: (string | null)[], colormap: string): string[] {
  return Array.from({ length: count }, (_, i) => overrides[i] ?? isoColorHex(i, count, colormap));
}

export interface ColorScale {
  range: ValueRange;
  colormap: string;
  /** Ascending levels when banded, null when continuous. */
  levels: number[] | null;
  colors: string[];
  /** Each level's name; null shows its value. */
  names: (string | null)[] | null;
  /** The limit each level was set from, where the levels follow the limits. */
  levelLimits: (LevelLimit | null)[] | null;
}

export function buildColorScale(
  s: ResolvedPlotSettings,
  range: ValueRange | null,
  colormap: string,
  limits?: LimitSet | null,
): ColorScale {
  const r = range ?? { min: 0, max: 0 };
  if (!viewNeedsLevels(s.view)) return { range: r, colormap, levels: null, colors: [], names: null, levelLimits: null };
  const levels = resolveLevels(s, range, limits);
  const names = levels.map((_, i) => s.labels[i]?.trim() || null);
  const live = isLimitSource(s.levelsSource) ? limitLevels(s, limits) : null;
  const levelLimits = live && live.levels.length === levels.length ? live.levelLimits : null;
  return { range: r, colormap, levels, colors: levelColors(levels.length, s.colors, colormap), names, levelLimits };
}

/** Index of the highest level at or below `v`; -1 below the lowest. */
export function bandIndex(levels: number[], v: number): number {
  let idx = -1;
  for (let i = 0; i < levels.length; i++) {
    if (v >= levels[i]) idx = i;
    else break;
  }
  return idx;
}

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

/**
 * The color for a display-unit value; null for a value outside the data
 * (NaN) or below the lowest level, which callers draw as background.
 */
export function scaleColor(scale: ColorScale, v: number): RGB | null {
  if (!Number.isFinite(v)) return null;
  if (scale.levels) {
    const i = bandIndex(scale.levels, v);
    return i < 0 ? null : hexToRgb(scale.colors[i]);
  }
  const span = scale.range.max - scale.range.min || 1;
  return valueToColor(Math.min(1, Math.max(0, (v - scale.range.min) / span)), scale.colormap);
}

// --- Level list edits. Each keeps every level's color and name with it. ---

export interface LevelList {
  levels: number[];
  colors: (string | null)[];
  labels: (string | null)[];
}

function sortTogether(list: LevelList): LevelList {
  const paired = list.levels.map((level, i) => ({ level, color: list.colors[i] ?? null, label: list.labels[i] ?? null }));
  paired.sort((a, b) => a.level - b.level);
  return { levels: paired.map((p) => p.level), colors: paired.map((p) => p.color), labels: paired.map((p) => p.label) };
}

/** `values` padded or cut to one entry per level. */
function perLevel<T>(list: LevelList, values: (T | null)[]): (T | null)[] {
  return Array.from({ length: list.levels.length }, (_, i) => values[i] ?? null);
}

export function setLevelValue(list: LevelList, index: number, value: number): LevelList {
  if (!(Number.isFinite(value) && value > 0)) return list;
  const levels = [...list.levels];
  levels[index] = value;
  return sortTogether({ ...list, levels });
}

export function setLevelColor(list: LevelList, index: number, color: string): LevelList {
  const colors = perLevel(list, list.colors);
  colors[index] = color;
  return { ...list, colors };
}

export function setLevelLabel(list: LevelList, index: number, label: string): LevelList {
  const labels = perLevel(list, list.labels);
  labels[index] = label.trim() || null;
  return { ...list, labels };
}

/** Add a level halfway between the top level and the data max (or above the top one). */
export function addLevel(list: LevelList, dataMax: number | null): LevelList {
  if (list.levels.length >= MAX_LEVELS) return list;
  const top = list.levels.at(-1);
  let value: number;
  if (top === undefined) value = dataMax && dataMax > 0 ? dataMax / 2 : 1;
  else value = dataMax != null && top < dataMax ? (top + dataMax) / 2 : top * 1.5;
  return sortTogether({
    levels: [...list.levels, roundSig(value)],
    colors: [...perLevel(list, list.colors), null],
    labels: [...perLevel(list, list.labels), null],
  });
}

export function removeLevel(list: LevelList, index: number): LevelList {
  if (list.levels.length <= 1) return list;
  return {
    levels: list.levels.filter((_, i) => i !== index),
    colors: list.colors.filter((_, i) => i !== index),
    labels: list.labels.filter((_, i) => i !== index),
  };
}

/** How the plot marks a level: its name where it has one, else its value. */
export function levelText(scale: ColorScale, index: number, decimals: number): string {
  return scale.names?.[index] ?? formatPlotValue(scale.levels?.[index] ?? 0, decimals);
}

/** Every value of a volume's 3D grid. */
export function* volumeValues(values: number[][][]): Generator<number> {
  for (const plane of values) for (const row of plane) yield* row;
}

/** Isosurface levels in the stored values' units, with one color each. */
export interface IsoScale {
  levels: number[];
  colors: string[];
}

// The range of a volume's values, kept per result so a store change doesn't re-sort them
const volumeRanges = new WeakMap<number[][][], { factor: number; range: ValueRange | null }>();

function cachedVolumeRange(values: number[][][], factor: number): ValueRange | null {
  const hit = volumeRanges.get(values);
  if (hit && hit.factor === factor) return hit.range;
  const range = valueRange(volumeValues(values), factor);
  volumeRanges.set(values, { factor, range });
  return range;
}

/** A volume's isosurfaces from its plot settings; `factor` converts stored values to display units. */
export function volumeIsoScale(
  stored: ZonePlotSettings | undefined,
  values: number[][][],
  factor: number,
  colormap: string,
  limits?: LimitSet | null,
): { scale: ColorScale; iso: IsoScale } {
  const scale = buildColorScale(resolvePlotSettings('volume', stored), cachedVolumeRange(values, factor), colormap, limits);
  const f = factor || 1;
  return { scale, iso: { levels: (scale.levels ?? []).map((l) => l / f), colors: scale.colors } };
}

/** The number as the plot shows it. */
export function formatPlotValue(v: number, decimals: number): string {
  return v.toFixed(decimals);
}
