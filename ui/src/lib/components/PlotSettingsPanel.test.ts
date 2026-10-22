import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import PlotSettingsPanel from './PlotSettingsPanel.svelte';
import { buildColorScale, limitSet, resolvePlotSettings } from '$lib/utils/plotScale';
import type { ZonePlotSettings } from '$lib/types/project';

function setup(stored: ZonePlotSettings, opts: { kind?: 'plane' | 'volume'; limit?: number | null } = {}) {
  const kind = opts.kind ?? 'plane';
  const settings = resolvePlotSettings(kind, stored);
  const limits = opts.limit ? limitSet([{ name: 'ACGIH Eye', value: opts.limit }, { name: 'ICNIRP', value: 0.7 }]) : null;
  const scale = buildColorScale(settings, { min: 0.3, max: 9 }, 'plasma', limits);
  const onChange = vi.fn();
  render(PlotSettingsPanel, { props: { kind, settings, scale, limits, unitLabel: 'µW/cm²', defaultTitle: 'Eye Dose', onChange } });
  return { onChange, scale };
}

const preset = () => screen.getByRole('combobox', { name: 'Level preset' }) as HTMLSelectElement;
const presetNames = () => Array.from(preset().options).map((o) => o.textContent?.trim());

describe('PlotSettingsPanel', () => {
  it('switches the view', async () => {
    const { onChange } = setup({});
    await fireEvent.click(screen.getByRole('button', { name: 'Contours' }));
    expect(onChange).toHaveBeenCalledWith({ view: 'contours' });
  });

  it('offers a volume only its isosurfaces, with their levels', () => {
    setup({}, { kind: 'volume' });
    expect(screen.queryByRole('button', { name: 'Heatmap' })).toBeNull();
    expect(screen.getAllByLabelText(/^Level \d/).length).toBeGreaterThan(0);
  });

  it('has no level list or colors toggle for a heatmap', () => {
    setup({});
    expect(screen.queryByText('+ Add level')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Continuous' })).toBeNull();
  });

  it('keeps the number of levels when switching back to Auto', async () => {
    const { onChange } = setup({ view: 'contours', levelsSource: 'custom', levels: [1, 2, 3, 4, 5, 6] });
    await fireEvent.change(preset(), { target: { value: 'auto' } });
    expect(onChange).toHaveBeenCalledWith({ levelsSource: 'auto', levelCount: 6, colors: [], labels: [] });
  });

  it('offers Limits and its percentages only when the zone has a limit', () => {
    setup({ view: 'contours' });
    expect(presetNames()).toEqual(['Auto']);
  });

  it('offers a percentage preset for each limit the zone has', () => {
    setup({ view: 'contours' }, { limit: 5 });
    expect(presetNames()).toEqual(['Auto', 'Limits', '% ICNIRP', '% ACGIH Eye']);
  });

  it('steps a percentage preset up to its limit in the levels shown', async () => {
    const { onChange } = setup({ view: 'contours', levelsSource: 'custom', levels: [1, 2, 3, 4], colors: ['#ff0000'] }, { limit: 5 });
    await fireEvent.change(preset(), { target: { value: 'pct-acgih-eye' } });
    expect(onChange).toHaveBeenCalledWith({
      levelsSource: 'pct-acgih-eye',
      levelCount: 4,
      levels: [1.25, 2.5, 3.75, 5],
      colors: [],
      labels: ['25% ACGIH Eye', '50% ACGIH Eye', '75% ACGIH Eye', '100% ACGIH Eye'],
    });
  });

  it('fills limit levels and drops color overrides', async () => {
    const { onChange } = setup({ view: 'contours', colors: ['#ff0000'] }, { limit: 5 });
    await fireEvent.change(preset(), { target: { value: 'limits' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ levelsSource: 'limits', levels: [0.7, 5], colors: [], labels: ['ICNIRP', 'ACGIH Eye'] }));
  });

  it('pins typed levels as custom, sorted with their colors', async () => {
    const { onChange } = setup({ view: 'contours', levelsSource: 'custom', levels: [1, 2, 5], colors: ['#111111', null, null] });
    const first = screen.getByLabelText('Level 1') as HTMLInputElement;
    await fireEvent.change(first, { target: { value: '3' } });
    expect(onChange).toHaveBeenCalledWith({ levelsSource: 'custom', levels: [2, 3, 5], colors: [null, '#111111', null], labels: [null, null, null] });
  });

  it('ignores a non-positive level and restores the field', async () => {
    const { onChange } = setup({ view: 'contours', levelsSource: 'custom', levels: [1, 2] });
    const first = screen.getByLabelText('Level 1') as HTMLInputElement;
    await fireEvent.change(first, { target: { value: '-4' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(first.value).toBe('1');
  });

  it('adds and removes levels', async () => {
    const { onChange } = setup({ view: 'contours', levelsSource: 'custom', levels: [1, 2] });
    await fireEvent.click(screen.getByText('+ Add level'));
    expect(onChange).toHaveBeenLastCalledWith({ levelsSource: 'custom', levels: [1, 2, 5.5], colors: [null, null, null], labels: [null, null, null] });
    await fireEvent.click(screen.getByLabelText('Remove level 1'));
    expect(onChange).toHaveBeenLastCalledWith({ levelsSource: 'custom', levels: [2], colors: [], labels: [] });
  });

  it('lists levels as a table with a name for each, and edits one', async () => {
    const { onChange } = setup({ view: 'contours', levelsSource: 'custom', levels: [1, 2], labels: ['Low', null] });
    expect(screen.getByText('Name')).toBeTruthy();
    expect(screen.getByText('Value')).toBeTruthy();
    expect((screen.getByLabelText('Name for level 1') as HTMLInputElement).value).toBe('Low');
    await fireEvent.change(screen.getByLabelText('Name for level 2'), { target: { value: 'High' } });
    expect(onChange).toHaveBeenCalledWith({ labels: ['Low', 'High'] });
  });

  it('names Limits levels for their limits', async () => {
    const { onChange } = setup({ view: 'contours' }, { limit: 5 });
    await fireEvent.change(preset(), { target: { value: 'limits' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ labels: ['ICNIRP', 'ACGIH Eye'] }));
  });

  it('names a volume levels too', () => {
    setup({}, { kind: 'volume' });
    expect(screen.getByLabelText('Name for level 1')).toBeTruthy();
  });

  it('sets a custom title, with the default as its placeholder, and clears it when blank', async () => {
    const { onChange } = setup({});
    const title = screen.getByLabelText('Title') as HTMLInputElement;
    expect(title.placeholder).toBe('Eye Dose');
    await fireEvent.change(title, { target: { value: '  Office, eye level ' } });
    expect(onChange).toHaveBeenLastCalledWith({ title: 'Office, eye level' });
    await fireEvent.change(title, { target: { value: '  ' } });
    expect(onChange).toHaveBeenLastCalledWith({ title: undefined });
  });

  it('shows filled bands only for contours', () => {
    setup({ view: 'contours' });
    expect(screen.getByLabelText('Filled bands')).toBeTruthy();
  });
});
