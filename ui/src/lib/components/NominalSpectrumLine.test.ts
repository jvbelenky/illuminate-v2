import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import NominalSpectrumLine from './NominalSpectrumLine.svelte';

const text = () => document.querySelector('svg')!.textContent!.replace(/\s+/g, ' ');

describe('NominalSpectrumLine', () => {
  it('marks a lamp type\'s line as assumed', () => {
    render(NominalSpectrumLine, { props: { wavelength: 254, color: '#5aa9ff' } });
    expect(text()).toMatch(/254 nm \(assumed\)/);
  });

  it('marks a typed wavelength as entered', () => {
    render(NominalSpectrumLine, { props: { wavelength: 265, color: '#5aa9ff', tag: 'entered' } });
    expect(text()).toMatch(/265 nm \(entered\)/);
  });

  it('without a wavelength asks for one', () => {
    render(NominalSpectrumLine, { props: { wavelength: null, color: '#999' } });
    expect(text()).toMatch(/Enter a wavelength,\s*or add a spectrum file/);
  });

  it('with axes, labels relative intensity and wavelength', () => {
    render(NominalSpectrumLine, { props: { wavelength: 222, color: '#a97cff', axes: true } });
    expect(text()).toMatch(/Relative intensity/);
    expect(text()).toMatch(/Wavelength \(nm\)/);
    expect(text()).toMatch(/0\.5/);
  });
});
