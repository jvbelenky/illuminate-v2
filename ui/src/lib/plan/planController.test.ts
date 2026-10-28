import { describe, test, expect, vi } from 'vitest';
import { tick } from 'svelte';
import { PlanController } from './planController.svelte';
import type { PlanActions, PlanScene } from './planActions';
import { DEFAULT_CEILING_LAYOUT } from '$lib/ceiling/ceilingLayout';
import { defaultProject, type CalcZone, type LampInstance, type SceneObject } from '$lib/types/project';
import type { Vertex } from '$lib/utils/roomGeometry';
import { get } from 'svelte/store';
import { pickMode } from '$lib/stores/pickMode';

// The harness defaults: a 6 x 4 m room with a single lamp and a single box obstacle.
const rect: Vertex[] = [[0, 0], [6, 0], [6, 4], [0, 4]];
const lamp = { id: 'lamp-1', name: 'Lamp 1', lamp_type: 'krcl_222', preset_id: 'beacon', scaling_factor: 1, enabled: true, x: 2, y: 2, z: 2.5, aimx: 2, aimy: 2, aimz: 0 } as LampInstance;
const box = { id: 'object-1', name: 'Desk', type: 'box', x: 1, y: 1, z: 0, width: 1, length: 1, height: 0.8, rotation: 0, enabled: true, reflectance: 0.5, transmittance: 0 } as unknown as SceneObject;

function makeScene(over: Partial<PlanScene> = {}): PlanScene {
  return {
    vertices: rect,
    units: 'meters',
    precision: 1,
    lamps: [lamp],
    objects: [box],
    zones: [],
    floorplan: null,
    image: null,
    roomZ: 2.7,
    fixtures: [],
    room: defaultProject().room,
    hidden: { lamps: new Set(), zones: new Set(), objects: new Set() },
    ceiling: DEFAULT_CEILING_LAYOUT,
    ...over,
  };
}

function makeActions(): PlanActions {
  return {
    setOutline: vi.fn(),
    setPlacement: vi.fn(),
    addObstacle: vi.fn(async () => 'object-2'),
    updateObstacle: vi.fn(),
    removeObstacle: vi.fn(),
    addLamp: vi.fn(async () => 'lamp-2'),
    addPlacedLamp: vi.fn(async () => 'lamp-2'),
    copyLamps: vi.fn(async () => ['lamp-2']),
    updateLamp: vi.fn(),
    removeLamp: vi.fn(),
    addZone: vi.fn(async () => 'zone-1'),
    updateZone: vi.fn(),
    removeZone: vi.fn(),
    copyZone: vi.fn(async () => 'zone-2'),
    changeUnits: vi.fn(),
    updateRoom: vi.fn(),
    setHidden: vi.fn(),
    updateCeiling: vi.fn(),
    addCeilingItem: vi.fn(() => 'ceiling-1'),
    updateCeilingItem: vi.fn(),
    removeCeilingItem: vi.fn(),
    copyCeilingItem: vi.fn(() => 'ceiling-2'),
  };
}

function make(over: Partial<PlanScene> = {}) {
  const actions = makeActions();
  const scene = makeScene(over);
  const ctl = new PlanController({ actions, scene: () => scene });
  return { ctl, actions };
}

/** Dispatch a keydown at `target` (or the document body) and hand it to the controller. */
function press(ctl: PlanController, key: string, target: HTMLElement = document.body, init: KeyboardEventInit = {}) {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  const handler = (e: Event) => ctl.onWindowKey(e as KeyboardEvent);
  target.addEventListener('keydown', handler);
  target.dispatchEvent(ev);
  target.removeEventListener('keydown', handler);
}

