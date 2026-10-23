import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import LampEditor from './LampEditor.svelte';
import type { LampInstance } from '$lib/types/project';
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

// Mock the lamp library store — LampEditor reads the `customLamps` derived store
// and (transitively via project.ts) the `lampLibrary` object.
vi.mock('$lib/stores/lampLibrary', async () => {
  const { writable } = await import('svelte/store');
  return {
    customLamps: writable<unknown[]>([]),
    lampLibrary: {
      get: vi.fn(),
      toIesFile: vi.fn(),
      toSpectrumFile: vi.fn(),
      toIntensityMapFile: vi.fn(),
      init: vi.fn(),
      isInitialized: vi.fn(() => false),
    },
  };
});

import { getLampOptions, placeSessionLamp } from '$lib/api/client';
import { customLamps } from '$lib/stores/lampLibrary';
import { project } from '$lib/stores/project';
import { photometricWebSource } from './photometricWeb';
import type { Writable } from 'svelte/store';

const customLampsW = customLamps as unknown as Writable<unknown[]>;

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

/** Wait for the editor to load, then open one of its fold-outs. */
async function openFold(name: 'Geometry' | 'Display') {
  const btn = await screen.findByRole('button', { name });
  if (btn.getAttribute('aria-expanded') !== 'true') await fireEvent.click(btn);
}

function renderEditor(lamp: LampInstance = mockLamp) {
  return render(LampEditor, {
    props: { lamp, room: defaultRoom(), onClose: vi.fn(), onOpenLampManager: vi.fn() },
  });
}

