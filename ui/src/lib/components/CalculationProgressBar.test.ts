import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';
import { calculationProgress } from '$lib/stores/calculationProgress';
import CalculationProgressBar from './CalculationProgressBar.svelte';
import { tick } from 'svelte';

describe('CalculationProgressBar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    calculationProgress.stopCalculation();
  });

  afterEach(() => {
    calculationProgress.stopCalculation();
    vi.useRealTimers();
  });

  it('does not render progress line when not calculating', () => {
    const { container } = render(CalculationProgressBar);
    expect(container.querySelector('.progress-line')).toBeNull();
  });

  it('renders progress line when calculating', async () => {
    const { container } = render(CalculationProgressBar);
    calculationProgress.startCalculation(10);
    await vi.advanceTimersByTimeAsync(100);
    await tick();
    await waitFor(() => {
      expect(container.querySelector('.progress-line')).toBeTruthy();
    });
  });

  it('hides progress line after calculation stops', async () => {
    const { container } = render(CalculationProgressBar);
    calculationProgress.startCalculation(10);
    await vi.advanceTimersByTimeAsync(100);
    await tick();
    await waitFor(() => {
      expect(container.querySelector('.progress-line')).toBeTruthy();
    });

    calculationProgress.stopCalculation();
    await vi.advanceTimersByTimeAsync(0);
    await tick();
    await waitFor(() => {
      expect(container.querySelector('.progress-line')).toBeNull();
    });
  });
});
