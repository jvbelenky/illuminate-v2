import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import FloorPlanThumbnail from './FloorPlanThumbnail.svelte';

const rect: [number, number][] = [[0, 0], [6, 0], [6, 4], [0, 4]];

describe('FloorPlanThumbnail', () => {
  it('draws only the outline without an image', () => {
    const { container } = render(FloorPlanThumbnail, { props: { vertices: rect } });
    expect(container.querySelector('image')).toBeNull();
  });
  it('draws the image under the outline when given', () => {
    const { container } = render(FloorPlanThumbnail, {
      props: { vertices: rect, imageSrc: 'data:image/png;base64,AAAA', imageRect: { x: 1, y: 0.5, width: 4, height: 2 }, imageOpacity: 0.5 },
    });
    const img = container.querySelector('image')!;
    expect(img).not.toBeNull();
    expect(img.getAttribute('opacity')).toBe('0.5');
    expect(container.querySelector('svg')!.firstElementChild?.tagName.toLowerCase()).toBe('image');
  });
});
