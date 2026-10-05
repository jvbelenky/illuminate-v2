import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import type { LampInstance } from '$lib/types/project';

const { lampsStore, customLampsStore, updateLamp, whenSynced } = vi.hoisted(() => {
  // vi.hoisted runs before imports, so build minimal stores by hand.
  function store<T>(initial: T) {
    let value = initial;
    const subs = new Set<(v: T) => void>();
    return {
      subscribe(fn: (v: T) => void) { subs.add(fn); fn(value); return () => subs.delete(fn); },
      set(v: T) { value = v; subs.forEach((fn) => fn(v)); },
    };
  }
  return {
    lampsStore: store<any[]>([]),
    customLampsStore: store<any[]>([]),
    updateLamp: vi.fn(),
    whenSynced: vi.fn(),
  };
});

vi.mock('$lib/stores/project', () => ({
  lamps: lampsStore,
  project: { updateLamp, whenSynced },
}));
vi.mock('$lib/stores/lampLibrary', () => ({ customLamps: customLampsStore }));
vi.mock('$lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/api/client')>();
  return {
    ...actual,
    parseSpectrumFile: vi.fn().mockResolvedValue({ num_series: 1, wavelengths: [], series: [] }),
  };
});

import LampSourceSettings from './LampSourceSettings.svelte';

function lamp(overrides: Partial<LampInstance> = {}): LampInstance {
  return {
    id: 'lamp-1', lamp_type: 'other', preset_id: 'custom', name: 'Custom',
    x: 1, y: 1, z: 2, aimx: 1, aimy: 1, aimz: 0,
    scaling_factor: 1, enabled: true, has_ies_file: true,
    ...overrides,
  };
}

describe('LampSourceSettings', () => {
  beforeEach(() => {
    updateLamp.mockReset();
    whenSynced.mockReset().mockResolvedValue(undefined);
    customLampsStore.set([]);
  });

  it('edits the wavelength of an Other-type instance and reports once synced', async () => {
    lampsStore.set([lamp({ wavelength: 280 })]);
    const onChanged = vi.fn();
    render(LampSourceSettings, { props: { lampId: 'lamp-1', onChanged } });

    const input = screen.getByLabelText(/Wavelength/) as HTMLInputElement;
    expect(input.value).toBe('280');
    await fireEvent.change(input, { target: { value: '265' } });

    expect(updateLamp).toHaveBeenCalledWith('lamp-1', { wavelength: 265 });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('locks the wavelength while the spectrum peak defines it', () => {
    lampsStore.set([lamp({ wavelength: 254, wavelength_from_spectrum: true, has_spectrum_file: true, spectrum_filename: 's.csv' })]);
    render(LampSourceSettings, { props: { lampId: 'lamp-1' } });
    expect((screen.getByLabelText(/Wavelength/) as HTMLInputElement).disabled).toBe(true);
  });

  it('has no wavelength field for fixed-wavelength lamp types', () => {
    lampsStore.set([lamp({ lamp_type: 'krcl_222' })]);
    render(LampSourceSettings, { props: { lampId: 'lamp-1' } });
    expect(screen.queryByLabelText(/Wavelength/)).toBeNull();
    expect(screen.getByText('Select Spectrum File')).toBeTruthy();
  });

  it('uploads a picked spectrum to this instance through the store', async () => {
    lampsStore.set([lamp({ lamp_type: 'krcl_222' })]);
    const onChanged = vi.fn();
    const { container } = render(LampSourceSettings, { props: { lampId: 'lamp-1', onChanged } });

    const file = new File(['nm,val\n222,1'], 'spec.csv');
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(updateLamp).toHaveBeenCalledWith('lamp-1', {
      pending_spectrum_file: file,
      pending_spectrum_column_index: 0,
      pending_remove_spectrum: undefined,
    }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('removes an attached spectrum through the sync queue', async () => {
    lampsStore.set([lamp({ has_spectrum_file: true, spectrum_filename: 'spec.csv', wavelength_from_spectrum: true })]);
    render(LampSourceSettings, { props: { lampId: 'lamp-1' } });

    expect(screen.getByText(/spec\.csv/)).toBeTruthy();
    await fireEvent.click(screen.getByTitle('Remove spectrum file'));

    expect(updateLamp).toHaveBeenCalledWith('lamp-1', expect.objectContaining({
      pending_remove_spectrum: true,
      has_spectrum_file: false,
      wavelength_from_spectrum: false,
      spectrum_filename: undefined,
    }));
  });

  it('notes that a linked library definition overrides instance edits', () => {
    customLampsStore.set([{ id: 'def-1', name: 'My UV lamp' }]);
    lampsStore.set([lamp({ custom_lamp_id: 'def-1' })]);
    render(LampSourceSettings, { props: { lampId: 'lamp-1' } });
    expect(screen.getByText(/this lamp only/).textContent).toContain('My UV lamp');
  });
});
