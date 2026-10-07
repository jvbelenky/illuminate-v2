/**
 * Resolve a fixture editor draft into what the editor, its confirmation
 * popup and the 3D scene display: the housing (typed dims, else the fallback
 * from the file's luminous opening), the luminous opening, and the same
 * layout in meters for the scene.
 */
import type { EmitterOffset, IesAnalysisResponse } from '$lib/api/contract';
import type { Extents } from './photometricAxis';
import type { FixtureDraft, HousingLayout } from './housingGeometry';
import { fromMeters, toMeters, type LengthUnit } from './unitConversion';

export interface FixtureView {
  layoutDisplay: HousingLayout;   // display units
  layoutMeters: HousingLayout;
  luminousHeight: number;         // display units; depth of the opening along the beam
  surfaceMeters: { length: number; width: number; height: number };
  web: { vertices: number[][]; triangles: number[][] } | null;
}

export function resolveFixtureView(
  draft: FixtureDraft,
  fallbackHousing: Extents | null,
  surface: { width: number; length: number; height?: number } | null,
  analysis: IesAnalysisResponse | null,
  units: LengthUnit,
): FixtureView {
  const dims = {
    length: draft.housingLength ?? fallbackHousing?.length ?? 0,
    width: draft.housingWidth ?? fallbackHousing?.width ?? 0,
    height: draft.housingHeight ?? fallbackHousing?.height ?? 0,
  };
  const ext = analysis?.extents_by_axis[draft.axis];
  const luminousHeight = surface?.height ?? fromMeters(ext?.height ?? 0, units);
  const toM = (v: number) => toMeters(v, units);
  return {
    layoutDisplay: { ...dims, face: draft.face, roll: draft.roll, offset: draft.offset },
    layoutMeters: {
      length: toM(dims.length), width: toM(dims.width), height: toM(dims.height),
      face: draft.face, roll: draft.roll,
      offset: draft.offset ? (draft.offset.map(toM) as EmitterOffset) : null,
    },
    luminousHeight,
    surfaceMeters: {
      length: surface ? toM(surface.length) : (ext?.length ?? 0),
      width: surface ? toM(surface.width) : (ext?.width ?? 0),
      height: toM(luminousHeight),
    },
    web: analysis ? { vertices: analysis.vertices, triangles: analysis.triangles } : null,
  };
}