describe('LampEditor', () => {
  beforeEach(() => {
    customLampsW.set([]);
    vi.mocked(getLampOptions).mockResolvedValue({
      lamp_types: [
        { id: 'krcl_222', name: 'Krypton chloride (222 nm)', wavelength: 222, requires_custom_ies: false, has_presets: true },
        { id: 'lp_254', name: 'Low-pressure mercury (254 nm)', wavelength: 254, requires_custom_ies: true, has_presets: false },
      ],
      presets_222nm: [
        { id: 'beacon', name: 'Beacon', lamp_type: 'krcl_222', wavelength: 222, has_ies: true, has_spectrum: true },
        { id: 'ushio_b1', name: 'USHIO B1', lamp_type: 'krcl_222', wavelength: 222, has_ies: true, has_spectrum: false },
      ],
    });
  });

  it('renders lamp editor container', () => {
    const { container } = render(LampEditor, {
      props: { lamp: mockLamp, room: defaultRoom(), onClose: vi.fn(), onOpenLampManager: vi.fn() },
    });
    expect(container.querySelector('.lamp-editor')).toBeTruthy();
  });

  it('shows loading state initially', () => {
    render(LampEditor, {
      props: { lamp: mockLamp, room: defaultRoom(), onClose: vi.fn(), onOpenLampManager: vi.fn() },
    });
    expect(screen.getByText(/Loading lamp options/)).toBeTruthy();
  });

  it('renders lamp type selector after loading', async () => {
    render(LampEditor, {
      props: { lamp: mockLamp, room: defaultRoom(), onClose: vi.fn(), onOpenLampManager: vi.fn() },
    });

    await waitFor(() => {
      expect(screen.getByText('Lamp Type')).toBeTruthy();
    });
  });

  it('renders preset selector for 222nm lamps', async () => {
    render(LampEditor, {
      props: { lamp: mockLamp, room: defaultRoom(), onClose: vi.fn(), onOpenLampManager: vi.fn() },
    });

    await waitFor(() => {
      expect(screen.getByText('Select Lamp')).toBeTruthy();
    });
  });

  it('Add custom lamp... opens the manager without mutating the lamp and restores the dropdown', async () => {
    const onOpenLampManager = vi.fn();
    // The whole point of the new contract: selecting "Add custom lamp..." (and
    // cancelling the manager, i.e. never saving) must touch NOTHING on the lamp.
    const updateSpy = vi.spyOn(project, 'updateLamp').mockImplementation(() => {});
    const applySpy = vi.spyOn(project, 'applyCustomLamp').mockResolvedValue(undefined);
    try {
      const { container } = render(LampEditor, {
        props: { lamp: mockLamp, room: defaultRoom(), onClose: vi.fn(), onOpenLampManager },
      });

      await waitFor(() => {
        expect(container.querySelector('#preset')).toBeTruthy();
      });

      const select = container.querySelector('#preset') as HTMLSelectElement;
      // Dropdown starts on the lamp's current preset.
      expect(select.value).toBe('beacon');

      await fireEvent.change(select, { target: { value: '__add_custom__' } });
      // The restore is deferred behind an `await tick()` in handleLampSelect (so
      // it lands in a *later* flush and is a real '__add_custom__' -> previous
      // state change that Svelte writes back to the DOM). Wait for that flush.
      await tick();

      // Opens the manager for this lamp's type, passing the launching lamp id.
      expect(onOpenLampManager).toHaveBeenCalledWith('krcl_222', 'lamp-1');
      // No photometry mutation whatsoever — no updateLamp, no applyCustomLamp.
      expect(updateSpy).not.toHaveBeenCalled();
      expect(applySpy).not.toHaveBeenCalled();
      // Dropdown visually restores to the previously-selected option.
      //
      // CAVEAT — this assertion cannot catch the real bug. jsdom + fireEvent do
      // NOT reproduce the Svelte 5 single-flush trap that broke this in the live
      // app: there, bind:value moved the <select> to '__add_custom__' and a
      // *synchronous* restore left the reactive value net-unchanged, so Svelte
      // never rewrote the DOM and the select stayed on "Add custom lamp...".
      // jsdom's event/flush model doesn't exhibit that, so this test passed even
      // against the buggy (synchronous-restore) code. The authoritative gate is
      // the real-browser check (see .superpowers/sdd/ux-round2-report.md): a
      // headless-Chromium synchronous post-flush read of the <select> shows the
      // stuck '__add_custom__' on the buggy build and the restored value on the
      // fixed build.
      expect(select.value).toBe('beacon');
    } finally {
      updateSpy.mockRestore();
      applySpy.mockRestore();
    }
  });

  it('re-derives the dropdown when the lamp gains a custom_lamp_id externally', async () => {
    // The new def's option must exist for the <select> to hold its value.
    customLampsW.set([{ id: 'c1', name: 'My 222 Lamp', lampType: 'krcl_222' }]);
    const { container, rerender } = render(LampEditor, {
      props: { lamp: mockLamp, room: defaultRoom(), onClose: vi.fn(), onOpenLampManager: vi.fn() },
    });

    await waitFor(() => {
      expect(container.querySelector('#preset')).toBeTruthy();
    });
    const select = container.querySelector('#preset') as HTMLSelectElement;
    expect(select.value).toBe('beacon');

    // Simulate an EXTERNAL store update (applyCustomLamp's echo after the
    // "Add custom lamp..." auto-apply) that sets custom_lamp_id on the instance.
    await rerender({
      lamp: { ...mockLamp, custom_lamp_id: 'c1', preset_id: 'custom' },
      room: defaultRoom(),
      onClose: vi.fn(),
      onOpenLampManager: vi.fn(),
    });
    await tick();

    await waitFor(() => expect(select.value).toBe('custom_lamp:c1'));
  });

  it('custom lamp options render for matching type only', async () => {
    customLampsW.set([
      { id: 'c1', name: 'My 222 Lamp', lampType: 'krcl_222' },
      { id: 'c2', name: 'My 254 Lamp', lampType: 'lp_254' },
    ]);

    const { container } = render(LampEditor, {
      props: { lamp: mockLamp, room: defaultRoom(), onClose: vi.fn(), onOpenLampManager: vi.fn() },
    });

    await waitFor(() => {
      expect(container.querySelector('#preset')).toBeTruthy();
    });

    const options = Array.from(container.querySelectorAll('#preset option')).map((o) => o.textContent);
    expect(options).toContain('My 222 Lamp');
    expect(options).not.toContain('My 254 Lamp');
  });

  it('selecting a custom lamp calls project.applyCustomLamp', async () => {
    customLampsW.set([{ id: 'c1', name: 'My 222 Lamp', lampType: 'krcl_222' }]);
    const applySpy = vi.spyOn(project, 'applyCustomLamp').mockResolvedValue(undefined);
    try {
      const { container } = render(LampEditor, {
        props: { lamp: mockLamp, room: defaultRoom(), onClose: vi.fn(), onOpenLampManager: vi.fn() },
      });

      await waitFor(() => {
        expect(container.querySelector('#preset')).toBeTruthy();
      });

      const select = container.querySelector('#preset') as HTMLSelectElement;
      await fireEvent.change(select, { target: { value: 'custom_lamp:c1' } });

      expect(applySpy).toHaveBeenCalledWith('lamp-1', 'c1');
    } finally {
      applySpy.mockRestore();
    }
  });

  it('changing lamp type clears a stale custom_lamp_id reference', async () => {
    const updateSpy = vi.spyOn(project, 'updateLamp').mockImplementation(() => {});
    try {
      const lampWithCustom: LampInstance = { ...mockLamp, custom_lamp_id: 'c1' };
      const { container } = render(LampEditor, {
        props: { lamp: lampWithCustom, room: defaultRoom(), onClose: vi.fn(), onOpenLampManager: vi.fn() },
      });

      await waitFor(() => {
        expect(container.querySelector('#lamp-type')).toBeTruthy();
      });

      const select = container.querySelector('#lamp-type') as HTMLSelectElement;
      await fireEvent.change(select, { target: { value: 'lp_254' } });

      await waitFor(() => {
        expect(updateSpy).toHaveBeenCalledWith(
          'lamp-1',
          expect.objectContaining({ custom_lamp_id: undefined })
        );
      });
    } finally {
      updateSpy.mockRestore();
    }
  });

  it('switching a preset lamp to another type drops its photometry, so no web or info is requested', async () => {
    const updateSpy = vi.spyOn(project, 'updateLamp').mockImplementation(() => {});
    try {
      const { container } = render(LampEditor, {
        props: { lamp: { ...mockLamp, ies_filename: 'beacon.ies' }, room: defaultRoom(), onClose: vi.fn(), onOpenLampManager: vi.fn() },
      });
      await waitFor(() => expect(container.querySelector('#lamp-type')).toBeTruthy());
      await fireEvent.change(container.querySelector('#lamp-type') as HTMLSelectElement, { target: { value: 'lp_254' } });

      await waitFor(() => expect(updateSpy).toHaveBeenCalled());
      const [, partial] = updateSpy.mock.calls[0];
      expect(partial).toMatchObject({ lamp_type: 'lp_254', preset_id: 'custom', has_ies_file: false });
      // The lamp the store then holds has no web source: Lamp3D and the info panel skip it
      expect(photometricWebSource({ ...mockLamp, ...partial } as LampInstance)).toBe('none');
    } finally {
      updateSpy.mockRestore();
    }
  });

  describe('Other lamp wavelength row', () => {
    const otherLamp: LampInstance = {
      ...mockLamp,
      id: 'lamp-other',
      lamp_type: 'other',
      preset_id: 'custom',
      wavelength: 265,
      custom_lamp_id: 'def-1',
    };

    it('shows the wavelength and writes an edit straight to the store', async () => {
      const updateSpy = vi.spyOn(project, 'updateLamp').mockImplementation(() => {});
      try {
        const { container } = render(LampEditor, {
          props: { lamp: otherLamp, room: defaultRoom(), onClose: vi.fn(), onOpenLampManager: vi.fn() },
        });
        await waitFor(() => expect(container.querySelector('#lamp-wavelength')).toBeTruthy());
        const input = container.querySelector('#lamp-wavelength') as HTMLInputElement;
        expect(input.value).toBe('265');
        expect(input.disabled).toBe(false);

        await fireEvent.change(input, { target: { value: '270' } });
        expect(updateSpy).toHaveBeenCalledWith('lamp-other', { wavelength: 270 });

        // Garbage and unchanged values do not round-trip to the backend
        updateSpy.mockClear();
        await fireEvent.change(input, { target: { value: '' } });
        await fireEvent.change(input, { target: { value: '-5' } });
        await fireEvent.change(input, { target: { value: '265' } });
        expect(updateSpy).not.toHaveBeenCalled();
      } finally {
        updateSpy.mockRestore();
      }
    });

    it('locks the input when the spectrum peak defines the wavelength', async () => {
      const { container } = render(LampEditor, {
        props: {
          lamp: { ...otherLamp, has_spectrum_file: true, wavelength_from_spectrum: true, spectrum_filename: 'peak.csv' },
          room: defaultRoom(), onClose: vi.fn(), onOpenLampManager: vi.fn(),
        },
      });
      await waitFor(() => expect(container.querySelector('#lamp-wavelength')).toBeTruthy());
      expect((container.querySelector('#lamp-wavelength') as HTMLInputElement).disabled).toBe(true);
      expect(container.textContent).toContain('from spectrum peak');
      expect(container.textContent).toContain('peak.csv');
    });

    it('Spectrum... opens the manager on the lamp\'s own definition', async () => {
      const onOpenLampManager = vi.fn();
      render(LampEditor, {
        props: { lamp: otherLamp, room: defaultRoom(), onClose: vi.fn(), onOpenLampManager },
      });
      const btn = await screen.findByRole('button', { name: 'Spectrum...' });
      await fireEvent.click(btn);
      expect(onOpenLampManager).toHaveBeenCalledWith('other', 'lamp-other', 'def-1');
    });

    it('is absent for 222 nm lamps', async () => {
      const { container } = render(LampEditor, {
        props: { lamp: mockLamp, room: defaultRoom(), onClose: vi.fn(), onOpenLampManager: vi.fn() },
      });
      await waitFor(() => expect(container.querySelector('#preset')).toBeTruthy());
      expect(container.querySelector('#lamp-wavelength')).toBeNull();
    });
  });

  it('renders placement buttons', async () => {
    const { container } = render(LampEditor, {
      props: { lamp: mockLamp, room: defaultRoom(), onClose: vi.fn(), onOpenLampManager: vi.fn() },
    });

    await waitFor(() => {
      const buttons = container.querySelectorAll('button');
      const buttonTexts = Array.from(buttons).map(b => b.textContent?.trim());
      expect(buttonTexts).toContain('Downlight');
      expect(buttonTexts).toContain('Corner');
      expect(buttonTexts).toContain('Edge');
    });
  });

  it('renders Details button', async () => {
    render(LampEditor, {
      props: { lamp: mockLamp, room: defaultRoom(), onClose: vi.fn(), onOpenLampManager: vi.fn() },
    });

    await waitFor(() => {
      expect(screen.getByText('Details...')).toBeTruthy();
    });
  });

  it('shows error when API fails', async () => {
    vi.mocked(getLampOptions).mockRejectedValue(new Error('Failed to load'));

    render(LampEditor, {
      props: { lamp: mockLamp, room: defaultRoom(), onClose: vi.fn(), onOpenLampManager: vi.fn() },
    });

    await waitFor(() => {
      expect(screen.getByText(/Failed to load/)).toBeTruthy();
    });
  });

  it('renders position inputs after loading', async () => {
    render(LampEditor, {
      props: { lamp: mockLamp, room: defaultRoom(), onClose: vi.fn(), onOpenLampManager: vi.fn() },
    });

    await openFold('Geometry');
    expect(screen.getByText('Position (m)')).toBeTruthy();
  });

  it('moving the lamp carries its aim point along, in one store write', async () => {
    const updateSpy = vi.spyOn(project, 'updateLamp').mockImplementation(() => {});
    try {
      const lamp: LampInstance = { ...mockLamp, aimx: 4, aimy: 3, aimz: 0 };
      const { container } = render(LampEditor, {
        props: { lamp, room: defaultRoom(), onClose: vi.fn(), onOpenLampManager: vi.fn() },
      });
      await openFold('Geometry');
      const x = container.querySelectorAll('.vector-row')[0].querySelector('input') as HTMLInputElement;
      await fireEvent.change(x, { target: { value: '3' } });
      await fireEvent.blur(x);
      expect(updateSpy).toHaveBeenCalledTimes(1);
      expect(updateSpy).toHaveBeenCalledWith('lamp-1', { x: 3, y: 3, z: 2.5, aimx: 5, aimy: 3, aimz: 0 });
    } finally {
      updateSpy.mockRestore();
    }
  });

  it('shows a change made elsewhere at once and never writes it back', async () => {
    const updateSpy = vi.spyOn(project, 'updateLamp').mockImplementation(() => {});
    try {
      const { container, rerender } = render(LampEditor, {
        props: { lamp: mockLamp, room: defaultRoom(), onClose: vi.fn(), onOpenLampManager: vi.fn() },
      });
      await openFold('Geometry');
      await rerender({ lamp: { ...mockLamp, x: 1.5, aimx: 1.5 }, room: defaultRoom(), onClose: vi.fn(), onOpenLampManager: vi.fn() });
      await tick();
      const x = container.querySelectorAll('.vector-row')[0].querySelector('input') as HTMLInputElement;
      expect(parseFloat(x.value)).toBe(1.5);
      await new Promise((r) => setTimeout(r, 150));
      expect(updateSpy).not.toHaveBeenCalled();
    } finally {
      updateSpy.mockRestore();
    }
  });

  describe('redesigned panel', () => {
    it('dimmer writes scaling_factor', async () => {
      const updateSpy = vi.spyOn(project, 'updateLamp').mockImplementation(() => {});
      try {
        const { container } = renderEditor({ ...mockLamp, scaling_factor: 0.8 });
        await screen.findByText('Dimmer');
        const range = container.querySelector('.dimmer input[type="range"]') as HTMLInputElement;
        const box = container.querySelector('.dimmer input[type="number"]') as HTMLInputElement;
        expect(range.min).toBe('0');
        expect(range.max).toBe('100');
        expect(range.value).toBe('80');
        expect(box.value).toBe('80');

        await fireEvent.change(range, { target: { value: '50' } });
        expect(updateSpy).toHaveBeenCalledTimes(1);
        expect(updateSpy).toHaveBeenCalledWith('lamp-1', { scaling_factor: 0.5 });

        // The number box clamps to 0-100
        updateSpy.mockClear();
        await fireEvent.change(box, { target: { value: '150' } });
        expect(updateSpy).toHaveBeenCalledWith('lamp-1', { scaling_factor: 1 });
        await fireEvent.change(box, { target: { value: '-5' } });
        expect(updateSpy).toHaveBeenCalledWith('lamp-1', { scaling_factor: 0 });
      } finally {
        updateSpy.mockRestore();
      }
    });

    for (const mode of ['downlight', 'corner', 'edge', 'horizontal'] as const) {
      it(`placement pictograms re-place the lamp (${mode})`, async () => {
        const updateSpy = vi.spyOn(project, 'updateLamp').mockImplementation(() => {});
        vi.mocked(placeSessionLamp).mockResolvedValue({ x: 1, y: 1, z: 2.5, aimx: 3, aimy: 3, aimz: 0, angle: 0, position_index: 0 } as never);
        try {
          const { container } = renderEditor();
          await screen.findByText('Dimmer');
          const btn = container.querySelector(`button.placement[data-mode="${mode}"]`) as HTMLButtonElement;
          expect(btn).not.toBeNull();
          expect(btn.querySelector('svg')).not.toBeNull();
          await fireEvent.click(btn);
          await waitFor(() => expect(updateSpy).toHaveBeenCalled());
          expect(vi.mocked(placeSessionLamp).mock.calls.at(-1)?.slice(0, 2)).toEqual(['lamp-1', mode]);
          expect(updateSpy).toHaveBeenCalledWith('lamp-1', { x: 1, y: 1, z: 2.5, angle: 0, aimx: 3, aimy: 3, aimz: 0 });
        } finally {
          updateSpy.mockRestore();
        }
      });
    }

    it('placement buttons are labelled Downlight, Corner, Edge, Upper-room, with no Place label', async () => {
      const { container } = renderEditor();
      await screen.findByText('Dimmer');
      const labels = Array.from(container.querySelectorAll('button.placement')).map((b) => b.textContent?.trim());
      expect(labels).toEqual(['Downlight', 'Corner', 'Edge', 'Upper-room']);
      expect(screen.queryByText(/^Place$/)).toBeNull();
    });

    it('Geometry and Display are collapsed by default', async () => {
      const { container } = renderEditor();
      const geometry = await screen.findByRole('button', { name: 'Geometry' });
      const display = screen.getByRole('button', { name: 'Display' });
      expect(geometry.getAttribute('aria-expanded')).toBe('false');
      expect(display.getAttribute('aria-expanded')).toBe('false');
      expect(container.querySelector('.vector-row')).toBeNull();
      expect(container.querySelector('button.pick-position')).toBeNull();
      expect(screen.queryByText('Show label')).toBeNull();

      await fireEvent.click(geometry);
      expect(screen.getByText('Position (m)')).toBeTruthy();
      expect(screen.getByText('Aim point (m)')).toBeTruthy();
      expect(container.querySelector('button.pick-position')).not.toBeNull();
      expect(container.querySelector('button.pick-aim')).not.toBeNull();
      // Pick buttons sit at the right end of their rows
      const rows = container.querySelectorAll('.vector-row');
      expect(rows[0].lastElementChild?.classList.contains('pick-position')).toBe(true);
      expect(rows[1].lastElementChild?.classList.contains('pick-aim')).toBe(true);
      // Tilt, orientation and rotation are all shown together
      expect(screen.getByLabelText(/^Tilt/)).toBeTruthy();
      expect(screen.getByLabelText(/^Orientation/)).toBeTruthy();
      expect(screen.getByLabelText(/^Rotation/)).toBeTruthy();

      await fireEvent.click(display);
      expect(screen.getByText('Show label')).toBeTruthy();
      expect(screen.getByText('Show photometric web')).toBeTruthy();
    });

    it('tilt and orientation write the aim point', async () => {
      const updateSpy = vi.spyOn(project, 'updateLamp').mockImplementation(() => {});
      try {
        renderEditor();
        await openFold('Geometry');
        const tilt = screen.getByLabelText(/^Tilt/) as HTMLInputElement;
        expect(tilt.value).toBe('0.0');
        await fireEvent.change(tilt, { target: { value: '90' } });
        expect(updateSpy).toHaveBeenCalledTimes(1);
        const [, partial] = updateSpy.mock.calls[0];
        expect(partial).toMatchObject({ tilt: 90, orientation: 0 });
        // Level, towards +X: the aim lands on the far wall at lamp height
        expect((partial as LampInstance).aimz).toBeCloseTo(2.5);
        expect((partial as LampInstance).aimx).toBeGreaterThan(2);

        updateSpy.mockClear();
        await fireEvent.change(screen.getByLabelText(/^Rotation/), { target: { value: '45' } });
        expect(updateSpy).toHaveBeenCalledWith('lamp-1', { angle: 45 });
      } finally {
        updateSpy.mockRestore();
      }
    });

    it('no aim-preset row', async () => {
      const { container } = renderEditor();
      await openFold('Geometry');
      expect(container.querySelector('.aim-presets')).toBeNull();
      const texts = Array.from(container.querySelectorAll('button')).map((b) => b.textContent?.trim());
      expect(texts).not.toContain('Down');
      expect(texts).not.toContain('Horizontal');
      expect(texts).not.toContain('Set Tilt/Orientation');
      expect(texts).not.toContain('Set Aim Point');
      expect(container.textContent).not.toMatch(/Horizontal/);
    });

    it('no placement label is clipped', async () => {
      const { container } = renderEditor();
      await screen.findByText('Dimmer');
      const labels = Array.from(container.querySelectorAll('button.placement .placement-label')) as HTMLElement[];
      expect(labels).toHaveLength(4);
      for (const el of labels) {
        for (const node of [el, el.parentElement as HTMLElement]) {
          const cs = getComputedStyle(node);
          expect(cs.textOverflow).not.toBe('ellipsis');
          expect(cs.whiteSpace === 'nowrap' && cs.overflow === 'hidden').toBe(false);
        }
      }
    });
  });
});
