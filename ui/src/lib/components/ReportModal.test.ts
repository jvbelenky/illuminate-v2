import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { get } from 'svelte/store';

const postMock = vi.fn();
const calcMock = vi.fn();
const csvMock = vi.fn();
vi.mock('$lib/utils/calculate', () => ({ performCalculation: (...a: unknown[]) => calcMock(...a) }));
vi.mock('$lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/api/client')>();
  return {
    ...actual,
    createSession: vi.fn().mockResolvedValue({ session_id: 's', token: 't' }),
    postSessionReportPdf: (...a: unknown[]) => postMock(...a),
    getSessionReport: (...a: unknown[]) => csvMock(...a),
    getEfficacyExploreData: vi.fn().mockResolvedValue({
      categories: ['Viruses', 'Bacteria'], mediums: ['Aerosol'], wavelengths: [222, 254],
      table: {
        columns: ['Category', 'Species', 'Strain', 'wavelength [nm]', 'k1 [cm2/mJ]', 'k2 [cm2/mJ]', '% resistant', 'Medium', 'Condition', 'Reference', 'Link'],
        rows: [
          ['Viruses', 'Human coronavirus', '', 222, 1.0, null, 0, 'Aerosol', '', '', ''],
          ['Viruses', 'Influenza virus', '', 222, 2.0, null, 0, 'Aerosol', '', '', ''],
          ['Bacteria', 'Staphylococcus aureus', '', 254, 3.0, null, 0, 'Aerosol', '', '', ''],
        ],
        count: 3,
      },
    }),
  };
});
vi.mock('$lib/stores/lampLibrary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/stores/lampLibrary')>();
  const lampLibrary = {
    get: vi.fn(), toIesFile: vi.fn(), toSpectrumFile: vi.fn(), toIntensityMapFile: vi.fn(),
    findByHash: vi.fn(), add: vi.fn(), ready: vi.fn(() => Promise.resolve()),
  };
  return { ...actual, lampLibrary };
});
vi.mock('$lib/utils/reportCapture', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/utils/reportCapture')>();
  return {
    ...actual,
    captureThumbnails: vi.fn().mockResolvedValue({ current: 'data:a', 'iso-front-left': 'data:b', top: 'data:c', front: 'data:d' }),
    captureReportImages: vi.fn().mockResolvedValue({ cover: 'data:image/png;base64,AAAA', plan: 'data:image/png;base64,BBBB' }),
  };
});

import ReportModal from './ReportModal.svelte';
import { project, stateHashes } from '$lib/stores/project';
import { userSettings } from '$lib/stores/settings';

const api = {
  canvas: () => null, prepare() {}, restore() {},
  getCamera: () => ({ position: [0, 0, 0], target: [0, 0, 0] }), setCamera() {}, setViewImmediate() {}, setVisibility() {}, render() {},
} as unknown as import('$lib/utils/reportCapture').SceneCaptureApi;

function seedResults() {
  project.loadFromFile({
    version: '2',
    name: 'north_wing',
    room: { x: 4, y: 6, z: 2.7, units: 'meters', useStandardZones: true },
    lamps: [{ id: 'L1', lamp_type: 'krcl_222', wavelength: 222, x: 1, y: 1, z: 2.7, aimx: 1, aimy: 1, aimz: 0, scaling_factor: 1, enabled: true }],
    zones: [{ id: 'WholeRoomFluence', name: 'Whole room', type: 'volume', enabled: true, isStandard: true, dose: false, hours: 8, minutes: 0, seconds: 0 }],
  } as never);
  project.setResults({
    calculatedAt: new Date().toISOString(),
    fluenceByWavelength: { 222: 1.5 },
    zones: { WholeRoomFluence: { zone_id: 'WholeRoomFluence', zone_type: 'volume', statistics: { mean: 1.5 } } },
  } as never);
}

