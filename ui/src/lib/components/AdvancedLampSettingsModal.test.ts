import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';
import AdvancedLampSettingsModal from './AdvancedLampSettingsModal.svelte';
import type { LampInstance, RoomConfig } from '$lib/types/project';
import { defaultRoom } from '$lib/types/project';

// Mock the lamps store
const mockLamps: LampInstance[] = [
  {
    id: 'lamp-1',
    lamp_type: 'krcl_222',
    preset_id: 'beacon',
    name: 'Beacon',
    x: 2, y: 3, z: 2.5,
    aimx: 2, aimy: 3, aimz: 0,
    scaling_factor: 1.0,
    enabled: true,
  },
  {
    id: 'lamp-2',
    lamp_type: 'krcl_222',
    preset_id: 'ushio_b1',
    name: 'Ushio B1',
    x: 4, y: 3, z: 2.5,
    aimx: 4, aimy: 3, aimz: 0,
    scaling_factor: 1.0,
    enabled: true,
  },
];

vi.mock('$lib/stores/project', () => ({
  lamps: {
    subscribe: (fn: (value: LampInstance[]) => void) => {
      fn(mockLamps);
      return () => {};
    },
  },
  project: {
    subscribe: (fn: (value: any) => void) => {
      fn({ lamps: mockLamps });
      return () => {};
    },
  },
}));

// Mock the API client
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
    getPhotometricWeb: vi.fn().mockResolvedValue(null),
    getSessionLampPhotometricWeb: vi.fn().mockResolvedValue(null),
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
  housing_width: null,
  housing_length: null,
  housing_height: null,
};

describe('AdvancedLampSettingsModal', () => {
  beforeEach(() => {
    vi.mocked(getSessionLampAdvancedSettings).mockResolvedValue(mockSettings);
  });

  it('renders modal title', () => {
    render(AdvancedLampSettingsModal, {
      props: {
        initialLampId: 'lamp-1',
        room: defaultRoom(),
        onClose: vi.fn(),
        onUpdate: vi.fn(),
      },
    });
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
  });

  it('shows loading state initially', () => {
    render(AdvancedLampSettingsModal, {
      props: {
        initialLampId: 'lamp-1',
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
        initialLampId: 'lamp-1',
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
        initialLampId: 'lamp-1',
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
        initialLampId: 'lamp-1',
        room: defaultRoom(),
        onClose: vi.fn(),
        onUpdate: vi.fn(),
      },
    });

    await waitFor(() => {
      const container = document.querySelector('[role="dialog"]');
      expect(container?.textContent).toContain('42.5');
    });
  });

  it('renders lamp sidebar with all lamps', async () => {
    render(AdvancedLampSettingsModal, {
      props: {
        initialLampId: 'lamp-1',
        room: defaultRoom(),
        onClose: vi.fn(),
        onUpdate: vi.fn(),
      },
    });

    // Lamp sidebar should list both lamps
    const lampTabs = document.querySelectorAll('.lamp-tab');
    expect(lampTabs.length).toBe(2);
    expect(lampTabs[0].textContent?.trim()).toBe('Beacon');
    expect(lampTabs[1].textContent?.trim()).toBe('Ushio B1');
  });

  it('renders setting category tabs after loading', async () => {
    render(AdvancedLampSettingsModal, {
      props: {
        initialLampId: 'lamp-1',
        room: defaultRoom(),
        onClose: vi.fn(),
        onUpdate: vi.fn(),
      },
    });

    await waitFor(() => {
      expect(screen.getByText('Scaling & Units')).toBeTruthy();
      expect(screen.getByText('Luminous Opening')).toBeTruthy();
      expect(screen.getByText('Lamp Fixture')).toBeTruthy();
    });
  });

  it('switches between setting tabs', async () => {
    render(AdvancedLampSettingsModal, {
      props: {
        initialLampId: 'lamp-1',
        room: defaultRoom(),
        onClose: vi.fn(),
        onUpdate: vi.fn(),
      },
    });

    await waitFor(() => {
      expect(screen.getByText('Scaling & Units')).toBeTruthy();
    });

    // Default tab should be "Scaling & Units" - check scaling content visible
    await waitFor(() => {
      const container = document.querySelector('[role="dialog"]');
      expect(container?.textContent).toContain('Photometry Scaling');
    });

    // Switch to Luminous Opening tab
    const openingTab = screen.getByText('Luminous Opening');
    await fireEvent.click(openingTab);

    await waitFor(() => {
      const container = document.querySelector('[role="dialog"]');
      expect(container?.textContent).toContain('Near-Field Source Options');
    });
  });

  it('shows warning text without tilde (10x not ~10x)', async () => {
    render(AdvancedLampSettingsModal, {
      props: {
        initialLampId: 'lamp-1',
        room: defaultRoom(),
        onClose: vi.fn(),
        onUpdate: vi.fn(),
      },
    });

    await waitFor(() => {
      const container = document.querySelector('[role="dialog"]');
      expect(container?.textContent).toContain('10x errors');
      expect(container?.textContent).not.toContain('~10x');
    });
  });
});
