import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import LampInfoModal from './LampInfoModal.svelte';

// Mock the API client - use importOriginal to include all exports
vi.mock('$lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/api/client')>();
  return {
    ...actual,
    getLampInfo: vi.fn(),
    getSessionLampInfo: vi.fn(),
    getLampIesDownloadUrl: vi.fn(() => 'http://example.com/ies'),
    getLampSpectrumDownloadUrl: vi.fn(() => 'http://example.com/spectrum'),
  };
});

import { getLampInfo, getSessionLampInfo } from '$lib/api/client';

const mockLampInfo = {
  preset_id: 'beacon',
  name: 'Beacon',
  total_power_mw: 42.5,
  tlv_acgih: { skin: 23.0, eye: 3.6 },
  tlv_icnirp: { skin: 23.0, eye: 3.6 },
  photometric_plot_base64: 'AAAA',
  spectrum_plot_base64: 'BBBB',
  has_spectrum: true,
  report_url: null,
};

describe('LampInfoModal', () => {
  beforeEach(() => {
    vi.mocked(getLampInfo).mockResolvedValue(mockLampInfo);
    vi.mocked(getSessionLampInfo).mockResolvedValue({
      lamp_id: 'lamp-1',
      name: 'Custom Lamp',
      total_power_mw: 30.0,
      tlv_acgih: { skin: 23.0, eye: 3.6 },
      tlv_icnirp: { skin: 23.0, eye: 3.6 },
      photometric_plot_base64: 'CCCC',
      spectrum_plot_base64: null,
      has_spectrum: false,
    });
  });

  it('renders lamp name in title', async () => {
    render(LampInfoModal, {
      props: { presetId: 'beacon', lampName: 'Beacon', onClose: vi.fn() },
    });
    // Title shows lampName immediately before data loads
    expect(screen.getByText(/Beacon/)).toBeTruthy();
  });

  it('shows loading state initially', () => {
    render(LampInfoModal, {
      props: { presetId: 'beacon', lampName: 'Beacon', onClose: vi.fn() },
    });
    expect(screen.getByText(/Loading lamp information/)).toBeTruthy();
  });

  it('shows no photometry message when hasPhotometry is false', () => {
    render(LampInfoModal, {
      props: { presetId: 'beacon', lampName: 'Beacon', hasPhotometry: false, onClose: vi.fn() },
    });
    expect(screen.getByText(/No Lamp Data/)).toBeTruthy();
  });

  it('renders lamp info after loading', async () => {
    render(LampInfoModal, {
      props: { presetId: 'beacon', lampName: 'Beacon', onClose: vi.fn() },
    });

    await waitFor(() => {
      expect(screen.getByText(/Photometric Distribution/)).toBeTruthy();
    });

    expect(screen.getByText(/42.5/)).toBeTruthy();
    // "Spectrum" appears multiple times (header + download button), just check at least one exists
    expect(screen.getAllByText(/Spectrum/).length).toBeGreaterThan(0);
  });

  it('renders TLV table with data', async () => {
    render(LampInfoModal, {
      props: { presetId: 'beacon', lampName: 'Beacon', onClose: vi.fn() },
    });

    await waitFor(() => {
      expect(screen.getByText('Skin')).toBeTruthy();
    });

    expect(screen.getByText('Eye')).toBeTruthy();
    expect(screen.getByText('ACGIH')).toBeTruthy();
    expect(screen.getByText('ICNIRP')).toBeTruthy();
  });

  it('shows error state when API fails', async () => {
    vi.mocked(getLampInfo).mockRejectedValue(new Error('Network error'));

    render(LampInfoModal, {
      props: { presetId: 'beacon', lampName: 'Beacon', onClose: vi.fn() },
    });

    await waitFor(() => {
      expect(screen.getByText(/Network error/)).toBeTruthy();
    });

    expect(screen.getByText('Retry')).toBeTruthy();
  });

  it('fetches session lamp info for custom lamps', async () => {
    render(LampInfoModal, {
      props: { lampId: 'lamp-1', lampName: 'Custom Lamp', onClose: vi.fn() },
    });

    await waitFor(() => {
      expect(getSessionLampInfo).toHaveBeenCalledWith('lamp-1', 'linear', expect.any(String));
    });
  });
});
