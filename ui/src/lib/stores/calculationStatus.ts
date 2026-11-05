/**
 * Outcome of the most recent calculation attempt, shared across the app.
 *
 * `calculationProgress` tracks the in-flight progress bar; this store records
 * whether a run is active and what the last run's error was, so the next-step
 * card, the Calculate button and the results header can all show the same
 * thing without each keeping a private copy.
 */
import { writable } from 'svelte/store';

export interface CalculationStatus {
  isCalculating: boolean;
  /** Error message from the last run, or null if it succeeded (or never ran). */
  lastError: string | null;
}

function createCalculationStatusStore() {
  const { subscribe, set, update } = writable<CalculationStatus>({ isCalculating: false, lastError: null });

  return {
    subscribe,
    begin() {
      set({ isCalculating: true, lastError: null });
    },
    finish(error: string | null = null) {
      update((s) => ({ ...s, isCalculating: false, lastError: error }));
    },
    reset() {
      set({ isCalculating: false, lastError: null });
    },
  };
}

export const calculationStatus = createCalculationStatusStore();

/**
 * Ask the Calculate button to run, as if clicked: it owns the budget-exceeded
 * modal and the auto-recalculate bookkeeping, so other surfaces (the Results
 * "Calculation failed" retry) go through it rather than calculating themselves.
 */
const requests = writable(0);
export const calculateRequests = { subscribe: requests.subscribe };
export function requestCalculation() {
  requests.update((n) => n + 1);
}
