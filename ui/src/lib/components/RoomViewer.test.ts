import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import RoomViewer from './RoomViewer.svelte';
import { ROOM_DEFAULTS } from '$lib/types/project';

vi.mock('@threlte/core', async () => {
  const Stub = (await import('./test/Stub.svelte')).default;
  return { Canvas: Stub, T: {}, useThrelte: () => ({ scene: {} }), useTask: () => {} };
});
vi.mock('./Scene.svelte', async () => ({
  default: (await import('./test/SceneSpy.svelte')).default,
}));

const room = { ...ROOM_DEFAULTS } as any;
const sceneProps = () => (globalThis as any).__sceneProps as Record<string, unknown>;

describe('RoomViewer', () => {
  it('shows the view tools bottom right by default, after the units select', async () => {
    const unitsSelect = createRawSnippet(() => ({ render: () => '<select title="Units" aria-label="Units"></select>' }));
    const { container } = render(RoomViewer, { props: { room, lamps: [], onLampClick: vi.fn(), unitsSelect } });
    await tick();
    const tools = container.querySelector('.view-tools-3d')!;
    expect(tools).not.toBeNull();
    expect(tools.firstElementChild?.getAttribute('title')).toBe('Units');
    for (const name of ['View presets', 'Orthographic', 'Open in new window', 'Save as image']) {
      expect(screen.getByRole('button', { name }).classList.contains('mv-btn')).toBe(true);
    }
    // The old floating label is gone
    expect(container.querySelector('.units-label')).toBeNull();
    // The presets open as a 3x3 grid
    expect(container.querySelector('.presets')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'View presets' }));
    expect(container.querySelectorAll('.presets .preset')).toHaveLength(9);
    await fireEvent.click(screen.getByRole('button', { name: 'Top (plan view)' }));
    expect(container.querySelector('.presets')).toBeNull();
    expect(container.querySelector('.viewer-container')!.classList.contains('mini')).toBe(false);
    expect(sceneProps().interactive).not.toBe(false);
    expect(typeof sceneProps().onLampClick).toBe('function');
  });

  it('mini hides view snap, projection toggle and actions', async () => {
    const clicks = { onLampClick: vi.fn(), onZoneClick: vi.fn(), onObjectClick: vi.fn() };
    const { container } = render(RoomViewer, { props: { room, lamps: [], mini: true, ...clicks } });
    await tick();
    expect(container.querySelector('.view-tools-3d')).toBeNull();
    expect(container.querySelector('.proj-toggle')).toBeNull();
    expect(container.querySelector('.viewer-container')!.classList.contains('mini')).toBe(true);
    // Clicks select nothing and pick no surface; orbit stays (the controls live in Scene)
    expect(sceneProps().interactive).toBe(false);
    for (const k of ['onLampClick', 'onZoneClick', 'onObjectClick']) (sceneProps()[k] as (id: string) => void)('x');
    for (const fn of Object.values(clicks)) expect(fn).not.toHaveBeenCalled();
  });
});
