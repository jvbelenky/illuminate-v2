import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
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
  it('shows view snap, projection toggle, units and actions by default', async () => {
    const { container } = render(RoomViewer, { props: { room, lamps: [], onLampClick: vi.fn() } });
    await tick();
    expect(container.querySelector('.view-overlay')).not.toBeNull();
    expect(container.querySelector('.proj-toggle')).not.toBeNull();
    expect(container.querySelector('.units-label')).not.toBeNull();
    expect(container.querySelector('.viewer-actions')).not.toBeNull();
    expect(container.querySelector('.viewer-container')!.classList.contains('mini')).toBe(false);
    expect(sceneProps().interactive).not.toBe(false);
    expect(typeof sceneProps().onLampClick).toBe('function');
  });

  it('mini hides view snap, projection toggle and actions', async () => {
    const clicks = { onLampClick: vi.fn(), onZoneClick: vi.fn(), onObjectClick: vi.fn() };
    const { container } = render(RoomViewer, { props: { room, lamps: [], mini: true, ...clicks } });
    await tick();
    expect(container.querySelector('.view-overlay')).toBeNull();
    expect(container.querySelector('.proj-toggle')).toBeNull();
    expect(container.querySelector('.units-label')).toBeNull();
    expect(container.querySelector('.viewer-actions')).toBeNull();
    expect(container.querySelector('.viewer-container')!.classList.contains('mini')).toBe(true);
    // Clicks select nothing and pick no surface; orbit stays (the controls live in Scene)
    expect(sceneProps().interactive).toBe(false);
    for (const k of ['onLampClick', 'onZoneClick', 'onObjectClick']) (sceneProps()[k] as (id: string) => void)('x');
    for (const fn of Object.values(clicks)) expect(fn).not.toHaveBeenCalled();
  });
});
