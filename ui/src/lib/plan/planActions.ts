import type { Vertex as OutlineVertex } from '$lib/utils/roomGeometry';
import type { CalcZone, FloorPlanPlacement, LampInstance, RoomConfig, SceneObject } from '$lib/types/project';
import type { FloorPlanImage } from '$lib/stores/floorplanImage';
import type { LengthUnit } from '$lib/utils/unitConversion';
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
  /** Add a new lamp ("Lamp N", no fixture yet unless the user's defaults name one) at a default placement; one undo step. */
  addNewLamp: () => Promise<string>;
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
  /** Add a detector, vent, sensor or keep-out area in the middle of the room (a keep-out area with `vertices`: that outline, one undo step); returns its id. */
  addCeilingItem: (kind: CeilingKind, vertices?: OutlineVertex[]) => string | null;
  updateCeilingItem: (id: string, partial: Partial<CeilingItem>) => void;
  removeCeilingItem: (id: string) => void;
  /** Copy a ceiling item, shifted one tile; returns the copy's id. */
  copyCeilingItem: (id: string) => string | null;
  /** Paste copied lamps (a snapshot, the originals may be gone), shifted by (dx, dy), as one undo step. */
  pasteLamps: (lamps: LampInstance[], dx: number, dy: number) => Promise<string[]>;
  /** Paste a copied zone, shifted by (dx, dy). */
  pasteZone: (zone: CalcZone, dx: number, dy: number) => Promise<string>;
  /** Paste a copied ceiling item, `n` tiles along (1 for the first paste); null when the layout is full. */
  pasteCeilingItem: (item: CeilingItem, n: number) => string | null;
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
  /** Fixtures the lamp editor's fixture dropdown offers. */
  fixtures: FixtureOption[];
  room: RoomConfig;
  hidden: { lamps: Set<string>; zones: Set<string>; objects: Set<string> };
  /** The ceiling designer's tile grid and items. */
  ceiling: CeilingLayout;
}
