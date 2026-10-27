import { describe, it, expect } from 'vitest';
import { attachSidecar, extractCeilingLayout, extractLabels, extractLampSticking, extractPlotSettings, extractSidecar, extractReportMeta, extractHidden, readSidecar, stripSidecar, SIDECAR_VERSION } from './floorplanSidecar';

const envelope = JSON.stringify({ 'guv-calcs_version': '0.7.3', timestamp: 't', format: 'project', data: { rooms: {} } });
const placement = { imageId: 'img-1', widthPx: 10, heightPx: 5, scale: 0.1, offsetX: 0.5, offsetY: 0.25, opacity: 0.6 };
const image = { mime: 'image/png', src: 'data:image/png;base64,AAAA' };

describe('attachSidecar', () => {
  it('adds a versioned illuminate block beside data', () => {
    const out = JSON.parse(attachSidecar(envelope, { placement, image }));
    expect(out.data).toEqual({ rooms: {} });
    expect(out.illuminate).toEqual({ version: SIDECAR_VERSION, floorplan: { placement, image } });
  });
  it('writes nothing when there is no floor plan', () => {
    expect(JSON.parse(attachSidecar(envelope, null)).illuminate).toBeUndefined();
  });
  it('preserves indentation style (pretty JSON stays readable)', () => {
    expect(attachSidecar(envelope, null)).toContain('\n');
  });
  it('passes unparseable output through untouched when there is no floor plan', () => {
    // guv_calcs writes Python's json.dumps output, which emits bare NaN
    const nanText = '{"data": {"rooms": {"r": {"x": NaN}}}}';
    expect(attachSidecar(nanText, null)).toBe(nanText);
  });
  it('splices a floor plan into output with bare NaN, and reads it back', () => {
    const text = attachSidecar('{"x": NaN}', { placement, image });
    expect(text).toContain('"x": NaN');
    expect(extractSidecar(text)).toEqual({ placement, image });
  });
});

describe('stripSidecar', () => {
  it('removes the app-owned block', () => {
    const withBlock = attachSidecar(envelope, { placement, image });
    const stripped = stripSidecar(withBlock);
    expect(stripped).not.toContain('illuminate');
    expect(JSON.parse(stripped)).toEqual(JSON.parse(envelope));
  });
  it('returns the input unchanged when there is no block', () => {
    expect(stripSidecar(envelope)).toBe(envelope);
  });
  it('returns the input unchanged when it is not JSON', () => {
    expect(stripSidecar('{"x": NaN}')).toBe('{"x": NaN}');
    expect(stripSidecar('not json')).toBe('not json');
  });
});

describe('extractSidecar', () => {
  it('round-trips', () => {
    const text = attachSidecar(envelope, { placement, image });
    expect(extractSidecar(text)).toEqual({ placement, image });
  });
  it('returns null when absent', () => {
    expect(extractSidecar(envelope)).toBeNull();
  });
  it('returns null for malformed blocks and unknown versions', () => {
    const bad = JSON.stringify({ ...JSON.parse(envelope), illuminate: { version: 1, floorplan: { placement: { imageId: 3 }, image } } });
    expect(extractSidecar(bad)).toBeNull();
    const future = JSON.stringify({ ...JSON.parse(envelope), illuminate: { version: 99, floorplan: { placement, image } } });
    expect(extractSidecar(future)).toBeNull();
    expect(extractSidecar('not json')).toBeNull();
  });
  it('rejects a src that is not a base64 image data URL', () => {
    const hostile = JSON.stringify({
      ...JSON.parse(envelope),
      illuminate: { version: 1, floorplan: { placement, image: { mime: 'text/html', src: 'data:text/html,<script>alert(1)</script>' } } },
    });
    expect(extractSidecar(hostile)).toBeNull();
  });
});

