import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import BudgetExceededModal from './BudgetExceededModal.svelte';
import type { BudgetError } from '$lib/api/client';

describe('BudgetExceededModal', () => {
  const defaultBudgetError: BudgetError = {
    error: 'budget_exceeded',
    message: 'Calculation too large',
    budget: {
      used: 2500000,
      max: 1000000,
      percent: 250,
    },
    breakdown: {
      zones: [
        { id: 'z1', name: 'Zone 1', type: 'plane', grid_points: 10000, cost: 500000, percent: 50 },
        { id: 'z2', name: 'Zone 2', type: 'volume', grid_points: 5000, cost: 300000, percent: 30 },
      ],
      lamps: {
        count: 3,
        cost: 200000,
        percent: 20,
      },
    },
    suggestions: ['Reduce zone resolution', 'Disable reflectance'],
  };

  it('renders title', () => {
    const onClose = vi.fn();
    render(BudgetExceededModal, { props: { budgetError: defaultBudgetError, onClose } });
    expect(screen.getByText(/Calculation Too Large/i)).toBeTruthy();
  });

  it('renders budget bar', () => {
    const onClose = vi.fn();
    const { container } = render(BudgetExceededModal, { props: { budgetError: defaultBudgetError, onClose } });
    expect(container.querySelector('.budget-bar')).toBeTruthy();
  });

  it('renders zone breakdown items', () => {
    const onClose = vi.fn();
    render(BudgetExceededModal, { props: { budgetError: defaultBudgetError, onClose } });
    expect(screen.getByText('Zone 1')).toBeTruthy();
    expect(screen.getByText('Zone 2')).toBeTruthy();
  });

  it('renders suggestions', () => {
    const onClose = vi.fn();
    render(BudgetExceededModal, { props: { budgetError: defaultBudgetError, onClose } });
    expect(screen.getByText(/Reduce zone resolution/)).toBeTruthy();
  });

  it('calls onClose on Escape key', async () => {
    const onClose = vi.fn();
    const { container } = render(BudgetExceededModal, { props: { budgetError: defaultBudgetError, onClose } });
    const backdrop = container.querySelector('.modal-backdrop')!;
    await fireEvent.keyDown(backdrop, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
