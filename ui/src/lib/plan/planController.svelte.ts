import { tick } from 'svelte';
import type PlanCanvas from '$lib/components/PlanCanvas.svelte';
import type { CanvasTool, PlanShape } from '$lib/components/PlanCanvas.svelte';
import type { CalcZone, FloorPlanPlacement, LampInstance } from '$lib/types/project';
import type { FloorPlanImage } from '$lib/stores/floorplanImage';
import type { PlacementMode } from '$lib/utils/lampPlacement';
import type { PlanContext } from '$lib/workspace/editorNav';
import type { PlanActions, PlanScene } from './planActions';
import { draftsFromObjects, draftFromPolygon, duplicateDraft, objectFromDraft, footprintGeometry } from '$lib/utils/obstacleDrafts';
import { zoneHasFootprint, zoneFootprint, footprintGeometry as zoneFootprintGeometry } from '$lib/utils/zoneFootprint';
import { displayDimension } from '$lib/utils/formatting';
import { unitAbbrev, unitsPerMeter, unitSnap, lengthFactor, roundToUnit, fromMeters, type LengthUnit } from '$lib/utils/unitConversion';
import {
  type Vertex,
  polygonArea,
  polygonBoundingBox,
  polygonEdgeLengths,
  edgeMidpoints,
  validatePolygon,
  normalizeCCW,
} from '$lib/utils/roomGeometry';
import { initialPlacement, imageRect, rescaleAboutPoint, scaleFromMeasurement } from '$lib/utils/floorplanImage';
import { decodeFloorPlanFile, isSupportedFloorPlanFile, FloorPlanDecodeError, type DecodedFloorPlan } from '$lib/utils/floorplanDecode';
import { planShouldHandleKey } from './planKeys';
import { stepSurface as stepSurfaceFrom, allSurfaces, wallIndex, wallSegment, zoneSurface, zoneWallIndex, toWall, fromWall, type Surface, type WallSegment } from '$lib/utils/surfaces';
import { pickMode, type PickRequest } from '$lib/stores/pickMode';
import { wallOutline, wallDepth, projectLamps, projectStructures, neighbourLabels, wallToCanvas, canvasToWall, unprojectLampMove, unprojectStructureMove } from './wallProjection';
import { wallPlaneOutline } from '$lib/utils/planeWorld';
import { tileGrid, tileLines, clipTileLines, snapToTileCentre, keepOutEditAllowed, pointMoveAllowed, MAX_CEILING_ITEMS, type CeilingItem, type CeilingKind, type CeilingKeepOut, type CeilingPointItem } from '$lib/ceiling/ceilingLayout';

/** A lamp (Lamps context) or a calc point (Zones context) on the plan. */
export interface Marker { id: string; name: string; x: number; y: number; ax: number; ay: number; enabled: boolean }

interface PlanHistory { undo(): void; redo(): void; canUndo: boolean; canRedo: boolean }

const clone = (vs: Vertex[]) => vs.map((v) => [v[0], v[1]] as Vertex);
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
/** A flow waiting for the 2D canvas is dropped if the canvas takes longer than this. */
const CANVAS_WAIT_MS = 2000;
/** In a wall view only structures at least this opaque (near the wall) can be dragged, so far ones don't steal clicks. */
const WALL_DRAGGABLE_OPACITY = 0.5;

/**
 * The same polygon up to where it starts and which way it winds. The store
 * keeps outlines CCW (and an origin rectangle as plain x/y), so an applied
 * draft can come back reordered; the corner table must not jump when it does.
 */
export function samePolygon(a: Vertex[], b: Vertex[]): boolean {
  const n = a.length;
  if (n !== b.length) return false;
  if (n === 0) return true;
  const close = (p: Vertex, q: Vertex) => Math.abs(p[0] - q[0]) < 1e-9 && Math.abs(p[1] - q[1]) < 1e-9;
  for (let start = 0; start < n; start++) {
    for (const dir of [1, -1]) {
      if (a.every((p, i) => close(p, b[(((start + dir * i) % n) + n) % n]))) return true;
    }
  }
  return false;
}

export { isTypingTarget, planShouldHandleKey } from './planKeys';

/**
 * The guided plan editor's state and behaviour: the outline, obstacles, lamps,
 * calc zones and reference image, and the keyboard. Every finished edit goes
 * through `actions`; the stored scene is read through `scene()`. Whoever renders
 * the canvas binds `canvas`, `draft`, `drawing`, `selectedIndex` and `tool`, and
 * keeps the draft following the stored polygon with an effect that calls
 * `followSource(ctl.source)`.
 */
export class PlanController {
  readonly actions: PlanActions;
  readonly scene: () => PlanScene;
  readonly history: PlanHistory | undefined;