describe('PlanController', () => {
  test('commitDraft applies a valid outline with one setOutline call', () => {
    const { ctl, actions } = make();
    ctl.draft = [[0, 0], [8, 0], [8, 4], [0, 4]];
    ctl.commitDraft();
    expect(actions.setOutline).toHaveBeenCalledTimes(1);
    expect(actions.setOutline).toHaveBeenCalledWith([[0, 0], [8, 0], [8, 4], [0, 4]]);
    expect(ctl.dirty).toBe(false);
  });

  test('an invalid (self-crossing) outline is held back and marks dirty', () => {
    const { ctl, actions } = make();
    ctl.draft = [[0, 0], [6, 4], [6, 0], [0, 4]];
    ctl.commitDraft();
    expect(actions.setOutline).not.toHaveBeenCalled();
    expect(ctl.dirty).toBe(true);
  });

  test('requestLeave proceeds at once when clean, and waits when dirty', () => {
    const { ctl } = make();
    const first = vi.fn();
    ctl.requestLeave(first);
    expect(first).toHaveBeenCalledTimes(1);
    expect(ctl.pendingLeave).toBeNull();

    ctl.draft = [[0, 0], [6, 4], [6, 0], [0, 4]];
    ctl.commitDraft();
    const second = vi.fn();
    ctl.requestLeave(second);
    expect(second).not.toHaveBeenCalled();
    expect(ctl.pendingLeave).toBe(second);
  });

  test('resolveLeave keep-saved reverts the draft and proceeds; stay keeps it', () => {
    const { ctl } = make();
    const crossed: Vertex[] = [[0, 0], [6, 4], [6, 0], [0, 4]];
    ctl.draft = crossed;
    ctl.commitDraft();

    const proceed = vi.fn();
    ctl.requestLeave(proceed);
    ctl.resolveLeave('stay');
    expect(proceed).not.toHaveBeenCalled();
    expect(ctl.pendingLeave).toBeNull();
    expect(ctl.dirty).toBe(true);
    expect(ctl.draft).toEqual(crossed);

    ctl.requestLeave(proceed);
    ctl.resolveLeave('keep-saved');
    expect(proceed).toHaveBeenCalledTimes(1);
    expect(ctl.dirty).toBe(false);
    expect(ctl.draft).toEqual(rect);
  });

  test('setContext clears the selections of other contexts', () => {
    const { ctl } = make();
    ctl.setContext('obstacles');
    expect(ctl.context).toBe('obstacles');
    ctl.selectObstacle('object-1');
    expect(ctl.selectedId).toBe('object-1');
    ctl.setContext('lamps');
    expect(ctl.context).toBe('lamps');
    expect(ctl.selectedId).toBeNull();
    ctl.selectedLampIds = ['lamp-1'];
    ctl.setContext('view');
    expect(ctl.selectedLampIds).toEqual([]);
    expect(ctl.draft).toEqual([]);
  });

  test('ignores shortcut keys typed into a field', () => {
    const { ctl, actions } = make();
    ctl.setContext('lamps');
    ctl.selectedLampIds = ['lamp-1'];
    expect(ctl.lampMode).toBe('move');
    for (const tag of ['input', 'select', 'textarea'] as const) {
      const field = document.createElement(tag);
      document.body.appendChild(field);
      press(ctl, 'Delete', field);
      press(ctl, 'ArrowLeft', field);
      press(ctl, 'a', field);
      field.remove();
    }
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const inner = document.createElement('span');
    editable.appendChild(inner);
    document.body.appendChild(editable);
    press(ctl, 'Delete', inner);
    press(ctl, 'ArrowLeft', inner);
    press(ctl, 'a', inner);
    editable.remove();
    expect(actions.removeLamp).not.toHaveBeenCalled();
    expect(actions.updateLamp).not.toHaveBeenCalled();
    expect(ctl.lampMode).toBe('move');
    // The same keys outside a field do act
    press(ctl, 'a');
    expect(ctl.lampMode).toBe('aim');
    press(ctl, 'ArrowLeft');
    expect(actions.updateLamp).toHaveBeenCalledTimes(1);
    press(ctl, 'Delete');
    expect(actions.removeLamp).toHaveBeenCalledWith('lamp-1');
  });

  test('shortcut keys act only on the current context', () => {
    const { ctl, actions } = make();
    ctl.setContext('obstacles');
    ctl.selectedLampIds = ['lamp-1'];
    press(ctl, 'Delete');
    press(ctl, 'ArrowLeft');
    press(ctl, 'd', document.body, { ctrlKey: true });
    expect(actions.removeLamp).not.toHaveBeenCalled();
    expect(actions.updateLamp).not.toHaveBeenCalled();
    expect(actions.copyLamps).not.toHaveBeenCalled();
    // Non-editing contexts take no shortcuts at all
    ctl.setContext('ceiling');
    ctl.selectedLampIds = ['lamp-1'];
    press(ctl, 'Delete');
    expect(actions.removeLamp).not.toHaveBeenCalled();
    expect(actions.removeObstacle).not.toHaveBeenCalled();
  });
});

describe('a new scene (project opened or New)', () => {
  test('resetForNewScene drops an invalid draft, selection, prompts and hover, shows the new outline and asks for a fit', () => {
    const actions = makeActions();
    let scene = makeScene();
    const ctl = new PlanController({ actions, scene: () => scene });
    ctl.setContext('lamps');
    ctl.selectedLampIds = ['lamp-1'];
    ctl.setContext('outline');
    ctl.draft = [[0, 0], [6, 4], [6, 0], [0, 4]];
    ctl.dirty = true;
    ctl.pendingLeave = () => {};
    ctl.hoverItem('lamps', 'lamp-1', true);
    const fits = ctl.fitRequest;
    const tri: Vertex[] = [[0, 0], [10, 0], [10, 8]];
    scene = makeScene({ vertices: tri });
    ctl.resetForNewScene();
    expect(ctl.draft).toEqual(tri);
    expect(ctl.dirty).toBe(false);
    expect(ctl.pendingLeave).toBeNull();
    expect(ctl.selectedLampIds).toEqual([]);
    expect(ctl.selectedId).toBeNull();
    expect(ctl.selectedZoneId).toBeNull();
    expect(ctl.hoveredItem).toBeNull();
    expect(ctl.fitRequest).toBe(fits + 1);
  });

  test('resetForNewScene clears a selection held in another context', () => {
    const { ctl } = make();
    ctl.setContext('obstacles');
    ctl.selectObstacle('object-1');
    expect(ctl.selectedId).toBe('object-1');
    ctl.resetForNewScene();
    expect(ctl.selectedId).toBeNull();
    expect(ctl.draft).toEqual([]);
  });
});

