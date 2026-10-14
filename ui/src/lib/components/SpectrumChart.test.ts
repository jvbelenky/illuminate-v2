import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import SpectrumChart from './SpectrumChart.svelte';

const props = (peak: number) => ({
  wavelengths: [250, 260, 270],
  series: [{ label: 'S', intensities: [0.2, peak, 0.3], color: '#3b82f6', visible: true }],
  interactive: false,
});

describe('SpectrumChart', () => {
  // jsdom has no canvas context, like a browser without canvas support: the
  // chart cannot be drawn, but changing its data must not throw.
  it('updates without a drawing context are harmless', async () => {
    const { rerender, unmount } = render(SpectrumChart, { props: props(1) });
    await expect(rerender(props(0.5))).resolves.not.toThrow();
    await new Promise((r) => setTimeout(r, 20));
    unmount();
  });
});
