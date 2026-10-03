import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import OccupancyBanner from './OccupancyBanner.svelte';

const ACGIH = { skin: 478.5, eye: 160.7 };
const ICNIRP = { skin: 23, eye: 23 };
const acgihStandard = 'ANSI IES RP 27.1-22 (ACGIH Limits)' as const;

describe('OccupancyBanner', () => {
  it('is green with Indefinite when a full day is within the ACGIH TLV, and still shows ICNIRP hours', () => {
    // eye: 8·160.7/100 = 12.9 h (limiting); ICNIRP: 8·23/100 = 1.8 h
    render(OccupancyBanner, { props: { skinMax: 100, eyeMax: 100, acgih: ACGIH, icnirp: ICNIRP, standard: acgihStandard } });
    const banner = screen.getByTestId('occupancy-banner');
    expect(banner.classList.contains('ok')).toBe(true);
    expect(banner.textContent).toContain('Continuous occupancy is within the ACGIH TLV');
    expect(screen.getByTestId('hours-acgih').textContent).toContain('Indefinite (12.9 h)');
    expect(screen.getByTestId('hours-acgih').classList.contains('ok')).toBe(true);
    expect(screen.getByTestId('hours-icnirp').textContent).toContain('1.8 h');
    expect(screen.getByTestId('hours-icnirp').classList.contains('limited')).toBe(true);
  });

  it('is yellow and states the safe hours when under 8 h, never "does not comply"', () => {
    // eye: 8·160.7/800 = 1.6 h
    render(OccupancyBanner, { props: { skinMax: 800, eyeMax: 800, acgih: ACGIH, icnirp: ICNIRP, standard: acgihStandard } });
    const banner = screen.getByTestId('occupancy-banner');
    expect(banner.classList.contains('limited')).toBe(true);
    expect(banner.textContent).toContain('Safe to occupy for 1.6 hours per day');
    expect(document.body.textContent).not.toMatch(/does not comply/i);
  });

  it('uses the ICNIRP limit for the headline when that standard is selected', () => {
    render(OccupancyBanner, { props: { skinMax: 10, eyeMax: 10, acgih: ACGIH, icnirp: ICNIRP, standard: 'IEC 62471-6:2022 (ICNIRP Limits)' } });
    // 8·23/10 = 18.4 h
    expect(screen.getByTestId('occupancy-banner').textContent).toContain('ICNIRP limit');
    expect(screen.getByTestId('hours-icnirp').textContent).toContain('Indefinite (18.4 h)');
  });

  it('renders nothing without doses', () => {
    render(OccupancyBanner, { props: { skinMax: null, eyeMax: null, acgih: ACGIH, icnirp: ICNIRP, standard: acgihStandard } });
    expect(screen.queryByTestId('occupancy-banner')).toBeNull();
  });
});