describe('report meta in the sidecar', () => {
  const meta = { title: 'Lab 3', client: 'Acme', prepared_by: 'V. B.', notes: 'north wing' };

  it('round-trips report meta with and without a floor plan', () => {
    const withMeta = attachSidecar(envelope, null, meta);
    expect(extractReportMeta(withMeta)).toEqual(meta);
    expect(extractSidecar(withMeta)).toBeNull();
    expect(JSON.parse(stripSidecar(withMeta))).not.toHaveProperty('illuminate');
    const both = attachSidecar(envelope, { placement, image }, meta);
    expect(extractReportMeta(both)).toEqual(meta);
    expect(extractSidecar(both)).toEqual({ placement, image });
  });

  it('returns null when the block or the report key is missing', () => {
    expect(extractReportMeta(envelope)).toBeNull();
    expect(extractReportMeta(attachSidecar(envelope, null, null))).toBeNull();
    expect(extractReportMeta(attachSidecar(envelope, { placement, image }))).toBeNull();
  });

  it('ignores a malformed report block', () => {
    const bad = JSON.stringify({ ...JSON.parse(envelope), illuminate: { version: 1, report: { title: 5 } } });
    expect(extractReportMeta(bad)).toBeNull();
  });
});

describe('hidden items in the sidecar', () => {
  const hidden = { lamps: ['lamp-1'], zones: ['zone-2', 'zone-3'], objects: [] };
  const meta = { title: 'Lab 3', client: 'Acme', prepared_by: 'V. B.', notes: '' };

  it('round-trips the hidden ids alongside the other blocks', () => {
    const only = attachSidecar(envelope, null, null, hidden);
    expect(extractHidden(only)).toEqual(hidden);
    expect(extractSidecar(only)).toBeNull();
    expect(extractReportMeta(only)).toBeNull();
    const all = attachSidecar(envelope, { placement, image }, meta, hidden);
    expect(extractHidden(all)).toEqual(hidden);
    expect(extractSidecar(all)).toEqual({ placement, image });
    expect(extractReportMeta(all)).toEqual(meta);
  });

  it('writes no block when nothing is hidden', () => {
    const none = { lamps: [], zones: [], objects: [] };
    expect(JSON.parse(attachSidecar(envelope, null, null, none))).not.toHaveProperty('illuminate');
    expect(extractHidden(attachSidecar(envelope, null, null, none))).toBeNull();
  });

  it('returns null when absent or malformed', () => {
    expect(extractHidden(envelope)).toBeNull();
    expect(extractHidden(attachSidecar(envelope, null, meta))).toBeNull();
    const bad = JSON.stringify({ ...JSON.parse(envelope), illuminate: { version: 1, hidden: { lamps: 'lamp-1' } } });
    expect(extractHidden(bad)).toBeNull();
  });

  it('reads a block that lists only some kinds', () => {
    const partial = JSON.stringify({ ...JSON.parse(envelope), illuminate: { version: 1, hidden: { zones: ['z'] } } });
    expect(extractHidden(partial)).toEqual({ lamps: [], zones: ['z'], objects: [] });
  });

  it('keeps the hidden ids on output it cannot parse (bare NaN)', () => {
    const nanText = '{"x": NaN}';
    const text = attachSidecar(nanText, null, null, hidden);
    expect(text).toContain('"x": NaN');
    expect(extractHidden(text)).toEqual(hidden);
  });
});

describe('plot settings in the sidecar', () => {
  const plots = { 'zone-1': { view: 'contours' as const, levelsSource: 'custom' as const, levels: [1, 2.5], colors: [null, '#ff0000'], decimals: 1 } };

  it('round-trips per-zone plot settings alongside the other blocks', () => {
    const text = attachSidecar(envelope, { placement, image }, null, null, plots);
    expect(extractPlotSettings(text)).toEqual(plots);
    expect(extractSidecar(text)).toEqual({ placement, image });
  });

  it('writes no block when there are no settings', () => {
    expect(JSON.parse(attachSidecar(envelope, null, null, null, {}))).not.toHaveProperty('illuminate');
  });

  it('drops malformed plot settings without losing the floor plan', () => {
    const bad = JSON.stringify({ ...JSON.parse(envelope), illuminate: { version: 1, floorplan: { placement, image }, plots: { z: { view: 'bars' } } } });
    expect(extractPlotSettings(bad)).toBeNull();
    expect(extractSidecar(bad)).toEqual({ placement, image });
  });
});

