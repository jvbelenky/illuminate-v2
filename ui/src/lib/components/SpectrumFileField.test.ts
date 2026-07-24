import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import SpectrumFileFieldHarness from '../test/SpectrumFileFieldHarness.svelte';
import type { SpectrumFileFieldValue } from './SpectrumFileField.svelte';
import type { ParsedSpectrumFile } from '$lib/api/client';

// Mock the API client - use importOriginal to include all exports
vi.mock('$lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/api/client')>();
  return {
    ...actual,
    parseSpectrumFile: vi.fn(),
  };
});

// Chart.js can't render in jsdom (no canvas backend); stub the chart out.
vi.mock('./SpectrumChart.svelte', () => ({
  default: () => {},
}));

import { parseSpectrumFile } from '$lib/api/client';

function makeFile(name = 'spectrum.csv') {
  return new File(['a,b\n1,2\n'], name, { type: 'text/csv' });
}

async function selectFile(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, 'files', {
    value: [file],
    configurable: true,
  });
  await fireEvent.change(input);
}

/** Renders the harness and returns a `latestValue()` accessor fed by onvalue. */
function renderField(props: {
  initialValue?: SpectrumFileFieldValue | null;
  currentFilename?: string;
  recommended?: boolean;
} = {}) {
  const onerror = vi.fn();
  const oncleared = vi.fn();
  let latest: SpectrumFileFieldValue | null = props.initialValue ?? null;
  const onvalue = vi.fn((v: SpectrumFileFieldValue | null) => {
    latest = v;
  });

  const result = render(SpectrumFileFieldHarness, {
    props: { ...props, onerror, onvalue, oncleared },
  });

  return { ...result, onerror, oncleared, latestValue: () => latest };
}

const singleColumnResult: ParsedSpectrumFile = {
  wavelengths: [200, 210, 220],
  series: [
    { index: 0, label: 'Column A', intensities: [1, 2, 3], peak_wavelength: 222, acgih_skin: null, acgih_eye: null, icnirp: null },
  ],
  num_series: 1,
  wavelength_range: [200, 220],
};

const multiColumnResult: ParsedSpectrumFile = {
  wavelengths: [200, 210, 220],
  series: [
    { index: 0, label: 'Column A', intensities: [1, 2, 3], peak_wavelength: 222, acgih_skin: null, acgih_eye: null, icnirp: null },
    { index: 1, label: 'Column B', intensities: [4, 5, 6], peak_wavelength: 254, acgih_skin: null, acgih_eye: null, icnirp: null },
  ],
  num_series: 2,
  wavelength_range: [200, 220],
};

describe('SpectrumFileField', () => {
  beforeEach(() => {
    vi.mocked(parseSpectrumFile).mockReset();
  });

  it('renders a hidden file input accepting spectrum formats and a select button', () => {
    const { container, getByText } = renderField();

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.getAttribute('accept')).toBe('.csv,.xls,.xlsx');
    expect(getByText('Select Spectrum File')).toBeTruthy();
  });

  it('shows "(recommended)" when recommended is true and "(optional)" otherwise', () => {
    const recRender = renderField({ recommended: true });
    expect(recRender.getByText('(recommended)')).toBeTruthy();
    recRender.unmount();

    const optRender = renderField({ recommended: false });
    expect(optRender.getByText('(optional)')).toBeTruthy();
  });

  it('shows currentFilename when no value has been selected yet', () => {
    const { getByText } = renderField({ currentFilename: 'existing-spectrum.csv' });
    expect(getByText('existing-spectrum.csv')).toBeTruthy();
  });

  it('single-column file: sets value to { file } directly without showing a picker', async () => {
    vi.mocked(parseSpectrumFile).mockResolvedValue(singleColumnResult);
    const { container, queryByText, latestValue } = renderField();

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = makeFile('mono.csv');
    await selectFile(input, file);

    await waitFor(() => {
      expect(latestValue()).toEqual({ file });
    });
    expect(queryByText(/data columns/)).toBeNull();
    // Input is cleared so re-selecting the same file re-fires change.
    expect(input.value).toBe('');
  });

  it('multi-column file: shows the column picker, then sets columnIndex on confirm', async () => {
    vi.mocked(parseSpectrumFile).mockResolvedValue(multiColumnResult);
    const { container, getByText, latestValue } = renderField();

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = makeFile('multi.csv');
    await selectFile(input, file);

    await waitFor(() => {
      expect(getByText(/This file contains 2 data columns/)).toBeTruthy();
    });

    // Value should not be set yet while the picker is open.
    expect(latestValue()).toBeNull();

    // Pick the second column.
    await fireEvent.click(getByText('Column B'));
    await fireEvent.click(getByText('Use Selected'));

    await waitFor(() => {
      expect(latestValue()).toEqual({ file, columnIndex: 1 });
    });
  });

  it('multi-column file: cancel leaves value unset and closes the picker', async () => {
    vi.mocked(parseSpectrumFile).mockResolvedValue(multiColumnResult);
    const { container, getByText, queryByText, latestValue } = renderField();

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await selectFile(input, makeFile('multi.csv'));

    await waitFor(() => {
      expect(getByText('Use Selected')).toBeTruthy();
    });

    await fireEvent.click(getByText('Cancel'));

    await waitFor(() => {
      expect(queryByText(/data columns/)).toBeNull();
    });
    expect(latestValue()).toBeNull();
  });

  it('parse rejection calls onerror and clears the input without setting value', async () => {
    vi.mocked(parseSpectrumFile).mockRejectedValue(new Error('Could not parse file'));
    const { container, onerror, latestValue } = renderField();

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await selectFile(input, makeFile('bad.csv'));

    await waitFor(() => {
      expect(onerror).toHaveBeenCalledWith('Could not parse file');
    });
    expect(latestValue()).toBeNull();
    expect(input.value).toBe('');
  });

  it('clear button resets value to null', async () => {
    const initialFile = makeFile('already-picked.csv');
    const { getByTitle, queryByText, latestValue } = renderField({
      initialValue: { file: initialFile },
    });

    expect(latestValue()).toEqual({ file: initialFile });

    await fireEvent.click(getByTitle('Remove spectrum file'));

    await waitFor(() => {
      expect(latestValue()).toBeNull();
    });
    expect(queryByText('already-picked.csv')).toBeNull();
  });

  it('clear button fires oncleared when clearing a newly-picked file', async () => {
    const initialFile = makeFile('already-picked.csv');
    const { getByTitle, oncleared } = renderField({
      initialValue: { file: initialFile },
    });

    await fireEvent.click(getByTitle('Remove spectrum file'));

    await waitFor(() => {
      expect(oncleared).toHaveBeenCalledTimes(1);
    });
  });

  it('clear button fires oncleared when dismissing a shown currentFilename (value was already null)', async () => {
    const { getByTitle, oncleared, latestValue } = renderField({
      currentFilename: 'existing-spectrum.csv',
    });

    // The parent's bound value is already null before the clear click — this is
    // exactly the case the parent can't observe without the oncleared callback.
    expect(latestValue()).toBeNull();

    await fireEvent.click(getByTitle('Remove spectrum file'));

    await waitFor(() => {
      expect(oncleared).toHaveBeenCalledTimes(1);
    });
    expect(latestValue()).toBeNull();
  });
});
