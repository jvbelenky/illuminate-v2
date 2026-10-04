import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import OccupancyBanner from './OccupancyBanner.svelte';

const ACGIH = { skin: 478.5, eye: 160.7 };
const ICNIRP = { skin: 23, eye: 23 };

describe('OccupancyBanner', () => {
  it('is green when both limits allow a full day', () => {
    // eye: 8·160.7/10 = 128.6 h; ICNIRP: 8·23/10 = 18.4 h
    render(OccupancyBanner, { props: { skinMax: 10, eyeMax: 10, acgih: ACGIH, icnirp: ICNIRP } });
    const banner = screen.getByTestId('occupancy-banner');
    expect(banner.classList.contains('ok')).toBe(true);
    expect(banner.textContent).toContain('Within ACGIH and ICNIRP limits all day');
    expect(screen.getByTestId('hours-acgih').textContent).toContain('Indefinite (128.6 h)');
    expect(screen.getByTestId('hours-icnirp').textContent).toContain('Indefinite (18.4 h)');
  });

  it('stays green on the ACGIH limit alone; the ICNIRP column carries its own colour', () => {
    // eye: 8·160.7/100 = 12.9 h; ICNIRP: 8·23/100 = 1.8 h
    render(OccupancyBanner, { props: { skinMax: 100, eyeMax: 100, acgih: ACGIH, icnirp: ICNIRP } });
    const banner = screen.getByTestId('occupancy-banner');
    expect(banner.classList.contains('ok')).toBe(true);
    expect(banner.textContent).toContain('Within the ACGIH limit all day');
    expect(screen.getByTestId('hours-acgih').classList.contains('ok')).toBe(true);
    expect(screen.getByTestId('hours-icnirp').classList.contains('limited')).toBe(true);
  });

  it('states the ACGIH hours when neither limit allows a full day, never "does not comply"', () => {
    // eye: 8·160.7/800 = 1.6 h; ICNIRP: 8·23/800 = 0.23 h
    render(OccupancyBanner, { props: { skinMax: 800, eyeMax: 800, acgih: ACGIH, icnirp: ICNIRP } });
    const banner = screen.getByTestId('occupancy-banner');
    expect(banner.classList.contains('limited')).toBe(true);
    // ACGIH eye: 8·160.7/800 = 1.6 h is the headline, not the stricter ICNIRP figure
    expect(banner.textContent).toContain('Safe to occupy for 1.6 h per day (ACGIH limit)');
    expect(document.body.textContent).not.toMatch(/does not comply/i);
  });

  it('renders nothing without doses', () => {
    render(OccupancyBanner, { props: { skinMax: null, eyeMax: null, acgih: ACGIH, icnirp: ICNIRP } });
    expect(screen.queryByTestId('occupancy-banner')).toBeNull();
  });
});
