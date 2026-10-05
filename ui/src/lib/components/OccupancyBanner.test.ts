import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import OccupancyBanner from './OccupancyBanner.svelte';

// Fractions of the TLV reached in 8 h for a 222 nm lamp at a given max dose
const ACGIH = { skin: 478.5, eye: 160.7 };
const ICNIRP = { skin: 23, eye: 23 };
const at = (dose: number) => ({
  acgih: { skin: dose / ACGIH.skin, eye: dose / ACGIH.eye },
  icnirp: { skin: dose / ICNIRP.skin, eye: dose / ICNIRP.eye },
});

describe('OccupancyBanner', () => {
  it('is green when both limits allow a full day', () => {
    // eye: 8·160.7/10 = 128.6 h; ICNIRP: 8·23/10 = 18.4 h
    render(OccupancyBanner, { props: at(10) });
    const banner = screen.getByTestId('occupancy-banner');
    expect(banner.classList.contains('ok')).toBe(true);
    expect(banner.textContent).toContain('Within ACGIH and ICNIRP limits all day');
    expect(screen.getByTestId('hours-acgih').textContent).toContain('Indefinite (128.6 h)');
    expect(screen.getByTestId('hours-icnirp').textContent).toContain('Indefinite (18.4 h)');
  });

  it('stays green on the ACGIH limit alone; the ICNIRP column carries its own colour', () => {
    // eye: 8·160.7/100 = 12.9 h; ICNIRP: 8·23/100 = 1.8 h
    render(OccupancyBanner, { props: at(100) });
    const banner = screen.getByTestId('occupancy-banner');
    expect(banner.classList.contains('ok')).toBe(true);
    expect(banner.textContent).toContain('Within the ACGIH limit all day');
    expect(screen.getByTestId('hours-acgih').classList.contains('ok')).toBe(true);
    expect(screen.getByTestId('hours-icnirp').classList.contains('limited')).toBe(true);
  });

  it('states the ACGIH hours when neither limit allows a full day, never "does not comply"', () => {
    // eye: 8·160.7/800 = 1.6 h; ICNIRP: 8·23/800 = 0.23 h
    render(OccupancyBanner, { props: at(800) });
    const banner = screen.getByTestId('occupancy-banner');
    expect(banner.classList.contains('limited')).toBe(true);
    // ACGIH eye: 8·160.7/800 = 1.6 h is the headline, not the stricter ICNIRP figure
    expect(banner.textContent).toContain('Safe to occupy for 1.6 h per day (ACGIH limit)');
    expect(document.body.textContent).not.toMatch(/does not comply/i);
  });

  it('weighs a weak 254 nm lamp by its dose, not by its TLV', () => {
    // 222 nm lamp at 100 mJ/cm² plus a 254 nm lamp at 0.5 mJ/cm² (ACGIH eye TLV 6):
    // eye 100/160.7 + 0.5/6 = 0.706 → 11.3 h. Judging all 100.5 mJ/cm² against
    // the 254 nm TLV would have given 29 minutes.
    const acgih = { skin: 100 / 478.5 + 0.5 / 10, eye: 100 / 160.7 + 0.5 / 6 };
    const icnirp = { skin: 100 / 23 + 0.5 / 6, eye: 100 / 23 + 0.5 / 6 };
    render(OccupancyBanner, { props: { acgih, icnirp } });
    expect(screen.getByTestId('hours-acgih').textContent).toContain('Indefinite (11.3 h)');
    expect(screen.getByTestId('occupancy-banner').textContent).toContain('Within the ACGIH limit all day');
  });

  it('renders nothing without exposure', () => {
    render(OccupancyBanner, { props: { acgih: null, icnirp: null } });
    expect(screen.queryByTestId('occupancy-banner')).toBeNull();
  });
});
