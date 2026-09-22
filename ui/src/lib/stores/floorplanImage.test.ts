import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { floorplanImage, FLOORPLAN_IMAGE_STORAGE_KEY, MAX_PERSISTED_IMAGE_CHARS, setFloorPlanWarningHandler } from './floorplanImage';

const img = { id: 'a', mime: 'image/png', src: 'data:image/png;base64,AAAA' };

describe('floorplanImage store', () => {
  beforeEach(() => {
    floorplanImage.clear();
    setFloorPlanWarningHandler(null);
  });

  it('starts empty', () => {
    expect(get(floorplanImage)).toBeNull();
    expect(floorplanImage.get()).toBeNull();
  });

  it('set stores the image and persists it', () => {
    floorplanImage.set(img);
    expect(get(floorplanImage)).toEqual(img);
    expect(sessionStorage.getItem(FLOORPLAN_IMAGE_STORAGE_KEY)).toBe(JSON.stringify(img));
  });

  it('clear empties the store and removes the key', () => {
    floorplanImage.set(img);
    floorplanImage.clear();
    expect(get(floorplanImage)).toBeNull();
    expect(sessionStorage.getItem(FLOORPLAN_IMAGE_STORAGE_KEY)).toBeNull();
  });

  it('restore reads a previously persisted image', () => {
    sessionStorage.setItem(FLOORPLAN_IMAGE_STORAGE_KEY, JSON.stringify(img));
    floorplanImage.restore();
    expect(get(floorplanImage)).toEqual(img);
  });

  it('restore ignores malformed storage', () => {
    sessionStorage.setItem(FLOORPLAN_IMAGE_STORAGE_KEY, '{not json');
    floorplanImage.restore();
    expect(get(floorplanImage)).toBeNull();
    sessionStorage.setItem(FLOORPLAN_IMAGE_STORAGE_KEY, JSON.stringify({ id: 1 }));
    floorplanImage.restore();
    expect(get(floorplanImage)).toBeNull();
  });

  it('keeps an oversized image in memory only, warning once', () => {
    const warn = vi.fn();
    setFloorPlanWarningHandler(warn);
    const big = { id: 'big', mime: 'image/png', src: 'data:image/png;base64,' + 'A'.repeat(MAX_PERSISTED_IMAGE_CHARS) };
    floorplanImage.set(big);
    expect(get(floorplanImage)).toEqual(big);
    expect(sessionStorage.getItem(FLOORPLAN_IMAGE_STORAGE_KEY)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    // A second oversized image does not warn again
    floorplanImage.set({ ...big, id: 'big-2' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(FLOORPLAN_IMAGE_STORAGE_KEY)).toBeNull();
  });

  it('drops a previously persisted image when an oversized one replaces it', () => {
    floorplanImage.set(img);
    expect(sessionStorage.getItem(FLOORPLAN_IMAGE_STORAGE_KEY)).not.toBeNull();
    floorplanImage.set({ id: 'big', mime: 'image/png', src: 'data:image/png;base64,' + 'A'.repeat(MAX_PERSISTED_IMAGE_CHARS) });
    expect(sessionStorage.getItem(FLOORPLAN_IMAGE_STORAGE_KEY)).toBeNull();
  });

  it('still persists an image under the cap', () => {
    const small = { id: 's', mime: 'image/png', src: 'data:image/png;base64,' + 'A'.repeat(1000) };
    floorplanImage.set(small);
    expect(sessionStorage.getItem(FLOORPLAN_IMAGE_STORAGE_KEY)).toBe(JSON.stringify(small));
  });

  it('keeps the image in memory and warns once when storage rejects it', () => {
    const warn = vi.fn();
    setFloorPlanWarningHandler(warn);
    vi.mocked(sessionStorage.setItem).mockImplementation(() => { throw new Error('QuotaExceededError'); });
    floorplanImage.set(img);
    floorplanImage.set({ ...img, id: 'b' });
    expect(get(floorplanImage)?.id).toBe('b');
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
