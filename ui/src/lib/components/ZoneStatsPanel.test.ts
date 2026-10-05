import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';
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

  it('shows the next-step hint when no results', () => {
    render(ZoneStatsPanel);
    // With no lamps the hint asks for one
    expect(screen.getByText('Add a lamp to begin')).toBeTruthy();
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
          value_units: 'µW/cm²',
        },
        'SkinLimits': {
          zone_id: 'SkinLimits',
          zone_name: 'Skin Dose (8 Hours)',
          zone_type: 'plane',
          statistics: { min: 5.0, max: 15.0, mean: 10.0, std: 3.0 },
          value_units: 'mJ/cm²',
        },
        'EyeLimits': {
          zone_id: 'EyeLimits',
          zone_name: 'Eye Dose (8 Hours)',
          zone_type: 'plane',
          statistics: { min: 1.0, max: 3.0, mean: 2.0, std: 0.5 },
          value_units: 'mJ/cm²',
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
          value_units: 'µW/cm²',
        },
        'SkinLimits': {
          zone_id: 'SkinLimits',
          zone_name: 'Skin Dose (8 Hours)',
          zone_type: 'plane',
          statistics: { min: 5.0, max: 15.0, mean: 10.0, std: 3.0 },
          value_units: 'mJ/cm²',
        },
        'EyeLimits': {
          zone_id: 'EyeLimits',
          zone_name: 'Eye Dose (8 Hours)',
          zone_type: 'plane',
          statistics: { min: 1.0, max: 3.0, mean: 2.0, std: 0.5 },
          value_units: 'mJ/cm²',
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

describe('ZoneStatsPanel — editable units and dose time', () => {
  const ZONE_ID = 'custom-zone-1';

  /** Seed the store with one custom plane zone plus a result for it. */
  async function seedCustomZone(overrides: Record<string, unknown> = {}) {
    project.loadFromFile({
      version: '2',
      name: 'test',
      room: { x: 4, y: 4, z: 3, units: 'meters', useStandardZones: false },
      lamps: [],
      zones: [
        {
          id: ZONE_ID,
          name: 'My Zone',
          type: 'plane',
          enabled: true,
          isStandard: false,
          dose: false,
          hours: 8,
          minutes: 0,
          seconds: 0,
          ...overrides,
        },
      ],
      lastModified: new Date().toISOString(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    project.setResults({
      calculatedAt: new Date().toISOString(),
      zones: {
        [ZONE_ID]: {
          zone_id: ZONE_ID,
          zone_name: 'My Zone',
          zone_type: 'plane',
          statistics: { min: 1.0, max: 10.0, mean: 5.0, std: 2.0 },
          value_units: 'µW/cm²',
          doseAtCalcTime: false,
          hoursAtCalcTime: 8,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      },
    });

    await tick();
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a units toggle button in fluence mode', async () => {
    await seedCustomZone();
    const { container } = render(ZoneStatsPanel);

    await waitFor(() => {
      const btn = container.querySelector('.units-toggle') as HTMLButtonElement;
      expect(btn).toBeTruthy();
      expect(btn.textContent).toContain('µW/cm²');
      expect(btn.textContent).toContain('⇄');
    });
    // No dose time is shown while in fluence mode
    expect(container.querySelector('.dose-time-btn')).toBeFalsy();
  });

  it('clicking the units toggle flips the zone into dose mode', async () => {
    await seedCustomZone();
    const spy = vi.spyOn(project, 'updateZone');
    const { container } = render(ZoneStatsPanel);

    const btn = await waitFor(() => {
      const b = container.querySelector('.units-toggle') as HTMLButtonElement;
      expect(b).toBeTruthy();
      return b;
    });

    btn.click();
    await tick();

    expect(spy).toHaveBeenCalledWith(ZONE_ID, { dose: true });
    await waitFor(() => {
      const b = container.querySelector('.units-toggle') as HTMLButtonElement;
      expect(b.textContent).toContain('mJ/cm²');
    });
  });

  it('scales the displayed values by the dose conversion factor after toggling', async () => {
    await seedCustomZone();
    const { container } = render(ZoneStatsPanel);

    const readMean = () =>
      (container.querySelector('.zone-card .stat-value.highlight') as HTMLElement)?.textContent?.trim();

    await waitFor(() => expect(readMean()).toBeTruthy());
    const before = readMean();

    (container.querySelector('.units-toggle') as HTMLButtonElement).click();
    await tick();

    // mean 5.0 µW/cm² over 8h = 5 * 3.6 * 8 = 144 mJ/cm²
    await waitFor(() => {
      expect(readMean()).not.toBe(before);
      expect(readMean()).toContain('144');
    });
  });

  it('always renders the dose time with hours, minutes and seconds', async () => {
    await seedCustomZone({ dose: true, hours: 8, minutes: 0, seconds: 0 });
    const { container } = render(ZoneStatsPanel);

    await waitFor(() => {
      const label = container.querySelector('.dose-time-btn') as HTMLElement;
      expect(label).toBeTruthy();
      expect(label.textContent?.trim()).toBe('(8h 0m 0s dose)');
    });
  });

  it('commits a typed dose time on Enter', async () => {
    await seedCustomZone({ dose: true });
    const spy = vi.spyOn(project, 'updateZone');
    const { container } = render(ZoneStatsPanel);

    const label = await waitFor(() => {
      const l = container.querySelector('.dose-time-btn') as HTMLElement;
      expect(l).toBeTruthy();
      return l;
    });

    label.click();
    await tick();

    const input = container.querySelector('.dose-time-input') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe('8h 0m 0s');

    input.value = '1h 30m 0s';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await tick();

    expect(spy).toHaveBeenCalledWith(ZONE_ID, { hours: 1, minutes: 30, seconds: 0 });
    await waitFor(() => {
      expect(container.querySelector('.dose-time-input')).toBeFalsy();
      expect((container.querySelector('.dose-time-btn') as HTMLElement).textContent?.trim())
        .toBe('(1h 30m 0s dose)');
    });
  });

  it('reverts unparseable dose time input without committing', async () => {
    await seedCustomZone({ dose: true });
    const spy = vi.spyOn(project, 'updateZone');
    const { container } = render(ZoneStatsPanel);

    const label = await waitFor(() => {
      const l = container.querySelector('.dose-time-btn') as HTMLElement;
      expect(l).toBeTruthy();
      return l;
    });
    label.click();
    await tick();

    const input = container.querySelector('.dose-time-input') as HTMLInputElement;
    input.value = 'garbage';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await tick();

    expect(spy).not.toHaveBeenCalled();
    await waitFor(() => {
      expect((container.querySelector('.dose-time-btn') as HTMLElement).textContent?.trim())
        .toBe('(8h 0m 0s dose)');
    });
  });

  it('cancels the edit on Escape, even though blur fires afterwards', async () => {
    await seedCustomZone({ dose: true });
    const spy = vi.spyOn(project, 'updateZone');
    const { container } = render(ZoneStatsPanel);

    const label = await waitFor(() => {
      const l = container.querySelector('.dose-time-btn') as HTMLElement;
      expect(l).toBeTruthy();
      return l;
    });
    label.click();
    await tick();

    const input = container.querySelector('.dose-time-input') as HTMLInputElement;
    input.value = '2h 0m 0s';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick();
    // The trailing blur must not sneak the edit through
    input.dispatchEvent(new FocusEvent('blur', { bubbles: false }));
    await tick();

    expect(spy).not.toHaveBeenCalled();
    await waitFor(() => {
      expect((container.querySelector('.dose-time-btn') as HTMLElement).textContent?.trim())
        .toBe('(8h 0m 0s dose)');
    });
  });
});

describe('ZoneStatsPanel safety exposure with mixed lamp spectra', () => {
  const plane = (id: string, name: string) => ({
    zone_id: id, zone_name: name, zone_type: 'plane' as const,
    statistics: { min: 5.0, max: 100.0, mean: 50.0, std: 3.0 }, value_units: 'mJ/cm²',
  });
  const lamp = (id: string, dose: number, skin_tlv: number, eye_tlv: number) => ({
    lamp_id: id, lamp_name: id, skin_dose_max: dose, eye_dose_max: dose, skin_tlv, eye_tlv,
    skin_dimming_required: 1, eye_dimming_required: 1, is_skin_compliant: true, is_eye_compliant: true,
    skin_near_limit: false, eye_near_limit: false, missing_spectrum: false,
  });

  it('shows hours from the spectrum-weighted exposure, not the lowest TLV in the room', async () => {
    // A 222 nm lamp delivering 100 mJ/cm² plus a 254 nm lamp delivering 0.5 mJ/cm².
    // Weighted: skin 100/478.5 + 0.5/10 = 0.259 (30.9 h); eye 100/160.7 + 0.5/6 = 0.706 (11.3 h).
    // Judging the whole dose against the 254 nm TLVs gave 48 and 29 minutes.
    const standardZone = (id: string, name: string) => ({
      id, name, type: 'plane', enabled: true, isStandard: true, dose: true, hours: 8, minutes: 0, seconds: 0,
      height: 1.8, x1: 0, x2: 4, y1: 0, y2: 6, num_x: 5, num_y: 5,
    });
    project.loadFromFile({
      version: '2',
      name: 'test',
      room: { x: 4, y: 6, z: 2.7, units: 'meters', useStandardZones: true, standard: 'ANSI IES RP 27.1-22 (ACGIH Limits)' },
      lamps: [],
      zones: [standardZone('SkinLimits', 'Skin Dose (8 Hours)'), standardZone('EyeLimits', 'Eye Dose (8 Hours)')],
      lastModified: new Date().toISOString(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    project.setResults({
      calculatedAt: new Date().toISOString(),
      zones: { SkinLimits: plane('SkinLimits', 'Skin Dose (8 Hours)'), EyeLimits: plane('EyeLimits', 'Eye Dose (8 Hours)') },
      checkLamps: {
        status: 'compliant',
        lamp_results: { l222: lamp('l222', 100, 478.5, 160.7), l254: lamp('l254', 0.5, 10, 6) },
        warnings: [],
        max_skin_dose: 3 * 0.259, max_eye_dose: 3 * 0.706,
        is_skin_compliant: true, is_eye_compliant: true, skin_near_limit: false, eye_near_limit: false,
        tlv_fraction_by_standard: {
          ACGIH: { skin: 100 / 478.5 + 0.5 / 10, eye: 100 / 160.7 + 0.5 / 6 },
          ICNIRP: { skin: 100 / 22.87 + 0.5 / 6, eye: 100 / 22.87 + 0.5 / 6 },
        },
      },
    });
    await tick();
    render(ZoneStatsPanel);

    await waitFor(() => {
      expect(screen.getByTestId('hours-acgih').textContent).toContain('Indefinite (11.3 h)');
    });
    expect(screen.getByTestId('hours-icnirp').textContent).toContain('1.8 h');

    // The safety table (room standard is ACGIH by default) agrees
    await fireEvent.click(screen.getByText('Photobiological Safety'));
    await waitFor(() => {
      expect(screen.getByText('Indefinite (30.9 h)')).toBeTruthy();
    });
    expect(screen.getByText('Indefinite (11.3 h)', { selector: 'td' })).toBeTruthy();
    expect(screen.queryByText(/29 min|48 min/)).toBeNull();
  });
});
