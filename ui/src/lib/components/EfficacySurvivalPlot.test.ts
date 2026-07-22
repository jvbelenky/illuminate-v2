import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import EfficacySurvivalPlot from './EfficacySurvivalPlot.svelte';

describe('EfficacySurvivalPlot', () => {
  const sampleData = [
    {
      species: 'E. coli',
      strain: '',
      wavelength: 254,
      k1: 0.5,
      k2: 0.1,
      category: 'Bacteria',
      medium: 'Air',
      condition: '',
      reference: '',
      link: '',
      resistant_fraction: 0,
      each_uv: 0,
      seconds_to_99: 0,
    },
  ];

  it('renders SVG element with data', () => {
    const { container } = render(EfficacySurvivalPlot, {
      props: { selectedRows: sampleData, filteredData: sampleData, fluence: 10, logLevels: [1], speciesSelectionOrder: [] },
    });
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('renders placeholder with no data', () => {
    render(EfficacySurvivalPlot, {
      props: { selectedRows: [], filteredData: [], fluence: 10, logLevels: [1], speciesSelectionOrder: [] },
    });
    expect(screen.getByText(/Select pathogens/i)).toBeTruthy();
  });

  it('renders axis labels with data', () => {
    const { container } = render(EfficacySurvivalPlot, {
      props: { selectedRows: sampleData, filteredData: sampleData, fluence: 10, logLevels: [1], speciesSelectionOrder: [] },
    });
    const texts = container.querySelectorAll('svg text');
    expect(texts.length).toBeGreaterThan(0);
  });
});
