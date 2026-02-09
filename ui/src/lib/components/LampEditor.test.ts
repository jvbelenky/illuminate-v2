import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import LampEditor from './LampEditor.svelte';
import type { LampInstance, RoomConfig } from '$lib/types/project';
import { defaultRoom } from '$lib/types/project';

// Mock the API client - use importOriginal to include all exports
vi.mock('$lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/api/client')>();
  return {
    ...actual,
    getLampOptions: vi.fn(),
    placeSessionLamp: vi.fn(),
    getLampInfo: vi.fn(),
    getSessionLampInfo: vi.fn(),
    getLampIesDownloadUrl: vi.fn(() => ''),
    getLampSpectrumDownloadUrl: vi.fn(() => ''),
    getSessionLampAdvancedSettings: vi.fn(),
    getSessionLampGridPointsPlot: vi.fn(),
    getSessionLampIntensityMapPlot: vi.fn(),
    updateSessionLampAdvanced: vi.fn(),
    uploadSessionLampIntensityMap: vi.fn(),
    deleteSessionLampIntensityMap: vi.fn(),
  };
});

import { getLampOptions } from '$lib/api/client';

const mockLamp: LampInstance = {
  id: 'lamp-1',
  lamp_type: 'krcl_222',
  preset_id: 'beacon',
  name: 'Beacon',
  x: 2, y: 3, z: 2.5,
  aimx: 2, aimy: 3, aimz: 0,
  scaling_factor: 1.0,
  enabled: true,
  has_ies_file: true,
};

describe('LampEditor', () => {
  beforeEach(() => {
    vi.mocked(getLampOptions).mockResolvedValue({
      lamp_types: [
        { id: 'krcl_222', name: 'Krypton chloride (222 nm)', wavelength: 222, requires_custom_ies: false, has_presets: true },
        { id: 'lp_254', name: 'Low-pressure mercury (254 nm)', wavelength: 254, requires_custom_ies: true, has_presets: false },
      ],
      presets_222nm: [
        { id: 'beacon', name: 'Beacon', lamp_type: 'krcl_222', wavelength: 222, has_ies: true, has_spectrum: true },
        { id: 'ushio_b1', name: 'Ushio B1', lamp_type: 'krcl_222', wavelength: 222, has_ies: true, has_spectrum: false },
      ],
    });
  });

  it('renders lamp editor container', () => {
    const { container } = render(LampEditor, {
      props: { lamp: mockLamp, room: defaultRoom(), onClose: vi.fn() },
    });
    expect(container.querySelector('.lamp-editor')).toBeTruthy();
  });

  it('shows loading state initially', () => {
    render(LampEditor, {
      props: { lamp: mockLamp, room: defaultRoom(), onClose: vi.fn() },
    });
    expect(screen.getByText(/Loading lamp options/)).toBeTruthy();
  });

  it('renders lamp type selector after loading', async () => {
    render(LampEditor, {
      props: { lamp: mockLamp, room: defaultRoom(), onClose: vi.fn() },
    });

    await waitFor(() => {
      expect(screen.getByText('Lamp Type')).toBeTruthy();
    });
  });

  it('renders preset selector for 222nm lamps', async () => {
    render(LampEditor, {
      props: { lamp: mockLamp, room: defaultRoom(), onClose: vi.fn() },
    });

    await waitFor(() => {
      expect(screen.getByText('Select Lamp')).toBeTruthy();
    });
  });

  it('renders placement buttons', async () => {
    const { container } = render(LampEditor, {
      props: { lamp: mockLamp, room: defaultRoom(), onClose: vi.fn() },
    });

    await waitFor(() => {
      const buttons = container.querySelectorAll('button');
      const buttonTexts = Array.from(buttons).map(b => b.textContent?.trim());
      expect(buttonTexts).toContain('Downlight');
      expect(buttonTexts).toContain('Corner');
      expect(buttonTexts).toContain('Edge');
    });
  });

  it('renders Lamp Info button', async () => {
    render(LampEditor, {
      props: { lamp: mockLamp, room: defaultRoom(), onClose: vi.fn() },
    });

    await waitFor(() => {
      expect(screen.getByText('Lamp Info')).toBeTruthy();
    });
  });

  it('shows error when API fails', async () => {
    vi.mocked(getLampOptions).mockRejectedValue(new Error('Failed to load'));

    render(LampEditor, {
      props: { lamp: mockLamp, room: defaultRoom(), onClose: vi.fn() },
    });

    await waitFor(() => {
      expect(screen.getByText(/Failed to load/)).toBeTruthy();
    });
  });

  it('renders position inputs after loading', async () => {
    render(LampEditor, {
      props: { lamp: mockLamp, room: defaultRoom(), onClose: vi.fn() },
    });

    await waitFor(() => {
      expect(screen.getByText('Position (meters)')).toBeTruthy();
    });
  });
});
