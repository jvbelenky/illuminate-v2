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

import { getLampOptions } from '$lib/api/client';
import { customLamps } from '$lib/stores/lampLibrary';
import { project } from '$lib/stores/project';
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

    await waitFor(() => {
      expect(screen.getByText('Position (m)')).toBeTruthy();
    });
  });
});
