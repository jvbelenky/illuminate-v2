import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';

const budgetError = {
  error: 'budget_exceeded',
  message: 'too big',
  budget: { used: 900, max: 500, percent: 180 },
  breakdown: { zones: [], lamps: { count: 0, memory_mb: 0, percent: 0 } },
  suggestions: [],
};
const { performCalculation } = vi.hoisted(() => ({ performCalculation: vi.fn() }));
vi.mock('$lib/utils/calculate', () => ({ performCalculation }));

import CalculateButton from './CalculateButton.svelte';
import { requestCalculation } from '$lib/stores/calculationStatus';

describe('CalculateButton calculation requests', () => {
  beforeEach(() => {
    cleanup();
    performCalculation.mockReset();
  });

  it('a requested calculation (the Results retry) runs through the button and shows its budget modal', async () => {
    performCalculation.mockResolvedValue({ success: false, budgetError });
    const { container } = render(CalculateButton);
    expect(container.querySelector('.modal-overlay, [role="dialog"]')).toBeNull();
    requestCalculation();
    await waitFor(() => expect(performCalculation).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(/Estimated peak memory/)).toBeTruthy());
  });

  it('does not run on mount without a request', () => {
    render(CalculateButton);
    expect(performCalculation).not.toHaveBeenCalled();
  });
});