describe('ceiling layout', () => {
  const layout = {
    tileSize: '4x2' as const, align: 'c' as const, offset: [0.25, 0] as [number, number], ceilingShown: true, tilesShown: false, itemsShown: true,
    items: [
      { id: 'ceiling-1', kind: 'smoke' as const, name: 'Smoke detector 1', x: 1, y: 2 },
      { id: 'ceiling-2', kind: 'keep' as const, name: 'Keep-out area 1', vertices: [[0, 0], [1, 0], [1, 1]] as [number, number][], yaw: 15, hidden: true },
    ],
  };

  it('round-trips through the sidecar', () => {
    const text = attachSidecar(envelope, null, null, null, null, layout);
    expect(extractCeilingLayout(text)).toEqual(layout);
    expect(JSON.parse(text).data).toEqual({ rooms: {} });
  });

  it('saves and round-trips with bare NaN in the backend output', () => {
    // guv_calcs writes Python's json.dumps output, which emits bare NaN
    const nanText = '{\n    "data": {"rooms": {"r": {"x": NaN, "label": "a \\"}\\" b"}}}\n}';
    const text = attachSidecar(nanText, null, null, null, null, layout);
    expect(text).toContain('"x": NaN');
    expect(extractCeilingLayout(text)).toEqual(layout);
    // Saving again replaces the block rather than adding a second one
    const again = attachSidecar(text, null, null, null, null, { ...layout, align: 'tl' });
    expect(again.match(/"illuminate"/g)).toHaveLength(1);
    expect(extractCeilingLayout(again)?.align).toBe('tl');
    // Stripping for the backend leaves the original text
    expect(stripSidecar(again).replace(/\s/g, '')).toBe(nanText.replace(/\s/g, ''));
  });

  it('loads a file without round-2 fields', () => {
    expect(extractCeilingLayout(envelope)).toBeNull();
    expect(extractCeilingLayout(attachSidecar(envelope, { placement, image }))).toBeNull();
  });

  it('a crafted file with a huge or infinite offset is rejected without hanging', () => {
    const base = JSON.parse(attachSidecar(envelope, { placement, image }, null, null, null, layout));
    for (const raw of ['1e300', '1e999', '-1e999']) {
      // JSON.parse reads 1e999 as Infinity
      const text = JSON.stringify(base).replace('"offset":[0.25,0]', `"offset":[${raw},0]`);
      expect(text).toContain(raw);
      expect(extractCeilingLayout(text)).toBeNull();
      expect(extractSidecar(text)).toEqual({ placement, image });
    }
    const bigItem = JSON.stringify(base).replace('"x":1,', '"x":1e300,');
    expect(extractCeilingLayout(bigItem)).toBeNull();
  });

  it('a bad ceiling block drops only the ceiling layout', () => {
    const parsed = JSON.parse(attachSidecar(envelope, { placement, image }));
    parsed.illuminate.ceilingLayout = { tileSize: 'huge' };
    const bad = JSON.stringify(parsed);
    expect(extractCeilingLayout(bad)).toBeNull();
    expect(extractSidecar(bad)).toEqual({ placement, image });
  });
});

