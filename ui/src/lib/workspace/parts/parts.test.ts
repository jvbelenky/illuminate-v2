import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
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
  await fireEvent.click(screen.getByRole('button', { name: /Geometry/ }));
}

describe('Floorplan part', () => {
  it('dimensions are visible by default', () => {
    mount({ part: 'floorplan' });
    for (const label of ['Width', 'Length', 'Height', 'Units']) expect(screen.getByLabelText(label)).toBeTruthy();
    expect((screen.getByLabelText('Height') as HTMLInputElement).value).toBe('2.7');
    expect((screen.getByLabelText('Width') as HTMLInputElement).disabled).toBe(false);
  });

  it('width and length hide for a polygon room; height and units stay', () => {
    mount({ part: 'floorplan', room: { shape: 'polygon' } });
    expect(screen.queryByLabelText('Width')).toBeNull();
    expect(screen.queryByLabelText('Length')).toBeNull();
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

  it('Geometry holds only the corners', async () => {
    mount({ part: 'floorplan' });
    const disc = screen.getByRole('button', { name: /Geometry/ });
    expect(disc.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.vertex-row')).toBeNull();
    await openGeometry();
    expect(document.querySelectorAll('.vertex-row')).toHaveLength(4);
    expect(document.querySelector('.vertex-table')?.querySelector('.dims')).toBeNull();
    expect(screen.getByLabelText('Width')).toBeTruthy();
  });

  it('area and volume stay visible', () => {
    mount({ part: 'floorplan' });
    expect(screen.getByText('Floor area').parentElement?.textContent).toMatch(/24\.0 m²/);
    expect(screen.getByText('Volume').parentElement?.textContent).toMatch(/64\.8 m³/);
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
    expect(adds[0][1]).toMatchObject({ shape: 'box' });
    const r = row('object-1');
    expect(r.classList.contains('open')).toBe(true);
    expect(r.querySelector('.stub-object-panel')).not.toBeNull();
    // The panel's close callback deselects
    await fireEvent.click(screen.getByRole('button', { name: 'Close object' }));
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
    // The pencil is only there once the row is open
    expect(screen.queryByRole('button', { name: /Rename/ })).toBeNull();
    await fireEvent.click(main('object-9'));
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
  it('Add lamp: a fixture reveals the placements; each placement adds a lamp and opens it', async () => {
    const calls: unknown[][] = [];
    const { container } = mount({ part: 'lamps', calls, fixtures });
    expect(screen.queryByRole('group', { name: 'Placement' })).toBeNull();
    expect(screen.getByText('None')).toBeTruthy();
    await fireEvent.change(screen.getByLabelText('Fixture'), { target: { value: 'preset:ushio_b1' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Corner' }));
    await tick();
    expect(callsOf(calls, 'addPlacedLamp')[0]).toEqual(['addPlacedLamp', 'preset:ushio_b1', 'corner']);
    expect(container.querySelector('.stub-lamp-panel')?.textContent).toMatch(/Lamp 1/);
    expect(document.querySelector('.editor-row.open')).not.toBeNull();
  });

  it('the Add lamp card says Upper-room', async () => {
    mount({ part: 'lamps', fixtures });
    await fireEvent.change(screen.getByLabelText('Fixture'), { target: { value: 'preset:beacon' } });
    const group = screen.getByRole('group', { name: 'Placement' });
    const buttons = Array.from(group.querySelectorAll('button'));
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Downlight', 'Corner', 'Edge', 'Upper-room']);
    for (const b of buttons) expect(b.querySelector('svg')).not.toBeNull();
    expect(group.textContent).not.toMatch(/Horizontal/);
  });

  it('choosing Add custom lamp… opens the manager and keeps the previous fixture', async () => {
    let opened = 0;
    mount({ part: 'lamps', fixtures, onAddCustomLamp: () => opened++ });
    const select = screen.getByLabelText('Fixture') as HTMLSelectElement;
    await fireEvent.change(select, { target: { value: 'preset:beacon' } });
    await fireEvent.change(select, { target: { value: '__add_custom__' } });
    expect(opened).toBe(1);
    expect(select.value).toBe('preset:beacon');
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

  it('the eye and calculator act on the lamp', async () => {
    const calls: unknown[][] = [];
    mount({ part: 'lamps', calls, lamps: [lamp] });
    await fireEvent.click(screen.getByRole('button', { name: 'Hide Beacon' }));
    expect(calls).toContainEqual(['setHidden', 'lamps', 'lamp-7', true]);
    await fireEvent.click(screen.getByRole('button', { name: 'Exclude Beacon from calculations' }));
    expect(calls).toContainEqual(['updateLamp', 'lamp-7', { enabled: false }]);
  });
});

describe('Zones part', () => {
  it('lists the standard zones, then the zones of your own; standard zones stay off the plan', async () => {
    const { container } = mount({ part: 'zones', zones: [standard, wholePlane] });
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
    expect(geometry).toMatchObject({ fit_room: true, height: roundToUnit(fromMeters(1.8, 'feet'), 'feet') });
    expect(geometry.height).toBeCloseTo(5.91, 2);
    expect(document.querySelector('.editor-row.open')).not.toBeNull();
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
    await fireEvent.change(screen.getByLabelText('Fixture'), { target: { value: 'preset:ushio_b1' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Corner' }));
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

  it('the eyes show and hide the ceiling, the tiles, the items and one item', async () => {
    const calls: unknown[][] = [];
    mount({ part: 'ceiling', ceiling, calls });
    await fireEvent.click(screen.getByRole('button', { name: 'Hide ceiling' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Hide tile grid' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Hide ceiling items' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Hide Duct' }));
    expect(calls).toEqual([
      ['updateCeiling', { ceilingShown: false }],
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
    expect(screen.getAllByLabelText(/^Corner \d [XY]$/)).toHaveLength(8);
    expect(screen.queryByRole('button', { name: /Geometry/ })).toBeNull();
    // Width keeps the reference corner fixed
    const w = screen.getByLabelText('Width') as HTMLInputElement;
    w.value = '3';
    await fireEvent.change(w);
    const [, id, partial] = calls.at(-1) as [string, string, { vertices: [number, number][] }];
    expect(id).toBe('ceiling-2');
    const xs = partial.vertices.map((v) => v[0]);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([1, 4]);
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
  it('Centre keeps the middle fixed; Rotation turns the shape about its middle', async () => {
    const calls: unknown[][] = [];
    const keep = { id: 'ceiling-2', kind: 'keep' as const, name: 'Duct', vertices: [[1, 1], [3, 1], [3, 2], [1, 2]] as [number, number][], yaw: 0 };
    mount({ part: 'ceiling', ceiling: { tileSize: '2x2', align: 'tl', offset: [0, 0], ceilingShown: true, tilesShown: true, itemsShown: true, items: [keep] }, calls });
    await fireEvent.click(main('ceiling-2'));
    expect((screen.getByLabelText('X') as HTMLInputElement).value).toBe('1');
    await fireEvent.change(screen.getByLabelText('Reference'), { target: { value: 'centre' } });
    expect((screen.getByLabelText('X') as HTMLInputElement).value).toBe('2');
    expect((screen.getByLabelText('Y') as HTMLInputElement).value).toBe('1.5');
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
