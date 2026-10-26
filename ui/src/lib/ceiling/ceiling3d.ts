/**
 * What the 3D view draws of the ceiling layout: the tile lines (the same
 * clipped lines the 2D plan draws), and the items that show. Planning only:
 * nothing here reaches the calculation. Coordinates are room x/y in the
 * project's units; the 3D component places them on the ceiling plane.
 */
import { tileGrid, tileLines, clipTileLines, type CeilingKeepOut, type CeilingLayout, type CeilingPointItem, type Segment } from './ceilingLayout';
import { polygonBoundingBox, type Vertex } from '$lib/utils/roomGeometry';
import { fromMeters, type LengthUnit } from '$lib/utils/unitConversion';

/** Full width in metres of each point item as drawn: a smoke detector is a 15 cm disc, a vent 30 cm square, a sensor a 12 cm cone. */
const POINT_SIZE_M = { smoke: 0.15, vent: 0.3, sensor: 0.12 } as const;

export type DrawnPoint = CeilingPointItem & { selected: boolean; /** Width in the project's units. */ size: number };
export type DrawnKeepOut = CeilingKeepOut & { selected: boolean };
export type DrawnItem = DrawnPoint | DrawnKeepOut;

export interface CeilingDrawing {
  /** The ceiling surface itself shows. */
  surface: boolean;
  tiles: Segment[];
  items: DrawnItem[];
}

export function ceilingDrawing(layout: CeilingLayout, outline: Vertex[], units: LengthUnit, selectedId: string | null): CeilingDrawing {
  if (!layout.ceilingShown) return { surface: false, tiles: [], items: [] };
  const tiles =
    layout.tilesShown && layout.tileSize !== 'none' && outline.length >= 3
      ? clipTileLines(tileLines(tileGrid(layout, outline, units), polygonBoundingBox(outline)), outline)
      : [];
  const items: DrawnItem[] = layout.itemsShown
    ? layout.items
        .filter((it) => !it.hidden)
        .map((it) =>
          it.kind === 'keep'
            ? { ...it, selected: it.id === selectedId }
            : { ...it, selected: it.id === selectedId, size: fromMeters(POINT_SIZE_M[it.kind], units) },
        )
    : [];
  return { surface: true, tiles, items };
}
