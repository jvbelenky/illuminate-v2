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
    name: 'USHIO B1',
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
    getLampInfoCache: vi.fn().mockReturnValue(null),
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
    analyzeLampIes: vi.fn(),
    getSessionLampFiles: vi.fn(),
    uploadSessionLampIntensityMap: vi.fn(),
    deleteSessionLampIntensityMap: vi.fn(),
    getPhotometricWeb: vi.fn().mockResolvedValue(null),
    getSessionLampPhotometricWeb: vi.fn().mockResolvedValue(null),
    getLampInfo: vi.fn().mockResolvedValue({
      preset_id: 'beacon',
      name: 'Beacon',
      total_power_mw: 42.5,
      tlv_acgih: { skin: 23.0, eye: 3.6 },
      tlv_icnirp: { skin: 23.0, eye: 3.6 },
      photometric_plot_base64: 'AAAA',
      spectrum_plot_base64: 'BBBB',
      has_spectrum: true,
      has_ies: true,
      report_url: null,
    }),
    getSessionLampInfo: vi.fn().mockResolvedValue({
      lamp_id: 'lamp-1',
      name: 'Custom Lamp',
      total_power_mw: 30.0,
      tlv_acgih: { skin: 23.0, eye: 3.6 },
      tlv_icnirp: { skin: 23.0, eye: 3.6 },
      photometric_plot_base64: null,
      spectrum_plot_base64: null,
      has_spectrum: false,
      has_ies: false,
    }),
    getSessionLampPlots: vi.fn().mockResolvedValue({}),
  };
});

import { getSessionLampAdvancedSettings, updateSessionLampAdvanced, analyzeLampIes, getSessionLampFiles } from '$lib/api/client';

// jsdom has no WebGL: stub the Threlte canvas and the fixture preview scene.
vi.mock('@threlte/core', async () => {
  const Stub = (await import('./test/Stub.svelte')).default;
  return { Canvas: Stub, T: {}, useThrelte: () => ({ scene: {} }), useTask: () => {} };
});
vi.mock('./FixturePreview3D.svelte', async () => ({
  default: (await import('./test/Stub.svelte')).default,
}));
// The picker needs WebGL; a stub exposes what it was given.
vi.mock('./PhotometricAxisPicker.svelte', async () => ({
  default: (await import('./test/PickerStub.svelte')).default,
}));

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
  photometric_axis: 'down' as const,
  photometric_depth: 0,
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

  it('renders Photometric and Spectral Info tab as first tab', () => {
    render(AdvancedLampSettingsModal, {
      props: {
        initialLampId: 'lamp-1',
        room: defaultRoom(),
        onClose: vi.fn(),
        onUpdate: vi.fn(),
      },
    });
    const tabs = document.querySelectorAll('.tab-btn');
    expect(tabs.length).toBeGreaterThanOrEqual(1);
    expect(tabs[0].textContent?.trim()).toBe('Photometric and Spectral Info');
  });

  it('shows loading state initially when on scaling tab', () => {
    render(AdvancedLampSettingsModal, {
      props: {
        initialLampId: 'lamp-1',
        initialTab: 'scaling' as const,
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
        initialTab: 'scaling' as const,
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
        initialTab: 'scaling' as const,
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
    expect(lampTabs[1].textContent?.trim()).toBe('USHIO B1');
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
      expect(screen.getByText('Photometric and Spectral Info')).toBeTruthy();
      expect(screen.getByText('Scaling & Units')).toBeTruthy();
      expect(screen.getByText('Luminous Opening')).toBeTruthy();
      expect(screen.getByText('Lamp Fixture')).toBeTruthy();
    });
  });

  it('switches between setting tabs', async () => {
    render(AdvancedLampSettingsModal, {
      props: {
        initialLampId: 'lamp-1',
        initialTab: 'scaling' as const,
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
        initialTab: 'scaling' as const,
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

describe('AdvancedLampSettingsModal orientation & mounting', () => {
  it('fixture tab analyzes the stored IES, saves a changed axis and reports it', async () => {
    vi.mocked(getSessionLampAdvancedSettings).mockResolvedValue({ ...mockSettings, photometric_axis: 'down', photometric_depth: 0 });
    vi.mocked(getSessionLampFiles).mockResolvedValue({ ies_filedata: 'TILT=NONE', ies_filename: 'x.ies', spectrum: null, content_hash: 'h' } as any);
    vi.mocked(analyzeLampIes).mockResolvedValue({
      suggested_axis: 'down', axis_scores: {}, ies_dimensions: { width: 1, length: 1, height: 0 }, vertices: [], triangles: [], extents_by_axis: {},
    } as any);
    vi.mocked(updateSessionLampAdvanced).mockResolvedValue({ success: true });
    const onUpdate = vi.fn();
    render(AdvancedLampSettingsModal, {
      props: { initialLampId: 'lamp-1', room: defaultRoom(), onClose: vi.fn(), onUpdate },
    });
    await waitFor(() => expect(getSessionLampAdvancedSettings).toHaveBeenCalled());
    await fireEvent.click(screen.getByRole('tab', { name: /Lamp Fixture/ }));
    await waitFor(() => expect(screen.getByTestId('axis').textContent).toBe('down'));
    await waitFor(() => expect(analyzeLampIes).toHaveBeenCalled());
    // the modal arms its auto-save effect 50 ms after the settings load
    await new Promise((r) => setTimeout(r, 100));
    await fireEvent.click(screen.getByTestId('pick-up'));
    await waitFor(
      () => expect(updateSessionLampAdvanced).toHaveBeenCalledWith('lamp-1', expect.objectContaining({ photometric_axis: 'up' })),
      { timeout: 3000 }
    );
    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
  });
});