describe('lamp stick state', () => {
  const sticking = {
    'Lamp-1': { stick_ceiling: true, ceiling_offset: 0.1 },
    'Lamp-2': { stick_ceiling: true, ceiling_offset: 0.3, stick_wall: true, wall_index: 1, wall_t: -0.4, wall_offset: 0.3 },
  };

  it('round-trips stick state', () => {
    const text = attachSidecar(envelope, { placement, image }, null, null, null, null, sticking);
    expect(extractLampSticking(text)).toEqual(sticking);
    expect(extractSidecar(text)).toEqual({ placement, image });
    // And on backend output that is not strict JSON (bare NaN)
    const nanText = '{\n    "data": {"rooms": {"r": {"x": NaN}}}\n}';
    const spliced = attachSidecar(nanText, null, null, null, null, null, sticking);
    expect(spliced).toContain('"x": NaN');
    expect(extractLampSticking(spliced)).toEqual(sticking);
  });

  it('writes no block when no lamp is stuck', () => {
    expect(attachSidecar(envelope, null, null, null, null, null, {})).not.toContain('illuminate');
  });

  it('loads a file without round-2 fields', () => {
    expect(extractLampSticking(envelope)).toBeNull();
    const old = attachSidecar(envelope, { placement, image }, { title: 't', client: '', prepared_by: '', notes: '' }, { lamps: ['a'], zones: [], objects: [] });
    expect(extractLampSticking(old)).toBeNull();
    expect(extractHidden(old)).toEqual({ lamps: ['a'], zones: [], objects: [] });
  });

  it('a crafted lamps entry drops only itself', () => {
    const parsed = JSON.parse(attachSidecar(envelope, { placement, image }, null, null, null, null, sticking));
    for (const bad of [
      { 'Lamp-1': { wall_index: 1e9 } },
      { 'Lamp-1': { ceiling_offset: 1e300 } },
      { ['x'.repeat(500)]: { stick_ceiling: true } },
      { 'Lamp-1': { stick_ceiling: true, ceiling_offset: -2 } },
      { 'Lamp-1': { stick_wall: true, wall_offset: -0.1 } },
      Object.fromEntries(Array.from({ length: 10001 }, (_, i) => [`L${i}`, {}])),
      'nope',
    ]) {
      parsed.illuminate.lamps = bad;
      const text = JSON.stringify(parsed);
      expect(extractLampSticking(text)).toBeNull();
      expect(extractSidecar(text)).toEqual({ placement, image });
    }
  });
});

describe('structure labels', () => {
  const labels = { objects: ['object-1', 'object-3'] };

  it('round-trips the label set, also on output with bare NaN', () => {
    const text = attachSidecar(envelope, { placement, image }, null, null, null, null, null, labels);
    expect(extractLabels(text)).toEqual(labels);
    expect(extractSidecar(text)).toEqual({ placement, image });
    const nanText = '{\n    "data": {"rooms": {"r": {"x": NaN}}}\n}';
    const spliced = attachSidecar(nanText, null, null, null, null, null, null, labels);
    expect(spliced).toContain('"x": NaN');
    expect(extractLabels(spliced)).toEqual(labels);
  });

  it('writes no block when no label is on', () => {
    expect(attachSidecar(envelope, null, null, null, null, null, null, { objects: [] })).not.toContain('illuminate');
  });

  it('loads a file without round-2 fields', () => {
    expect(extractLabels(envelope)).toBeNull();
    const old = attachSidecar(envelope, { placement, image }, null, { lamps: [], zones: [], objects: ['object-1'] });
    expect(extractLabels(old)).toBeNull();
    expect(extractHidden(old)).toEqual({ lamps: [], zones: [], objects: ['object-1'] });
  });

  it('a crafted labels entry drops only itself', () => {
    const parsed = JSON.parse(attachSidecar(envelope, { placement, image }, null, null, null, null, null, labels));
    for (const bad of [
      { objects: ['x'.repeat(500)] },
      { objects: Array.from({ length: 10001 }, (_, i) => `object-${i}`) },
      { objects: [1, 2] },
      { objects: 'object-1' },
      'nope',
    ]) {
      parsed.illuminate.labels = bad;
      const text = JSON.stringify(parsed);
      expect(extractLabels(text)).toBeNull();
      expect(extractSidecar(text)).toEqual({ placement, image });
    }
  });
});

