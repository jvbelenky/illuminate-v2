import { tick } from 'svelte';
import type PlanCanvas from '$lib/components/PlanCanvas.svelte';
import type { CanvasTool, PlanShape } from '$lib/components/PlanCanvas.svelte';
import type { CalcZone, FloorPlanPlacement } from '$lib/types/project';
import type { FloorPlanImage } from '$lib/stores/floorplanImage';
import type { PlacementMode } from '$lib/utils/lampPlacement';
import type { PlanContext } from '$lib/workspace/editorNav';
import type { PlanActions, PlanScene } from './planActions';
import { draftsFromObjects, draftFromPolygon, duplicateDraft, objectFromDraft, footprintGeometry } from '$lib/utils/obstacleDrafts';
import { zoneHasFootprint, zoneFootprint, footprintGeometry as zoneFootprintGeometry } from '$lib/utils/zoneFootprint';
import { displayDimension } from '$lib/utils/formatting';
import { unitAbbrev, unitsPerMeter, unitSnap, lengthFactor, roundToUnit, type LengthUnit } from '$lib/utils/unitConversion';
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
import { tileGrid, tileLines, clipTileLines, snapToTileCentre, pointInRoom, polygonInRoom, type CeilingItem, type CeilingKind, type CeilingKeepOut, type CeilingPointItem } from '$lib/ceiling/ceilingLayout';

/** A lamp (Lamps context) or a calc point (Zones context) on the plan. */
export interface Marker { id: string; name: string; x: number; y: number; ax: number; ay: number; enabled: boolean }

interface PlanHistory { undo(): void; redo(): void; canUndo: boolean; canRedo: boolean }

