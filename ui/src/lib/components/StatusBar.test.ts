import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';

// Mock the project store to control lamps, zones, results
vi.mock('$lib/stores/project', () => {
  const { writable } = require('svelte/store');
  return {
    lamps: writable([]),
    zones: writable([]),
    results: writable(null),
  };
});

import StatusBar from './StatusBar.svelte';
import { lamps, zones, results } from '$lib/stores/project';

describe('StatusBar', () => {
  beforeEach(() => {
    (lamps as any).set([]);
    (zones as any).set([]);
    (results as any).set(null);
  });

  it('renders Ready indicator', () => {
    render(StatusBar);
    expect(screen.getByText('Ready')).toBeTruthy();
  });

  it('shows lamp count', () => {
    (lamps as any).set([{ id: '1' }, { id: '2' }]);
    render(StatusBar);
    expect(screen.getByText(/Lamps: 2/)).toBeTruthy();
  });

  it('shows zone count', () => {
    (zones as any).set([{ id: '1' }, { id: '2' }, { id: '3' }]);
    render(StatusBar);
    expect(screen.getByText(/Zones: 3/)).toBeTruthy();
  });

  it('shows guv-calcs version when provided', () => {
    render(StatusBar, { props: { guvCalcsVersion: '1.2.3' } });
    expect(screen.getByText(/1\.2\.3/)).toBeTruthy();
  });

  it('does not show version when null', () => {
    const { container } = render(StatusBar);
    expect(container.textContent).not.toContain('guv-calcs');
  });
});
