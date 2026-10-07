/**
 * Resolve a fixture editor draft into what the editor, its confirmation
 * popup and the 3D scene display. Lengths are in the draft's units.
 *
 * - Luminous opening: the typed values, else the IES file's (LM-63 width /
 *   length / height, which describe the opening, not the fixture).
 * - Housing: the typed values, else the luminous opening, which is the
 *   first approximation of the housing (it must be at least that large).
 */
import type { EmitterOffset, IesAnalysisResponse } from '$lib/api/contract';
import type { Extents } from './photometricAxis';
import { aimToHousingExtents, type FixtureDraft, type HousingLayout } from './housingGeometry';
import { fromMeters, toMeters, type LengthUnit } from './unitConversion';

export interface FixtureView {
  luminous: Extents;              // aim frame
  luminousFromFile: Extents;      // aim frame, what the file says
  fallbackHousing: Extents;       // housing frame, used where no housing dim is typed
  layoutDisplay: HousingLayout;
  layoutMeters: HousingLayout;
  luminousHeight: number;         // depth of the opening along the beam
  surfaceMeters: { length: number; width: number; height: number };
  web: { vertices: number[][]; triangles: number[][] } | null;
}

export function resolveFixtureView(
  draft: FixtureDraft,
  analysis: IesAnalysisResponse | null,
  units: LengthUnit,
): FixtureView {
  const ext = analysis?.extents_by_axis[draft.axis];
  const luminousFromFile: Extents = {
    length: fromMeters(ext?.length ?? 0, units),
    width: fromMeters(ext?.width ?? 0, units),
    height: fromMeters(ext?.height ?? 0, units),
  };
  const luminous: Extents = {
    length: draft.surfaceLength ?? luminousFromFile.length,
    width: draft.surfaceWidth ?? luminousFromFile.width,
    height: draft.surfaceHeight ?? luminousFromFile.height,
  };
  const fallbackHousing = aimToHousingExtents(draft.face, draft.roll, luminous);
  const dims = {
    length: draft.housingLength ?? fallbackHousing.length,
    width: draft.housingWidth ?? fallbackHousing.width,
    height: draft.housingHeight ?? fallbackHousing.height,
  };
  const toM = (v: number) => toMeters(v, units);
  return {
    luminous,
    luminousFromFile,
    fallbackHousing,
    layoutDisplay: { ...dims, face: draft.face, roll: draft.roll, offset: draft.offset },
    layoutMeters: {
      length: toM(dims.length), width: toM(dims.width), height: toM(dims.height),
      face: draft.face, roll: draft.roll,
      offset: draft.offset ? (draft.offset.map(toM) as EmitterOffset) : null,
    },
    luminousHeight: luminous.height,
    surfaceMeters: { length: toM(luminous.length), width: toM(luminous.width), height: toM(luminous.height) },
    web: analysis ? { vertices: analysis.vertices, triangles: analysis.triangles } : null,
  };
}
