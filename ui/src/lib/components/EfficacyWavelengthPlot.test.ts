import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import EfficacyWavelengthPlot from './EfficacyWavelengthPlot.svelte';

describe('EfficacyWavelengthPlot', () => {
  it('renders SVG element with data', () => {
    const data = [
      { species: 'E. coli', wavelength_nm: 254, k1: 0.5, k2: 0.1, category: 'Bacteria', medium: 'Air', strain: '', condition: '', reference: '', link: '' },
    ];
    const { container } = render(EfficacyWavelengthPlot, { props: { filteredData: data } });
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('renders placeholder with empty data', () => {
    render(EfficacyWavelengthPlot, { props: { filteredData: [] } });
    expect(screen.getByText(/No data/i)).toBeTruthy();
  });

  it('renders axis labels', () => {
    const data = [
      { species: 'E. coli', wavelength_nm: 254, k1: 0.5, k2: 0.1, category: 'Bacteria', medium: 'Air', strain: '', condition: '', reference: '', link: '' },
    ];
    render(EfficacyWavelengthPlot, { props: { filteredData: data } });
    expect(screen.getByText(/Wavelength/)).toBeTruthy();
  });

  it('has k1/k2 toggle checkbox', () => {
    const data = [
      { species: 'E. coli', wavelength_nm: 254, k1: 0.5, k2: 0.1, category: 'Bacteria', medium: 'Air', strain: '', condition: '', reference: '', link: '' },
    ];
    const { container } = render(EfficacyWavelengthPlot, { props: { filteredData: data } });
    const checkbox = container.querySelector('input[type="checkbox"]');
    expect(checkbox).toBeTruthy();
  });
});
