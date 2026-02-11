import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import ExploreDataModal from './ExploreDataModal.svelte';

// Mock the API client - use importOriginal to include all exports
vi.mock('$lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/api/client')>();
  return {
    ...actual,
    getEfficacyExploreData: vi.fn(),
  };
});

import { getEfficacyExploreData } from '$lib/api/client';

describe('ExploreDataModal', () => {
  const defaultProps = {
    fluence: 10,
    wavelength: 222,
    roomX: 4,
    roomY: 6,
    roomZ: 2.7,
    roomUnits: 'meters' as const,
    airChanges: 1.0,
    onclose: vi.fn(),
  };

  beforeEach(() => {
    vi.mocked(getEfficacyExploreData).mockResolvedValue({
      mediums: ['Aerosol', 'Water', 'Surface'],
      categories: ['Bacteria', 'Virus', 'Fungi'],
      wavelengths: [222, 254, 265],
      table: {
        columns: ['species', 'strain', 'wavelength_nm', 'k1', 'k2', 'category', 'medium', 'condition', 'reference', 'link'],
        rows: [
          ['E. coli', 'K-12', 222, 0.5, 0.1, 'Bacteria', 'Aerosol', 'ambient', 'Smith 2020', ''],
          ['SARS-CoV-2', '', 222, 1.2, null, 'Virus', 'Aerosol', '', 'Jones 2021', ''],
        ],
        count: 2,
      },
    });
  });

  it('renders modal title', () => {
    render(ExploreDataModal, { props: defaultProps });
    expect(screen.getByText(/Explore Pathogen Efficacy Data/)).toBeTruthy();
  });

  it('shows loading state initially', () => {
    render(ExploreDataModal, { props: defaultProps });
    expect(screen.getByText(/Loading efficacy data/)).toBeTruthy();
  });

  it('fetches data on mount', async () => {
    render(ExploreDataModal, { props: defaultProps });

    await waitFor(() => {
      expect(getEfficacyExploreData).toHaveBeenCalledWith(defaultProps.fluence);
    });
  });

  it('renders data after loading', async () => {
    render(ExploreDataModal, { props: defaultProps });

    await waitFor(() => {
      // After data loads, the loading state should be replaced with content
      expect(screen.queryByText(/Loading efficacy data/)).toBeFalsy();
    });
  });

  it('shows error state when API fails', async () => {
    vi.mocked(getEfficacyExploreData).mockRejectedValue(new Error('Network error'));

    render(ExploreDataModal, { props: defaultProps });

    await waitFor(() => {
      expect(screen.getByText(/Network error|Failed to load/)).toBeTruthy();
    });
  });

  it('has close button', () => {
    render(ExploreDataModal, { props: defaultProps });
    const closeBtn = document.querySelector('.close-btn');
    expect(closeBtn).toBeTruthy();
  });

  it('renders dialog role', () => {
    render(ExploreDataModal, { props: defaultProps });
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
  });
});
