import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';
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

const mockExploreResponse = {
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
};

describe('ExploreDataModal', () => {
  const defaultProps = {
    fluence: 10,
    wavelength: 222,
    room: { x: 4, y: 6, z: 2.7, shape: 'rectangle' as const },
    airChanges: 1.0,
    onclose: vi.fn(),
  };

  beforeEach(() => {
    vi.mocked(getEfficacyExploreData).mockResolvedValue(mockExploreResponse);
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
      expect(getEfficacyExploreData).toHaveBeenCalledWith();
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

  it('uses prefetched data when provided', async () => {
    render(ExploreDataModal, {
      props: {
        ...defaultProps,
        prefetchedData: mockExploreResponse,
      },
    });

    await waitFor(() => {
      // Should not call the API when prefetched data is provided
      expect(getEfficacyExploreData).not.toHaveBeenCalled();
      // Should still render content
      expect(screen.queryByText(/Loading efficacy data/)).toBeFalsy();
    });
  });

  it('works without fluence (no calculation)', async () => {
    render(ExploreDataModal, {
      props: {
        ...defaultProps,
        fluence: undefined,
      },
    });

    await waitFor(() => {
      expect(getEfficacyExploreData).toHaveBeenCalledWith();
    });
  });
});

describe('ExploreDataModal zone selector', () => {
  const zoneOptions = [
    { id: 'WholeRoomFluence', name: 'Whole Room Fluence', meanFluence: 10, zoneType: 'volume' as const },
    { id: 'bench', name: 'Bench', meanFluence: 3, zoneType: 'plane' as const },
    { id: 'shelf', name: 'Shelf', meanFluence: 3, zoneType: 'plane' as const },
  ];
  const props = {
    fluence: 10,
    wavelength: 222,
    room: { x: 4, y: 6, z: 2.7, shape: 'rectangle' as const },
    airChanges: 1.0,
    onclose: vi.fn(),
    prefetchedData: {
      ...mockExploreResponse,
      table: {
        columns: ['species', 'wavelength', 'k1', 'category', 'medium'],
        rows: [
          ['E. coli', 222, 0.5, 'Bacteria', 'Aerosol'],
          ['S. aureus', 222, 0.3, 'Bacteria', 'Surface'],
        ],
        count: 2,
      },
    },
    zoneOptions,
  };

  it('groups zones into surfaces and air', async () => {
    const { container } = render(ExploreDataModal, { props });
    await waitFor(() => expect(container.querySelector('#zone-select')).toBeTruthy());
    const groups = [...container.querySelectorAll('#zone-select optgroup')].map(g => g.getAttribute('label'));
    expect(groups).toEqual(['Surfaces (planes)', 'Air (volumes)']);
  });

  it('switches to a plane when the medium filter narrows to Surface', async () => {
    const { container } = render(ExploreDataModal, { props });
    await waitFor(() => expect(container.querySelector('#zone-select')).toBeTruthy());
    const select = container.querySelector('#zone-select') as HTMLSelectElement;
    expect(select.value).toBe('WholeRoomFluence');

    await fireEvent.click(container.querySelector('.medium-dropdown .dropdown-btn')!);
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Aerosol' }));
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Surface' }));
    expect(select.value).toBe('bench');
  });

  it('keeps the chosen zone when two zones share a fluence', async () => {
    const { container } = render(ExploreDataModal, { props });
    await waitFor(() => expect(container.querySelector('#zone-select')).toBeTruthy());
    const select = container.querySelector('#zone-select') as HTMLSelectElement;
    select.value = 'shelf';
    await fireEvent.change(select);
    expect(select.value).toBe('shelf');
  });
});
