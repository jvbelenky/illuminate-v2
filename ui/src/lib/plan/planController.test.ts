import { describe, test, expect, vi } from 'vitest';
import { PlanController } from './planController.svelte';
import type { PlanActions, PlanScene } from './planActions';
import { defaultProject, type LampInstance, type SceneObject } from '$lib/types/project';
import type { Vertex } from '$lib/utils/roomGeometry';

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
    ctl.askNewOutline = true;
    ctl.hoverItem('lamps', 'lamp-1', true);
    const fits = ctl.fitRequest;
    const tri: Vertex[] = [[0, 0], [10, 0], [10, 8]];
    scene = makeScene({ vertices: tri });
    ctl.resetForNewScene();
    expect(ctl.draft).toEqual(tri);
    expect(ctl.dirty).toBe(false);
    expect(ctl.pendingLeave).toBeNull();
    expect(ctl.askNewOutline).toBe(false);
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
