import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/svelte';
import { writable } from 'svelte/store';

const { step, performCalculation } = vi.hoisted(() => ({
  step: { current: null as any },
  performCalculation: vi.fn(async () => ({ success: false })),
}));
vi.mock('$lib/stores/nextStep', async () => {
  const { writable } = await import('svelte/store');
  step.current = writable({ id: 'no-lamps', tone: 'info', title: 'x', detail: '', step: 2 });
  return { nextStep: step.current };
});
vi.mock('$lib/stores/calculationStatus', () => ({ requestCalculation: performCalculation }));

import ZoneStatsPanel from './ZoneStatsPanel.svelte';

describe('Results next-step buttons', () => {
  beforeEach(() => {
    cleanup();
    performCalculation.mockClear();
  });

  it('"Choose a model for Lamp N" opens that lamp with the fixture focused', async () => {
    step.current.set({ id: 'lamp-needs-model', tone: 'info', title: 'Choose a model for Lamp 2', detail: '', step: 2, action: 'open-lamp:abc' });
    const onOpenLamps = vi.fn();
    render(ZoneStatsPanel, { onOpenLamps });
    const btn = screen.getByRole('button', { name: 'Choose a model for Lamp 2' });
    expect(btn.classList.contains('secondary')).toBe(true);
    await fireEvent.click(btn);
    expect(onOpenLamps).toHaveBeenCalledWith('abc', true);
  });

  it('"Lamps excluded" opens the Lamps step', async () => {
    step.current.set({ id: 'lamps-excluded', tone: 'warning', title: 'Every lamp is excluded from the calculation', detail: '', step: 2 });
    const onOpenLamps = vi.fn();
    render(ZoneStatsPanel, { onOpenLamps });
    await fireEvent.click(screen.getByRole('button', { name: /Every lamp is excluded/ }));
    // With no single lamp in the project there is no lamp to open
    expect(onOpenLamps).toHaveBeenLastCalledWith(undefined);
  });

  it('"Nothing to calculate" opens the Zones step', async () => {
    step.current.set({ id: 'no-zones', tone: 'warning', title: 'Nothing to calculate', detail: '', step: 3 });
    const onOpenZones = vi.fn();
    render(ZoneStatsPanel, { onOpenZones });
    await fireEvent.click(screen.getByRole('button', { name: 'Nothing to calculate' }));
    expect(onOpenZones).toHaveBeenCalledTimes(1);
  });

  it('"Calculation failed" asks the Calculate button to run again', async () => {
    step.current.set({ id: 'calc-error', tone: 'danger', title: 'Calculation failed', detail: 'boom', step: 3 });
    render(ZoneStatsPanel);
    await fireEvent.click(screen.getByRole('button', { name: 'Calculation failed' }));
    expect(performCalculation).toHaveBeenCalledTimes(1);
  });

  it('"Ready to calculate" stays plain text', () => {
    step.current.set({ id: 'never-calculated', tone: 'info', title: 'Ready to calculate', detail: '', step: 3 });
    render(ZoneStatsPanel, { onOpenLamps: vi.fn(), onOpenZones: vi.fn() });
    expect(screen.queryByRole('button', { name: 'Ready to calculate' })).toBeNull();
    expect(screen.getByText('Ready to calculate')).toBeTruthy();
  });
});
