import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import Harness from '$lib/workspace/test/WorkspaceHarness.svelte';
import type { PlanController } from '$lib/plan/planController.svelte';
import { fromMeters, roundToUnit } from '$lib/utils/unitConversion';

const rect: [number, number][] = [[0, 0], [6, 0], [6, 4], [0, 4]];
const baseProps = { vertices: rect, units: 'meters' as const, precision: 1 };

/** The harness logs every action; filter them by name. */
function callsOf(calls: unknown[][], name: string): unknown[][] {
  return calls.filter((c) => c[0] === name);
}

/** Render the harness with one editor part and hand back its controller. */
function mount(props: Record<string, unknown> = {}) {
  let ctl!: PlanController;
  const result = render(Harness, { props: { ...baseProps, ...props, onController: (c: PlanController) => (ctl = c) } });
  return { ...result, ctl };
}

const box = { id: 'object-9', name: 'Desk', shape: 'box' as const, width: 1, length: 1, height: 0.75, x: 2, y: 2, z: 0, yaw: 0, pitch: 0, roll: 0, reflectance: 0.1, transmittance: 0, enabled: true };
const lamp = { id: 'lamp-7', name: 'Beacon', lamp_type: 'krcl_222' as const, preset_id: 'beacon', has_ies_file: true, x: 2, y: 2, z: 2.5, aimx: 2, aimy: 2, aimz: 0, scaling_factor: 1, enabled: true };
const wholePlane = { id: 'zone-9', name: 'Floor', type: 'plane' as const, ref_surface: 'xy' as const, enabled: true, height: 0, x1: 0, x2: 6, y1: 0, y2: 4, fit_room: true };
const standard = { ...wholePlane, id: 'WholeRoomFluence', name: 'Whole room fluence', isStandard: true, type: 'volume' as const };
const fixtures = [
  { key: 'preset:beacon', label: 'Beacon', group: 'Presets' },
  { key: 'preset:ushio_b1', label: 'Ushio B1', group: 'Presets' },
];

/** The clickable part of a row, which opens it. */
function main(id: string): HTMLElement {
  return row(id).querySelector('.row-main') as HTMLElement;
}

function row(id: string): HTMLElement {
  return document.querySelector(`.editor-row[data-id="${id}"]`) as HTMLElement;
}

/** Open the Floorplan part's collapsed Geometry disclosure. */
async function openGeometry() {
  await fireEvent.click(screen.getByRole('button', { name: 'Vertices' }));
}

describe('Floorplan part', () => {
  it('dimensions are visible by default', () => {
    mount({ part: 'floorplan' });
    for (const label of ['Width', 'Length', 'Height', 'Units']) expect(screen.getByLabelText(label)).toBeTruthy();
    expect((screen.getByLabelText('Height') as HTMLInputElement).value).toBe('2.7');
    expect((screen.getByLabelText('Width') as HTMLInputElement).disabled).toBe(false);
  });

  it('width and length stay visible for a polygon room, as its bounding box', () => {
    mount({ part: 'floorplan', vertices: [[0, 0], [4, 0], [5, 3], [2, 5], [0, 3]], room: { shape: 'polygon', x: 5, y: 5 } });
    expect((screen.getByLabelText('Width') as HTMLInputElement).value).toBe('5');
    expect((screen.getByLabelText('Length') as HTMLInputElement).value).toBe('5');
    expect((screen.getByLabelText('Height') as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByLabelText('Units')).toBeTruthy();
  });

  it('no Start from heading and no 3D model button', () => {
    mount({ part: 'floorplan' });
    expect(screen.queryByText('Start from')).toBeNull();
    expect(screen.queryByRole('button', { name: /3D model/ })).toBeNull();
    expect(screen.queryByText('later')).toBeNull();
  });

  it('the image button says Upload floor plan image', () => {
    mount({ part: 'floorplan' });
    expect(screen.getByRole('button', { name: 'Upload floor plan image' })).toBeTruthy();
    expect(document.querySelector('input[type="file"]')).not.toBeNull();
  });

  it('Draw new outline sits below a divider; Upload floor plan image is on its own card after the outline, Vertices below it', () => {
    mount({ part: 'floorplan' });
    const buttons = [...document.querySelectorAll('.plan-actions button')].map((b) => b.textContent?.trim());
    expect(buttons).toEqual(['Draw new outline']);
    const card = screen.getByRole('region', { name: 'Floor plan image' });
    expect(card.classList.contains('ep-addcard')).toBe(true);
    // No heading: the card itself is the separation
    expect(card.querySelector('h3')).toBeNull();
    expect(screen.queryByText('Floor plan image')).toBeNull();
    expect(card.contains(screen.getByRole('button', { name: 'Upload floor plan image' }))).toBe(true);
    expect(card.querySelector('input[type="file"]')).not.toBeNull();
    const vertices = screen.getByRole('button', { name: 'Vertices' });
    expect(card.compareDocumentPosition(vertices) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Geometry/ })).toBeNull();
    // No image: the card holds the upload alone
    expect(card.querySelectorAll('button')).toHaveLength(1);
  });

  it('with an image loaded, its controls are on the card', () => {
    const placement = { imageId: 'img-1', widthPx: 400, heightPx: 200, scale: 0.015, offsetX: 0, offsetY: 0, opacity: 0.6 };
    const image = { id: 'img-1', mime: 'image/png', src: 'data:image/png;base64,AAAA' };
    mount({ part: 'floorplan', floorplan: placement, image });
    const card = screen.getByRole('region', { name: 'Floor plan image' });
    for (const name of ['Upload floor plan image', 'Set scale…', 'Move image', 'Remove']) expect(within(card).getByRole('button', { name })).toBeTruthy();
    expect(card.contains(screen.getByLabelText('Reference image opacity'))).toBe(true);
  });

  it('Vertices holds only the vertex table, with Add vertex', async () => {
    mount({ part: 'floorplan' });
    const disc = screen.getByRole('button', { name: 'Vertices' });
    expect(disc.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.vertex-row')).toBeNull();
    await openGeometry();
    expect(document.querySelectorAll('.vertex-row')).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Add vertex' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove vertex 1' })).toBeTruthy();
    expect(document.querySelector('.vertex-table')?.querySelector('.dims')).toBeNull();
    expect(screen.getByLabelText('Width')).toBeTruthy();
  });

  it('area and volume stay visible', () => {
    mount({ part: 'floorplan' });
    expect(screen.getByLabelText('Floor area and volume').textContent).toMatch(/24\.0 m² · 64\.8 m³/);
  });

  it('dimension edits go through updateRoom; units go through the units action', async () => {
    const calls: unknown[][] = [];
    mount({ part: 'floorplan', calls });
    const width = screen.getByLabelText('Width') as HTMLInputElement;
    await fireEvent.change(width, { target: { value: '8' } });
    expect(callsOf(calls, 'updateRoom')).toEqual([['updateRoom', { x: 8 }]]);
    await fireEvent.change(screen.getByLabelText('Units'), { target: { value: 'feet' } });
    expect(callsOf(calls, 'changeUnits')).toEqual([['changeUnits', 'feet']]);
  });
});

