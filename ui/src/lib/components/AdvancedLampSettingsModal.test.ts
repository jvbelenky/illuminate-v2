import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import AdvancedLampSettingsModal from './AdvancedLampSettingsModal.svelte';
import type { LampInstance, RoomConfig } from '$lib/types/project';
import { defaultRoom } from '$lib/types/project';

// Mock the API client - use importOriginal to include all exports
vi.mock('$lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/api/client')>();
  return {
    ...actual,
    getSessionLampAdvancedSettings: vi.fn(),
    getSessionLampGridPointsPlot: vi.fn(),
    getSessionLampIntensityMapPlot: vi.fn(),
    updateSessionLampAdvanced: vi.fn(),
    uploadSessionLampIntensityMap: vi.fn(),
    deleteSessionLampIntensityMap: vi.fn(),
  };
});

import { getSessionLampAdvancedSettings } from '$lib/api/client';

const mockSettings = {
  lamp_id: 'lamp-1',
  total_power_mw: 42.5,
  max_irradiance: 150.0,
  center_irradiance: 120.0,
  scaling_factor: 1.0,
  intensity_units: 'mW/sr' as const,
  source_width: null,
  source_length: null,
  source_depth: null,
  source_density: 1,
  photometric_distance: 1.0,
  num_points: [37, 73] as [number, number],
  has_intensity_map: false,
};

const mockLamp: LampInstance = {
  id: 'lamp-1',
  lamp_type: 'krcl_222',
  preset_id: 'beacon',
  name: 'Beacon',
  x: 2, y: 3, z: 2.5,
  aimx: 2, aimy: 3, aimz: 0,
  scaling_factor: 1.0,
  enabled: true,
};

describe('AdvancedLampSettingsModal', () => {
  beforeEach(() => {
    vi.mocked(getSessionLampAdvancedSettings).mockResolvedValue(mockSettings);
  });

  it('renders modal title', () => {
    render(AdvancedLampSettingsModal, {
      props: {
        lamp: mockLamp,
        room: defaultRoom(),
        onClose: vi.fn(),
        onUpdate: vi.fn(),
      },
    });
    // Modal should show "Advanced Settings" or similar header
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
  });

  it('shows loading state initially', () => {
    render(AdvancedLampSettingsModal, {
      props: {
        lamp: mockLamp,
        room: defaultRoom(),
        onClose: vi.fn(),
        onUpdate: vi.fn(),
      },
    });
    expect(screen.getByText(/Loading/i)).toBeTruthy();
  });

  it('fetches advanced settings on mount', async () => {
    render(AdvancedLampSettingsModal, {
      props: {
        lamp: mockLamp,
        room: defaultRoom(),
        onClose: vi.fn(),
        onUpdate: vi.fn(),
      },
    });

    await waitFor(() => {
      expect(getSessionLampAdvancedSettings).toHaveBeenCalledWith('lamp-1');
    });
  });

  it('shows error state when API fails', async () => {
    vi.mocked(getSessionLampAdvancedSettings).mockRejectedValue(new Error('Server error'));

    render(AdvancedLampSettingsModal, {
      props: {
        lamp: mockLamp,
        room: defaultRoom(),
        onClose: vi.fn(),
        onUpdate: vi.fn(),
      },
    });

    await waitFor(() => {
      expect(screen.getByText(/Server error|Failed/i)).toBeTruthy();
    });
  });

  it('renders settings form after loading', async () => {
    render(AdvancedLampSettingsModal, {
      props: {
        lamp: mockLamp,
        room: defaultRoom(),
        onClose: vi.fn(),
        onUpdate: vi.fn(),
      },
    });

    await waitFor(() => {
      // Should display power or irradiance values from the settings
      const container = document.querySelector('[role="dialog"]');
      expect(container?.textContent).toContain('42.5');
    });
  });
});
