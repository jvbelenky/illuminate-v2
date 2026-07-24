/**
 * Types for the custom lamp library: self-contained lamp definitions
 * (photometry + spectrum + product fields) that live in the browser
 * (IndexedDB) or ride with the project (sessionStorage), and are
 * referenced by placed lamp instances via `custom_lamp_id`.
 */

import type { LampType } from '$lib/types/project';

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
  scalingFactor?: number;
  intensityUnits?: 'mw/sr' | 'uw/cm2';
  surface?: { width?: number; length?: number; height?: number; units?: 'meters' | 'feet' };
  housing?: { width?: number; length?: number; height?: number };
  sourceDensity?: number;
  intensityMap?: EmbeddedFile;
  scope: LampScope;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
}
