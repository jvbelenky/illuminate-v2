/**
 * Types for the custom lamp library: self-contained lamp definitions
 * (photometry + spectrum + product fields) that live in the browser
 * (IndexedDB) or ride with the project (sessionStorage), and are
 * referenced by placed lamp instances via `custom_lamp_id`.
 */

import type { LengthUnit } from '$lib/utils/unitConversion';
import type { LampType } from '$lib/types/project';
import type { PhotometricAxis } from '$lib/utils/photometricAxis';
import type { EmitterOffset, HousingFaceToken, HousingRoll } from '$lib/api/contract';

export interface EmbeddedFile {
  filename: string;
  dataBase64: string;
}

export type LampScope = 'browser' | 'project';

// A custom lamp definition's type is the same union as a placed lamp instance's.
export type CustomLampType = LampType;

export interface CustomLampDef {
  id: string;
  name: string;
  lampType: CustomLampType;
  wavelength?: number;
  ies: EmbeddedFile;
  spectrum?: EmbeddedFile & { columnIndex?: number };
  scalingFactor?: number;   // legacy: same as scalingMethod 'factor'
  // Scale the photometry on use, as in Advanced Lamp Settings: to a total power (mW),
  // a max or center irradiance (uW/cm2), or by a raw factor.
  scalingMethod?: 'factor' | 'max' | 'total' | 'center';
  scalingValue?: number;
  intensityUnits?: 'mw/sr' | 'uw/cm2';
  surface?: { width?: number; length?: number; height?: number; units?: LengthUnit };
  // Housing box (in surface units) and how the emitter sits in it; see
  // guv_calcs Fixture. Undefined layout fields mean bottom face, roll 0, flush.
  housing?: {
    width?: number;
    length?: number;
    height?: number;
    mountFace?: HousingFaceToken;
    roll?: HousingRoll;
    offset?: EmitterOffset;
  };
  // Where the beam points in the IES file's frame (guv_calcs PhotometricAxis).
  // Undefined means 'down', the convention every bundled preset follows.
  photometricAxis?: PhotometricAxis;
  // True once the user changed the fixture layout; otherwise it is the one
  // auto-detected from the IES file.
  fixtureEdited?: boolean;
  sourceDensity?: number;
  intensityMap?: EmbeddedFile;
  scope: LampScope;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
}