describe('ReportModal', () => {
  beforeEach(() => {
    postMock.mockReset();
    project.reset({ skipBackendSync: true });
    seedResults();
    userSettings.update(s => ({ ...s, resultSpecies: ['Human coronavirus'], summarySpecies: 'Human coronavirus', reportCoverView: 'current' }));
  });

  it('defaults the title to the project name and lists only species with data at the lamp wavelengths', async () => {
    const { container } = render(ReportModal, { props: { onClose: () => {}, captureApi: api } });
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('north_wing');
    // The picker lists species only when opened
    await waitFor(() => expect(container.querySelector('.trigger')).toBeTruthy());
    await fireEvent.click(container.querySelector('.trigger') as HTMLElement);
    await waitFor(() => expect(screen.getByText(/Human coronavirus/)).toBeTruthy());
    expect(screen.getByText(/Influenza virus/)).toBeTruthy();
    expect(screen.queryByText(/Staphylococcus aureus/)).toBeNull();
  });

  it('writes meta to the store and posts the request with captures and selections', async () => {
    postMock.mockResolvedValue(new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: 'application/pdf' }));
    const createObjectURL = vi.fn(() => 'blob:x');
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = createObjectURL;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
    render(ReportModal, { props: { onClose: () => {}, captureApi: api } });
    await fireEvent.input(screen.getByLabelText('Client or site'), { target: { value: 'Acme' } });
    expect(get(project).reportMeta?.client).toBe('Acme');
    await waitFor(() => expect((screen.getByRole('button', { name: 'Generate PDF' }) as HTMLButtonElement).disabled).toBe(false));
    await fireEvent.click(screen.getByRole('button', { name: 'Generate PDF' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    const body = postMock.mock.calls[0][0];
    expect(body.meta).toMatchObject({ title: 'north_wing', client: 'Acme' });
    expect(body.pathogens).toEqual(['Human coronavirus']);
    expect(Object.keys(body.images)).toEqual(['cover', 'plan']);
    expect(body.options).toMatchObject({ include_lamp_appendix: true, include_methodology: true, page_size: 'auto' });
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
  });

  it('shows the backend error message', async () => {
    postMock.mockRejectedValue(new Error("No inactivation data for 'Foo'"));
    render(ReportModal, { props: { onClose: () => {}, captureApi: api } });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Generate PDF' }) as HTMLButtonElement).disabled).toBe(false));
    await fireEvent.click(screen.getByRole('button', { name: 'Generate PDF' }));
    await waitFor(() => expect(screen.getByText(/No inactivation data for 'Foo'/)).toBeTruthy());
  });
});

describe('ReportModal review follow-ups', () => {
  beforeEach(() => {
    postMock.mockReset();
    project.reset({ skipBackendSync: true });
    seedResults();
    stateHashes.set({ current: null, lastCalculated: null });
  });

  it('puts the summary species first so the headline tiles match the panel', async () => {
    postMock.mockResolvedValue(new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: 'application/pdf' }));
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => 'blob:x');
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
    userSettings.update(s => ({ ...s, resultSpecies: ['Human coronavirus', 'Influenza virus'], summarySpecies: 'Influenza virus' }));
    render(ReportModal, { props: { onClose: () => {}, captureApi: api } });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Generate PDF' }) as HTMLButtonElement).disabled).toBe(false));
    await fireEvent.click(screen.getByRole('button', { name: 'Generate PDF' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(postMock.mock.calls[0][0].pathogens).toEqual(['Influenza virus', 'Human coronavirus']);
  });

});

describe('ReportModal calculates first when needed', () => {
  beforeEach(() => {
    postMock.mockReset();
    calcMock.mockReset();
    project.reset({ skipBackendSync: true });
    seedResults();
    stateHashes.set({ current: null, lastCalculated: null });
    userSettings.update(s => ({ ...s, resultSpecies: ['Human coronavirus'], summarySpecies: 'Human coronavirus' }));
    postMock.mockResolvedValue(new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: 'application/pdf' }));
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => 'blob:x');
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
  });

  it('runs the calculation before posting when the results are stale', async () => {
    const hashes = { calc_state: { lamps: 1, calc_zones: { WholeRoomFluence: 1 }, reflectance: 1 }, update_state: { lamps: 1, calc_zones: { WholeRoomFluence: 1 }, reflectance: 1 } };
    stateHashes.set({ current: { ...hashes, calc_state: { ...hashes.calc_state, lamps: 2 } }, lastCalculated: hashes });
    calcMock.mockImplementation(async () => { stateHashes.set({ current: hashes, lastCalculated: hashes }); return { success: true }; });
    render(ReportModal, { props: { onClose: () => {}, captureApi: api } });
    expect(screen.getByText(/will be recalculated first/)).toBeTruthy();
    const btn = screen.getByRole('button', { name: 'Generate PDF' }) as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(false));
    await fireEvent.click(btn);
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(calcMock).toHaveBeenCalledTimes(1);
    expect(calcMock.mock.invocationCallOrder[0]).toBeLessThan(postMock.mock.invocationCallOrder[0]);
  });

  it('runs the calculation first when there are no results yet', async () => {
    project.clearResults();
    calcMock.mockResolvedValue({ success: true });
    render(ReportModal, { props: { onClose: () => {}, captureApi: api } });
    expect(screen.getByText(/will be calculated first/)).toBeTruthy();
    const btn = screen.getByRole('button', { name: 'Generate PDF' }) as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(false));
    await fireEvent.click(btn);
    await waitFor(() => expect(calcMock).toHaveBeenCalledTimes(1));
  });

  it('stops with the calculation error and never posts when the calculation fails', async () => {
    project.clearResults();
    calcMock.mockResolvedValue({ success: false, error: 'Simulation failed: too many points' });
    render(ReportModal, { props: { onClose: () => {}, captureApi: api } });
    await fireEvent.click(screen.getByRole('button', { name: 'Generate PDF' }));
    await waitFor(() => expect(screen.getByText(/too many points/)).toBeTruthy());
    expect(postMock).not.toHaveBeenCalled();
  });

  it('shows the backend detail as plain text, not raw JSON', async () => {
    const { ApiError } = await import('$lib/api/client');
    postMock.mockRejectedValue(new ApiError(422, '{"detail":"Image \u0027cover\u0027 exceeds 4 MB"}'));
    render(ReportModal, { props: { onClose: () => {}, captureApi: api } });
    await fireEvent.click(screen.getByRole('button', { name: 'Generate PDF' }));
    await waitFor(() => expect(screen.getByText(/exceeds 4 MB/)).toBeTruthy());
    expect(screen.queryByText(/"detail"/)).toBeNull();
  });

  it("explains a reverse proxy's 413 instead of printing its HTML page", async () => {
    const { ApiError } = await import('$lib/api/client');
    postMock.mockRejectedValue(new ApiError(413, '<html><head><title>413 Request Entity Too Large</title></head><body><center><h1>413 Request Entity Too Large</h1></center><hr><center>nginx</center></body></html>'));
    render(ReportModal, { props: { onClose: () => {}, captureApi: api } });
    await fireEvent.click(screen.getByRole('button', { name: 'Generate PDF' }));
    await waitFor(() => expect(screen.getByText(/too large/i)).toBeTruthy());
    expect(screen.queryByText(/<html>|nginx/)).toBeNull();
  });
});

