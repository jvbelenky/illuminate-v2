import { describe, it, expect } from 'vitest';
import { computeNextStep, type NextStepInput } from './nextStep';
import type { ComplianceSummary } from './compliance';
import type { LampInstance } from '$lib/types/project';

function lamp(overrides: Partial<LampInstance> = {}): LampInstance {
  return {
    id: 'lamp-1',
    lamp_type: 'krcl_222',
    x: 1, y: 1, z: 2.5,
    angle: 0,
    aimx: 1, aimy: 1, aimz: 0,
    scaling_factor: 1,
    enabled: true,
    has_ies_file: true,
    has_spectrum_file: true,
    ...overrides,
  } as LampInstance;
}

function complianceOf(status: ComplianceSummary['status'], extra: Partial<ComplianceSummary> = {}): ComplianceSummary {
  return {
    hasSafetyResults: status !== 'none',
    skinNonCompliant: false,
    skinNearLimit: false,
    eyeNonCompliant: false,
    eyeNearLimit: false,
    anyNonCompliant: status === 'non-compliant',
    anyNearLimit: status === 'near-limit',
    status,
    ...extra,
  };
}

function input(overrides: Partial<NextStepInput> = {}): NextStepInput {
  return {
    lamps: [lamp()],
    hasZones: true,
    hasResults: false,
    needsCalculation: true,
    isCalculating: false,
    lastError: null,
    autoRecalculate: false,
    compliance: complianceOf('none'),
    auditProblems: [],
    ...overrides,
  };
}

describe('computeNextStep', () => {
  it('asks for a lamp when there are none', () => {
    const step = computeNextStep(input({ lamps: [] }));
    expect(step.id).toBe('no-lamps');
    expect(step.action).toBe('add-lamp');
    expect(step.step).toBe(2);
  });

  it('flags when every lamp is excluded from the calculation', () => {
    const step = computeNextStep(input({ lamps: [lamp({ enabled: false })] }));
    expect(step.id).toBe('lamps-excluded');
    expect(step.action).toBe('include-lamps');
  });

  it('points at the first enabled lamp without photometry, by name', () => {
    const step = computeNextStep(input({
      lamps: [lamp({ id: 'a', has_ies_file: true }), lamp({ id: 'b', name: 'Corner unit', has_ies_file: false })],
    }));
    expect(step.id).toBe('lamp-needs-model');
    expect(step.title).toContain('Corner unit');
    expect(step.action).toBe('open-lamp:b');
  });

  it('falls back to a positional label for an unnamed lamp', () => {
    const step = computeNextStep(input({ lamps: [lamp({ id: 'x', has_ies_file: false })] }));
    expect(step.title).toBe('Choose a model for Lamp 1');
  });

  it('ignores disabled lamps when looking for missing photometry', () => {
    const step = computeNextStep(input({
      lamps: [lamp({ id: 'a' }), lamp({ id: 'b', enabled: false, has_ies_file: false })],
    }));
    expect(step.id).not.toBe('lamp-needs-model');
  });

  it('asks for a zone when there is nothing to calculate', () => {
    const step = computeNextStep(input({ hasZones: false }));
    expect(step.id).toBe('no-zones');
    expect(step.action).toBe('add-zone');
  });

  it('shows progress while calculating, with no action', () => {
    const step = computeNextStep(input({ isCalculating: true }));
    expect(step.id).toBe('calculating');
    expect(step.action).toBeUndefined();
    expect(step.tone).toBe('progress');
  });

  it('surfaces the last error with a retry', () => {
    const step = computeNextStep(input({ lastError: 'Server busy' }));
    expect(step.id).toBe('calc-error');
    expect(step.detail).toBe('Server busy');
    expect(step.action).toBe('calculate');
  });

  it('offers Calculate before the first run', () => {
    const step = computeNextStep(input({ hasResults: false, needsCalculation: true }));
    expect(step.id).toBe('never-calculated');
    expect(step.actionLabel).toBe('Calculate');
  });

  it('offers Recalculate when results are stale', () => {
    const step = computeNextStep(input({ hasResults: true, needsCalculation: true }));
    expect(step.id).toBe('stale');
    expect(step.actionLabel).toBe('Recalculate');
  });

  it('shows a passive recalculating state when auto-recalculate is on', () => {
    const step = computeNextStep(input({ hasResults: true, needsCalculation: true, autoRecalculate: true }));
    expect(step.id).toBe('stale');
    expect(step.action).toBeUndefined();
    expect(step.title).toMatch(/Recalculating/);
  });

  it('still offers Calculate when hashes say up to date but nothing was ever calculated', () => {
    const step = computeNextStep(input({ hasResults: false, needsCalculation: false }));
    expect(step.id).toBe('never-calculated');
  });

  it('reports non-compliance naming the affected dose', () => {
    const step = computeNextStep(input({
      hasResults: true,
      needsCalculation: false,
      compliance: complianceOf('non-compliant', { skinNonCompliant: true }),
    }));
    expect(step.id).toBe('non-compliant');
    expect(step.detail).toContain('skin dose');
    expect(step.detail).not.toContain('skin and eye');
    expect(step.action).toBe('review-safety');
    expect(step.tone).toBe('danger');
  });

  it('names both doses when both exceed the limit', () => {
    const step = computeNextStep(input({
      hasResults: true,
      needsCalculation: false,
      compliance: complianceOf('non-compliant', { skinNonCompliant: true, eyeNonCompliant: true }),
    }));
    expect(step.detail).toContain('skin and eye dose');
  });

  it('reports near-limit as a warning', () => {
    const step = computeNextStep(input({ hasResults: true, needsCalculation: false, compliance: complianceOf('near-limit') }));
    expect(step.id).toBe('near-limit');
    expect(step.tone).toBe('warning');
  });

  it('surfaces the first audit problem and counts the rest', () => {
    const step = computeNextStep(input({
      hasResults: true,
      needsCalculation: false,
      compliance: complianceOf('compliant'),
      auditProblems: [
        { level: 'warning', category: 'design', message: 'Lamp 1 extends outside the room.' },
        { level: 'warning', category: 'safety', message: 'Lamp 1 is missing spectrum data.' },
      ],
    }));
    expect(step.id).toBe('warnings');
    expect(step.title).toBe('Lamp 1 extends outside the room.');
    expect(step.detail).toBe('1 more item in the design audit.');
    expect(step.action).toBe('open-audit');
  });

  it('ranks non-compliance above audit warnings', () => {
    const step = computeNextStep(input({
      hasResults: true,
      needsCalculation: false,
      compliance: complianceOf('non-compliant', { eyeNonCompliant: true }),
      auditProblems: [{ level: 'warning', category: 'design', message: 'x' }],
    }));
    expect(step.id).toBe('non-compliant');
  });

  it('celebrates a compliant design and offers a report', () => {
    const step = computeNextStep(input({ hasResults: true, needsCalculation: false, compliance: complianceOf('compliant') }));
    expect(step.id).toBe('compliant');
    expect(step.action).toBe('generate-report');
    expect(step.tone).toBe('success');
  });

  it('reports up to date when there are results but no safety zones', () => {
    const step = computeNextStep(input({ hasResults: true, needsCalculation: false, compliance: complianceOf('none') }));
    expect(step.id).toBe('up-to-date');
  });

  it('ranks missing lamps above everything else', () => {
    const step = computeNextStep(input({ lamps: [], isCalculating: true, lastError: 'boom' }));
    expect(step.id).toBe('no-lamps');
  });
});