describe('row hover', () => {
  test('hovering a row sets the hovered item; leaving it clears it; another row leaving does not', () => {
    const { ctl } = make();
    ctl.hoverItem('zones', 'zone-1', true);
    expect(ctl.hoveredItem).toEqual({ kind: 'zones', id: 'zone-1' });
    ctl.hoverItem('lamps', 'lamp-1', false);
    expect(ctl.hoveredItem).toEqual({ kind: 'zones', id: 'zone-1' });
    ctl.hoverItem('zones', 'zone-1', false);
    expect(ctl.hoveredItem).toBeNull();
  });

  test('switching context clears the hover (the row is gone without a mouseleave)', () => {
    const { ctl } = make();
    ctl.hoverItem('objects', 'object-1', true);
    ctl.setContext('lamps');
    expect(ctl.hoveredItem).toBeNull();
  });
});

describe('flows that need the 2D canvas', () => {
  function fakeCanvas() {
    return { startDraw: vi.fn(), cancelDraw: vi.fn(), focus: vi.fn(), removeVertex: vi.fn() } as any;
  }

  test('with the canvas away, a flow asks for it and runs once it is there', async () => {
    const flows: [string, (c: PlanController) => void, string][] = [
      ['Draw outline', (c) => c.requestNewOutline(), 'startDraw'],
      ['structure draw', (c) => c.startObstacleDraw(), 'startDraw'],
      ['zone draw', (c) => c.startZoneDraw('plane'), 'startDraw'],
      ['placing', (c) => c.setPlacing(true), 'focus'],
      ['remove corner', (c) => c.removeVertex(1), 'removeVertex'],
    ];
    for (const [name, run, method] of flows) {
      const { ctl } = make();
      const onNeedCanvas = vi.fn();
      ctl.onNeedCanvas = onNeedCanvas;
      run(ctl);
      expect(onNeedCanvas, name).toHaveBeenCalledTimes(1);
      const canvas = fakeCanvas();
      ctl.canvas = canvas;
      await tick();
      expect(canvas[method], name).toHaveBeenCalledTimes(1);
      // It runs once, not again on a later canvas
      const again = fakeCanvas();
      ctl.canvas = null;
      ctl.canvas = again;
      await tick();
      expect(again[method], name).not.toHaveBeenCalled();
    }
  });

  test('with the canvas there, a flow runs at once without asking', () => {
    const { ctl } = make();
    const onNeedCanvas = vi.fn();
    ctl.onNeedCanvas = onNeedCanvas;
    const canvas = fakeCanvas();
    ctl.canvas = canvas;
    ctl.requestNewOutline();
    expect(canvas.startDraw).toHaveBeenCalledTimes(1);
    expect(onNeedCanvas).not.toHaveBeenCalled();
  });

  test('a request whose canvas never came is dropped, not run much later', async () => {
    const { ctl } = make();
    ctl.onNeedCanvas = vi.fn();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    ctl.requestNewOutline();
    now.mockReturnValue(5000);
    const canvas = fakeCanvas();
    ctl.canvas = canvas;
    await tick();
    expect(canvas.startDraw).not.toHaveBeenCalled();
    now.mockRestore();
  });

  describe('surfaces', () => {
    test('] steps floor -> ceiling -> wall:0 and wraps', () => {
      const { ctl } = make();
      expect(ctl.surface).toBe('floor');
      press(ctl, ']');
      expect(ctl.surface).toBe('ceiling');
      press(ctl, ']');
      expect(ctl.surface).toBe('wall:0');
      for (let i = 0; i < 4; i++) press(ctl, ']');
      expect(ctl.surface).toBe('floor');
    });

    test('[ from floor goes to the last wall', () => {
      const { ctl } = make();
      press(ctl, '[');
      expect(ctl.surface).toBe('wall:3');
    });

    test('surface keys are ignored while typing', () => {
      const { ctl } = make();
      const input = document.createElement('input');
      document.body.appendChild(input);
      press(ctl, ']', input);
      input.remove();
      expect(ctl.surface).toBe('floor');
    });

    test('selecting a wall plane switches the surface to its wall', () => {
      const zone = { id: 'z1', type: 'plane', name: 'Wall plane', surface: 'wall:2', isStandard: false } as unknown as CalcZone;
      const { ctl } = make({ zones: [zone] });
      ctl.selectZone('z1');
      expect(ctl.surface).toBe('wall:2');
      expect(ctl.selectedZoneId).toBe('z1');
    });

    test('changing surface clears the selection', () => {
      const { ctl } = make();
      ctl.selectedZoneId = 'z1';
      ctl.setSurface('ceiling');
      expect(ctl.selectedZoneId).toBeNull();
    });

    test('ceiling context sets the ceiling surface and leaving returns to floor', () => {
      const { ctl } = make();
      ctl.setContext('ceiling');
      expect(ctl.surface).toBe('ceiling');
      ctl.setContext('zones');
      expect(ctl.surface).toBe('floor');
    });

    test('leaving the ceiling context keeps a surface the user picked', () => {
      const { ctl } = make();
      ctl.setContext('ceiling');
      ctl.setSurface('wall:1');
      ctl.setContext('zones');
      expect(ctl.surface).toBe('wall:1');
    });

    test('surface falls back to floor when its wall disappears', () => {
      const scene = makeScene();
      const ctl = new PlanController({ actions: makeActions(), scene: () => scene });
      ctl.setSurface('wall:3');
      expect(ctl.surface).toBe('wall:3');
      expect(ctl.wallSeg).not.toBeNull();
      scene.vertices = [[0, 0], [6, 0], [3, 4]];
      expect(ctl.surface).toBe('floor');
      expect(ctl.wallSeg).toBeNull();
    });
  });

  describe('keys on a wall', () => {
    test('floor shortcuts do nothing while a wall shows: a selected lamp is not nudged, copied or deleted', () => {
      const { ctl, actions } = make();
      ctl.setContext('lamps');
      // Control: on the floor, an arrow nudges the selected lamp
      ctl.selectLamp('lamp-1');
      press(ctl, 'ArrowLeft');
      expect(actions.updateLamp).toHaveBeenCalledTimes(1);
      vi.mocked(actions.updateLamp).mockClear();
      ctl.setSurface('wall:0');
      ctl.selectLamp('lamp-1');
      press(ctl, 'ArrowLeft');
      press(ctl, 'Delete');
      press(ctl, 'd', document.body, { ctrlKey: true });
      expect(actions.updateLamp).not.toHaveBeenCalled();
      expect(actions.removeLamp).not.toHaveBeenCalled();
      expect(actions.copyLamps).not.toHaveBeenCalled();
      // [ and ] still step surfaces
      press(ctl, ']');
      expect(ctl.surface).toBe('wall:1');
    });

    test('a selected structure is not nudged or deleted on a wall', () => {
      const { ctl, actions } = make();
      ctl.setContext('obstacles');
      ctl.setSurface('wall:0');
      ctl.selectObstacle('object-1');
      press(ctl, 'ArrowUp');
      press(ctl, 'Delete');
      expect(actions.updateObstacle).not.toHaveBeenCalled();
      expect(actions.removeObstacle).not.toHaveBeenCalled();
    });
  });
});