describe('ReportModal CSV option', () => {
  beforeEach(() => {
    postMock.mockReset();
    csvMock.mockReset();
    project.reset({ skipBackendSync: true });
    seedResults();
    stateHashes.set({ current: null, lastCalculated: null });
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => 'blob:x');
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
  });

  it('offers a CSV download beside the PDF, named after the title', async () => {
    csvMock.mockResolvedValue(new Blob(['a,b\n1,2'], { type: 'text/csv' }));
    render(ReportModal, { props: { onClose: () => {}, captureApi: api } });
    const clicks: string[] = [];
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicks.push(this.download); });
    await fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    await waitFor(() => expect(csvMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(clicks).toContain('north_wing_report.csv'));
    clickSpy.mockRestore();
    expect(postMock).not.toHaveBeenCalled();
  });

  it('calculates first for the CSV too when results are stale', async () => {
    const hashes = { calc_state: { lamps: 1, calc_zones: { WholeRoomFluence: 1 }, reflectance: 1 }, update_state: { lamps: 1, calc_zones: { WholeRoomFluence: 1 }, reflectance: 1 } };
    stateHashes.set({ current: { ...hashes, calc_state: { ...hashes.calc_state, lamps: 2 } }, lastCalculated: hashes });
    calcMock.mockImplementation(async () => { stateHashes.set({ current: hashes, lastCalculated: hashes }); return { success: true }; });
    csvMock.mockResolvedValue(new Blob(['a'], { type: 'text/csv' }));
    render(ReportModal, { props: { onClose: () => {}, captureApi: api } });
    await fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    await waitFor(() => expect(csvMock).toHaveBeenCalledTimes(1));
    expect(calcMock).toHaveBeenCalledTimes(1);
    expect(calcMock.mock.invocationCallOrder[0]).toBeLessThan(csvMock.mock.invocationCallOrder[0]);
  });
});

describe('ReportModal when the backend has no results', () => {
  beforeEach(() => {
    postMock.mockReset();
    calcMock.mockReset();
    project.reset({ skipBackendSync: true });
    seedResults();
    stateHashes.set({ current: null, lastCalculated: null });
    userSettings.update(s => ({ ...s, resultSpecies: ['Human coronavirus'], summarySpecies: 'Human coronavirus' }));
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => 'blob:x');
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
  });

  it('calculates and retries instead of showing the "calculate the room" error', async () => {
    const { ApiError } = await import('$lib/api/client');
    postMock
      .mockRejectedValueOnce(new ApiError(400, '{"detail":"Calculate the room before generating a report (WholeRoomFluence has no results)."}'))
      .mockResolvedValueOnce(new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: 'application/pdf' }));
    calcMock.mockResolvedValue({ success: true });
    render(ReportModal, { props: { onClose: () => {}, captureApi: api } });
    await fireEvent.click(screen.getByRole('button', { name: 'Generate PDF' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(2));
    expect(calcMock).toHaveBeenCalledTimes(1);
    expect(calcMock.mock.invocationCallOrder[0]).toBeGreaterThan(postMock.mock.invocationCallOrder[0]);
    expect(calcMock.mock.invocationCallOrder[0]).toBeLessThan(postMock.mock.invocationCallOrder[1]);
    expect(screen.queryByText(/Calculate the room before/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('gives up with the message only if the backend still has no results after calculating', async () => {
    const { ApiError } = await import('$lib/api/client');
    postMock.mockRejectedValue(new ApiError(400, '{"detail":"Calculate the room before generating a report (WholeRoomFluence has no results)."}'));
    calcMock.mockResolvedValue({ success: true });
    render(ReportModal, { props: { onClose: () => {}, captureApi: api } });
    await fireEvent.click(screen.getByRole('button', { name: 'Generate PDF' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(postMock).toHaveBeenCalledTimes(2);
    expect(calcMock).toHaveBeenCalledTimes(1);
  });
});
