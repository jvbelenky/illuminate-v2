import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';

// Mock the project store to control results
vi.mock('$lib/stores/project', async () => {
  const { writable } = await import('svelte/store');
  return {
    results: writable(null),
  };
});

// The next-step hint is a derived store over the whole project; stub it so this
// test stays about the bar itself.
vi.mock('$lib/stores/nextStep', async () => {
  const { writable } = await import('svelte/store');
  return {
    nextStep: writable({ id: 'no-lamps', tone: 'info', step: 2, title: 'Add a lamp to begin', detail: 'Place a lamp.' }),
  };
});

import StatusBar from './StatusBar.svelte';
import { results } from '$lib/stores/project';

describe('StatusBar', () => {
  beforeEach(() => {
    (results as any).set(null);
  });

  it('shows only the version info before anything is calculated', () => {
    const { container } = render(StatusBar, { props: { appVersion: '0.5.0', guvCalcsVersion: '1.2.3' } });
    expect(container.textContent).not.toMatch(/Ready|Lamps:|Zones:|Obstacles:|Add a lamp/);
    expect(screen.queryByText(/Last calculated/)).toBeNull();
    expect(screen.getByText(/illuminate v0\.5\.0/)).toBeTruthy();
    expect(screen.getByText(/1\.2\.3/)).toBeTruthy();
  });

  it('shows the last-calculated time once results exist', () => {
    (results as any).set({ calculatedAt: '2026-10-05T10:30:00.000Z', zones: {} });
    render(StatusBar);
    expect(screen.getByText(/Last calculated:/)).toBeTruthy();
  });

  it('exposes the next-step state as a data attribute without rendering its text', () => {
    const { container } = render(StatusBar);
    const bar = container.querySelector('.app-status-bar')!;
    expect(bar.getAttribute('data-next-step')).toBe('no-lamps');
    expect(bar.textContent).not.toContain('Add a lamp to begin');
  });

  it('does not show version when null', () => {
    const { container } = render(StatusBar);
    expect(container.textContent).not.toContain('guv-calcs');
  });
});
