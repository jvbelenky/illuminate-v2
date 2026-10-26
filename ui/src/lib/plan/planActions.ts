import type { Vertex as OutlineVertex } from '$lib/utils/roomGeometry';
import type { CalcZone, FloorPlanPlacement, LampInstance, RoomConfig, SceneObject } from '$lib/types/project';
import type { FloorPlanImage } from '$lib/stores/floorplanImage';
import type { LengthUnit } from '$lib/utils/unitConversion';
import type { PlacementMode } from '$lib/utils/lampPlacement';
import type { FixtureOption } from '$lib/utils/lampFixture';
import type { CeilingItem, CeilingKind, CeilingLayout } from '$lib/ceiling/ceilingLayout';

/**
 * What the plan does to the scene. Every call is one finished edit (a closed
 * outline, the end of a drag, a placed obstacle), applied straight away.
 */
export interface PlanActions {
  /** A valid outline (CCW, display units) that differs from the current one. */
  setOutline: (vertices: OutlineVertex[]) => void;
  /** Move, rescale or restyle the reference image; null removes it. `image` comes with a new upload. */
  setPlacement: (placement: FloorPlanPlacement | null, image?: FloorPlanImage) => void;
  addObstacle: (obj: Omit<SceneObject, 'id'>) => Promise<string>;
  updateObstacle: (id: string, partial: Partial<SceneObject>) => void;
  removeObstacle: (id: string) => void;
  /** Kept for Phase 3 (surfaces), used by point-place. Place a lamp at (x, y): with `likeId`, a copy of that lamp (fixture and aim); otherwise a new default lamp aimed straight down. */
  addLamp: (x: number, y: number, likeId?: string) => Promise<string>;
  /** Add a lamp with a fixture (`preset:…` or `custom:…`), placed automatically by a placement mode. */
  addPlacedLamp: (fixture: string, mode: PlacementMode) => Promise<string>;
  /** Copy several lamps (fixture, aim and all), shifted by (dx, dy), as one undo step. */
  copyLamps: (ids: string[], dx: number, dy: number) => Promise<string[]>;
  updateLamp: (id: string, partial: Partial<LampInstance>) => void;
  removeLamp: (id: string) => void;
  /** Add a calc zone with this geometry, on the user's zone defaults. */
  addZone: (type: 'plane' | 'volume' | 'point', geometry: Partial<CalcZone>) => Promise<string>;
  updateZone: (id: string, partial: Partial<CalcZone>) => void;
  removeZone: (id: string) => void;
  /** Copy a zone with all its settings, shifted by (dx, dy). */
  copyZone: (id: string, dx: number, dy: number) => Promise<string>;
  changeUnits: (units: LengthUnit) => void | Promise<void>;
  /** Any other room setting (height, reflectances, …). */
  updateRoom: (partial: Partial<RoomConfig>) => void;
  /** Hide an item from (or show it in) the views. */
  setHidden: (kind: 'lamps' | 'zones' | 'objects', id: string, hidden: boolean) => void;
  /** Ceiling designer: the tile grid and the eyes. */
  updateCeiling: (partial: Partial<Omit<CeilingLayout, 'items'>>) => void;
  /** Add a detector, vent, sensor or keep-out area in the middle of the room; returns its id. */
  addCeilingItem: (kind: CeilingKind) => string;
  updateCeilingItem: (id: string, partial: Partial<CeilingItem>) => void;
  removeCeilingItem: (id: string) => void;
  /** Copy a ceiling item, shifted one tile; returns the copy's id. */
  copyCeilingItem: (id: string) => string;
}

/** The scene as stored, which the plan reads (and never writes directly). */
export interface PlanScene {
  /** The room outline (CCW, display units). */
  vertices: OutlineVertex[];
  units: LengthUnit;
  precision: number;
  lamps: LampInstance[];
  objects: SceneObject[];
  zones: CalcZone[];
  /** Current reference-image placement (meters), if any. */
  floorplan: FloorPlanPlacement | null;
  /** Current reference image; null with a placement means it could not be restored. */
  image: FloorPlanImage | null;
  /** Room height (display units). */
  roomZ: number;
  /** Fixtures the Add lamp selector offers. */
  fixtures: FixtureOption[];
  room: RoomConfig;
  hidden: { lamps: Set<string>; zones: Set<string>; objects: Set<string> };
  /** The ceiling designer's tile grid and items. */
  ceiling: CeilingLayout;
}