describe('planes on surfaces', () => {
  const fakeCanvas = () => ({ startDraw: vi.fn(), cancelDraw: vi.fn(), focus: vi.fn(), isDragging: () => false }) as any;
  // Wall 1 of the 6 x 4 room runs (6, 0) -> (6, 4): length 4. Seen from inside, canvas x = 4 - along.
  const wholeWall = { id: 'zw', type: 'plane', name: 'Wall plane', surface: 'wall:1', fit_room: true, normal_offset: 0, flip: false, isStandard: false } as unknown as CalcZone;
  const drawn = { ...wholeWall, fit_room: false, wall_vertices: [[0.5, 0.5], [2, 0.5], [2, 2]] } as unknown as CalcZone;
  const asSet = (vs: number[][]) => new Set(vs.map(([a, b]) => `${Math.round(a * 1e6) / 1e6},${Math.round(b * 1e6) / 1e6}`));

  test('drawing on wall:1 sets wall_vertices in wall coordinates and clears fit_room', async () => {
    const { ctl, actions } = make({ zones: [wholeWall] });
    ctl.setContext('zones');
    ctl.selectZone('zw');
    expect(ctl.surface).toBe('wall:1');
    ctl.canvas = fakeCanvas();
    ctl.startZoneDraw('plane');
    expect(ctl.canvas!.startDraw).toHaveBeenCalled();
    // Canvas corners (x, up); along = 4 - x
    ctl.draft = [[1, 0.5], [3, 0.5], [3, 2]];
    await ctl.onDrawEnd(true);
    expect(actions.addZone).not.toHaveBeenCalled();
    expect(actions.updateZone).toHaveBeenCalledTimes(1);
    const [id, partial] = vi.mocked(actions.updateZone).mock.calls[0];
    expect(id).toBe('zw');
    expect(partial.fit_room).toBe(false);
    expect(asSet(partial.wall_vertices!)).toEqual(asSet([[3, 0.5], [1, 0.5], [1, 2]]));
    expect(partial).not.toHaveProperty('vertices');
  });

  test('drawing on a wall with no plane selected adds a plane on that wall', async () => {
    const { ctl, actions } = make();
    ctl.setContext('zones');
    ctl.setSurface('wall:1');
    ctl.canvas = fakeCanvas();
    ctl.startZoneDraw('plane');
    ctl.draft = [[1, 0.5], [3, 0.5], [3, 2]];
    await ctl.onDrawEnd(true);
    const [kind, geometry] = vi.mocked(actions.addZone).mock.calls[0];
    expect(kind).toBe('plane');
    expect(geometry).toMatchObject({ surface: 'wall:1', fit_room: false, normal_offset: 0, flip: false });
    expect(asSet(geometry.wall_vertices!)).toEqual(asSet([[3, 0.5], [1, 0.5], [1, 2]]));
  });

  test('drawing on the ceiling adds a downward plane at the ceiling from the polygon', async () => {
    const { ctl, actions } = make();
    ctl.setContext('zones');
    ctl.setSurface('ceiling');
    ctl.canvas = fakeCanvas();
    ctl.startZoneDraw('plane');
    ctl.draft = [[1, 1], [3, 1], [2, 3]];
    await ctl.onDrawEnd(true);
    const [, geometry] = vi.mocked(actions.addZone).mock.calls[0];
    expect(geometry).toMatchObject({ surface: 'ceiling', height: 2.7, direction: -1, fit_room: false });
    expect(geometry.vertices).toHaveLength(3);
  });

  test("dragging a wall plane's corner on its wall updates wall_vertices", () => {
    const { ctl, actions } = make({ zones: [drawn] });
    ctl.setContext('zones');
    ctl.selectZone('zw');
    expect(ctl.surface).toBe('wall:1');
    // The stored outline, on the mirrored canvas
    expect(asSet(ctl.draft)).toEqual(asSet([[3.5, 0.5], [2, 0.5], [2, 2]]));
    expect(asSet(ctl.source)).toEqual(asSet(ctl.draft));
    ctl.draft = ctl.draft.map(([x, y]) => (x === 3.5 ? [3, y] : [x, y]));
    ctl.commitDraft();
    expect(actions.updateZone).toHaveBeenCalledTimes(1);
    const [id, partial] = vi.mocked(actions.updateZone).mock.calls[0];
    expect(id).toBe('zw');
    expect(asSet(partial.wall_vertices!)).toEqual(asSet([[1, 0.5], [2, 0.5], [2, 2]]));
    expect(partial.fit_room).toBe(false);
  });

  test("a whole-wall plane's draft is the wall face", () => {
    const { ctl } = make({ zones: [wholeWall] });
    ctl.setContext('zones');
    ctl.selectZone('zw');
    expect(asSet(ctl.draft)).toEqual(asSet([[0, 0], [4, 0], [4, 2.7], [0, 2.7]]));
  });

  test('the floor view lists wall planes as lines along their wall', () => {
    const { ctl } = make({ zones: [drawn] });
    ctl.setContext('zones');
    expect(ctl.wallPlaneLines).toHaveLength(1);
    const l = ctl.wallPlaneLines[0];
    expect([l.x1, l.y1, l.x2, l.y2].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([6, 0.5, 6, 2]);
  });

  test('each surface shows only its own planes', () => {
    const floorPlane = { id: 'zf', type: 'plane', name: 'F', surface: 'floor', height: 1, x1: 0, x2: 2, y1: 0, y2: 2, isStandard: false } as unknown as CalcZone;
    const ceilPlane = { id: 'zc', type: 'plane', name: 'C', surface: 'ceiling', height: 2.7, direction: -1, x1: 0, x2: 2, y1: 0, y2: 2, isStandard: false } as unknown as CalcZone;
    const { ctl } = make({ zones: [floorPlane, ceilPlane, drawn] });
    ctl.setContext('zones');
    expect(ctl.surfaceZones.map((z) => z.id)).toEqual(['zf']);
    ctl.setSurface('ceiling');
    expect(ctl.surfaceZones.map((z) => z.id)).toEqual(['zc']);
    ctl.setSurface('wall:1');
    expect(ctl.wallView!.planes.map((p) => p.id)).toEqual(['zw']);
  });

  test('drawing on the floor adds a plane at eye height', async () => {
    const { ctl, actions } = make();
    ctl.setContext('zones');
    ctl.canvas = fakeCanvas();
    ctl.startZoneDraw('plane');
    ctl.draft = [[1, 1], [3, 1], [2, 3]];
    await ctl.onDrawEnd(true);
    const [, geometry] = vi.mocked(actions.addZone).mock.calls[0];
    expect(geometry).toMatchObject({ surface: 'floor', height: 1.8, fit_room: false });
  });

  test('an orphaned wall plane is drawn on no wall and opens on Floor', () => {
    const orphan = { ...drawn, wall_orphan: true } as CalcZone;
    const { ctl } = make({ zones: [orphan] });
    ctl.setContext('zones');
    expect(ctl.wallPlaneLines).toEqual([]);
    ctl.setSurface('wall:1');
    expect(ctl.wallView!.planes).toEqual([]);
    ctl.selectZone('zw');
    expect(ctl.surface).toBe('floor');
    expect(ctl.selectedWallPlane).toBeNull();
  });

  test('Delete and Ctrl+D act on a plane selected on its wall; arrows do nothing', async () => {
    const { ctl, actions } = make({ zones: [drawn] });
    ctl.setContext('zones');
    ctl.canvas = { ...fakeCanvas(), nudge: vi.fn() };
    ctl.selectZone('zw');
    expect(ctl.onWall).toBe(true);
    press(ctl, 'ArrowLeft');
    expect(actions.updateZone).not.toHaveBeenCalled();
    expect(ctl.canvas!.nudge).not.toHaveBeenCalled();
    press(ctl, 'd', document.body, { ctrlKey: true });
    await tick();
    expect(actions.copyZone).toHaveBeenCalledWith('zw', expect.any(Number), expect.any(Number));
    ctl.selectZone('zw');
    press(ctl, 'Delete');
    expect(actions.removeZone).toHaveBeenCalledWith('zw');
  });

  test('on a wall, Delete does nothing without a plane of that wall selected', () => {
    const { ctl, actions } = make({ zones: [drawn] });
    ctl.setContext('zones');
    ctl.selectZone('zw');
    // Another wall: the selection is dropped, and nothing is deleted
    ctl.setSurface('wall:0');
    press(ctl, 'Delete');
    press(ctl, 'd', document.body, { ctrlKey: true });
    expect(actions.removeZone).not.toHaveBeenCalled();
    expect(actions.copyZone).not.toHaveBeenCalled();
    // Lamps context on the plane's wall: still inert
    ctl.setContext('lamps');
    ctl.setSurface('wall:1');
    ctl.selectLamp('lamp-1');
    press(ctl, 'Delete');
    expect(actions.removeLamp).not.toHaveBeenCalled();
  });
});

describe('editing in a wall view', () => {
  const canvas = () => ({ pointerToRoom: (e: any) => [e.clientX, e.clientY], snapValue: (v: number) => v, isSpaceHeld: () => false }) as any;
  const ptr = (x: number, y: number) => ({ button: 0, shiftKey: false, altKey: false, clientX: x, clientY: y, pointerId: 1, currentTarget: {}, preventDefault() {}, stopPropagation() {} }) as any;

  test('dragging a projected lamp on wall:0 in Lamps context calls updateLamp with the unprojected move', () => {
    const { ctl, actions } = make();
    ctl.setContext('lamps');
    ctl.setSurface('wall:0');
    ctl.canvas = canvas();
    // lamp at along 2, up 2.5: canvas (6 - 2, 2.5) = (4, 2.5)
    ctl.onMarkerPointerDown(ptr(4, 2.5), 'lamp-1', 'body');
    // dragging right on the canvas is toward the wall's first vertex: along decreases
    ctl.onMarkerDragMove(ptr(5, 2));
    ctl.endMarkerDrag();
    expect(actions.updateLamp).toHaveBeenCalledTimes(1);
    const [id, move] = vi.mocked(actions.updateLamp).mock.calls[0];
    expect(id).toBe('lamp-1');
    expect(move.x).toBeCloseTo(1);
    expect(move.y).toBeCloseTo(2);
    expect(move.z).toBeCloseTo(2);
    expect(move.aimx).toBeCloseTo(1);
  });

  test('a lamp has no aim handle in a wall view', () => {
    const { ctl, actions } = make();
    ctl.setContext('lamps');
    ctl.setSurface('wall:0');
    ctl.canvas = canvas();
    ctl.lampMode = 'aim';
    ctl.onMarkerPointerDown(ptr(4, 2.5), 'lamp-1', 'body');
    ctl.onMarkerDragMove(ptr(5, 2.5));
    ctl.endMarkerDrag();
    expect(vi.mocked(actions.updateLamp).mock.calls[0][1]).toHaveProperty('x');
  });

  test('dragging a structure near the wall calls updateObstacle with the unprojected move', () => {
    const { ctl, actions } = make({ objects: [{ ...box, shape: 'box', yaw: 0 } as unknown as SceneObject] });
    ctl.setContext('obstacles');
    ctl.setSurface('wall:0');
    ctl.canvas = canvas();
    ctl.onWallShapeDown('object-1', ptr(1, 0.4));
    ctl.onHostMove(ptr(0.5, 0.9));
    ctl.onHostPointerUp();
    expect(actions.updateObstacle).toHaveBeenCalledTimes(1);
    const [id, move] = vi.mocked(actions.updateObstacle).mock.calls[0];
    expect(id).toBe('object-1');
    // left on the canvas is away from the first vertex: along increases
    expect(move.x).toBeCloseTo(1.5);
    expect(move.y).toBeCloseTo(1);
    expect(move.z).toBeCloseTo(0.5);
  });

  test('on wall:1 in Obstacles, onWallShapeDown leaves the draft empty', () => {
    const near = { ...box, shape: 'box', yaw: 0, x: 5.6, y: 2 } as unknown as SceneObject;
    const { ctl } = make({ objects: [near] });
    ctl.setContext('obstacles');
    ctl.setSurface('wall:1');
    ctl.canvas = canvas();
    ctl.onWallShapeDown('object-1', ptr(2, 0.4));
    expect(ctl.selectedId).toBe('object-1');
    expect(ctl.draft).toEqual([]);
    // Picked from its row too
    ctl.selectObstacle(null);
    ctl.selectObstacle('object-1');
    expect(ctl.draft).toEqual([]);
  });

  test('a ceiling keep-out picked while a wall shows puts no floor polygon on the wall canvas', () => {
    const { ctl } = make({ ceiling: { ...DEFAULT_CEILING_LAYOUT, items: [{ id: 'k1', kind: 'keep', name: 'Keep', vertices: [[1, 1], [2, 1], [2, 2]] }] } as any });
    ctl.setContext('ceiling');
    ctl.setSurface('wall:0');
    ctl.selectCeilingItem('k1');
    expect(ctl.draft).toEqual([]);
  });

  test('a structure far from the wall is not draggable', () => {
    const far = { ...box, shape: 'box', yaw: 0, id: 'object-9', y: 3.6 } as unknown as SceneObject;
    const { ctl, actions } = make({ objects: [far] });
    ctl.setContext('obstacles');
    ctl.setSurface('wall:0');
    ctl.canvas = canvas();
    expect(ctl.wallView!.shapes[0].inert).toBe(true);
    ctl.onWallShapeDown('object-9', ptr(1, 0.4));
    ctl.onHostMove(ptr(0.5, 0.9));
    ctl.onHostPointerUp();
    expect(actions.updateObstacle).not.toHaveBeenCalled();
  });
});

describe('Place and Aim on the plan', () => {
  const canvas = () => ({ pointerToRoom: (e: any) => [e.clientX, e.clientY], snapValue: (v: number) => v, isSpaceHeld: () => false, focus() {} }) as any;
  const click = (x: number, y: number) => ({ button: 0, altKey: false, clientX: x, clientY: y }) as any;
  const point = { id: 'p1', type: 'point', name: 'Point', x: 3, y: 1.2, z: 1, aim_x: 3, aim_y: 1.2, aim_z: 2, isStandard: false } as unknown as CalcZone;
  function setup() {
    const r = make({ zones: [point] });
    r.ctl.setContext('zones');
    r.ctl.selectZone('p1');
    r.ctl.canvas = canvas();
    return r;
  }

  test('on the floor a click sets x and y and keeps z', () => {
    const { ctl, actions } = setup();
    ctl.syncPointPick({ type: 'point_position' });
    expect(ctl.pointPick).toBe('point_position');
    expect(ctl.tool).toBe('custom');
    ctl.onCustomClick(click(4.5, 2.25));
    expect(actions.updateZone).toHaveBeenCalledTimes(1);
    expect(actions.updateZone).toHaveBeenCalledWith('p1', { x: 4.5, y: 2.25 });
    expect(ctl.pointPick).toBeNull();
    expect(ctl.tool).toBe('edit');
  });

  test('Aim on the floor sets aim_x and aim_y and keeps aim_z', () => {
    const { ctl, actions } = setup();
    ctl.syncPointPick({ type: 'aim_point' });
    ctl.onCustomClick(click(1, 3));
    expect(actions.updateZone).toHaveBeenCalledWith('p1', { aim_x: 1, aim_y: 3 });
  });

  test('on wall:0 a click sets the position from (along, up) at the current depth', () => {
    const { ctl, actions } = setup();
    ctl.setSurface('wall:0');
    ctl.selectZone('p1');
    ctl.canvas = canvas();
    ctl.syncPointPick({ type: 'point_position' });
    // canvas x = length - along: (4, 1.5) is along 2, up 1.5; depth from the wall is y = 1.2
    ctl.onCustomClick(click(4, 1.5));
    expect(actions.updateZone).toHaveBeenCalledWith('p1', { x: 2, y: 1.2, z: 1.5 });
  });

  test('on wall:1 the mirrored canvas gives the right world point, and Aim keeps its own depth', () => {
    const { ctl, actions } = setup();
    ctl.setSurface('wall:1');
    ctl.selectZone('p1');
    ctl.canvas = canvas();
    ctl.syncPointPick({ type: 'point_position' });
    // wall:1 runs (6,0) to (6,4); canvas (1.5, 2) is along 4 - 1.5 = 2.5, up 2; depth is 6 - 3 = 3
    ctl.onCustomClick(click(1.5, 2));
    expect(actions.updateZone).toHaveBeenLastCalledWith('p1', { x: 3, y: 2.5, z: 2 });
    ctl.syncPointPick({ type: 'aim_point' });
    ctl.onCustomClick(click(3, 0.5));
    expect(actions.updateZone).toHaveBeenLastCalledWith('p1', { aim_x: 3, aim_y: 1, aim_z: 0.5 });
  });

  test('Escape cancels the pick and the request, without an update', () => {
    const { ctl, actions } = setup();
    pickMode.set({ type: 'point_position' });
    ctl.syncPointPick(get(pickMode));
    expect(ctl.onEscapeKey()).toBe(true);
    expect(ctl.pointPick).toBeNull();
    expect(get(pickMode)).toBeNull();
    expect(actions.updateZone).not.toHaveBeenCalled();
  });

  describe('a lamp Position or Aim pick from the lamp editor', () => {
    // The harness lamp stands at (2, 2, 2.5), aimed straight down at (2, 2, 0)
    function lampSetup(over: Partial<LampInstance> = {}) {
      const r = make({ lamps: [{ ...lamp, ...over }] });
      r.ctl.canvas = canvas();
      return r;
    }

    test('on the floor a click moves x and y, keeps z, and carries the aim along, in one update', () => {
      const { ctl, actions } = lampSetup({ aimx: 3, aimy: 2.5 });
      ctl.syncPointPick({ type: 'lamp_position', lampId: 'lamp-1' });
      expect(ctl.pointPick).toBe('lamp_position');
      expect(ctl.tool).toBe('custom');
      ctl.onCustomClick(click(4, 1));
      expect(actions.updateLamp).toHaveBeenCalledTimes(1);
      expect(actions.updateLamp).toHaveBeenCalledWith('lamp-1', { x: 4, y: 1, aimx: 5, aimy: 1.5 });
      expect(ctl.pointPick).toBeNull();
      expect(ctl.tool).toBe('edit');
    });

    test('Aim on the floor sets aimx and aimy and keeps aimz', () => {
      const { ctl, actions } = lampSetup();
      ctl.syncPointPick({ type: 'lamp_aim', lampId: 'lamp-1' });
      ctl.onCustomClick(click(5, 3));
      expect(actions.updateLamp).toHaveBeenCalledWith('lamp-1', { aimx: 5, aimy: 3 });
    });

    test('on wall:0 a click sets (along, up) at the lamp\'s depth; Aim keeps its own depth', () => {
      const { ctl, actions } = lampSetup();
      ctl.setSurface('wall:0');
      ctl.canvas = canvas();
      ctl.syncPointPick({ type: 'lamp_position', lampId: 'lamp-1' });
      // canvas (3, 2) is along 3, up 2; the lamp is 2 in from the wall; the aim moves by the same delta
      ctl.onCustomClick(click(3, 2));
      expect(actions.updateLamp).toHaveBeenLastCalledWith('lamp-1', { x: 3, y: 2, z: 2, aimx: 3, aimy: 2, aimz: -0.5 });
      ctl.syncPointPick({ type: 'lamp_aim', lampId: 'lamp-1' });
      // canvas (1, 0.5) is along 5, up 0.5; the aim point is 2 in from the wall
      ctl.onCustomClick(click(1, 0.5));
      expect(actions.updateLamp).toHaveBeenLastCalledWith('lamp-1', { aimx: 5, aimy: 2, aimz: 0.5 });
    });

    test('a lamp stuck to the wall showing stays on it, clamped to its length', () => {
      const { ctl, actions } = lampSetup({ y: 0.25, aimy: 0.25, stick_wall: true, wall_index: 0, wall_t: 2, wall_offset: 0.25 });
      ctl.setSurface('wall:0');
      ctl.canvas = canvas();
      ctl.syncPointPick({ type: 'lamp_position', lampId: 'lamp-1' });
      // canvas x -1 is along 7, past the wall's end at 6
      ctl.onCustomClick(click(-1, 2));
      expect(actions.updateLamp).toHaveBeenCalledWith('lamp-1', expect.objectContaining({ x: 6, y: 0.25, z: 2, stick_wall: true, wall_t: expect.any(Number) }));
    });

    test('without a lamp id it picks for the selected lamp; with neither nothing changes', () => {
      const { ctl, actions } = lampSetup();
      ctl.syncPointPick({ type: 'lamp_aim' });
      ctl.onCustomClick(click(1, 1));
      expect(actions.updateLamp).not.toHaveBeenCalled();
      ctl.setContext('lamps');
      ctl.selectLamp('lamp-1');
      ctl.syncPointPick({ type: 'lamp_aim' });
      ctl.onCustomClick(click(1, 1));
      expect(actions.updateLamp).toHaveBeenCalledWith('lamp-1', { aimx: 1, aimy: 1 });
    });

    test('Escape cancels the pick and the request, without an update', () => {
      const { ctl, actions } = lampSetup();
      pickMode.set({ type: 'lamp_position', lampId: 'lamp-1' });
      ctl.syncPointPick(get(pickMode));
      expect(ctl.onEscapeKey()).toBe(true);
      expect(ctl.pointPick).toBeNull();
      expect(get(pickMode)).toBeNull();
      expect(actions.updateLamp).not.toHaveBeenCalled();
    });
  });

  test('other pick types, or none, end it; the ghost follows the pointer', () => {
    const { ctl } = setup();
    ctl.syncPointPick({ type: 'point_position' });
    ctl.onCustomMove({ clientX: 2, clientY: 3, altKey: false } as any);
    expect(ctl.placeCursor).toEqual([2, 3]);
    ctl.syncPointPick({ type: 'direction' });
    expect(ctl.pointPick).toBeNull();
    expect(ctl.placeCursor).toBeNull();
  });
});
