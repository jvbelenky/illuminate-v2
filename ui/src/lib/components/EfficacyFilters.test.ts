import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import EfficacyFilters from './EfficacyFilters.svelte';

describe('EfficacyFilters', () => {
  const defaultProps = {
    mediums: ['Air', 'Water', 'Surface'],
    categories: ['Bacteria', 'Virus'],
    wavelengths: [222, 254, 275],
    selectedMedium: 'All',
    selectedCategory: 'All',
    selectedWavelength: 'All' as number | 'All',
    speciesSearch: '',
    conditionSearch: '',
    logLevels: [2],
    onMediumChange: vi.fn(),
    onCategoryChange: vi.fn(),
    onWavelengthChange: vi.fn(),
    onSpeciesSearchChange: vi.fn(),
    onConditionSearchChange: vi.fn(),
    onLogLevelsChange: vi.fn(),
  };

  it('renders medium dropdown with options', () => {
    render(EfficacyFilters, { props: defaultProps });
    const select = screen.getByLabelText('Medium');
    expect(select).toBeTruthy();
  });

  it('renders category dropdown', () => {
    render(EfficacyFilters, { props: defaultProps });
    expect(screen.getByLabelText('Category')).toBeTruthy();
  });

  it('renders wavelength dropdown', () => {
    render(EfficacyFilters, { props: defaultProps });
    expect(screen.getByLabelText('Wavelength')).toBeTruthy();
  });

  it('renders species search input', () => {
    render(EfficacyFilters, { props: defaultProps });
    expect(screen.getByLabelText('Species')).toBeTruthy();
  });

  it('renders condition search input', () => {
    render(EfficacyFilters, { props: defaultProps });
    expect(screen.getByLabelText('Condition')).toBeTruthy();
  });

  it('renders log level checkboxes', () => {
    render(EfficacyFilters, { props: defaultProps });
    expect(screen.getByText('Log Reduction')).toBeTruthy();
    // Should render checkboxes for log levels
    expect(screen.getByText('99%')).toBeTruthy();
  });

  it('calls onMediumChange when medium selected', async () => {
    const onMediumChange = vi.fn();
    render(EfficacyFilters, { props: { ...defaultProps, onMediumChange } });
    const select = screen.getByLabelText('Medium');
    await fireEvent.change(select, { target: { value: 'Air' } });
    expect(onMediumChange).toHaveBeenCalled();
  });

  it('calls onSpeciesSearchChange on input', async () => {
    const onSpeciesSearchChange = vi.fn();
    render(EfficacyFilters, { props: { ...defaultProps, onSpeciesSearchChange } });
    const input = screen.getByLabelText('Species');
    await fireEvent.input(input, { target: { value: 'staph' } });
    expect(onSpeciesSearchChange).toHaveBeenCalled();
  });
});
