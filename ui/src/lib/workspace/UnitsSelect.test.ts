import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import UnitsSelect from './UnitsSelect.svelte';

const options = () => [...(screen.getByTitle('Units') as HTMLSelectElement).options].map((o) => o.textContent);

describe('UnitsSelect', () => {
  it('names the units in full', () => {
    render(UnitsSelect, { props: { units: 'meters', onchange: vi.fn() } });
    expect(options()).toEqual(['meters', 'centimeters', 'millimeters', 'feet', 'inches']);
  });

  it('compact (a narrow main view): abbreviations, same values', () => {
    render(UnitsSelect, { props: { units: 'feet', onchange: vi.fn(), compact: true } });
    const select = screen.getByTitle('Units') as HTMLSelectElement;
    expect(options()).toEqual(['m', 'cm', 'mm', 'ft', 'in']);
    expect(select.value).toBe('feet');
  });
});