  // Every finished edit is applied at once through `actions`; the scene is as
  // stored. The canvas edits `draft`, a copy of one polygon (the outline, or the
  // selected obstacle's world footprint) that only lives for the gesture in
  // flight. An edit that leaves the polygon invalid stays local (drawn red) and
  // is not applied, so the stored scene is always the last valid one.
  draft = $state<Vertex[]>([]);
  // 'custom' is the Set scale tool: the canvas hands clicks and moves to us
  tool = $state<CanvasTool>('edit');
  drawing = $state(false);
  selectedIndex = $state(-1);
  #canvas = $state<PlanCanvas | null>(null);
  get canvas(): PlanCanvas | null {
    return this.#canvas;
  }
  set canvas(c: PlanCanvas | null) {
    this.#canvas = c;
    const pending = this.#pendingCanvas;
    if (!c || !pending) return;
    this.#pendingCanvas = null;
    // Once the canvas has mounted; dropped if it took too long to come
    tick().then(() => {
      if (this.#canvas && Date.now() - pending.at <= CANVAS_WAIT_MS) pending.run();
    });
  }
  /** Asked when a flow needs the 2D canvas and it is not there (the host shows the 2D view). */
  onNeedCanvas: (() => void) | undefined = undefined;
  #pendingCanvas: { run: () => void; at: number } | null = null;
  /** Run a flow that needs the canvas now, or once the host has brought it up. */
  private withCanvas(run: () => void) {
    if (this.#canvas || !this.onNeedCanvas) {
      run();
      return;
    }
    this.#pendingCanvas = { run, at: Date.now() };
    this.onNeedCanvas();
  }
  /** Run a tool that works on the 2D canvas (the edit strip in 3D brings the 2D view up first). */
  inCanvas = (run: () => void) => this.withCanvas(run);
  /**
   * Whether the edit strip has tools for this context: not on reflectance or
   * the view, not on a wall outside Zones, and on the ceiling only with an item
   * selected or tiles to move.
   */
  get editStripShown(): boolean {
    if (this.context === 'reflectance' || this.context === 'view') return false;
    if (this.onWall && !this.onZones) return false;
    return !(this.onCeiling && !this.selectedCeilingItem && !this.tilesActive);
  }
  /** A local edit of the current polygon that is invalid, so not applied. */
  dirty = $state(false);

  // --- Surface (which room surface the 2D view shows: floor, ceiling or a wall)
  private _surface = $state<Surface>('floor');
  /** A wall whose index the outline no longer has reads as the floor. */
  get surface(): Surface {
    const w = wallIndex(this._surface);
    return w !== null && w >= this.scene().vertices.length ? 'floor' : this._surface;
  }
  set surface(s: Surface) { this._surface = s; }
  get surfaces(): Surface[] { return allSurfaces(this.scene().vertices); }
  get wallSeg(): ReturnType<typeof wallSegment> {
    const w = wallIndex(this.surface);
    return w === null ? null : wallSegment(this.scene().vertices, w);
  }
  /** A wall is showing: its elevation, with nothing of the floor plan to edit. */
  get onWall(): boolean { return this.wallSeg !== null; }
  /**
   * The wall view on its canvas, seen from inside (`wallToCanvas`): the wall face, the lamps
   * and structures in front of it (farthest first, faded by distance), and
   * the walls meeting it at each end. Null off a wall.
   */
  readonly wallView = $derived.by(() => {
    const seg = this.wallSeg;
    const w = wallIndex(this.surface);
    if (!seg || w === null) return null;
    const { vertices, roomZ, lamps } = this.scene();
    const depth = wallDepth(vertices, seg);
    const lampById = new Map(lamps.map((l) => [l.id, l]));
    const projected = projectLamps(lamps, seg, depth);
    const mdrag = this.markerDrag?.part === 'body' ? this.markerDrag : null;
    const sdrag = this.wallShapeDrag;
    const obstacleByKey = new Map(this.obstacles.map((o) => [o.key, o]));
    const structures = projectStructures(this.obstacles.map((o) => ({ id: o.key, vertices: o.vertices, z: o.z, height: o.height })), seg, roomZ, depth);
    return {
      outline: wallOutline(seg, roomZ),
      lamps: projected.map((p): LampInstance => {
        const [x, y] = wallToCanvas(p.along, p.up, seg);
        const d = mdrag && mdrag.group.includes(p.id) ? mdrag : null;
        return { ...lampById.get(p.id)!, x: x + (d?.dx ?? 0), y: y + (d?.dy ?? 0) };
      }),
      lampOpacity: Object.fromEntries(projected.map((p) => [p.id, p.opacity])) as Record<string, number>,
      shapes: structures.map((st): PlanShape => {
        const o = obstacleByKey.get(st.id)!;
        const d = sdrag && sdrag.id === st.id ? sdrag : null;
        const vertices = st.rect.map(([a, u]) => wallToCanvas(a, u, seg)).map(([x, y]): Vertex => [x + (d?.dx ?? 0), y + (d?.dy ?? 0)]);
        return { id: st.id, vertices, name: o.name, opacity: st.opacity, selected: this.onObstacles && o.id === this.selectedId, disabled: !o.enabled, inert: st.opacity < WALL_DRAGGABLE_OPACITY };
      }),
      labels: neighbourLabels(vertices, w),
      planes: this.userZones
        .filter((z) => zoneWallIndex(z) === w)
        .map((z) => ({ id: z.id, name: z.name || z.id, vertices: this.wallCanvasOutline(z, seg), enabled: z.enabled !== false })),
    };
  });
  /** A wall plane's outline on its wall's canvas (seen from inside). */
  private wallCanvasOutline(z: CalcZone, seg: WallSegment): Vertex[] {
    return wallPlaneOutline(z, seg, this.scene().roomZ).map(([a, u]) => wallToCanvas(a, u, seg));
  }
  /** Corners drawn on a wall's canvas as a stored outline: (along, up), CCW. */
  private toWallOutline(draft: Vertex[], seg: WallSegment): [number, number][] {
    return normalizeCCW(draft.map(([x, y]) => {
      const { along, up } = canvasToWall(x, y, seg);
      return [r6(along), r6(up)] as Vertex;
    })).map(([a, u]) => [a, u] as [number, number]);
  }
  /** The surface a zone lies on matches the one showing (volumes and points lie on the floor). */
  private zoneOnSurface(z: CalcZone): boolean {
    if (z.type !== 'plane') return this.surface === 'floor';
    return zoneSurface(z, this.scene().roomZ) === this.surface;
  }
  /** The polygon the canvas edits for a zone: a wall plane's outline on its wall, else its footprint. */
  private zoneOutline(z: CalcZone): Vertex[] {
    const w = zoneWallIndex(z);
    const seg = w === null ? null : wallSegment(this.scene().vertices, w);
    if (seg) return this.wallCanvasOutline(z, seg);
    return z.type !== 'point' && zoneHasFootprint(z) ? clone(zoneFootprint(z)) : [];
  }
  /** The draft a context starts with: the outline's corners when editing it on the floor, else none. */
  private contextDraft(context: PlanContext = this.context): Vertex[] {
    return clone(context === 'outline' && !this.onWall ? this.scene().vertices : []);
  }
  /** Show another surface, dropping the draft and selection (a zone pick keeps them: it sets `surface` itself). */
  setSurface = (next: Surface) => {
    if (next === this.surface) return;
    const refit = wallIndex(next) !== null || this.onWall;
    if (this.drawing) this.canvas?.cancelDraw();
    if (this.tool === 'custom') { this.cancelMeasure(); this.tool = 'edit'; }
    this.planSelected = false;
    this.selectedId = null;
    this.selectedLampIds = [];
    // A selected point stays selected: Place and Aim can pick on any surface
    if (this.selectedZone?.type !== 'point') this.selectedZoneId = null;
    this.clearCeilingState();
    this.marquee = null;
    this.selectedIndex = -1;
    this._surface = next;
    this.draft = this.contextDraft();
    if (refit) this.fitRequest++;
  };
  stepSurface = (delta: 1 | -1) => this.setSurface(stepSurfaceFrom(this.surface, this.scene().vertices, delta));

  // --- Context (what the plan edits)
  context = $state<PlanContext>('outline');
  readonly onOutline = $derived(this.context === 'outline');
  readonly onObstacles = $derived(this.context === 'obstacles');
  readonly onLamps = $derived(this.context === 'lamps');
  readonly onZones = $derived(this.context === 'zones');
  readonly onReflectance = $derived(this.context === 'reflectance');
  readonly onCeiling = $derived(this.context === 'ceiling');

  // --- Obstacles, straight from the scene
  readonly obstacles = $derived.by(() => draftsFromObjects(this.scene().objects));
  selectedId = $state<string | null>(null);
  readonly selected = $derived(this.selectedId ? this.obstacles.find((o) => o.id === this.selectedId) ?? null : null);
  /** Reflectance: the surface the pointer is over in the list ('walls' or an obstacle id). */
  hoveredSurface = $state<'walls' | string | null>(null);
  readonly shapes = $derived<PlanShape[]>(
    this.obstacles
      .filter((o) => !(this.onObstacles && o.id === this.selectedId && !this.drawing))
      .map((o) => {
        const lit = this.onReflectance && this.hoveredSurface === o.id;
        return { id: o.key, vertices: o.vertices, name: o.name, selected: (this.onObstacles && o.id === this.selectedId) || lit, dimmed: !this.onObstacles && !lit, disabled: !o.enabled };
      })
  );

  // Calc zones: flat planes and volumes are footprints drawn like obstacles
  readonly userZones = $derived.by(() => this.scene().zones.filter((z) => !z.isStandard));
  selectedZoneId = $state<string | null>(null);
  readonly selectedZone = $derived(this.selectedZoneId ? this.userZones.find((z) => z.id === this.selectedZoneId) ?? null : null);
  readonly selectedFootprint = $derived(this.selectedZone && this.selectedZone.type !== 'point' && zoneHasFootprint(this.selectedZone) && this.zoneOnSurface(this.selectedZone) ? this.selectedZone : null);
  /** The selected plane on the wall showing: its outline is the canvas's polygon there. */
  readonly selectedWallPlane = $derived(this.onWall && this.selectedZone && zoneWallIndex(this.selectedZone) === wallIndex(this.surface) ? this.selectedZone : null);
  drawKind = $state<'plane' | 'volume' | null>(null);
  /** A Draw that replaces the selected zone's outline, rather than adding a zone. */
  redrawZoneId: string | null = null;
  readonly footprintZones = $derived(this.userZones.filter((z) => z.type !== 'point' && zoneHasFootprint(z)));
  /** Footprints on the floor or ceiling showing: floor planes and volumes on the floor, ceiling planes on the ceiling. */
  readonly surfaceZones = $derived(this.footprintZones.filter((z) => this.zoneOnSurface(z)));
  /** Wall planes seen on the floor view: a line along their wall, at their distance from it. */
  readonly wallPlaneLines = $derived.by(() => {
    const { vertices, roomZ } = this.scene();
    return this.userZones.flatMap((z) => {
      const w = zoneWallIndex(z);
      const seg = w === null ? null : wallSegment(vertices, w);
      if (!seg) return [];
      const along = wallPlaneOutline(z, seg, roomZ).map((p) => p[0]);
      const off = z.normal_offset ?? 0;
      const a = fromWall(Math.min(...along), 0, off, seg), b = fromWall(Math.max(...along), 0, off, seg);
      return [{ id: z.id, name: z.name || z.id, x1: a.x, y1: a.y, x2: b.x, y2: b.y, enabled: z.enabled !== false }];
    });
  });

  // --- Ceiling: the tile grid and the items on it. A detector, vent or sensor
  // drags to move (to the middle of a tile while the tiles show; Alt: free); a
  // keep-out area, once selected, is the canvas's polygon like a structure's
  // footprint. Move grid drags the grid's offset.
  readonly ceiling = $derived.by(() => this.scene().ceiling);
  selectedCeilingId = $state<string | null>(null);
  readonly selectedCeilingItem = $derived.by<CeilingItem | null>(() => (this.selectedCeilingId ? this.ceiling.items.find((i) => i.id === this.selectedCeilingId) ?? null : null));
  readonly selectedKeepOut = $derived.by<CeilingKeepOut | null>(() => (this.selectedCeilingItem?.kind === 'keep' ? this.selectedCeilingItem : null));
  /** Whether an item shows on the plan (its eye, the items' eye and the ceiling's eye). */
  ceilingItemShown = (it: CeilingItem): boolean => this.ceiling.ceilingShown && this.ceiling.itemsShown && !it.hidden;
  /** The selected keep-out area while it shows: the canvas edits it (no handles for a hidden one). */
  readonly editableKeepOut = $derived.by<CeilingKeepOut | null>(() => (this.selectedKeepOut && this.ceilingItemShown(this.selectedKeepOut) ? this.selectedKeepOut : null));
  /** The Move grid tool is on (only offered with nothing selected and the tiles showing). */
  gridMove = $state(false);
  gridDrag = $state<{ start: Vertex; from: [number, number]; offset: [number, number] } | null>(null);
  ceilingDrag = $state<{ id: string; start: Vertex; from: Vertex; at: Vertex } | null>(null);
  /** Tiles that snap items and can be moved: a size is chosen and they are shown. */
  readonly tilesActive = $derived(this.ceiling.tileSize !== 'none' && this.ceiling.tilesShown);
  readonly ceilingGrid = $derived.by(() => tileGrid({ ...this.ceiling, offset: this.gridDrag?.offset ?? this.ceiling.offset }, this.scene().vertices, this.scene().units));
  /** The tile grid's lines, cut to the room outline. */
  readonly tileSegments = $derived.by(() => {
    const vs = this.scene().vertices;
    if (!this.tilesActive || vs.length < 3) return [];
    return clipTileLines(tileLines(this.ceilingGrid, polygonBoundingBox(vs)), vs);
  });

  /** The stored polygon the canvas edits in this context. */
  readonly source = $derived.by(() =>
    this.onWall ? (this.onZones && this.selectedWallPlane && this.wallSeg ? this.wallCanvasOutline(this.selectedWallPlane, this.wallSeg) : [])
      : this.onOutline ? this.scene().vertices
      : this.onObstacles ? (this.selected?.vertices ?? [])
      : this.onZones && this.selectedFootprint ? zoneFootprint(this.selectedFootprint)
      : this.onCeiling && this.editableKeepOut ? this.editableKeepOut.vertices
      : []
  );

  // Leaving a context (or closing) with an invalid outline asks first
  pendingLeave = $state<(() => void) | null>(null);

  // --- Lamps and calc points. Each is a ring (drag to move it; the aim point
  // travels along) with a dot at its aim point (drag to aim). Each finished
  // drag is one update. Lamps live in the Lamps context, points in Zones.
  // Lamps: one or several selected (Shift-click, or drag a box on empty space).
  // Move drags the selection; Aim points it at where the drag ends.
  selectedLampIds = $state<string[]>([]);
  /** The selection minus ids that no longer exist (an undone add leaves them behind). */
  readonly liveLampIds = $derived.by(() => {
    const lamps = this.scene().lamps;
    return this.selectedLampIds.filter((id) => lamps.some((l) => l.id === id));
  });
  readonly selectedLampId = $derived(this.selectedLampIds.length === 1 ? this.selectedLampIds[0] : null);
  readonly selectedLamp = $derived.by(() => this.selectedLampId ? this.scene().lamps.find((l) => l.id === this.selectedLampId) ?? null : null);
  lampMode = $state<'move' | 'aim'>('move');
  // Placing a new lamp or point by clicking the plan
  placing = $state(false);
  placeCursor = $state<Vertex | null>(null);
  /** A selected point's Place or Aim pick running on this canvas: the next click sets that position. */
  pointPick = $state<'point_position' | 'aim_point' | null>(null);
  markerDrag = $state<{ id: string; part: 'body' | 'aim' | 'aimAt'; start: Vertex; dx: number; dy: number; target: Vertex | null; group: string[] } | null>(null);
  marquee = $state<{ a: Vertex; b: Vertex; add: boolean } | null>(null);

  // --- Add lamp: choose a fixture, then each placement button adds one, placed automatically
  addFixture = $state('');
  addingLamp = $state<PlacementMode | null>(null);

  readonly markers = $derived.by<Marker[]>(() => {
    const seg = this.wallSeg;
    if (seg && this.onLamps) {
      // In a wall view the markers are the lamps in front of it, on its canvas (no aim point)
      const { lamps } = this.scene();
      const front = new Set(projectLamps(lamps, seg).map((p) => p.id));
      return lamps.filter((l) => front.has(l.id)).map((l) => {
        const w = toWall(l.x, l.y, l.z, seg);
        const [x, y] = wallToCanvas(w.along, w.up, seg);
        return { id: l.id, name: l.name || l.id, x, y, ax: x, ay: y, enabled: l.enabled !== false };
      });
    }
    return this.floorMarkers();
  });
  private floorMarkers(): Marker[] {
    return this.onLamps
      ? this.scene().lamps.map((l) => ({ id: l.id, name: l.name || l.id, x: l.x, y: l.y, ax: l.aimx, ay: l.aimy, enabled: l.enabled !== false }))
      : this.onZones
        ? this.userZones.filter((z) => z.type === 'point').map((z) => ({ id: z.id, name: z.name || z.id, x: z.x ?? 0, y: z.y ?? 0, ax: z.aim_x ?? z.x ?? 0, ay: z.aim_y ?? z.y ?? 0, enabled: z.enabled !== false }))
        : [];
  }
  readonly selectedMarkerId = $derived(this.onZones ? this.selectedZoneId : null);

  // --- Reference image. The placement is in meters; `k` converts to display
  // units at render. A drag or an opacity slide previews locally and is applied
  // when it ends.
  dragPlacement = $state<FloorPlanPlacement | null>(null);
  previewOpacity = $state<number | null>(null);
  readonly placement = $derived.by<FloorPlanPlacement | null>(() => {
    const floorplan = this.scene().floorplan;
    return this.dragPlacement ?? (floorplan ? (this.previewOpacity !== null ? { ...floorplan, opacity: this.previewOpacity } : floorplan) : null);
  });
  imageFileName = $state<string | null>(null);
  imageError = $state<string | null>(null);
  decoding = $state(false);
  pdfFile: File | null = null;
  pdfPageCount = $state(0);
  pdfPage = $state(1);
  readonly k = $derived.by(() => unitsPerMeter(this.scene().units));
  readonly imageMissing = $derived.by(() => this.placement !== null && this.scene().image === null);
  readonly hasImage = $derived.by(() => this.placement !== null && this.scene().image !== null);
  readonly planImage = $derived.by(() => {
    const image = this.scene().image;
    const placement = this.placement;
    return placement && image ? { ...imageRect(placement, this.k), href: image.src, opacity: placement.opacity } : null;
  });
  /** The image's corners, so Fit shows the plan as well as the outline. */
  readonly imageFitPoints = $derived.by((): Vertex[] => {
    if (!this.placement) return [];
    const r = imageRect(this.placement, this.k);
    return [[r.x, r.y], [r.x + r.width, r.y + r.height]];
  });

  readonly unit = $derived.by(() => unitAbbrev(this.scene().units));
  // Snap step: 10 cm in metric units, 3 inches in imperial ones. Alt disables snapping.
  readonly snapStep = $derived.by(() => unitSnap(this.scene().units));

  readonly validationMessage = $derived(this.drawing ? null : validatePolygon(this.draft));
  readonly area = $derived(this.draft.length >= 3 ? polygonArea(this.draft) : 0);
  readonly edgeLengths = $derived(this.draft.length >= 2 ? polygonEdgeLengths(this.draft) : []);
  readonly midpoints = $derived(this.draft.length >= 2 ? edgeMidpoints(this.draft) : []);


  // --- Set scale: click two points a known distance apart, type the distance.
  measure = $state<{ a: Vertex; b: Vertex | null } | null>(null);
  measuredDistance = $state<number | null>(null);
  // After a new upload: with an outline present, keep it or clear it; then offer Set scale
  askClearOutline = $state(false);
  askSetScale = $state(false);
  // The plan is only a picture: nothing reads the room out of it. Once it is in
  // place and there is no outline yet, offer to start tracing (like Set scale).
  askTrace = $state(false);
  cursorFree = $state<Vertex | null>(null);

  readonly measuredPixels = $derived.by(() => {
    if (!this.measure?.b || !this.placement) return 0;
    return Math.hypot(this.measure.b[0] - this.measure.a[0], this.measure.b[1] - this.measure.a[1]) / this.k / this.placement.scale;
  });
  readonly measureLine = $derived.by(() => {
    const measure = this.measure;
    if (!measure) return null;
    const [x1, y1] = [measure.a[0], -measure.a[1]];
    const end = measure.b ?? (this.tool === 'custom' && this.cursorFree ? this.cursorFree : null);
    if (!end) return { x1, y1, x2: x1, y2: y1, done: false };
    const [x2, y2] = [end[0], -end[1]];
    return { x1, y1, x2, y2, done: measure.b !== null };
  });

  // --- The plan: click to select it (highlight + position readout); a selected
  // plan drags anywhere on the image, snapping its offset to the grid unless Alt.
  // Clicking elsewhere or Escape deselects.
  imageDrag = $state<{ startPointer: Vertex; startPlacement: FloorPlanPlacement } | null>(null);
  planSelected = $state(false);
  readonly planInteractive = $derived(this.hasImage && !this.drawing && this.tool !== 'custom' && this.onOutline);

  readonly hasOutline = $derived.by(() => this.scene().vertices.length >= 3);

  /**
   * Called with an item's id after it is selected on the 2D plan, or added or
   * copied there, so the host can scroll its editor row into view. Selections
   * made from the editor rows themselves do not call it.
   */
  onItemSelected: ((id: string) => void) | undefined;

  constructor(opts: { actions: PlanActions; scene: () => PlanScene; history?: PlanHistory; onItemSelected?: (id: string) => void }) {
    this.actions = opts.actions;
    this.scene = opts.scene;
    this.history = opts.history;
    this.onItemSelected = opts.onItemSelected;
    this.draft = clone(opts.scene().vertices);
  }

  // --- Draft

  /**
   * Follow the stored polygon (an undo, a units switch, a backend nudge), except
   * mid-gesture or while a local invalid edit is on screen. Called from an
   * effect that tracks `source`.
   */
  followSource = (src: Vertex[]) => {
    if (this.drawing || this.dirty || this.canvas?.isDragging()) return;
    if (!samePolygon(this.draft, src)) this.draft = clone(src);
  };

  /** Apply the draft as the outline or the selected obstacle's footprint, if valid and changed. */
  commitDraft = () => {
    if (this.drawing) return;
    if (this.onWall) {
      // On a wall only the selected wall plane's outline is editable
      const z = this.onZones ? this.selectedWallPlane : null;
      const seg = this.wallSeg;
      if (!z || !seg) return;
      if (validatePolygon(this.draft) !== null) {
        this.dirty = true;
        return;
      }
      this.dirty = false;
      const next = this.toWallOutline(this.draft, seg);
      if (!samePolygon(next, wallPlaneOutline(z, seg, this.scene().roomZ))) this.actions.updateZone(z.id, { wall_vertices: next, fit_room: false });
      return;
    }
    if (!(this.onOutline || this.onObstacles || this.onZones || this.onCeiling)) return;
    if (this.onObstacles && !this.selected) return;
    if (this.onZones && !this.selectedFootprint) return;
    if (this.onCeiling && !this.editableKeepOut) return;
    if (validatePolygon(this.draft) !== null) {
      this.dirty = true;
      return;
    }
    this.dirty = false;
    const next = normalizeCCW(this.draft);
    if (this.onOutline) {
      if (!samePolygon(next, this.scene().vertices)) this.actions.setOutline(next);
    } else if (this.onCeiling) {
      const k = this.editableKeepOut!;
      // A keep-out area stays in the room: an edit that leaves it snaps back
      // (one a room change left outside takes any edit, to come back in)
      if (!keepOutEditAllowed(k.vertices, next, this.scene().vertices)) {
        this.revertDraft();
        return;
      }
      if (!samePolygon(next, k.vertices)) this.actions.updateCeilingItem(k.id, { vertices: next });
    } else if (this.onZones) {
      const z = this.selectedFootprint!;
      // Reshaping a whole-room zone makes it a drawn one
      if (!samePolygon(next, zoneFootprint(z))) this.actions.updateZone(z.id, { ...zoneFootprintGeometry(z.type as 'plane' | 'volume', next), fit_room: false });
    } else if (this.selected && !samePolygon(next, this.selected.vertices)) {
      this.actions.updateObstacle(this.selected.id!, footprintGeometry(next));
    }
  };

  /** Drop a local invalid edit and show the stored polygon again. */
  revertDraft = () => {
    this.dirty = false;
    this.draft = clone(this.source);
  };

  // --- Context

  /** Leave the current context (or the editor): at once, unless an invalid edit is on screen. */
  requestLeave = (proceed: () => void) => {
    if (this.drawing) this.canvas?.cancelDraw();
    if (this.dirty) {
      this.pendingLeave = proceed;
      return;
    }
    proceed();
  };

  /** Answer the "outline not saved" question: drop the edit and go, or stay to fix it. */
  resolveLeave = (choice: 'keep-saved' | 'stay') => {
    const proceed = this.pendingLeave;
    this.pendingLeave = null;
    if (choice !== 'keep-saved' || !proceed) return;
    this.revertDraft();
    proceed();
  };

  /** Switch what the plan edits, clearing every per-context selection and tool. */
  setContext = (next: PlanContext) => {
    if (next === this.context) return;
    if (this.drawing) this.canvas?.cancelDraw();
    if (this.tool === 'custom') { this.cancelMeasure(); this.tool = 'edit'; }
    this.planSelected = false;
    this.hoveredSurface = null;
    this.hoveredItem = null;
    this.selectedId = null;
    this.selectedLampIds = [];
    this.selectedZoneId = null;
    this.clearCeilingState();
    this.markerDrag = null;
    this.wallShapeDrag = null;
    this.marquee = null;
    this.drawKind = null;
    this.placing = false;
    this.placeCursor = null;
    this.selectedIndex = -1;
    if (next === 'ceiling') this._surface = 'ceiling';
    else if (this.context === 'ceiling' && this._surface === 'ceiling') this._surface = 'floor';
    this.context = next;
    this.draft = this.contextDraft(next);
  };

  /**
   * Another project replaced the scene (opened, or New): drop any gesture,
   * invalid edit, prompt and selection, show the new polygon, and ask the
   * canvas to fit the new room.
   */
  resetForNewScene = () => {
    if (this.drawing) this.canvas?.cancelDraw();
    if (this.tool === 'custom') { this.cancelMeasure(); this.tool = 'edit'; }
    this.pendingLeave = null;
    this.askClearOutline = false;
    this.askSetScale = false;
    this.askTrace = false;
    this.dirty = false;
    this.planSelected = false;
    this.hoveredSurface = null;
    this.hoveredItem = null;
    this.selectedId = null;
    this.selectedLampIds = [];
    this.selectedZoneId = null;
    this.clearCeilingState();
    this.markerDrag = null;
    this.wallShapeDrag = null;
    this.marquee = null;
    this.drawKind = null;
    this.placing = false;
    this.placeCursor = null;
    this.selectedIndex = -1;
    this.draft = this.contextDraft();
    this.fitRequest++;
  };

  // --- Hover: the item whose row the pointer is over, highlighted in 3D

  hoveredItem = $state<{ kind: 'lamps' | 'zones' | 'objects'; id: string } | null>(null);
  hoverItem = (kind: 'lamps' | 'zones' | 'objects', id: string, on: boolean) => {
    if (on) this.hoveredItem = { kind, id };
    else if (this.hoveredItem?.kind === kind && this.hoveredItem.id === id) this.hoveredItem = null;
  };

  /** Bumped when the canvas should fit the room again (the pane fits on each change). */
  fitRequest = $state(0);
  /** Fit the room in the canvas again (after a typed room size, whatever the user's zoom). */
  requestFit = () => {
    this.fitRequest++;
  };

  // --- Obstacles

  selectObstacle = (id: string | null) => {
    if (this.drawing) return;
    if (this.dirty) this.revertDraft();
    this.selectedId = id;
    this.selectedIndex = -1;
    const o = id ? this.obstacles.find((x) => x.id === id) : null;
    // A wall view edits no footprint (its canvas is in wall coordinates)
    this.draft = o && !this.onWall ? clone(o.vertices) : [];
  };

  /** A structure picked on the 2D plan: select it and bring its row into view. */
  clickObstacle = (id: string) => {
    if (this.drawing) return;
    this.selectObstacle(id);
    this.onItemSelected?.(id);
  };

  startObstacleDraw = () => {
    this.withCanvas(() => {
      this.selectObstacle(null);
      this.canvas?.startDraw();
    });
  };
  stopObstacleDraw = () => {
    if (this.drawing) this.canvas?.cancelDraw();
  };
  onDrawEnd = async (committed: boolean) => {
    // A plane drawn on the surface showing (reached through startZoneDraw)
    if (this.onZones) {
      const kind = this.drawKind;
      this.drawKind = null;
      const redraw = this.redrawZoneId;
      this.redrawZoneId = null;
      if (!committed || this.draft.length < 3 || !kind) return;
      const seg = this.wallSeg;
      if (redraw) {
        // The selected plane takes the drawn outline
        const partial = seg ? { wall_vertices: this.toWallOutline(this.draft, seg) } : zoneFootprintGeometry(kind, this.draft);
        this.actions.updateZone(redraw, { ...partial, fit_room: false });
        return;
      }
      try {
        this.selectedZoneId = await this.actions.addZone(kind, { ...this.drawnZoneGeometry(kind, this.draft, seg), fit_room: false });
        this.onItemSelected?.(this.selectedZoneId);
      } catch (e) {
        console.error('Failed to add zone:', e);
        this.draft = [];
      }
      return;
    }
    if (!committed || this.draft.length < 3) return;
    if (this.onOutline) {
      this.commitDraft();
      return;
    }
    if (!this.onObstacles) return;
    // The new obstacle is selected and editable; Draw is one click away for the next
    const d = draftFromPolygon(this.draft, this.scene().roomZ, this.obstacles);
    try {
      this.selectedId = await this.actions.addObstacle(objectFromDraft(d));
      this.onItemSelected?.(this.selectedId);
    } catch (e) {
      console.error('Failed to add obstacle:', e);
      this.draft = [];
    }
  };

  /** A new zone's fields for a polygon drawn on the surface showing. */
  private drawnZoneGeometry(kind: 'plane' | 'volume', draft: Vertex[], seg: WallSegment | null): Partial<CalcZone> {
    if (seg && kind === 'plane') return { surface: this.surface, wall_vertices: this.toWallOutline(draft, seg), normal_offset: 0, flip: false };
    const footprint = zoneFootprintGeometry(kind, draft);
    if (kind === 'volume') return footprint;
    if (this.surface === 'ceiling') return { ...footprint, surface: 'ceiling', height: this.scene().roomZ, direction: -1 };
    // At eye height, as Add puts a floor plane
    const units = this.scene().units;
    return { ...footprint, surface: 'floor', height: roundToUnit(fromMeters(1.8, units), units) };
  }

  duplicateSelected = async () => {
    if (!this.selected || this.drawing) return;
    const copy = duplicateDraft(this.selected, this.snapStep * 2, this.obstacles);
    try {
      const id = await this.actions.addObstacle(objectFromDraft(copy));
      this.selectObstacle(null);
      this.selectedId = id;
      this.onItemSelected?.(id);
    } catch (e) {
      console.error('Failed to copy obstacle:', e);
    }
  };
  deleteSelected = () => {
    if (!this.selected?.id || this.drawing) return;
    const id = this.selected.id;
    this.selectObstacle(null);
    this.actions.removeObstacle(id);
  };

  // --- Keyboard

  onWindowKey = (event: KeyboardEvent) => {
    if (!planShouldHandleKey(event)) return;
    // F fits the view, in every context
    if (event.key.toLowerCase() === 'f' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      this.canvas?.fitView();
      return;
    }
    if ((event.key === '[' || event.key === ']') && !event.ctrlKey && !event.metaKey && !event.altKey && !this.drawing) {
      event.preventDefault();
      this.stepSurface(event.key === ']' ? 1 : -1);
      return;
    }
    // A plane selected on its wall in Zones can be deleted or copied there (no nudges)
    if (this.onWall && this.onZones && this.selectedWallPlane && !this.drawing && !this.placing) {
      if ((event.key === 'Delete' || event.key === 'Backspace') && this.selectedIndex < 0) {
        event.preventDefault();
        this.deleteSelectedZone();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        this.copySelectedZone();
      }
      return;
    }
    // The rest act on the floor plan (floor x / y nudges, delete, copy); a wall view has none yet
    if (this.onWall) return;
    if (this.onCeiling) {
      this.onCeilingKey(event);
      return;
    }
    const lamps = this.scene().lamps;
    if (this.onLamps && !this.drawing) {
      const key = event.key.toLowerCase();
      if (!event.ctrlKey && !event.metaKey && !event.altKey && (key === 'm' || key === 'a') && lamps.length) {
        this.lampMode = key === 'm' ? 'move' : 'aim';
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === 'a') {
        event.preventDefault();
        this.selectedLampIds = lamps.map((l) => l.id);
        return;
      }
      if (this.liveLampIds.length === 0) return;
      const st = this.snapStep;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        this.deleteSelectedLamps();
      } else if ((event.ctrlKey || event.metaKey) && key === 'd') {
        event.preventDefault();
        this.copySelectedLamps();
      } else if (event.key.startsWith('Arrow')) {
        event.preventDefault();
        const dx = event.key === 'ArrowLeft' ? -st : event.key === 'ArrowRight' ? st : 0;
        const dy = event.key === 'ArrowUp' ? st : event.key === 'ArrowDown' ? -st : 0;
        for (const m of this.markers) if (this.liveLampIds.includes(m.id)) this.moveMarker(m, dx, dy);
      }
      return;
    }
    const markerSel = this.onZones && this.selectedZone?.type === 'point' ? this.selectedZoneId : null;
    if (this.onZones && !this.placing && !this.drawing && (markerSel || this.selectedZone)) {
      const st = this.snapStep;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (this.selectedIndex >= 0) return; // the canvas removes a corner
        event.preventDefault();
        this.deleteSelectedZone();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        this.copySelectedZone();
      } else if (event.key.startsWith('Arrow')) {
        event.preventDefault();
        const dx = event.key === 'ArrowLeft' ? -st : event.key === 'ArrowRight' ? st : 0;
        const dy = event.key === 'ArrowUp' ? st : event.key === 'ArrowDown' ? -st : 0;
        const m = this.markers.find((x) => x.id === markerSel);
        if (m) this.moveMarker(m, dx, dy);
        else this.canvas?.nudge(dx, dy);
      }
      return;
    }
    if (!this.onObstacles) return;
    const selected = this.selected;
    if ((event.key === 'Delete' || event.key === 'Backspace') && selected && this.selectedIndex < 0 && !this.drawing) {
      event.preventDefault();
      this.deleteSelected();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd' && selected && !this.drawing) {
      event.preventDefault();
      this.duplicateSelected();
    } else if (event.key.startsWith('Arrow') && selected && !this.drawing) {
      event.preventDefault();
      const s = this.snapStep;
      this.canvas?.nudge(event.key === 'ArrowLeft' ? -s : event.key === 'ArrowRight' ? s : 0, event.key === 'ArrowUp' ? s : event.key === 'ArrowDown' ? -s : 0);
    }
  };

  /** Escape: cancel an in-progress gesture or selection. True when it did something. */
  onEscapeKey = (): boolean => {
    if (this.onCeiling) {
      if (this.selectedCeilingId) { this.selectCeilingItem(null); return true; }
      if (this.gridMove) { this.gridMove = false; return true; }
      return false;
    }
    if (this.onLamps) {
      if (this.placing) { this.setPlacing(false); return true; }
      if (this.selectedLampId) { this.selectLamp(null); return true; }
      return false;
    }
    if (this.onZones) {
      if (this.pointPick) { this.endPointPick(true); return true; }
      if (this.drawing) { this.canvas?.cancelDraw(); return true; }
      if (this.placing) { this.setPlacing(false); return true; }
      if (this.selectedZoneId) { this.selectZone(null); return true; }
      return false;
    }
    if (this.onObstacles) {
      if (this.drawing) { this.stopObstacleDraw(); return true; }
      if (this.selectedId) { this.selectObstacle(null); return true; }
      return false;
    }
    if (this.planSelected) {
      this.planSelected = false;
      return true;
    }
    if (this.tool === 'custom' && this.measure) {
      this.cancelMeasure();
      return true;
    }
    if (this.tool === 'custom') {
      this.tool = 'edit';
      this.measure = null;
      return true;
    }
    if (this.drawing) {
      this.cancelDraw();
      return true;
    }
    return false;
  };

  /**
   * Ctrl+Z: while drawing it drops the last corner; with an invalid edit on
   * screen it drops that edit. False lets the app-wide undo run.
   */
  undoInterceptor = (): boolean => {
    if (this.canvas?.undoLastPoint()) return true;
    if (this.dirty) { this.revertDraft(); return true; }
    return false;
  };

  // --- Lamps

  addPlaced = async (mode: PlacementMode) => {
    if (!this.addFixture || this.addingLamp) return;
    this.addingLamp = mode;
    try {
      this.selectLamp(await this.actions.addPlacedLamp(this.addFixture, mode));
    } catch (e) {
      console.error('Failed to add lamp:', e);
    } finally {
      this.addingLamp = null;
    }
  };
  toggleLamp = (id: string) => {
    this.selectedLampIds = this.selectedLampIds.includes(id) ? this.selectedLampIds.filter((x) => x !== id) : [...this.selectedLampIds, id];
  };
  copySelectedLamps = async () => {
    const ids = this.liveLampIds;
    if (!ids.length) return;
    try {
      this.selectedLampIds = await this.actions.copyLamps(ids, this.snapStep * 2, this.snapStep * 2);
      if (this.selectedLampIds.length) this.onItemSelected?.(this.selectedLampIds[0]);
    } catch (e) {
      console.error('Failed to copy lamps:', e);
    }
  };
  deleteSelectedLamps = () => {
    const ids = [...this.liveLampIds];
    this.selectLamp(null);
    for (const id of ids) this.actions.removeLamp(id);
  };
  /** Shift + drag on empty space (Lamps) draws a box that adds the lamps inside to the selection; a plain drag follows the view's Hand / Zoom mode. */
  onBackgroundDragStart = (event: PointerEvent): boolean => {
    if (this.onCeiling) return this.startGridDrag(event);
    if (!this.onLamps || !event.shiftKey || this.placing || this.drawing || !this.canvas) return false;
    const a = this.canvas.pointerToRoom(event);
    this.marquee = { a, b: a, add: event.shiftKey };
    return true;
  };
  /** A press on empty canvas deselects everything. */
  onBackgroundPointerDown = () => {
    this.planSelected = false;
    if (this.onCeiling) this.selectCeilingItem(null);
    if (this.onObstacles) this.selectObstacle(null);
    if (this.onLamps) this.selectLamp(null);
    if (this.onZones) this.selectZone(null);
  };
  endMarquee = () => {
    const m = this.marquee;
    this.marquee = null;
    if (!m) return;
    const x0 = Math.min(m.a[0], m.b[0]), x1 = Math.max(m.a[0], m.b[0]);
    const y0 = Math.min(m.a[1], m.b[1]), y1 = Math.max(m.a[1], m.b[1]);
    if (x1 - x0 < this.snapStep / 2 && y1 - y0 < this.snapStep / 2) {
      // A click on empty space
      if (!m.add) this.selectLamp(null);
      return;
    }
    const inside = this.scene().lamps.filter((l) => l.x >= x0 && l.x <= x1 && l.y >= y0 && l.y <= y1).map((l) => l.id);
    this.selectedLampIds = m.add ? [...new Set([...this.selectedLampIds, ...inside])] : inside;
  };

  /** Where a marker and its aim point are drawn, including a drag in flight. */
  markerView = (m: Marker) => {
    const d = this.markerDrag;
    if (!d || !d.group.includes(m.id)) return { x: m.x, y: m.y, ax: m.ax, ay: m.ay };
    if (d.part === 'aimAt') return d.target ? { x: m.x, y: m.y, ax: d.target[0], ay: d.target[1] } : { x: m.x, y: m.y, ax: m.ax, ay: m.ay };
    if (d.part === 'aim') return { x: m.x, y: m.y, ax: m.ax + d.dx, ay: m.ay + d.dy };
    return { x: m.x + d.dx, y: m.y + d.dy, ax: m.ax + d.dx, ay: m.ay + d.dy };
  };

  selectLamp = (id: string | null) => {
    this.selectedLampIds = id ? [id] : [];
  };

  // --- Zones

  selectZone = (id: string | null) => {
    if (this.drawing) return;
    if (this.dirty) this.revertDraft();
    this.selectedZoneId = id;
    this.selectedIndex = -1;
    const z = id ? this.userZones.find((x) => x.id === id) : null;
    // A plane opens on its surface and a volume on the floor; a point stays on the surface showing
    if (z) {
      const next = z.type === 'plane' ? zoneSurface(z, this.scene().roomZ) : z.type === 'point' ? this.surface : 'floor';
      if (next !== this.surface) {
        const refit = wallIndex(next) !== null || this.onWall;
        this._surface = next;
        if (refit) this.fitRequest++;
      }
    }
    this.draft = z ? this.zoneOutline(z) : [];
  };
  /** A zone picked on the 2D plan: select it and bring its row into view. */
  clickZone = (id: string) => {
    if (this.drawing) return;
    this.selectZone(id);
    this.onItemSelected?.(id);
  };
  setPlacing = (on: boolean) => {
    if (on && !this.canvas && this.onNeedCanvas) {
      this.withCanvas(() => this.setPlacing(true));
      return;
    }
    this.placing = on;
    this.tool = on ? 'custom' : 'edit';
    this.placeCursor = null;
    if (on) this.canvas?.focus();
  };
  /**
   * Follow the pick request of the zone panel (Place or Aim on a point): while one runs and
   * this canvas is the main view, a click here sets the point. Any other request, or none,
   * ends it.
   */
  syncPointPick = (req: PickRequest) => {
    const type = req && (req.type === 'point_position' || req.type === 'aim_point') ? req.type : null;
    if (type === this.pointPick) return;
    const was = this.pointPick;
    this.pointPick = type;
    this.placeCursor = null;
    if (type) {
      this.tool = 'custom';
      this.canvas?.focus();
    } else if (was && this.tool === 'custom') this.tool = 'edit';
  };
  /** End a point pick (and the request behind it when `cancel`). */
  private endPointPick(cancel: boolean) {
    if (cancel) pickMode.set(null);
    this.syncPointPick(null);
  }
  /** The click of a point pick: the position (or aim) from the pointer, on the floor or on the wall showing. One update. */
  private pickAt = (event: MouseEvent) => {
    const type = this.pointPick;
    const z = this.selectedZone;
    if (!type || !this.canvas || !z || z.type !== 'point') return;
    const [cx, cy] = this.snappedPointer(event);
    const room = this.scene().room;
    const seg = this.wallSeg;
    const place = type === 'point_position';
    let partial: Partial<CalcZone>;
    if (seg) {
      // On a wall: (along, up) from the click, at the point's current depth from that wall
      const cur = place
        ? { x: z.x ?? room.x / 2, y: z.y ?? room.y / 2, z: z.z ?? 1 }
        : { x: z.aim_x ?? room.x / 2, y: z.aim_y ?? room.y / 2, z: z.aim_z ?? 2 };
      const { along, up } = canvasToWall(cx, cy, seg);
      const w = fromWall(along, up, toWall(cur.x, cur.y, cur.z, seg).depth, seg);
      partial = place ? { x: r6(w.x), y: r6(w.y), z: r6(w.z) } : { aim_x: r6(w.x), aim_y: r6(w.y), aim_z: r6(w.z) };
    } else {
      partial = place ? { x: r6(cx), y: r6(cy) } : { aim_x: r6(cx), aim_y: r6(cy) };
    }
    this.endPointPick(true);
    this.actions.updateZone(z.id, partial);
  };
  snappedPointer = (event: MouseEvent): Vertex => {
    const canvas = this.canvas!;
    const p = canvas.pointerToRoom(event);
    return [canvas.snapValue(p[0], event.altKey), canvas.snapValue(p[1], event.altKey)];
  };
  placeAt = async (event: MouseEvent) => {
    if (!this.canvas) return;
    const [x, y] = this.snappedPointer(event);
    try {
      if (this.onLamps) {
        // A new lamp copies the selected (or last placed) one, so a row of the same fixture is just clicks
        const like = this.selectedLampId ?? this.scene().lamps.at(-1)?.id;
        const id = await this.actions.addLamp(x, y, like);
        this.selectLamp(id);
        this.onItemSelected?.(id);
      } else if (this.onZones) {
        this.selectZone(null);
        this.selectedZoneId = await this.actions.addZone('point', { x, y, aim_x: x, aim_y: y });
        this.onItemSelected?.(this.selectedZoneId);
      }
    } catch (e) {
      console.error('Failed to place:', e);
    }
  };
  copySelectedZone = async () => {
    const z = this.selectedZone;
    if (!z) return;
    try {
      const id = await this.actions.copyZone(z.id, this.snapStep * 2, this.snapStep * 2);
      this.selectZone(null);
      this.selectedZoneId = id;
      this.onItemSelected?.(id);
    } catch (e) {
      console.error('Failed to copy zone:', e);
    }
  };
  deleteSelectedZone = () => {
    const id = this.selectedZone?.id;
    if (!id) return;
    this.selectZone(null);
    this.actions.removeZone(id);
  };
  /**
   * Draw a zone's outline on the surface showing (volumes on the floor only).
   * With a plane on this surface (or a volume) of that kind selected, the
   * drawing becomes its outline; otherwise it adds a new zone.
   */
  startZoneDraw = (kind: 'plane' | 'volume') => {
    if (!this.canvas && this.onNeedCanvas) {
      this.withCanvas(() => this.startZoneDraw(kind));
      return;
    }
    if (this.drawing) {
      this.canvas?.cancelDraw();
      if (this.drawKind === kind) return;
    }
    if (kind === 'volume' && this.surface !== 'floor') return;
    this.setPlacing(false);
    const z = this.selectedZone;
    const editable = z && (z.id === this.selectedWallPlane?.id || z.id === this.selectedFootprint?.id);
    const redraw = z?.type === kind && editable ? z.id : null;
    if (!redraw) this.selectZone(null);
    this.redrawZoneId = redraw;
    this.drawKind = kind;
    this.canvas?.startDraw();
  };

  // --- Markers (lamps and calc points)

  moveMarker = (m: Marker, dx: number, dy: number) => {
    if (dx === 0 && dy === 0) return;
    const seg = this.wallSeg;
    if (seg && this.onLamps) {
      // On a wall's canvas (seen from inside) a drag of +dx is -dx along the wall
      const lamp = this.scene().lamps.find((l) => l.id === m.id);
      const w = wallIndex(this.surface);
      if (!lamp || w === null) return;
      const at = toWall(lamp.x, lamp.y, lamp.z, seg);
      this.actions.updateLamp(m.id, unprojectLampMove(lamp, seg, at.along - dx, at.up + dy, w));
      return;
    }
    const x = r6(m.x + dx), y = r6(m.y + dy), ax = r6(m.ax + dx), ay = r6(m.ay + dy);
    if (this.onLamps) this.actions.updateLamp(m.id, { x, y, aimx: ax, aimy: ay });
    else this.actions.updateZone(m.id, { x, y, aim_x: ax, aim_y: ay });
  };
  aimMarker = (m: Marker, dx: number, dy: number) => {
    const ax = r6(m.ax + dx), ay = r6(m.ay + dy);
    if (this.onLamps) this.actions.updateLamp(m.id, { aimx: ax, aimy: ay });
    else this.actions.updateZone(m.id, { aim_x: ax, aim_y: ay });
  };
  onMarkerPointerDown = (event: PointerEvent, id: string, part: 'body' | 'aim') => {
    const canvas = this.canvas;
    if (this.placing || this.pointPick || this.drawing || event.button !== 0 || !canvas || canvas.isSpaceHeld()) return;
    event.preventDefault();
    event.stopPropagation();
    if (this.onLamps && event.shiftKey) {
      this.toggleLamp(id);
      if (this.selectedLampIds.includes(id)) this.onItemSelected?.(id);
      return;
    }
    if (this.onLamps) {
      if (!this.selectedLampIds.includes(id)) this.selectLamp(id);
    } else this.selectZone(id);
    this.onItemSelected?.(id);
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    const group = this.onLamps ? [...this.selectedLampIds] : [id];
    const kind = this.onLamps && !this.onWall && part === 'body' && this.lampMode === 'aim' ? 'aimAt' : part;
    this.markerDrag = { id, part: kind, start: canvas.pointerToRoom(event), dx: 0, dy: 0, target: null, group: kind === 'aim' ? [id] : group };
  };
  /** Drag a marker or its aim point; the dragged point lands on the grid (Alt: free). */
  onMarkerDragMove = (event: PointerEvent): boolean => {
    const drag = this.markerDrag;
    const canvas = this.canvas;
    if (!drag || !canvas) return false;
    const m = this.markers.find((x) => x.id === drag.id);
    if (!m) return false;
    if (drag.part === 'aimAt') {
      this.markerDrag = { ...drag, target: this.snappedPointer(event) };
      return true;
    }
    const p = canvas.pointerToRoom(event);
    const [ox, oy] = drag.part === 'aim' ? [m.ax, m.ay] : [m.x, m.y];
    const nx = canvas.snapValue(ox + p[0] - drag.start[0], event.altKey);
    const ny = canvas.snapValue(oy + p[1] - drag.start[1], event.altKey);
    this.markerDrag = { ...drag, dx: nx - ox, dy: ny - oy };
    return true;
  };
  /** A structure being dragged in a wall view, by (dx, dy) on its canvas. */
  wallShapeDrag = $state<{ id: string; start: Vertex; dx: number; dy: number } | null>(null);
  onWallShapeDown = (id: string, event: PointerEvent) => {
    const canvas = this.canvas;
    const shape = this.wallView?.shapes.find((s) => s.id === id);
    if (!canvas || !this.onObstacles || !shape || (shape.opacity ?? 1) < WALL_DRAGGABLE_OPACITY || event.button !== 0 || canvas.isSpaceHeld()) return;
    this.selectObstacle(id);
    (event.currentTarget as Element | null)?.setPointerCapture?.(event.pointerId);
    this.wallShapeDrag = { id, start: canvas.pointerToRoom(event), dx: 0, dy: 0 };
  };
  private onWallShapeDragMove = (event: PointerEvent): boolean => {
    const drag = this.wallShapeDrag;
    const canvas = this.canvas;
    if (!drag || !canvas) return false;
    const p = canvas.pointerToRoom(event);
    this.wallShapeDrag = { ...drag, dx: canvas.snapValue(p[0] - drag.start[0], event.altKey), dy: canvas.snapValue(p[1] - drag.start[1], event.altKey) };
    return true;
  };
  private endWallShapeDrag = () => {
    const d = this.wallShapeDrag;
    this.wallShapeDrag = null;
    const seg = this.wallSeg;
    if (!d || !seg || (d.dx === 0 && d.dy === 0)) return;
    const o = this.scene().objects.find((x) => x.id === d.id);
    if (!o) return;
    this.actions.updateObstacle(d.id, unprojectStructureMove(o, seg, -d.dx, d.dy));
  };
  endMarkerDrag = () => {
    const d = this.markerDrag;
    this.markerDrag = null;
    if (!d) return;
    if (d.part === 'aimAt') {
      // Every selected lamp points at where the drag ended (one undo step)
      if (d.target) for (const id of d.group) this.actions.updateLamp(id, { aimx: r6(d.target[0]), aimy: r6(d.target[1]) });
      return;
    }
    if (d.dx === 0 && d.dy === 0) return;
    const m = this.markers.find((x) => x.id === d.id);
    if (!m) return;
    if (d.part === 'aim') this.aimMarker(m, d.dx, d.dy);
    else for (const g of this.markers) if (d.group.includes(g.id)) this.moveMarker(g, d.dx, d.dy);
  };
  onCustomClick = (event: MouseEvent) => {
    if (this.pointPick) this.pickAt(event);
    else if ((this.onLamps || this.onZones) && this.placing) this.placeAt(event);
    else this.onScaleClick(event);
  };
  onCustomMove = (event: PointerEvent) => {
    if (this.pointPick || ((this.onLamps || this.onZones) && this.placing)) {
      if (this.canvas) this.placeCursor = this.snappedPointer(event);
    } else this.onScaleMove(event);
  };
  onCustomLeave = () => {
    this.cursorFree = null;
    this.placeCursor = null;
  };

  // --- Ceiling

  private clearCeilingState() {
    this.selectedCeilingId = null;
    this.ceilingDrag = null;
    this.gridDrag = null;
    this.gridMove = false;
  }

  selectCeilingItem = (id: string | null) => {
    if (this.drawing) return;
    if (this.dirty) this.revertDraft();
    this.selectedCeilingId = id;
    this.selectedIndex = -1;
    if (id) this.gridMove = false;
    const it = id ? this.ceiling.items.find((i) => i.id === id) : null;
    this.draft = it?.kind === 'keep' && this.ceilingItemShown(it) && !this.onWall ? clone(it.vertices) : [];
  };
  /** An item picked on the 2D plan: select it and bring its row into view. */
  clickCeilingItem = (id: string) => {
    if (this.drawing) return;
    this.selectCeilingItem(id);
    this.onItemSelected?.(id);
  };
  /** The layout holds as many items as a saved file may: Add and Copy stop. */
  get ceilingFull(): boolean {
    return this.ceiling.items.length >= MAX_CEILING_ITEMS;
  }
  /** Add to ceiling: one item in the middle of the room, selected (null when the layout is full). */
  addCeilingItem = (kind: CeilingKind): string | null => {
    if (this.ceilingFull) return null;
    const id = this.actions.addCeilingItem(kind);
    if (id) this.selectCeilingItem(id);
    return id;
  };
  copySelectedCeilingItem = () => {
    const it = this.selectedCeilingItem;
    if (!it || this.drawing || this.ceilingFull) return;
    const id = this.actions.copyCeilingItem(it.id);
    if (!id) return;
    this.selectCeilingItem(id);
    this.onItemSelected?.(id);
  };
  deleteSelectedCeilingItem = () => {
    const id = this.selectedCeilingItem?.id;
    if (!id || this.drawing) return;
    this.selectCeilingItem(null);
    this.actions.removeCeilingItem(id);
  };
  toggleGridMove = () => {
    this.gridMove = !this.gridMove && this.tilesActive;
  };

  /** Where a detector, vent or sensor is drawn, including a drag in flight. */
  ceilingItemAt = (it: CeilingPointItem): Vertex => (this.ceilingDrag?.id === it.id ? this.ceilingDrag.at : [it.x, it.y]);

  /** A press on an item: select it; a detector, vent or sensor also starts a drag. */
  onCeilingItemPointerDown = (event: PointerEvent, id: string) => {
    const canvas = this.canvas;
    if (this.drawing || event.button !== 0 || !canvas || canvas.isSpaceHeld()) return;
    event.preventDefault();
    event.stopPropagation();
    this.clickCeilingItem(id);
    const it = this.ceiling.items.find((i) => i.id === id);
    if (!it || it.kind === 'keep') return;
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    this.ceilingDrag = { id, start: canvas.pointerToRoom(event), from: [it.x, it.y], at: [it.x, it.y] };
  };
  /** Drag an item (to the middle of a tile while the tiles show; Alt: free; never out of the room) or the grid. */
  onCeilingDragMove = (event: PointerEvent): boolean => {
    const canvas = this.canvas;
    const gd = this.gridDrag;
    if (gd && canvas) {
      const p = canvas.pointerToRoom(event);
      const step = this.snapStep;
      const snap = (v: number) => (event.altKey ? roundToUnit(v, this.scene().units) : r6(Math.round(v / step) * step));
      this.gridDrag = { ...gd, offset: [snap(gd.from[0] + p[0] - gd.start[0]), snap(gd.from[1] + p[1] - gd.start[1])] };
      return true;
    }
    const d = this.ceilingDrag;
    if (!d || !canvas) return false;
    const p = canvas.pointerToRoom(event);
    const raw: Vertex = [d.from[0] + p[0] - d.start[0], d.from[1] + p[1] - d.start[1]];
    const target: Vertex = this.tilesActive && !event.altKey
      ? snapToTileCentre(raw[0], raw[1], this.ceilingGrid)
      : [canvas.snapValue(raw[0], event.altKey), canvas.snapValue(raw[1], event.altKey)];
    if (pointMoveAllowed(d.from, target, this.scene().vertices)) this.ceilingDrag = { ...d, at: target };
    return true;
  };
  endCeilingDrag = () => {
    const gd = this.gridDrag;
    this.gridDrag = null;
    if (gd && (gd.offset[0] !== gd.from[0] || gd.offset[1] !== gd.from[1])) this.actions.updateCeiling({ offset: gd.offset });
    const d = this.ceilingDrag;
    this.ceilingDrag = null;
    if (!d || (d.at[0] === d.from[0] && d.at[1] === d.from[1])) return;
    this.actions.updateCeilingItem(d.id, { x: r6(d.at[0]), y: r6(d.at[1]) });
  };
  /** Move grid: a drag on empty space shifts the grid. */
  private startGridDrag = (event: PointerEvent): boolean => {
    if (!this.gridMove || !this.tilesActive || this.selectedCeilingId || this.drawing || !this.canvas) return false;
    const off = this.ceiling.offset;
    this.gridDrag = { start: this.canvas.pointerToRoom(event), from: [off[0], off[1]], offset: [off[0], off[1]] };
    return true;
  };
  private onCeilingKey = (event: KeyboardEvent) => {
    const it = this.selectedCeilingItem;
    if (!it || this.drawing) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (this.selectedIndex >= 0) return; // the canvas removes a corner
      event.preventDefault();
      this.deleteSelectedCeilingItem();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      this.copySelectedCeilingItem();
    } else if (event.key.startsWith('Arrow')) {
      event.preventDefault();
      const st = this.snapStep;
      const dx = event.key === 'ArrowLeft' ? -st : event.key === 'ArrowRight' ? st : 0;
      const dy = event.key === 'ArrowUp' ? st : event.key === 'ArrowDown' ? -st : 0;
      if (it.kind === 'keep') {
        if (this.editableKeepOut) this.canvas?.nudge(dx, dy);
      } else if (pointMoveAllowed([it.x, it.y], [it.x + dx, it.y + dy], this.scene().vertices)) {
        this.actions.updateCeilingItem(it.id, { x: r6(it.x + dx), y: r6(it.y + dy) });
      }
    }
  };

  // --- Outline: draw tool and corner table

  // Drawing a new outline clears the corners at once: cancelling before three
  // corners restores them, and undo covers the rest.
  requestNewOutline = () => {
    if (this.drawing) return;
    this.startDraw();
  };
  startDraw = () => {
    this.withCanvas(() => {
      this.planSelected = false;
      this.canvas?.startDraw();
    });
  };
  cancelDraw = () => {
    this.canvas?.cancelDraw();
  };
  setVertexCoord = (index: number, axis: 0 | 1, value: number) => {
    const next = clone(this.draft);
    next[index][axis] = this.onObstacles ? value : Math.max(0, value);
    this.draft = next;
    this.commitDraft();
  };
  removeVertex = (index: number) => {
    this.withCanvas(() => this.canvas?.removeVertex(index));
  };
  addVertex = () => {
    if (this.draft.length < 2) return;
    // Split the longest wall at its midpoint
    const edgeLengths = this.edgeLengths;
    let longest = 0;
    for (let i = 1; i < edgeLengths.length; i++) if (edgeLengths[i] > edgeLengths[longest]) longest = i;
    const [mx, my] = this.midpoints[longest];
    const next = clone(this.draft);
    next.splice(longest + 1, 0, [mx, my]);
    this.draft = next;
    this.selectedIndex = longest + 1;
    this.commitDraft();
  };

  // --- Reference image

  onFileChosen = async (file: File) => {
    if (!isSupportedFloorPlanFile(file)) {
      this.imageError = 'Unsupported file type. Use PNG, JPEG, WebP, GIF, SVG or PDF.';
      return;
    }
    // Drawing and the image tools are mutually exclusive modes (as in
    // `handleUnitsChange`); an upload leaves draw mode.
    if (this.drawing) this.cancelDraw();
    this.pdfFile = file.type === 'application/pdf' || /\.pdf$/i.test(file.name) ? file : null;
    this.pdfPage = 1;
    await this.installDecoded(file, 1);
  };

  installDecoded = async (file: File, page: number) => {
    this.decoding = true;
    this.imageError = null;
    try {
      const decoded: DecodedFloorPlan = await decodeFloorPlanFile(file, { page });
      this.pdfPageCount = decoded.pageCount ?? 0;
      const id = crypto.randomUUID();
      const newImage: FloorPlanImage = { id, mime: decoded.mime, src: decoded.src };
      this.imageFileName = file.name;
      const { floorplan, vertices } = this.scene();
      // Re-upload of the same-size image keeps a restored placement's calibration
      if (floorplan && floorplan.widthPx === decoded.widthPx && floorplan.heightPx === decoded.heightPx) {
        this.actions.setPlacement({ ...floorplan, imageId: id }, newImage);
      } else {
        // Size the image to the current room, then offer Set scale (Escape dismisses it)
        const bb = polygonBoundingBox(this.draft.length >= 3 ? this.draft : vertices);
        this.actions.setPlacement(initialPlacement(id, decoded.widthPx, decoded.heightPx, bb.xMax / this.k, bb.yMax / this.k), newImage);
        await tick();
        this.canvas?.fitView();
        // With an outline already drawn, ask whether this plan replaces it; then offer Set scale
        if (this.onOutline && this.draft.length >= 3) this.askClearOutline = true;
        else this.askSetScale = true;
      }
    } catch (e) {
      this.imageError = e instanceof FloorPlanDecodeError ? e.message : 'Could not read this file.';
    } finally {
      this.decoding = false;
    }
  };

  changePdfPage = async (page: number) => {
    if (!this.pdfFile) return;
    this.pdfPage = page;
    await this.installDecoded(this.pdfFile, page);
  };

  removeImage = () => {
    this.planSelected = false;
    this.imageFileName = null;
    this.imageError = null;
    this.pdfFile = null;
    this.pdfPageCount = 0;
    if (this.tool === 'custom') this.tool = 'edit';
    this.measure = null;
    this.actions.setPlacement(null);
  };

  setOpacity = (value: number) => {
    this.previewOpacity = Math.min(1, Math.max(0.1, value));
  };
  commitOpacity = () => {
    const floorplan = this.scene().floorplan;
    if (floorplan && this.previewOpacity !== null) this.actions.setPlacement({ ...floorplan, opacity: this.previewOpacity });
    this.previewOpacity = null;
  };

  setOffset = (axis: 'offsetX' | 'offsetY', displayValue: number) => {
    const floorplan = this.scene().floorplan;
    if (floorplan) this.actions.setPlacement({ ...floorplan, [axis]: displayValue / this.k });
  };

  answerClearOutline = (clear: boolean) => {
    this.askClearOutline = false;
    if (clear) {
      // The stored outline stays until the new one is traced
      this.draft = [];
      this.dirty = true;
      this.selectedIndex = -1;
    }
    this.askSetScale = true;
  };
  answerSetScale = (now: boolean) => {
    this.askSetScale = false;
    if (now) this.startSetScale();
    else {
      this.tool = 'edit';
      this.promptToTrace();
    }
  };

  promptToTrace = () => {
    if (!this.onOutline || this.draft.length >= 3 || !this.hasImage) return;
    this.askTrace = true;
  };
  answerTrace = (now: boolean) => {
    this.askTrace = false;
    if (now && !this.drawing) this.startDraw();
  };

  startSetScale = () => {
    if (!this.placement) return;
    if (!this.canvas && this.onNeedCanvas) {
      this.withCanvas(() => this.startSetScale());
      return;
    }
    this.planSelected = false;
    if (this.tool === 'custom') {
      this.cancelMeasure();
      this.tool = 'edit';
      return;
    }
    if (this.drawing) this.cancelDraw();
    this.tool = 'custom';
    this.measure = null;
    this.measuredDistance = null;
    this.selectedIndex = -1;
    this.canvas?.focus();
  };

  afterCalibration = () => {
    this.tool = 'edit';
    this.promptToTrace();
  };

  onScaleClick = (event: MouseEvent) => {
    const canvas = this.canvas;
    if (this.tool !== 'custom' || !this.placement || !canvas) return;
    // No grid snapping (the user points at pixels), but the second point snaps
    // to a right angle from the first: a measured wall is almost always straight.
    const raw = canvas.pointerToRoom(event);
    const measure = this.measure;
    if (!measure) {
      this.measure = { a: raw, b: null };
    } else if (!measure.b) {
      const p = canvas.snapAngle(measure.a, raw, [1, 0], event).point;
      if (Math.hypot(p[0] - measure.a[0], p[1] - measure.a[1]) < 1e-9) return;
      this.measure = { a: measure.a, b: p };
    }
  };

  onScaleMove = (event: PointerEvent) => {
    const canvas = this.canvas;
    if (!canvas) return;
    const raw = canvas.pointerToRoom(event);
    const measure = this.measure;
    this.cursorFree = measure && !measure.b ? canvas.snapAngle(measure.a, raw, [1, 0], event).point : raw;
  };

  onScaleEnter = (): boolean => {
    if (this.measure?.b) {
      this.confirmMeasure();
      return true;
    }
    return false;
  };

  confirmMeasure = async () => {
    const measure = this.measure;
    const placement = this.placement;
    if (!measure?.b || !placement || this.measuredDistance === null) return;
    const k = this.k;
    const a: [number, number] = [measure.a[0] / k, measure.a[1] / k];
    const b: [number, number] = [measure.b[0] / k, measure.b[1] / k];
    const newScale = scaleFromMeasurement(placement, a, b, this.measuredDistance / k);
    if (newScale === null) return;
    // Rescale about the room origin: a plan whose corner sits on (0,0) stays there,
    // so no part of the room drifts below the axes where it could not be traced.
    this.actions.setPlacement(rescaleAboutPoint(placement, [0, 0], newScale));
    this.measure = null;
    this.measuredDistance = null;
    await tick();
    this.canvas?.fitView();
    this.afterCalibration();
  };

  cancelMeasure = () => {
    this.measure = null;
    this.measuredDistance = null;
  };

  onPlanPointerDown = (event: PointerEvent) => {
    const placement = this.placement;
    if (!placement || !this.planInteractive || event.button !== 0 || this.canvas?.isSpaceHeld()) return;
    event.preventDefault();
    event.stopPropagation();
    this.selectedIndex = -1;
    if (!this.planSelected) {
      this.planSelected = true;
      return;
    }
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    this.imageDrag = { startPointer: this.canvas!.pointerToRoom(event), startPlacement: { ...placement } };
  };

  onHostMove = (event: PointerEvent): boolean => {
    const canvas = this.canvas;
    if (this.marquee && canvas) {
      this.marquee = { ...this.marquee, b: canvas.pointerToRoom(event) };
      return true;
    }
    if (this.onMarkerDragMove(event)) return true;
    if (this.onWallShapeDragMove(event)) return true;
    if (this.onCeilingDragMove(event)) return true;
    const drag = this.imageDrag;
    if (!drag || !canvas) return false;
    const k = this.k;
    const p = canvas.pointerToRoom(event);
    const dx = (p[0] - drag.startPointer[0]) / k;
    const dy = (p[1] - drag.startPointer[1]) / k;
    // The plan's corner may sit at a negative offset, so snap without the >= 0 clamp
    const snapOffset = (meters: number) => canvas.snapValue(meters * k, event.altKey) / k;
    this.dragPlacement = {
      ...drag.startPlacement,
      offsetX: snapOffset(drag.startPlacement.offsetX + dx),
      offsetY: snapOffset(drag.startPlacement.offsetY + dy),
    };
    return true;
  };

  onHostPointerUp = () => {
    this.endMarquee();
    this.endMarkerDrag();
    this.endWallShapeDrag();
    this.endCeilingDrag();
    const moved = this.dragPlacement;
    this.imageDrag = null;
    if (moved) this.actions.setPlacement(moved);
    this.dragPlacement = null;
  };

  /** A second finger landed mid-drag: drop the drag in flight without applying it. */
  cancelHostDrag = () => {
    this.marquee = null;
    this.markerDrag = null;
    this.wallShapeDrag = null;
    this.ceilingDrag = null;
    this.gridDrag = null;
    this.imageDrag = null;
    this.dragPlacement = null;
  };

  handleUnitsChange = async (event: Event) => {
    const next = (event.target as HTMLSelectElement).value as LengthUnit;
    const units = this.scene().units;
    if (next === units) return;
    const factor = lengthFactor(units, next);
    if (this.drawing) this.cancelDraw();
    // A Set scale in progress carries on: its points and typed distance are in
    // display units, so convert them (the user may switch units just to type the
    // known length). The placement is in meters and needs no conversion.
    const scalePoint = ([x, y]: Vertex): Vertex => [x * factor, y * factor];
    const measure = this.measure;
    if (measure) this.measure = { a: scalePoint(measure.a), b: measure.b ? scalePoint(measure.b) : null };
    if (this.measuredDistance !== null) this.measuredDistance = roundToUnit(this.measuredDistance * factor, next);
    this.cursorFree = null;
    // The stored scene converts itself; an unsaved local edit follows along
    if (this.dirty) this.draft = this.draft.map(([x, y]) => [roundToUnit(x * factor, next), roundToUnit(y * factor, next)] as Vertex);
    // Keep the same area on screen rather than refitting: with no outline yet the
    // fit falls back to a one-unit square, a sudden zoom to one inch
    this.canvas?.scaleView(factor);
    await this.actions.changeUnits(next);
  };

  fmt = (v: number): string => displayDimension(v, this.scene().precision);
}