describe('Floorplan part corners', () => {
  it('a corner typed into the table applies at once', async () => {
    const calls: unknown[][] = [];
    mount({ part: 'floorplan', calls });
    await openGeometry();
    const x = document.querySelectorAll('.vertex-row')[1].querySelector('input') as HTMLInputElement;
    await fireEvent.input(x, { target: { value: '7' } });
    await fireEvent.change(x, { target: { value: '7' } });
    await fireEvent.blur(x);
    const outlines = callsOf(calls, 'setOutline');
    expect(outlines).toHaveLength(1);
    expect((outlines[0][1] as number[][]).some(([vx]) => vx === 7)).toBe(true);
  });

  it('an invalid corner is shown as Not saved and not applied', async () => {
    const calls: unknown[][] = [];
    mount({ part: 'floorplan', calls });
    await openGeometry();
    const y = document.querySelectorAll('.vertex-row')[1].querySelectorAll('input')[1] as HTMLInputElement;
    await fireEvent.change(y, { target: { value: '6' } });
    await fireEvent.blur(y);
    expect(screen.getByRole('alert').textContent).toMatch(/Not saved/);
    expect(callsOf(calls, 'setOutline')).toHaveLength(0);
  });
});

describe('Floorplan part Set scale', () => {
  const placement = { imageId: 'img-1', widthPx: 400, heightPx: 200, scale: 0.015, offsetX: 0, offsetY: 0, opacity: 0.6 };
  const image = { id: 'img-1', mime: 'image/png', src: 'data:image/png;base64,AAAA' };

  it('Set scale… starts the measure tool and clicking it again stops it; absent without an image', async () => {
    const { unmount } = mount({ part: 'floorplan' });
    expect(screen.queryByRole('button', { name: 'Set scale…' })).toBeNull();
    unmount();
    const { ctl } = mount({ part: 'floorplan', floorplan: placement, image });
    const btn = screen.getByRole('button', { name: 'Set scale…' });
    await fireEvent.click(btn);
    expect(ctl.tool).toBe('custom');
    expect(btn.classList.contains('active')).toBe(true);
    await fireEvent.click(btn);
    expect(ctl.tool).toBe('edit');
  });

  it('is disabled while drawing', async () => {
    const { ctl } = mount({ part: 'floorplan', floorplan: placement, image });
    ctl.startDraw();
    await tick();
    expect((screen.getByRole('button', { name: 'Set scale…' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Structures part', () => {
  it('+ Add structure adds one default box, selects it and opens its panel', async () => {
    const calls: unknown[][] = [];
    mount({ part: 'structures', calls });
    expect(screen.getByText('None')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: '+ Add structure' }));
    await tick();
    const adds = callsOf(calls, 'addObstacle');
    expect(adds).toHaveLength(1);
    expect(adds[0][1]).toMatchObject({ shape: 'box', name: 'Structure 1' });
    const r = row('object-1');
    expect(r.classList.contains('open')).toBe(true);
    expect(r.querySelector('.stub-object-panel')).not.toBeNull();
    // The row header closes it (the panel has no close button)
    await fireEvent.click(main('object-1'));
    expect(row('object-1').classList.contains('open')).toBe(false);
  });

  it('a structure row has no size or height readout', () => {
    mount({ part: 'structures', objects: [box] });
    expect(row('object-9').querySelector('.subtitle')).toBeNull();
  });

  it('clicking a row opens it and clicking again closes it', async () => {
    mount({ part: 'structures', objects: [box] });
    await fireEvent.click(main('object-9'));
    expect(row('object-9').classList.contains('open')).toBe(true);
    await fireEvent.click(main('object-9'));
    expect(row('object-9').classList.contains('open')).toBe(false);
  });

  it('rows rename with the pencil: Enter saves, Esc cancels', async () => {
    const calls: unknown[][] = [];
    mount({ part: 'structures', calls, objects: [box] });
    // The pencil sits with copy and delete, ahead of the eye and calculator
    const names = Array.from(row('object-9').querySelectorAll('.row-head button:not(.row-main)')).map((b) => b.getAttribute('aria-label'));
    expect(names.map((n) => n!.split(' ')[0])).toEqual(['Rename', 'Copy', 'Delete', 'Hide', 'Exclude']);
    // Every icon button says what it does on hover
    const titles = Array.from(row('object-9').querySelectorAll('.row-head button:not(.row-main)')).map((b) => b.getAttribute('title'));
    expect(titles).toEqual(['Rename', 'Copy (Ctrl+D)', 'Delete (Del)', 'Hide in views', 'Exclude from calculation']);
    expect(row('object-9').querySelector('.actions + .divider + .toggles')).not.toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: /Rename/ }));
    let input = row('object-9').querySelector('input[type="text"]') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'Esc name' } });
    await fireEvent.keyDown(input, { key: 'Escape' });
    expect(callsOf(calls, 'updateObstacle')).toHaveLength(0);
    expect(row('object-9').querySelector('input[type="text"]')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: /Rename/ }));
    input = row('object-9').querySelector('input[type="text"]') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'Bench' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(callsOf(calls, 'updateObstacle')).toEqual([['updateObstacle', 'object-9', { name: 'Bench' }]]);
  });

  it('the eye and calculator toggle hidden and enabled', async () => {
    const calls: unknown[][] = [];
    mount({ part: 'structures', calls, objects: [box] });
    await fireEvent.click(screen.getByRole('button', { name: 'Hide Desk' }));
    expect(calls).toContainEqual(['setHidden', 'objects', 'object-9', true]);
    expect(screen.getByRole('button', { name: 'Show Desk' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Exclude Desk from calculations' }));
    expect(calls).toContainEqual(['updateObstacle', 'object-9', { enabled: false }]);
    expect(row('object-9').classList.contains('off')).toBe(true);
    expect(screen.getByRole('button', { name: 'Include Desk in calculations' })).toBeTruthy();
  });

  it('a drawn obstacle is selected and its row opens', async () => {
    const calls: unknown[][] = [];
    const { ctl } = mount({ part: 'structures', calls });
    await ctl.actions.addObstacle({ ...box, name: 'Drawn' });
    ctl.selectObstacle('object-1');
    await tick();
    expect(row('object-1').classList.contains('open')).toBe(true);
  });
});

describe('Ceiling part', () => {
  it('edits the room height through updateRoom', async () => {
    const calls: unknown[][] = [];
    mount({ part: 'ceiling', calls });
    const height = screen.getByLabelText('Height') as HTMLInputElement;
    expect(height.value).toBe('2.7');
    await fireEvent.change(height, { target: { value: '3' } });
    expect(callsOf(calls, 'updateRoom')).toEqual([['updateRoom', { z: 3 }]]);
  });
});

describe('Lamps part', () => {
  it('+ Add lamp adds a lamp with no fixture, opens its row and focuses its fixture dropdown', async () => {
    const calls: unknown[][] = [];
    const { container } = mount({ part: 'lamps', calls, fixtures });
    expect(screen.getByText('None')).toBeTruthy();
    // One button: no fixture dropdown and no placements in the Add card
    expect(screen.queryByLabelText('Fixture')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Placement' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: '+ Add lamp' }));
    await tick();
    await tick();
    expect(callsOf(calls, 'addNewLamp')).toEqual([['addNewLamp']]);
    expect(container.querySelector('.stub-lamp-panel')?.textContent).toMatch(/Lamp 1/);
    const open = document.querySelector('.editor-row.open') as HTMLElement;
    expect(open.dataset.id).toBe('lamp-1');
    expect(document.activeElement).toBe(open.querySelector('select[aria-label="Fixture"]'));
  });

  it('rows show a wavelength dot (grey when excluded) and the fixture name', async () => {
    mount({ part: 'lamps', lamps: [lamp, { ...lamp, id: 'lamp-8', name: 'Off', enabled: false }], fixtures });
    const on = row('lamp-7');
    expect(on.querySelector('.subtitle.italic')?.textContent).toBe('Beacon');
    const dotOn = on.querySelector('.lead .dot') as HTMLElement;
    const dotOff = row('lamp-8').querySelector('.lead .dot') as HTMLElement;
    expect(dotOn.style.background).not.toBe('');
    expect(dotOn.style.background).not.toBe(dotOff.style.background);
    expect(row('lamp-8').classList.contains('off')).toBe(true);
  });

  it('Shift-click adds lamps to the selection; the editor shows only with exactly one', async () => {
    const two = [{ ...lamp, id: 'a', name: 'A' }, { ...lamp, id: 'b', name: 'B' }];
    const { container } = mount({ part: 'lamps', lamps: two });
    await fireEvent.click(main('a'));
    expect(container.querySelector('.stub-lamp-panel')?.textContent).toMatch(/A/);
    await fireEvent.click(main('b'), { shiftKey: true });
    expect(screen.getByText('2 selected')).toBeTruthy();
    expect(container.querySelector('.stub-lamp-panel')).toBeNull();
    expect(row('a').classList.contains('selected')).toBe(true);
    expect(row('b').classList.contains('selected')).toBe(true);
  });

  it("the row header closes the lamp panel, and the strip's Delete and the Delete key remove the lamp", async () => {
    const calls: unknown[][] = [];
    const two = [{ ...lamp, id: 'a', name: 'A' }, { ...lamp, id: 'b', name: 'B' }];
    const { container } = mount({ part: 'lamps', calls, lamps: two });
    await fireEvent.click(main('a'));
    expect(row('a').classList.contains('open')).toBe(true);
    expect(container.querySelector('.stub-lamp-panel')).not.toBeNull();
    await fireEvent.click(main('a'));
    expect(row('a').classList.contains('open')).toBe(false);
    expect(container.querySelector('.stub-lamp-panel')).toBeNull();

    await fireEvent.click(main('a'));
    await fireEvent.click(within(container.querySelector('.plan-toolbar') as HTMLElement).getByRole('button', { name: 'Delete' }));
    expect(callsOf(calls, 'removeLamp')).toEqual([['removeLamp', 'a']]);
    await tick();
    expect(row('a')).toBeNull();

    await fireEvent.click(main('b'));
    await fireEvent.keyDown(window, { key: 'Delete' });
    expect(callsOf(calls, 'removeLamp')).toEqual([['removeLamp', 'a'], ['removeLamp', 'b']]);
  });

  it('the eye and calculator act on the lamp', async () => {
    const calls: unknown[][] = [];
    mount({ part: 'lamps', calls, lamps: [lamp] });
    await fireEvent.click(screen.getByRole('button', { name: 'Hide Beacon' }));
    expect(calls).toContainEqual(['setHidden', 'lamps', 'lamp-7', true]);
    await fireEvent.click(screen.getByRole('button', { name: 'Exclude Beacon from calculations' }));
    expect(calls).toContainEqual(['updateLamp', 'lamp-7', { enabled: false }]);
  });
});

async function openStandard() {
  await fireEvent.click(screen.getByRole('button', { name: 'Standard zones' }));
  await tick();
}

describe('Zones part', () => {
  it('zone rows show no subtitle', () => {
    const point = { id: 'zone-8', name: 'Pt', type: 'point' as const, enabled: true, x: 1, y: 1, z: 1.8, aim_x: 1, aim_y: 2, aim_z: 1.8 };
    mount({ part: 'zones', zones: [wholePlane, point] });
    expect(row('zone-9').querySelector('.subtitle')).toBeNull();
    expect(row('zone-8').querySelector('.subtitle')).toBeNull();
  });

  it('closing the fold-out deselects a standard zone, and later zone changes leave it closed', async () => {
    const z = mount({ part: 'zones', zones: [standard, wholePlane] });
    z.ctl.selectZone('WholeRoomFluence');
    await tick();
    await tick();
    const fold = screen.getByRole('button', { name: 'Standard zones' });
    expect(fold.getAttribute('aria-expanded')).toBe('true');
    await fireEvent.click(fold);
    await tick();
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    expect(z.ctl.selectedZoneId).toBeNull();
    await z.ctl.actions.updateZone('zone-9', { name: 'Renamed' });
    await tick();
    await tick();
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    expect(z.ctl.selectedZoneId).toBeNull();
  });

  it('Add zone comes before the zone list and the Standard zones fold-out', () => {
    mount({ part: 'zones', zones: [standard, wholePlane] });
    const add = screen.getByRole('region', { name: 'Add zone' });
    const mine = row('zone-9');
    const fold = screen.getByRole('button', { name: 'Standard zones' });
    expect(add.compareDocumentPosition(mine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(mine.compareDocumentPosition(fold) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('Standard zones is collapsed by default and holds the checkbox and rows', async () => {
    mount({ part: 'zones', zones: [standard, wholePlane] });
    const fold = screen.getByRole('button', { name: 'Standard zones' });
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('checkbox', { name: 'Use standard zones' })).toBeNull();
    expect(document.querySelector('.editor-row[data-id="WholeRoomFluence"]')).toBeNull();
    await fireEvent.click(fold);
    await tick();
    expect(fold.getAttribute('aria-expanded')).toBe('true');
    expect((screen.getByRole('checkbox', { name: 'Use standard zones' }) as HTMLInputElement).checked).toBe(true);
    expect(row('WholeRoomFluence')).toBeTruthy();
  });

  it('a new zone appears above the Standard zones fold-out', async () => {
    mount({ part: 'zones', zones: [standard] });
    const fold = screen.getByRole('button', { name: 'Standard zones' });
    await fireEvent.click(screen.getByRole('button', { name: 'Plane' }));
    await tick();
    await tick();
    const added = row('zone-1');
    expect(added.compareDocumentPosition(fold) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('selecting a standard zone opens the fold-out', async () => {
    const z = mount({ part: 'zones', zones: [standard] });
    expect(document.querySelector('.editor-row[data-id="WholeRoomFluence"]')).toBeNull();
    z.ctl.selectZone('WholeRoomFluence');
    await tick();
    await tick();
    expect(screen.getByRole('button', { name: 'Standard zones' }).getAttribute('aria-expanded')).toBe('true');
    expect(row('WholeRoomFluence').classList.contains('open')).toBe(true);
  });

  it('lists the standard zones, then the zones of your own; standard zones stay off the plan', async () => {
    const { container } = mount({ part: 'zones', zones: [standard, wholePlane] });
    await openStandard();
    expect(screen.getByText('Whole room fluence')).toBeTruthy();
    expect(row('zone-9')).toBeTruthy();
    expect(row('WholeRoomFluence')).toBeTruthy();
    // Opening a user zone shows its panel; a standard row has none
    await fireEvent.click(main('zone-9'));
    expect(container.querySelector('.stub-zone-panel')?.textContent).toMatch(/Floor/);
  });

  it('Use standard zones off hides the standard rows', async () => {
    const calls: unknown[][] = [];
    mount({ part: 'zones', calls, zones: [standard, wholePlane] });
    await openStandard();
    const box = screen.getByRole('checkbox', { name: 'Use standard zones' }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    await fireEvent.click(box);
    expect(callsOf(calls, 'updateRoom')).toEqual([['updateRoom', { useStandardZones: false }]]);
    await tick();
    expect(document.querySelector('.editor-row[data-id="WholeRoomFluence"]')).toBeNull();
    expect(row('zone-9')).toBeTruthy();
  });

  it('Add zone › Plane adds a whole-room plane at eye height', async () => {
    const calls: unknown[][] = [];
    mount({ part: 'zones', calls, units: 'feet' });
    await fireEvent.click(screen.getByRole('button', { name: 'Plane' }));
    await tick();
    const [, type, geometry] = callsOf(calls, 'addZone')[0] as [string, string, Record<string, unknown>];
    expect(type).toBe('plane');
    expect(geometry).toMatchObject({ surface: 'floor', fit_room: true, height: roundToUnit(fromMeters(1.8, 'feet'), 'feet') });
    expect(geometry.height).toBeCloseTo(5.91, 2);
    expect(document.querySelector('.editor-row.open')).not.toBeNull();
  });

  it('Plane on a wall surface creates a whole-wall plane on that wall', async () => {
    const calls: unknown[][] = [];
    const z = mount({ part: 'zones', calls });
    z.ctl.setSurface('wall:1');
    await tick();
    await fireEvent.click(screen.getByRole('button', { name: 'Plane' }));
    await tick();
    const [, type, geometry] = callsOf(calls, 'addZone')[0] as [string, string, Record<string, unknown>];
    expect(type).toBe('plane');
    expect(geometry).toEqual({ surface: 'wall:1', fit_room: true, normal_offset: 0, flip: false });
    expect(z.ctl.surface).toBe('wall:1');
  });

  it('there is no ceiling view: Plane from the plan view goes on the floor at eye height', async () => {
    const calls: unknown[][] = [];
    const z = mount({ part: 'zones', calls });
    z.ctl.setSurface('ceiling');
    expect(z.ctl.surface).toBe('floor');
    await fireEvent.click(screen.getByRole('button', { name: 'Plane' }));
    const [, type, geometry] = callsOf(calls, 'addZone')[0] as [string, string, Record<string, unknown>];
    expect(type).toBe('plane');
    expect(geometry).toEqual({ surface: 'floor', fit_room: true, height: 1.8 });
  });

  it('Volume and Point stay on the floor whatever surface shows', async () => {
    const calls: unknown[][] = [];
    const z = mount({ part: 'zones', calls });
    z.ctl.setSurface('wall:1');
    await fireEvent.click(screen.getByRole('button', { name: 'Volume' }));
    const [, , geometry] = callsOf(calls, 'addZone')[0] as [string, string, Record<string, unknown>];
    expect(geometry).toMatchObject({ fit_room: true, z_min: 0, z_max: 2.7 });
    expect(geometry.surface).toBeUndefined();
  });

  it('Add zone › Volume adds a floor-to-ceiling whole-room volume', async () => {
    const calls: unknown[][] = [];
    mount({ part: 'zones', calls });
    await fireEvent.click(screen.getByRole('button', { name: 'Volume' }));
    const [, type, geometry] = callsOf(calls, 'addZone')[0] as [string, string, Record<string, unknown>];
    expect(type).toBe('volume');
    expect(geometry).toMatchObject({ fit_room: true, z_min: 0, z_max: 2.7 });
  });

  it('Add zone › Point puts a point at the room centre at eye height, aimed level', async () => {
    const calls: unknown[][] = [];
    mount({ part: 'zones', calls });
    await fireEvent.click(screen.getByRole('button', { name: 'Point' }));
    const [, type, geometry] = callsOf(calls, 'addZone')[0] as [string, string, Record<string, number>];
    expect(type).toBe('point');
    expect(geometry).toMatchObject({ x: 3, y: 2, z: 1.8, aim_x: 3, aim_z: 1.8 });
    expect(geometry.aim_y).toBeGreaterThan(geometry.y);
  });

  it('the eye and calculator act on a zone', async () => {
    const calls: unknown[][] = [];
    mount({ part: 'zones', calls, zones: [wholePlane] });
    await fireEvent.click(screen.getByRole('button', { name: 'Hide Floor' }));
    expect(calls).toContainEqual(['setHidden', 'zones', 'zone-9', true]);
    await fireEvent.click(screen.getByRole('button', { name: 'Exclude Floor from calculations' }));
    expect(calls).toContainEqual(['updateZone', 'zone-9', { enabled: false }]);
  });
});

describe('new items scroll into view', () => {
  afterEach(() => {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it('a new lamp and a new zone scroll their rows to the top', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    mount({ part: 'lamps', fixtures });
    await fireEvent.click(screen.getByRole('button', { name: '+ Add lamp' }));
    await tick();
    await tick();
    expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect((scroll.mock.contexts[0] as HTMLElement).dataset.id).toBe('lamp-1');
    cleanup();
    scroll.mockClear();
    mount({ part: 'zones' });
    await fireEvent.click(screen.getByRole('button', { name: 'Plane' }));
    await tick();
    await tick();
    expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect((scroll.mock.contexts[0] as HTMLElement).dataset.id).toBe('zone-1');
  });
});

describe('standard zone rows', () => {
  it('open onto the zone panel and have no rename', async () => {
    const { container } = mount({ part: 'zones', zones: [standard] });
    await openStandard();
    await fireEvent.click(main('WholeRoomFluence'));
    expect(row('WholeRoomFluence').classList.contains('open')).toBe(true);
    expect(container.querySelector('.stub-zone-panel')?.textContent).toMatch(/Whole room fluence/);
    expect(screen.queryByRole('button', { name: /Rename/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Hide Whole room fluence' })).toBeTruthy();
  });
});

describe('row hover', () => {
  it('hovering a lamp, structure or zone row sets the hovered item; leaving clears it', async () => {
    const { ctl } = mount({ part: 'lamps', lamps: [lamp] });
    await fireEvent.mouseEnter(row('lamp-7'));
    expect(ctl.hoveredItem).toEqual({ kind: 'lamps', id: 'lamp-7' });
    await fireEvent.mouseLeave(row('lamp-7'));
    expect(ctl.hoveredItem).toBeNull();
    cleanup();
    const s = mount({ part: 'structures', objects: [box] });
    await fireEvent.mouseEnter(row('object-9'));
    expect(s.ctl.hoveredItem).toEqual({ kind: 'objects', id: 'object-9' });
    cleanup();
    const z = mount({ part: 'zones', zones: [standard, wholePlane] });
    await openStandard();
    await fireEvent.mouseEnter(row('WholeRoomFluence'));
    expect(z.ctl.hoveredItem).toEqual({ kind: 'zones', id: 'WholeRoomFluence' });
    await fireEvent.mouseLeave(row('WholeRoomFluence'));
    expect(z.ctl.hoveredItem).toBeNull();
  });
});

describe('Ceiling part', () => {
  const detector = { id: 'ceiling-1', kind: 'smoke' as const, name: 'Hall detector', x: 3, y: 3 };
  const keep = { id: 'ceiling-2', kind: 'keep' as const, name: 'Duct', vertices: [[1, 1], [3, 1], [3, 2], [1, 2]] as [number, number][], yaw: 0 };
  const ceiling = { tileSize: '2x2' as const, align: 'tl' as const, offset: [1, 0.5] as [number, number], ceilingShown: true, tilesShown: true, itemsShown: true, items: [detector, keep] };

  afterEach(() => {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it('shows Height, the Tile grid card, Add to ceiling and the items', () => {
    mount({ part: 'ceiling', ceiling });
    expect((screen.getByLabelText('Height') as HTMLInputElement).value).toBe('2.7');
    expect(screen.getByRole('heading', { name: 'Tile grid' })).toBeTruthy();
    for (const t of ['None', '2×2', '4×2', '2×4']) expect(screen.getByRole('button', { name: t })).toBeTruthy();
    expect(screen.getByRole('button', { name: '2×2' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getAllByRole('button', { name: /^From the |^Centred on the room$/ })).toHaveLength(5);
    expect(screen.getByRole('heading', { name: 'Add to ceiling' })).toBeTruthy();
    for (const t of ['Detector', 'Vent', 'Sensor', 'Keep-out']) expect(screen.getByRole('button', { name: t })).toBeTruthy();
    expect(row('ceiling-1')).toBeTruthy();
    expect(row('ceiling-2')).toBeTruthy();
    // Ceiling items have no calculation toggle
    expect(screen.queryByRole('button', { name: /calculations/ })).toBeNull();
  });

  it('Tiles: None hides Align and the tiles eye', async () => {
    const calls: unknown[][] = [];
    mount({ part: 'ceiling', ceiling, calls });
    expect(screen.getByRole('button', { name: 'Hide tile grid' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'None' }));
    expect(calls).toContainEqual(['updateCeiling', { tileSize: 'none' }]);
    expect(screen.queryByRole('button', { name: 'From the top-left corner' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hide tile grid' })).toBeNull();
  });

  it('the eyes show and hide the tiles, the items and one item', async () => {
    const calls: unknown[][] = [];
    mount({ part: 'ceiling', ceiling, calls });
    expect(screen.queryByRole('button', { name: 'Hide ceiling' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Hide tile grid' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Hide ceiling items' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Hide Duct' }));
    expect(calls).toEqual([
      ['updateCeiling', { tilesShown: false }],
      ['updateCeiling', { itemsShown: false }],
      ['updateCeilingItem', 'ceiling-2', { hidden: true }],
    ]);
  });

  it('Add to ceiling adds, selects and scrolls', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const calls: unknown[][] = [];
    const { ctl } = mount({ part: 'ceiling', calls });
    expect(screen.getByText('None', { selector: '.ep-chip' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Detector' }));
    await tick();
    await tick();
    expect(calls).toContainEqual(['addCeilingItem', 'smoke']);
    expect(ctl.selectedCeilingId).toBe('ceiling-1');
    expect(row('ceiling-1').classList.contains('open')).toBe(true);
    expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect((scroll.mock.contexts.at(-1) as HTMLElement).dataset.id).toBe('ceiling-1');
    await fireEvent.click(screen.getByRole('button', { name: 'Keep-out' }));
    await tick();
    await tick();
    expect(calls).toContainEqual(['addCeilingItem', 'keep']);
    expect(ctl.selectedCeilingId).toBe('ceiling-2');
  });

  it('Align resets the grid offset', async () => {
    const calls: unknown[][] = [];
    mount({ part: 'ceiling', ceiling, calls });
    expect(screen.getByRole('button', { name: 'From the top-left corner' }).getAttribute('aria-pressed')).toBe('true');
    await fireEvent.click(screen.getByRole('button', { name: 'From the bottom-right corner' }));
    expect(calls).toContainEqual(['updateCeiling', { align: 'br', offset: [0, 0] }]);
    expect(screen.getByRole('button', { name: 'From the bottom-right corner' }).getAttribute('aria-pressed')).toBe('true');
  });

  it("the open item's fields are shown directly", async () => {
    const calls: unknown[][] = [];
    mount({ part: 'ceiling', ceiling, calls });
    expect(screen.queryByLabelText('X')).toBeNull();
    await fireEvent.click(main('ceiling-1'));
    expect(row('ceiling-1').classList.contains('open')).toBe(true);
    const x = screen.getByLabelText('X') as HTMLInputElement;
    expect(x.value).toBe('3');
    expect(screen.queryByLabelText('Width')).toBeNull();
    x.value = '4.5';
    await fireEvent.change(x);
    expect(calls).toContainEqual(['updateCeilingItem', 'ceiling-1', { x: 4.5 }]);

    // A keep-out area: X/Y with Reference, Width, Length, Rotation and the corners, no fold-out
    await fireEvent.click(main('ceiling-2'));
    expect(row('ceiling-1').classList.contains('open')).toBe(false);
    for (const label of ['X', 'Y', 'Reference', 'Width', 'Length', 'Rotation']) expect(screen.getByLabelText(label)).toBeTruthy();
    expect((screen.getByLabelText('Width') as HTMLInputElement).value).toBe('2');
    expect((screen.getByLabelText('Length') as HTMLInputElement).value).toBe('1');
    expect(screen.getAllByLabelText(/^Vertex \d [XY]$/)).toHaveLength(8);
    expect(screen.queryByRole('button', { name: /Geometry/ })).toBeNull();
    // Reference starts at Centre; Width keeps the middle fixed
    expect(screen.getByRole('radio', { name: 'Centre' }).getAttribute('aria-checked')).toBe('true');
    const w = screen.getByLabelText('Width') as HTMLInputElement;
    w.value = '3';
    await fireEvent.change(w);
    const [, id, partial] = calls.at(-1) as [string, string, { vertices: [number, number][] }];
    expect(id).toBe('ceiling-2');
    const xs = partial.vertices.map((v) => v[0]);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([0.5, 3.5]);
  });

  it('an item left outside the room by a room change edits back in from its fields', async () => {
    const calls: unknown[][] = [];
    const out = { id: 'ceiling-1', kind: 'smoke' as const, name: 'Hall detector', x: 8, y: 2 };
    const stranded = { id: 'ceiling-2', kind: 'keep' as const, name: 'Duct', vertices: [[5, 1], [9, 1], [9, 2], [5, 2]] as [number, number][], yaw: 0 };
    mount({ part: 'ceiling', calls, ceiling: { ...ceiling, items: [out, stranded] } });
    await fireEvent.click(main('ceiling-1'));
    const x = screen.getByLabelText('X') as HTMLInputElement;
    x.value = '9';
    await fireEvent.change(x);
    expect(callsOf(calls, 'updateCeilingItem')).toEqual([]);
    x.value = '7';
    await fireEvent.change(x);
    expect(callsOf(calls, 'updateCeilingItem')).toEqual([['updateCeilingItem', 'ceiling-1', { x: 7 }]]);

    await fireEvent.click(main('ceiling-2'));
    const w = screen.getByLabelText('Width') as HTMLInputElement;
    w.value = '3';
    await fireEvent.change(w);
    const [, id, partial] = callsOf(calls, 'updateCeilingItem').at(-1) as [string, string, { vertices: [number, number][] }];
    expect(id).toBe('ceiling-2');
    expect(Math.max(...partial.vertices.map((v) => v[0]))).toBeCloseTo(8.5, 6);
  });

  it('rename with the pencil', async () => {
    const calls: unknown[][] = [];
    mount({ part: 'ceiling', ceiling, calls });
    await fireEvent.click(main('ceiling-1'));
    await fireEvent.click(screen.getByRole('button', { name: 'Rename Hall detector' }));
    const input = screen.getByLabelText('Name') as HTMLInputElement;
    input.value = 'Lobby';
    await fireEvent.input(input);
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(calls).toContainEqual(['updateCeilingItem', 'ceiling-1', { name: 'Lobby' }]);
  });
});

describe('Shape geometry fields', () => {
  it('Centre (the default) keeps the middle fixed; Corner reads the start corner; Rotation turns the shape about its middle', async () => {
    const calls: unknown[][] = [];
    const keep = { id: 'ceiling-2', kind: 'keep' as const, name: 'Duct', vertices: [[1, 1], [3, 1], [3, 2], [1, 2]] as [number, number][], yaw: 0 };
    mount({ part: 'ceiling', ceiling: { tileSize: '2x2', align: 'tl', offset: [0, 0], ceilingShown: true, tilesShown: true, itemsShown: true, items: [keep] }, calls });
    await fireEvent.click(main('ceiling-2'));
    expect((screen.getByLabelText('X') as HTMLInputElement).value).toBe('2');
    expect((screen.getByLabelText('Y') as HTMLInputElement).value).toBe('1.5');
    await fireEvent.click(screen.getByRole('radio', { name: 'Bottom-left corner' }));
    expect((screen.getByLabelText('X') as HTMLInputElement).value).toBe('1');
    await fireEvent.click(screen.getByRole('radio', { name: 'Centre' }));
    const len = screen.getByLabelText('Length') as HTMLInputElement;
    len.value = '2';
    await fireEvent.change(len);
    let partial = (calls.at(-1) as [string, string, { vertices: [number, number][] }])[2];
    const ys = partial.vertices.map((v) => v[1]);
    expect([Math.min(...ys), Math.max(...ys)]).toEqual([0.5, 2.5]);
    const rot = screen.getByLabelText('Rotation') as HTMLInputElement;
    rot.value = '90';
    await fireEvent.change(rot);
    const last = calls.at(-1) as [string, string, { vertices: [number, number][]; yaw: number }];
    partial = last[2];
    expect(last[2].yaw).toBe(90);
    const rx = partial.vertices.map((v) => v[0]);
    // 2 wide, 2 long about (2, 1.5): still 2 across after a quarter turn
    expect(Math.max(...rx) - Math.min(...rx)).toBeCloseTo(2, 6);
  });
});

/** The row header's Copy / Delete icons. */
function rowActions(id: string) {
  const el = row(id).querySelector('.row-head') as HTMLElement;
  expect(el).not.toBeNull();
  return within(el);
}

describe('Copy and Delete in every item editor', () => {
  it('a structure: the shape line with Redraw footprint and Edit vertices; Copy and Delete are row icons', async () => {
    const calls: unknown[][] = [];
    const { ctl } = mount({ part: 'structures', calls, objects: [box] });
    await fireEvent.click(main('object-9'));
    const r = row('object-9');
    expect(r.querySelector('.structure-shape')?.textContent).toMatch(/Rectangle/);
    const draw = within(r).getByRole('button', { name: 'Redraw footprint' });
    const corners = within(r).getByRole('button', { name: 'Edit vertices' });
    expect(draw.getAttribute('aria-pressed')).toBe('false');
    // Copy and Delete are icons in the row header, not in the editor
    expect(r.querySelector('.row-body .structure-shape')).not.toBeNull();
    expect(r.querySelector('.row-body')!.textContent).not.toMatch(/Copy|Delete/);
    expect(rowActions('object-9').getByRole('button', { name: 'Copy (Ctrl+D)' })).toBeTruthy();
    expect(rowActions('object-9').getByRole('button', { name: 'Delete (Del)' })).toBeTruthy();
    // Redraw footprint arms a polygon drawing for this structure and shows pressed
    await fireEvent.click(draw);
    await tick();
    expect(ctl.drawing).toBe(true);
    expect(ctl.drawShape).toBe('polygon');
    expect(ctl.redrawObstacleId).toBe('object-9');
    expect(within(row('object-9')).getByRole('button', { name: 'Redraw footprint' }).getAttribute('aria-pressed')).toBe('true');
    ctl.cancelDraw();
    await tick();
    expect(ctl.drawing).toBe(false);
    // Edit vertices is a toggle: pressed while the corners are edited
    await fireEvent.click(corners);
    await tick();
    expect(ctl.shapeMode).toBe('corners');
    expect(within(row('object-9')).getByRole('button', { name: 'Edit vertices' }).getAttribute('aria-pressed')).toBe('true');
    await fireEvent.click(within(row('object-9')).getByRole('button', { name: 'Edit vertices' }));
    await tick();
    expect(ctl.shapeMode).toBe('select');
    expect(ctl.selectedId).toBe('object-9');
    expect(within(row('object-9')).getByRole('button', { name: 'Edit vertices' }).getAttribute('aria-pressed')).toBe('false');
  });

  it("a keep-out area's editor: Redraw footprint and Edit vertices", async () => {
    const keep = { id: 'ceiling-2', kind: 'keep' as const, name: 'Duct', vertices: [[1, 1], [3, 1], [3, 2], [1, 2]] as [number, number][], yaw: 0 };
    const { ctl } = mount({ part: 'ceiling', ceiling: { tileSize: 'none', align: 'tl', offset: [0, 0], ceilingShown: true, tilesShown: true, itemsShown: true, items: [keep] } });
    ctl.selectCeilingItem('ceiling-2');
    await tick();
    const r = row('ceiling-2');
    await fireEvent.click(within(r).getByRole('button', { name: 'Edit vertices' }));
    await tick();
    expect(ctl.shapeMode).toBe('corners');
    expect(within(row('ceiling-2')).getByRole('button', { name: 'Edit vertices' }).getAttribute('aria-pressed')).toBe('true');
    await fireEvent.click(within(row('ceiling-2')).getByRole('button', { name: 'Redraw footprint' }));
    await tick();
    expect(ctl.drawing).toBe(true);
    expect(ctl.redrawKeepOutId).toBe('ceiling-2');
  });

  it('a polygon structure reads Polygon, N vertices', async () => {
    const poly = { ...box, shape: 'extrusion' as const, vertices: [[-1, -1], [1, -1], [1, 1], [0, 2], [-1, 1]] as [number, number][] };
    mount({ part: 'structures', objects: [poly] });
    await fireEvent.click(main('object-9'));
    expect(row('object-9').querySelector('.structure-shape')?.textContent).toMatch(/Polygon, 5 vertices/);
  });

  it('a structure: a finished Redraw footprint replaces its footprint', async () => {
    const calls: unknown[][] = [];
    const { ctl } = mount({ part: 'structures', calls, objects: [box] });
    await fireEvent.click(main('object-9'));
    await fireEvent.click(within(row('object-9')).getByRole('button', { name: 'Redraw footprint' }));
    ctl.draft = [[1, 1], [4, 1], [4, 2], [2, 3], [1, 3]];
    ctl.drawing = false;
    await ctl.onDrawEnd(true);
    await tick();
    expect(callsOf(calls, 'addObstacle')).toHaveLength(0);
    const updates = callsOf(calls, 'updateObstacle');
    expect(updates).toHaveLength(1);
    expect(updates[0][1]).toBe('object-9');
    expect(updates[0][2]).toMatchObject({ shape: 'extrusion', yaw: 0 });
    await tick();
    expect(row('object-9').querySelector('.structure-shape')?.textContent).toMatch(/Polygon, 5 vertices/);
  });

  it('a structure: Copy duplicates it and opens the copy; Delete removes it', async () => {
    const calls: unknown[][] = [];
    const { ctl } = mount({ part: 'structures', calls, objects: [box] });
    await fireEvent.click(main('object-9'));
    await fireEvent.click(rowActions('object-9').getByRole('button', { name: 'Copy (Ctrl+D)' }));
    await tick();
    expect(callsOf(calls, 'addObstacle')).toHaveLength(1);
    expect(ctl.selectedId).toBe('object-1');
    expect(row('object-1').classList.contains('open')).toBe(true);
    await fireEvent.click(rowActions('object-1').getByRole('button', { name: 'Delete (Del)' }));
    await tick();
    expect(callsOf(calls, 'removeObstacle')).toEqual([['removeObstacle', 'object-1']]);
    expect(row('object-1')).toBeNull();
    expect(ctl.selectedId).toBeNull();
  });

  it('a lamp: Copy copies it alone and opens the copy; Delete removes it', async () => {
    const calls: unknown[][] = [];
    const { ctl } = mount({ part: 'lamps', calls, lamps: [{ ...lamp, id: 'a', name: 'A' }] });
    await fireEvent.click(main('a'));
    expect(rowActions('a').getByRole('button', { name: 'Copy (Ctrl+D)' }).getAttribute('title')).toBe('Copy (Ctrl+D)');
    await fireEvent.click(rowActions('a').getByRole('button', { name: 'Copy (Ctrl+D)' }));
    await tick();
    expect(callsOf(calls, 'copyLamps')).toHaveLength(1);
    expect((callsOf(calls, 'copyLamps')[0][1] as string[])).toEqual(['a']);
    const copyId = ctl.selectedLampId!;
    expect(copyId).not.toBe('a');
    expect(row(copyId).classList.contains('open')).toBe(true);
    await fireEvent.click(rowActions(copyId).getByRole('button', { name: 'Delete (Del)' }));
    await tick();
    expect(callsOf(calls, 'removeLamp')).toEqual([['removeLamp', copyId]]);
    expect(row(copyId)).toBeNull();
  });

  it('a zone: Copy copies it and opens the copy; Delete removes it; standard zones have neither', async () => {
    const calls: unknown[][] = [];
    const { ctl } = mount({ part: 'zones', calls, zones: [standard, wholePlane] });
    await fireEvent.click(main('zone-9'));
    await fireEvent.click(rowActions('zone-9').getByRole('button', { name: 'Copy (Ctrl+D)' }));
    await tick();
    expect(callsOf(calls, 'copyZone')).toHaveLength(1);
    const copyId = ctl.selectedZoneId!;
    expect(copyId).not.toBe('zone-9');
    expect(row(copyId).classList.contains('open')).toBe(true);
    await fireEvent.click(rowActions(copyId).getByRole('button', { name: 'Delete (Del)' }));
    await tick();
    expect(callsOf(calls, 'removeZone')).toEqual([['removeZone', copyId]]);
    expect(row(copyId)).toBeNull();
    ctl.selectZone('WholeRoomFluence');
    await tick();
    await tick();
    expect(row('WholeRoomFluence').classList.contains('open')).toBe(true);
    expect(within(row('WholeRoomFluence')).queryByRole('button', { name: /^(Copy|Delete)/ })).toBeNull();
  });

  it('a ceiling item: Copy copies it and opens the copy; Delete removes it', async () => {
    const calls: unknown[][] = [];
    const detector = { id: 'ceiling-1', kind: 'smoke' as const, name: 'Hall detector', x: 3, y: 2 };
    const ceiling = { tileSize: 'none' as const, align: 'tl' as const, offset: [0, 0] as [number, number], ceilingShown: true, tilesShown: true, itemsShown: true, items: [detector] };
    const { ctl } = mount({ part: 'ceiling', calls, ceiling });
    await fireEvent.click(main('ceiling-1'));
    await fireEvent.click(rowActions('ceiling-1').getByRole('button', { name: 'Copy (Ctrl+D)' }));
    await tick();
    expect(callsOf(calls, 'copyCeilingItem')).toEqual([['copyCeilingItem', 'ceiling-1']]);
    const copyId = ctl.selectedCeilingId!;
    expect(copyId).not.toBe('ceiling-1');
    expect(row(copyId).classList.contains('open')).toBe(true);
    await fireEvent.click(rowActions(copyId).getByRole('button', { name: 'Delete (Del)' }));
    await tick();
    expect(callsOf(calls, 'removeCeilingItem')).toEqual([['removeCeilingItem', copyId]]);
    expect(row(copyId)).toBeNull();
  });
});
