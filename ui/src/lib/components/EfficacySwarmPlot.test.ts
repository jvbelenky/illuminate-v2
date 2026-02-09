import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import EfficacySwarmPlot from './EfficacySwarmPlot.svelte';

describe('EfficacySwarmPlot', () => {
  const sampleData = [
    {
      species: 'E. coli',
      strain: '',
      wavelength_nm: 254,
      k1: 0.5,
      k2: 0.1,
      category: 'Bacteria',
      medium: 'Air',
      condition: '',
      reference: '',
      link: '',
    },
  ];

  const defaultProps = {
    filteredData: sampleData,
    stats: { median: 0.5, min: 0.1, max: 1.0, count: 1 },
    dataCategories: ['Bacteria'],
    roomVolumeM3: 50,
    roomUnits: 'meters' as const,
    airChanges: 6,
  };

  it('renders SVG element with data', () => {
    const { container } = render(EfficacySwarmPlot, { props: defaultProps });
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('renders with empty data without crashing', () => {
    const { container } = render(EfficacySwarmPlot, {
      props: { ...defaultProps, filteredData: [], stats: { median: 0, min: 0, max: 0, count: 0 } },
    });
    expect(container).toBeTruthy();
  });

  it('renders data points', () => {
    const { container } = render(EfficacySwarmPlot, { props: defaultProps });
    const circles = container.querySelectorAll('circle');
    expect(circles.length).toBeGreaterThan(0);
  });
});
