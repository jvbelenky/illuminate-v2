import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import FixtureConfirmDialog from './FixtureConfirmDialog.svelte';
import type { FixtureDraft } from '$lib/utils/housingGeometry';

// jsdom has no WebGL: stub the Threlte canvas and the scene.
vi.mock('@threlte/core', async () => {
  const Stub = (await import('./test/Stub.svelte')).default;
  return { Canvas: Stub, T: {}, useThrelte: () => ({ scene: {} }), useTask: () => {} };
});
vi.mock('./FixtureScene.svelte', async () => ({
  default: (await import('./test/Stub.svelte')).default,
}));

// UV-FLOW style four-way ceiling unit: 0.58 x 0.58 x 0.12 m luminous opening
const analysis = {
  suggested_axis: 'down', axis_scores: {}, vertices: [], triangles: [],
  extents_by_axis: { down: { length: 0.58, width: 0.58, height: 0.12 } },
} as any;

const draft: FixtureDraft = { axis: 'down', face: 'top', roll: 0, offset: null };

function setup() {
  const onaccept = vi.fn();
  const onedit = vi.fn();
  render(FixtureConfirmDialog, {
    props: {
      draft, analysis: { ...analysis, total_power_mw: 42.5 }, units: 'meters', color: '#55aaff',
      plot: 'UExPVA==', onaccept, onedit,
    } as any,
  });
  return { onaccept, onedit };
}

describe('FixtureConfirmDialog', () => {
  it('asks whether the detected fixture looks right, and says what was detected', () => {
    setup();
    expect(screen.getByText('Does this look right?')).toBeTruthy();
    expect(screen.getByText('Mounted on the ceiling')).toBeTruthy();
    // luminous opening and the housing it defaults to
    expect(screen.getAllByText('0.58 × 0.58 × 0.12 m')).toHaveLength(2);
    expect(screen.getByText('0.06 m from mounting point')).toBeTruthy();
  });

  it('shows the photometric distribution and total power beside the fixture', () => {
    setup();
    expect(document.querySelector('img.photometric-plot')!.getAttribute('src')).toBe('data:image/png;base64,UExPVA==');
    expect(screen.getByText('42.5 mW')).toBeTruthy();
  });

  it('accepting keeps the detected settings', async () => {
    const { onaccept, onedit } = setup();
    await fireEvent.click(screen.getByRole('button', { name: 'Looks right' }));
    expect(onaccept).toHaveBeenCalledOnce();
    expect(onedit).not.toHaveBeenCalled();
  });

  it('asking for changes opens the editor', async () => {
    const { onaccept, onedit } = setup();
    await fireEvent.click(screen.getByRole('button', { name: 'No, I need to make changes' }));
    expect(onedit).toHaveBeenCalledOnce();
    expect(onaccept).not.toHaveBeenCalled();
  });
});
