import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import EfficacyFilters from './EfficacyFilters.svelte';

describe('EfficacyFilters', () => {
  const defaultProps = {
    mediums: ['Air', 'Water', 'Surface'],
    categories: ['Bacteria', 'Virus'],
    wavelengths: [222, 254, 275],
    selectedMediums: [] as string[],
    selectedCategories: [] as string[],
    selectedWavelengths: [] as number[],
    speciesSearch: '',
    conditionSearch: '',
    onMediumsChange: vi.fn(),
    onCategoriesChange: vi.fn(),
    onWavelengthsChange: vi.fn(),
    onSpeciesSearchChange: vi.fn(),
    onConditionSearchChange: vi.fn(),
  };

  it('renders medium dropdown with options', () => {
    render(EfficacyFilters, { props: defaultProps });
    expect(screen.getByText('Medium')).toBeTruthy();
  });

  it('renders category dropdown', () => {
    render(EfficacyFilters, { props: defaultProps });
    expect(screen.getByText('Category')).toBeTruthy();
  });

  it('renders wavelength dropdown', () => {
    render(EfficacyFilters, { props: defaultProps });
    expect(screen.getByText('Wavelength')).toBeTruthy();
  });

  it('renders species search input', () => {
    render(EfficacyFilters, { props: defaultProps });
    expect(screen.getByLabelText('Species')).toBeTruthy();
  });

  it('renders condition search input', () => {
    render(EfficacyFilters, { props: defaultProps });
    expect(screen.getByLabelText('Condition')).toBeTruthy();
  });

  it('does not render log level checkboxes (moved to ExploreDataModal)', () => {
    render(EfficacyFilters, { props: defaultProps });
    expect(screen.queryByText('Log Reduction')).toBeNull();
  });

  it('renders medium dropdown button', () => {
    render(EfficacyFilters, { props: defaultProps });
    // With no mediums selected, label should show "All"
    const buttons = screen.getAllByText('All');
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  it('calls onSpeciesSearchChange on input', async () => {
    const onSpeciesSearchChange = vi.fn();
    render(EfficacyFilters, { props: { ...defaultProps, onSpeciesSearchChange } });
    const input = screen.getByLabelText('Species');
    await fireEvent.input(input, { target: { value: 'staph' } });
    expect(onSpeciesSearchChange).toHaveBeenCalled();
  });
});
