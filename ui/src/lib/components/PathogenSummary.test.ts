import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { get } from 'svelte/store';
import PathogenSummary from './PathogenSummary.svelte';
import { userSettings } from '$lib/stores/settings';
import type { EfficacyRow } from '$lib/utils/efficacy-filters';

// Two aerosol species at 222 nm with simple single-exponential kinetics
function row(species: string, k1: number, wavelength = 222, medium = 'Aerosol'): EfficacyRow {
  return {
    category: 'Viruses', species, strain: '', wavelength, k1, k2: null, resistant_fraction: 0,
    medium, condition: '', reference: '', link: '',
  } as unknown as EfficacyRow;
}

const rows = [row('Human coronavirus', 1.0), row('Influenza virus', 2.0), row('E. coli', 3.0, 222, 'Surface')];
const bact = { ...row('Staphylococcus aureus', 4.0), category: 'Bacteria' } as unknown as EfficacyRow;
const rowsWithBacteria = [...rows, bact];

describe('PathogenSummary', () => {
  beforeEach(() => {
    userSettings.update(s => ({ ...s, summarySpecies: 'Human coronavirus' }));
  });

  it('defaults to Human coronavirus and lists only aerosol species with data', () => {
    render(PathogenSummary, { props: { rows, fluenceDict: { 222: 1 }, avgFluence: 1, volumeM3: 100 } });
    const select = screen.getByLabelText('For') as HTMLSelectElement;
    expect(select.value).toBe('Human coronavirus');
    expect([...select.querySelectorAll('optgroup[label="Species"] option')].map(o => (o as HTMLOptionElement).value)).toEqual(['Human coronavirus', 'Influenza virus']);
  });

  it('computes eACH, CADR and reduction times from the wired-in kinetics', () => {
    render(PathogenSummary, { props: { rows, fluenceDict: { 222: 1 }, avgFluence: 1, volumeM3: 100 } });
    // eACH = k1 · I · 3.6 = 3.6 /h; CADR = 3.6·100·1000/3600 = 100 lps; 3.6·3531.47/60 = 211.9 cfm
    expect(screen.getByTestId('each').textContent).toBe('3.6');
    expect(screen.getByTestId('cadr').textContent?.trim()).toBe('212CFM');
    expect(screen.getByTestId('cadr-lps').textContent?.trim()).toBe('(100 LPS)');
    // 90% at ln(10)/(k·I/1000) = 2302.6 s = 38.4 min; 99% 4605 s = 1.3 h; 99.9% 1.9 h
    expect(screen.getByTestId('t90').textContent).toBe('38.4 min');
    expect(screen.getByTestId('t99').textContent).toBe('1.3 h');
    expect(screen.getByTestId('t999').textContent).toBe('1.9 h');
  });

  it('switching the pathogen recomputes and persists the choice', async () => {
    render(PathogenSummary, { props: { rows, fluenceDict: { 222: 1 }, avgFluence: 1, volumeM3: 100 } });
    await fireEvent.change(screen.getByLabelText('For'), { target: { value: 'Influenza virus' } });
    expect(screen.getByTestId('each').textContent).toBe('7.2');
    expect(get(userSettings).summarySpecies).toBe('Influenza virus');
  });

  it('offers category groups and shows the median across the group, noting the count', async () => {
    render(PathogenSummary, { props: { rows: rowsWithBacteria, fluenceDict: { 222: 1 }, avgFluence: 1, volumeM3: 100 } });
    const select = screen.getByLabelText('For') as HTMLSelectElement;
    const groups = [...select.querySelectorAll('optgroup[label="Groups"] option')].map(o => o.textContent);
    expect(groups).toEqual(['All airborne pathogens (3)', 'All bacteria (1)', 'All viruses (2)']);
    // Viruses: eACH 3.6 and 7.2 → median 5.4
    await fireEvent.change(select, { target: { value: 'group:Viruses' } });
    expect(screen.getByTestId('each').textContent).toBe('5.4');
    // All three: 3.6, 7.2, 14.4 → median 7.2
    await fireEvent.change(select, { target: { value: 'group:all' } });
    expect(screen.getByTestId('each').textContent).toBe('7.2');
    await fireEvent.change(select, { target: { value: 'group:Bacteria' } });
    expect(screen.getByTestId('each').textContent).toBe('14.4');
  });

  it('explains when the lamp wavelength has no data', () => {
    render(PathogenSummary, { props: { rows, fluenceDict: { 280: 1 }, avgFluence: 1, volumeM3: 100, missingWavelengths: [280] } });
    expect(screen.getByText('No inactivation data at 280 nm')).toBeTruthy();
    expect(screen.getByTestId('each').textContent).toBe('—');
  });
});
