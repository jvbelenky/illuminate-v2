import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import EfficacySurvivalPlot from './EfficacySurvivalPlot.svelte';

describe('EfficacySurvivalPlot', () => {
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

  it('renders SVG element with data', () => {
    const { container } = render(EfficacySurvivalPlot, {
      props: { selectedRows: sampleData, fluence: 10, logLevel: 1 },
    });
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('renders placeholder with no data', () => {
    render(EfficacySurvivalPlot, {
      props: { selectedRows: [], fluence: 10, logLevel: 1 },
    });
    expect(screen.getByText(/Select pathogens/i)).toBeTruthy();
  });

  it('renders axis labels with data', () => {
    const { container } = render(EfficacySurvivalPlot, {
      props: { selectedRows: sampleData, fluence: 10, logLevel: 1 },
    });
    const texts = container.querySelectorAll('svg text');
    expect(texts.length).toBeGreaterThan(0);
  });
});