const clone = (vs: Vertex[]) => vs.map((v) => [v[0], v[1]] as Vertex);
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

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
  canvas = $state<PlanCanvas | null>(null);
  /** A local edit of the current polygon that is invalid, so not applied. */
  dirty = $state(false);

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
  readonly selectedFootprint = $derived(this.selectedZone && this.selectedZone.type !== 'point' && zoneHasFootprint(this.selectedZone) ? this.selectedZone : null);
  drawKind = $state<'plane' | 'volume' | null>(null);
  readonly footprintZones = $derived(this.userZones.filter((z) => z.type !== 'point' && zoneHasFootprint(z)));

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
    this.onOutline ? this.scene().vertices
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
  // Kept for Phase 3 (surfaces): point-place state
  placing = $state(false);
  placeCursor = $state<Vertex | null>(null);
  markerDrag = $state<{ id: string; part: 'body' | 'aim' | 'aimAt'; start: Vertex; dx: number; dy: number; target: Vertex | null; group: string[] } | null>(null);
  marquee = $state<{ a: Vertex; b: Vertex; add: boolean } | null>(null);

  // --- Add lamp: choose a fixture, then each placement button adds one, placed automatically
  addFixture = $state('');
  addingLamp = $state<PlacementMode | null>(null);

  readonly markers = $derived.by<Marker[]>(() =>
    this.onLamps
      ? this.scene().lamps.map((l) => ({ id: l.id, name: l.name || l.id, x: l.x, y: l.y, ax: l.aimx, ay: l.aimy, enabled: l.enabled !== false }))
      : this.onZones
        ? this.userZones.filter((z) => z.type === 'point').map((z) => ({ id: z.id, name: z.name || z.id, x: z.x ?? 0, y: z.y ?? 0, ax: z.aim_x ?? z.x ?? 0, ay: z.aim_y ?? z.y ?? 0, enabled: z.enabled !== false }))
        : []
  );
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

  // "New outline" clears the current corners, so with corners present it asks first.
  askNewOutline = $state(false);

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
    if (this.drawing || !(this.onOutline || this.onObstacles || this.onZones || this.onCeiling)) return;
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
      if (!polygonInRoom(next, this.scene().vertices)) {
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
    this.marquee = null;
    this.drawKind = null;
    this.placing = false;
    this.placeCursor = null;
    this.selectedIndex = -1;
    this.context = next;
    this.draft = clone(next === 'outline' ? this.scene().vertices : []);
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
    this.askNewOutline = false;
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
    this.marquee = null;
    this.drawKind = null;
    this.placing = false;
    this.placeCursor = null;
    this.selectedIndex = -1;
    this.draft = clone(this.context === 'outline' ? this.scene().vertices : []);
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
    this.draft = o ? clone(o.vertices) : [];
  };

  /** A structure picked on the 2D plan: select it and bring its row into view. */
  clickObstacle = (id: string) => {
    if (this.drawing) return;
    this.selectObstacle(id);
    this.onItemSelected?.(id);
  };

  startObstacleDraw = () => {
    this.selectObstacle(null);
    this.canvas?.startDraw();
  };
  stopObstacleDraw = () => {
    if (this.drawing) this.canvas?.cancelDraw();
  };
  onDrawEnd = async (committed: boolean) => {
    // Kept for Phase 3 (surfaces): the zone branch, reached through startZoneDraw
    if (this.onZones) {
      const kind = this.drawKind;
      this.drawKind = null;
      if (!committed || this.draft.length < 3 || !kind) return;
      try {
        this.selectedZoneId = await this.actions.addZone(kind, { ...zoneFootprintGeometry(kind, this.draft), fit_room: false });
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
  /** Drag on empty space (Lamps) draws a box that selects the lamps inside; Shift adds to the selection. */
  onBackgroundDragStart = (event: PointerEvent): boolean => {
    if (this.onCeiling) return this.startGridDrag(event);
    if (!this.onLamps || this.placing || this.drawing || !this.canvas) return false;
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
    this.draft = z && z.type !== 'point' && zoneHasFootprint(z) ? clone(zoneFootprint(z)) : [];
  };
  /** A zone picked on the 2D plan: select it and bring its row into view. */
  clickZone = (id: string) => {
    if (this.drawing) return;
    this.selectZone(id);
    this.onItemSelected?.(id);
  };
  // Kept for Phase 3 (surfaces): point-place (setPlacing, placeAt, placing, placeCursor)
  setPlacing = (on: boolean) => {
    this.placing = on;
    this.tool = on ? 'custom' : 'edit';
    this.placeCursor = null;
    if (on) this.canvas?.focus();
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
  // Kept for Phase 3 (surfaces): zone-draw
  startZoneDraw = (kind: 'plane' | 'volume') => {
    if (this.drawing) {
      this.canvas?.cancelDraw();
      if (this.drawKind === kind) return;
    }
    this.setPlacing(false);
    this.selectZone(null);
    this.drawKind = kind;
    this.canvas?.startDraw();
  };

  // --- Markers (lamps and calc points)

  moveMarker = (m: Marker, dx: number, dy: number) => {
    if (dx === 0 && dy === 0) return;
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
    if (this.placing || this.drawing || event.button !== 0 || !canvas || canvas.isSpaceHeld()) return;
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
    const kind = this.onLamps && part === 'body' && this.lampMode === 'aim' ? 'aimAt' : part;
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
    if ((this.onLamps || this.onZones) && this.placing) this.placeAt(event);
    else this.onScaleClick(event);
  };
  onCustomMove = (event: PointerEvent) => {
    if ((this.onLamps || this.onZones) && this.placing) {
      if (this.canvas) this.placeCursor = this.snappedPointer(event);
    } else this.onScaleMove(event);
  };
  onCustomLeave = () => {
    this.cursorFree = null;
    this.placeCursor = null;
  };
  zoneSummary = (z: CalcZone): string => {
    if (z.type === 'point') return `point · ${this.fmt(z.z ?? 0)} ${this.unit} up`;
    if (!zoneHasFootprint(z)) return 'wall plane';
    const where = z.fit_room ? 'whole room' : z.vertices?.length ? `${z.vertices.length} corners` : 'rectangle';
    if (z.type === 'volume') return `volume · ${where}`;
    return `plane · ${where} · ${this.fmt(z.height ?? 0)} ${this.unit} up`;
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
    this.draft = it?.kind === 'keep' && this.ceilingItemShown(it) ? clone(it.vertices) : [];
  };
  /** An item picked on the 2D plan: select it and bring its row into view. */
  clickCeilingItem = (id: string) => {
    if (this.drawing) return;
    this.selectCeilingItem(id);
    this.onItemSelected?.(id);
  };
  /** Add to ceiling: one item in the middle of the room, selected. */
  addCeilingItem = (kind: CeilingKind): string => {
    const id = this.actions.addCeilingItem(kind);
    this.selectCeilingItem(id);
    return id;
  };
  copySelectedCeilingItem = () => {
    const it = this.selectedCeilingItem;
    if (!it || this.drawing) return;
    const id = this.actions.copyCeilingItem(it.id);
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
    const room = this.scene().vertices;
    if (pointInRoom(room, target[0], target[1])) this.ceilingDrag = { ...d, at: target };
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
      } else if (pointInRoom(this.scene().vertices, it.x + dx, it.y + dy)) {
        this.actions.updateCeilingItem(it.id, { x: r6(it.x + dx), y: r6(it.y + dy) });
      }
    }
  };

  // --- Outline: draw tool and corner table

  requestNewOutline = () => {
    if (this.drawing) return;
    if (this.draft.length > 0) this.askNewOutline = true;
    else this.startDraw();
  };
  startDraw = () => {
    this.askNewOutline = false;
    this.planSelected = false;
    this.canvas?.startDraw();
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
    this.canvas?.removeVertex(index);
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
    this.endCeilingDrag();
    const moved = this.dragPlacement;
    this.imageDrag = null;
    if (moved) this.actions.setPlacement(moved);
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
