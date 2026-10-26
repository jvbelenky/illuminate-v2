import { describe, it, expect } from 'vitest';
import { attachSidecar, extractCeilingLayout, extractPlotSettings, extractSidecar, extractReportMeta, extractHidden, stripSidecar, SIDECAR_VERSION } from './floorplanSidecar';

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
  it('throws when it cannot attach a floor plan to unparseable output', () => {
    expect(() => attachSidecar('{"x": NaN}', { placement, image })).toThrow(/floor-plan image/);
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

  it('saves without the hidden ids rather than fail on output it cannot parse', () => {
    const nanText = '{"x": NaN}';
    expect(attachSidecar(nanText, null, null, hidden)).toBe(nanText);
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
