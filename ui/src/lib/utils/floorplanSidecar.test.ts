import { describe, it, expect } from 'vitest';
import { attachSidecar, extractSidecar, SIDECAR_VERSION } from './floorplanSidecar';

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
});
