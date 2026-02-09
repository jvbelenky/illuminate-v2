import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import EfficacyDataTable from './EfficacyDataTable.svelte';

describe('EfficacyDataTable', () => {
  const sampleData = [
    {
      species: 'E. coli',
      strain: 'K-12',
      wavelength_nm: 254,
      k1: 0.5,
      k2: 0.1,
      category: 'Bacteria',
      medium: 'Air',
      condition: 'ambient',
      reference: 'Smith 2020',
      link: 'https://example.com',
    },
    {
      species: 'SARS-CoV-2',
      strain: '',
      wavelength_nm: 222,
      k1: 1.2,
      k2: null,
      category: 'Virus',
      medium: 'Air',
      condition: '',
      reference: 'Jones 2021',
      link: '',
    },
  ];

  const defaultProps = {
    sortedData: sampleData,
    totalCount: 2,
    sortColumn: 'species' as keyof (typeof sampleData)[0],
    sortAscending: true,
    selectedKeys: new Set<string>(),
    showSelection: true,
    logLevel: 1,
    fluence: 10,
    onSort: vi.fn(),
    onSelectionChange: vi.fn(),
  };

  it('renders table', () => {
    const { container } = render(EfficacyDataTable, { props: defaultProps });
    expect(container.querySelector('table')).toBeTruthy();
  });

  it('renders data rows', () => {
    render(EfficacyDataTable, { props: defaultProps });
    expect(screen.getByText('E. coli')).toBeTruthy();
    expect(screen.getByText('SARS-CoV-2')).toBeTruthy();
  });

  it('renders category badges', () => {
    render(EfficacyDataTable, { props: defaultProps });
    expect(screen.getByText('Bacteria')).toBeTruthy();
    expect(screen.getByText('Virus')).toBeTruthy();
  });

  it('renders table header', () => {
    render(EfficacyDataTable, { props: defaultProps });
    expect(screen.getByText('Data Table')).toBeTruthy();
  });

  it('handles empty data', () => {
    const { container } = render(EfficacyDataTable, {
      props: { ...defaultProps, sortedData: [], totalCount: 0 },
    });
    expect(container.querySelector('table')).toBeTruthy();
  });
});
