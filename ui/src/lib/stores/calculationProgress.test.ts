import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { calculationProgress } from './calculationProgress';

describe('calculationProgress', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    calculationProgress.stopCalculation();
  });

  afterEach(() => {
    calculationProgress.stopCalculation();
    vi.useRealTimers();
  });

  describe('initial state', () => {
    it('is not calculating', () => {
      const state = get(calculationProgress);
      expect(state.isCalculating).toBe(false);
    });

    it('has zero estimated seconds', () => {
      const state = get(calculationProgress);
      expect(state.estimatedSeconds).toBe(0);
    });

    it('has null startTime', () => {
      const state = get(calculationProgress);
      expect(state.startTime).toBeNull();
    });

    it('has zero progress percent', () => {
      expect(get(calculationProgress.progressPercent)).toBe(0);
    });

    it('has empty time remaining', () => {
      expect(get(calculationProgress.timeRemaining)).toBe('');
    });
  });

  describe('startCalculation', () => {
    it('sets isCalculating to true', () => {
      calculationProgress.startCalculation(10);
      expect(get(calculationProgress).isCalculating).toBe(true);
    });

    it('sets estimatedSeconds', () => {
      calculationProgress.startCalculation(30);
      expect(get(calculationProgress).estimatedSeconds).toBe(30);
    });

    it('sets startTime to current time', () => {
      const now = Date.now();
      calculationProgress.startCalculation(10);
      expect(get(calculationProgress).startTime).toBe(now);
    });

    it('clamps estimatedSeconds to at least 1 for zero input', () => {
      calculationProgress.startCalculation(0);
      expect(get(calculationProgress).estimatedSeconds).toBe(1);
    });

    it('clamps estimatedSeconds to at least 1 for negative input', () => {
      calculationProgress.startCalculation(-5);
      expect(get(calculationProgress).estimatedSeconds).toBe(1);
    });
  });

  describe('stopCalculation', () => {
    it('resets to initial state', () => {
      calculationProgress.startCalculation(10);
      calculationProgress.stopCalculation();

      const state = get(calculationProgress);
      expect(state.isCalculating).toBe(false);
      expect(state.estimatedSeconds).toBe(0);
      expect(state.startTime).toBeNull();
    });

    it('clears elapsed seconds', () => {
      calculationProgress.startCalculation(10);
      vi.advanceTimersByTime(1000);
      calculationProgress.stopCalculation();
      expect(get(calculationProgress.elapsedSeconds)).toBe(0);
    });

    it('stops interval updates', () => {
      calculationProgress.startCalculation(10);
      calculationProgress.stopCalculation();
      vi.advanceTimersByTime(1000);
      expect(get(calculationProgress.elapsedSeconds)).toBe(0);
    });
  });

  describe('progressPercent', () => {
    it('returns 0 when not calculating', () => {
      expect(get(calculationProgress.progressPercent)).toBe(0);
    });

    it('returns correct percentage based on elapsed time', () => {
      calculationProgress.startCalculation(10);
      vi.advanceTimersByTime(5000); // 5s elapsed out of 10s = 50%
      expect(get(calculationProgress.progressPercent)).toBeCloseTo(50, 0);
    });

    it('caps at 95%', () => {
      calculationProgress.startCalculation(10);
      vi.advanceTimersByTime(20000); // 200% -> capped at 95
      expect(get(calculationProgress.progressPercent)).toBe(95);
    });
  });

  describe('timeRemaining', () => {
    it('returns empty string when not calculating', () => {
      expect(get(calculationProgress.timeRemaining)).toBe('');
    });

    it('returns "Almost done..." when less than 1s remaining', () => {
      calculationProgress.startCalculation(5);
      vi.advanceTimersByTime(4500); // 0.5s remaining
      expect(get(calculationProgress.timeRemaining)).toBe('Almost done...');
    });

    it('returns seconds format for < 60s remaining', () => {
      calculationProgress.startCalculation(30);
      vi.advanceTimersByTime(5000); // 25s remaining
      expect(get(calculationProgress.timeRemaining)).toBe('~25s remaining');
    });

    it('returns minutes and seconds format for >= 60s remaining', () => {
      calculationProgress.startCalculation(120);
      vi.advanceTimersByTime(5000); // 115s remaining
      expect(get(calculationProgress.timeRemaining)).toBe('~1m 55s remaining');
    });
  });

  describe('elapsedSeconds', () => {
    it('increments by 0.1 every 100ms', () => {
      calculationProgress.startCalculation(10);
      vi.advanceTimersByTime(500); // 5 ticks
      expect(get(calculationProgress.elapsedSeconds)).toBeCloseTo(0.5, 1);
    });

    it('resets when new calculation starts', () => {
      calculationProgress.startCalculation(10);
      vi.advanceTimersByTime(2000);
      calculationProgress.startCalculation(20);
      expect(get(calculationProgress.elapsedSeconds)).toBe(0);
    });
  });
});
