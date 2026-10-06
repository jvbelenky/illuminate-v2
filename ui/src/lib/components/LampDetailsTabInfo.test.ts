import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import type { LampInstance } from '$lib/types/project';

const { lampsStore, getSessionLampInfo } = vi.hoisted(() => {
  // vi.hoisted runs before imports, so build a minimal store by hand.
  function store<T>(initial: T) {
    let value = initial;
    const subs = new Set<(v: T) => void>();
    return {
      subscribe(fn: (v: T) => void) { subs.add(fn); fn(value); return () => subs.delete(fn); },
      set(v: T) { value = v; subs.forEach((fn) => fn(v)); },
    };
  }
  return { lampsStore: store<any[]>([]), getSessionLampInfo: vi.fn() };
});

vi.mock('$lib/stores/project', () => ({
  lamps: lampsStore,
  project: { getLampInfoCache: () => null },
}));
vi.mock('$lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/api/client')>();
  return { ...actual, getSessionLampInfo, getSessionLampPlots: vi.fn().mockResolvedValue({}) };
});

import LampDetailsTabInfo from './LampDetailsTabInfo.svelte';

function lamp(overrides: Partial<LampInstance> = {}): LampInstance {
  return {
    id: 'lamp-1', lamp_type: 'other', preset_id: 'custom', name: 'Custom',
    x: 1, y: 1, z: 2, aimx: 1, aimy: 1, aimz: 0,
    scaling_factor: 1, enabled: true, has_ies_file: false,
    ...overrides,
  };
}

const INFO = {
  lamp_id: 'lamp-1', name: 'Custom', total_power_mw: 0,
  tlv_acgih: { skin: 1, eye: 1 }, tlv_icnirp: { skin: 1, eye: 1 },
  has_ies: false, has_spectrum: false,
};

describe('LampDetailsTabInfo', () => {
  beforeEach(() => {
    getSessionLampInfo.mockReset().mockResolvedValue(INFO);
  });

  it('prompts for a wavelength or spectrum instead of fetching when the lamp has neither', async () => {
    lampsStore.set([lamp()]);
    render(LampDetailsTabInfo, { props: { lampId: 'lamp-1', lampName: 'Custom', hasIes: false, lampType: 'other' } });
    expect(await screen.findByText(/enter a wavelength or attach a spectrum/i)).toBeTruthy();
    expect(screen.queryByText(/no photometric or wavelength data/i)).toBeNull();
    expect(getSessionLampInfo).not.toHaveBeenCalled();
  });

  it('fetches once the lamp gains a wavelength', async () => {
    lampsStore.set([lamp()]);
    render(LampDetailsTabInfo, { props: { lampId: 'lamp-1', lampName: 'Custom', hasIes: false, lampType: 'other' } });
    await screen.findByText(/enter a wavelength or attach a spectrum/i);

    lampsStore.set([lamp({ wavelength: 265 })]);
    await waitFor(() => expect(getSessionLampInfo).toHaveBeenCalledWith('lamp-1'));
    await waitFor(() => expect(screen.queryByText(/enter a wavelength or attach a spectrum/i)).toBeNull());
  });

  it('fetches straight away for a lamp with a wavelength', async () => {
    lampsStore.set([lamp({ wavelength: 265 })]);
    render(LampDetailsTabInfo, { props: { lampId: 'lamp-1', lampName: 'Custom', hasIes: false, lampType: 'other' } });
    await waitFor(() => expect(getSessionLampInfo).toHaveBeenCalledWith('lamp-1'));
  });
});
