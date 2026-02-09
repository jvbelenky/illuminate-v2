import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import EfficacyStatsBar from './EfficacyStatsBar.svelte';

describe('EfficacyStatsBar', () => {
  const defaultStats = {
    median: 12.345,
    min: 1.234,
    max: 99.876,
    count: 42,
  };

  it('renders median value', () => {
    render(EfficacyStatsBar, { props: { stats: defaultStats } });
    expect(screen.getByText(/12\.35/)).toBeTruthy();
  });

  it('renders range', () => {
    render(EfficacyStatsBar, { props: { stats: defaultStats } });
    expect(screen.getByText(/1\.23/)).toBeTruthy();
    expect(screen.getByText(/99\.88/)).toBeTruthy();
  });

  it('renders count', () => {
    render(EfficacyStatsBar, { props: { stats: defaultStats } });
    expect(screen.getByText(/42/)).toBeTruthy();
  });

  it('handles zero values', () => {
    const zeroStats = { median: 0, min: 0, max: 0, count: 0 };
    const { container } = render(EfficacyStatsBar, { props: { stats: zeroStats } });
    // Zero values should render without crashing
    expect(container.textContent).toContain('0');
  });
});