describe('each block drops alone', () => {
  const meta = { title: 'Lab 3', client: 'Acme', prepared_by: 'V. B.', notes: '' };
  const hidden = { lamps: ['lamp-1'], zones: [], objects: [] };
  const layout = {
    tileSize: '2x2' as const, align: 'tl' as const, offset: [0, 0] as [number, number], ceilingShown: true, tilesShown: true, itemsShown: true,
    items: [{ id: 'ceiling-1', kind: 'smoke' as const, name: 'Smoke detector 1', x: 1, y: 2 }],
  };
  const sticking = { 'Lamp-1': { stick_ceiling: true, ceiling_offset: 0.1 } };
  const labels = { objects: ['object-1'] };
  const full = () => JSON.parse(attachSidecar(envelope, { placement, image }, meta, hidden, null, layout, sticking, labels));

  it('one read returns every block', () => {
    const blocks = readSidecar(JSON.stringify(full()));
    expect(blocks).toEqual({ floorplan: { placement, image }, report: meta, hidden, plots: null, ceilingLayout: layout, lamps: sticking, labels, zoneSurfaces: null });
    expect(readSidecar(envelope)).toEqual({ floorplan: null, report: null, hidden: null, plots: null, ceilingLayout: null, lamps: null, labels: null, zoneSurfaces: null });
    expect(readSidecar('not json').ceilingLayout).toBeNull();
    // Backend output that is not strict JSON (bare NaN) still has a readable block
    const nanText = '{\n    "data": {"rooms": {"r": {"x": NaN}}}\n}';
    expect(readSidecar(attachSidecar(nanText, null, null, null, null, layout, sticking, labels))).toMatchObject({ ceilingLayout: layout, lamps: sticking, labels });
  });

  it('a bad hidden, report or floorplan block keeps the ceiling layout, stick state and labels', () => {
    for (const [key, bad] of [['hidden', [1]], ['hidden', { lamps: [3] }], ['report', { title: 5 }], ['floorplan', { placement: { imageId: 3 }, image }]] as const) {
      const parsed = full();
      parsed.illuminate[key] = bad;
      const blocks = readSidecar(JSON.stringify(parsed));
      expect(blocks[key]).toBeNull();
      expect(blocks.ceilingLayout).toEqual(layout);
      expect(blocks.lamps).toEqual(sticking);
      expect(blocks.labels).toEqual(labels);
      for (const other of ['hidden', 'report', 'floorplan'] as const) if (other !== key) expect(blocks[other]).not.toBeNull();
    }
  });

  it('a ceiling layout with more than 20 000 keep-out corners in all drops only the ceiling block', () => {
    const keep = (n: number) => ({ id: `ceiling-${n}`, kind: 'keep', name: 'K', yaw: 0, vertices: Array.from({ length: 1000 }, (_, i) => [Math.cos(i / 159.155), Math.sin(i / 159.155)]) });
    const parsed = full();
    parsed.illuminate.ceilingLayout = { ...layout, items: Array.from({ length: 20 }, (_, i) => keep(i + 1)) };
    expect(readSidecar(JSON.stringify(parsed)).ceilingLayout).not.toBeNull();
    parsed.illuminate.ceilingLayout.items.push(keep(21));
    const blocks = readSidecar(JSON.stringify(parsed));
    expect(blocks.ceilingLayout).toBeNull();
    expect(blocks.floorplan).toEqual({ placement, image });
    expect(blocks.lamps).toEqual(sticking);
    expect(blocks.labels).toEqual(labels);
  });
});

describe('zone surfaces', () => {
  const surfaces = { 'zone-1': 'wall:2', 'zone-2': 'ceiling' };
  const attach = () => JSON.parse(attachSidecar(envelope, { placement, image }, null, { lamps: ['L'], zones: [], objects: [] }, null, null, { L: { stick_ceiling: true, ceiling_offset: 0.1 } }, null, surfaces));

  it('round-trips', () => {
    expect(readSidecar(JSON.stringify(attach())).zoneSurfaces).toEqual(surfaces);
  });
  it('drops unknown values and keeps the rest', () => {
    const parsed = attach();
    parsed.illuminate.zoneSurfaces = { a: 'wall:1', b: 'roof', c: 'wall:x' };
    expect(readSidecar(JSON.stringify(parsed)).zoneSurfaces).toEqual({ a: 'wall:1' });
  });
  it('a bad block drops only itself', () => {
    const parsed = attach();
    parsed.illuminate.zoneSurfaces = 5;
    const blocks = readSidecar(JSON.stringify(parsed));
    expect(blocks.zoneSurfaces).toBeNull();
    expect(blocks.hidden).toEqual({ lamps: ['L'], zones: [], objects: [] });
    expect(blocks.lamps).toEqual({ L: { stick_ceiling: true, ceiling_offset: 0.1 } });
  });
});
