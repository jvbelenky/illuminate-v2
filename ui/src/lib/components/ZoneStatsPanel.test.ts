import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import ZoneStatsPanel from './ZoneStatsPanel.svelte';

// Mock the API client - use importOriginal to include all exports
vi.mock('$lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/api/client')>();
  return {
    ...actual,
    getSessionReport: vi.fn(),
    getSessionZoneExport: vi.fn(),
    getSessionExportZip: vi.fn(),
    getDisinfectionTable: vi.fn(),
    getSurvivalPlot: vi.fn(),
    checkLampsSession: vi.fn(),
    updateSessionRoom: vi.fn(),
    getEfficacyTable: vi.fn(),
    getEfficacyMediums: vi.fn(),
    getEfficacyCategories: vi.fn(),
    getEfficacyWavelengths: vi.fn(),
    getLampInfo: vi.fn(),
    getSessionLampInfo: vi.fn(),
    getLampIesDownloadUrl: vi.fn(() => ''),
    getLampSpectrumDownloadUrl: vi.fn(() => ''),
  };
});

// ZoneStatsPanel reads from stores directly, so we need to populate them
import { project } from '$lib/stores/project';

describe('ZoneStatsPanel', () => {
  beforeEach(async () => {
    // Reset project store to a clean state
    // The store auto-initializes with defaults
    await tick();
  });

  it('renders the results heading', () => {
    render(ZoneStatsPanel);
    expect(screen.getByText('Results')).toBeTruthy();
  });

  it('shows empty state when no results', () => {
    render(ZoneStatsPanel);
    expect(screen.getByText('No results yet')).toBeTruthy();
  });

  it('shows calculate hint when no results', () => {
    render(ZoneStatsPanel);
    expect(screen.getByText(/Click Calculate/)).toBeTruthy();
  });

  it('renders panel header', () => {
    const { container } = render(ZoneStatsPanel);
    expect(container.querySelector('.panel-header')).toBeTruthy();
  });

  it('renders stats panel container', () => {
    const { container } = render(ZoneStatsPanel);
    expect(container.querySelector('.stats-panel')).toBeTruthy();
  });

  it('shows results when project has calculation data', async () => {
    // Set up project with results
    project.setResults({
      calculatedAt: new Date().toISOString(),
      zones: {
        'WholeRoomFluence': {
          zone_id: 'WholeRoomFluence',
          zone_name: 'Whole Room Fluence',
          zone_type: 'volume',
          statistics: { min: 1.0, max: 10.0, mean: 5.0, std: 2.0 },
          units: 'µW/cm²',
        },
        'SkinLimits': {
          zone_id: 'SkinLimits',
          zone_name: 'Skin Dose (8 Hours)',
          zone_type: 'plane',
          statistics: { min: 5.0, max: 15.0, mean: 10.0, std: 3.0 },
          units: 'mJ/cm²',
        },
        'EyeLimits': {
          zone_id: 'EyeLimits',
          zone_name: 'Eye Dose (8 Hours)',
          zone_type: 'plane',
          statistics: { min: 1.0, max: 3.0, mean: 2.0, std: 0.5 },
          units: 'mJ/cm²',
        },
      },
    });

    await tick();

    render(ZoneStatsPanel);

    await waitFor(() => {
      // Should show results, not empty state
      expect(screen.queryByText('No results yet')).toBeFalsy();
    });
  });

  it('renders section titles with results', async () => {
    project.setResults({
      calculatedAt: new Date().toISOString(),
      zones: {
        'WholeRoomFluence': {
          zone_id: 'WholeRoomFluence',
          zone_name: 'Whole Room Fluence',
          zone_type: 'volume',
          statistics: { min: 1.0, max: 10.0, mean: 5.0, std: 2.0 },
          units: 'µW/cm²',
        },
        'SkinLimits': {
          zone_id: 'SkinLimits',
          zone_name: 'Skin Dose (8 Hours)',
          zone_type: 'plane',
          statistics: { min: 5.0, max: 15.0, mean: 10.0, std: 3.0 },
          units: 'mJ/cm²',
        },
        'EyeLimits': {
          zone_id: 'EyeLimits',
          zone_name: 'Eye Dose (8 Hours)',
          zone_type: 'plane',
          statistics: { min: 1.0, max: 3.0, mean: 2.0, std: 0.5 },
          units: 'mJ/cm²',
        },
      },
    });

    await tick();

    render(ZoneStatsPanel);

    await waitFor(() => {
      expect(screen.getByText('Summary')).toBeTruthy();
    });
  });
});
