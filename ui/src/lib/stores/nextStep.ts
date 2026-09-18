/**
 * The one thing the user should do next, derived from project state.
 *
 * `computeNextStep` is pure so every state can be unit-tested. The store emits
 * an action *id*; the sidebar card maps ids to page handlers, keeping this
 * module free of UI wiring.
 */
import { derived } from 'svelte/store';
import { lamps, results, needsCalculation, hasZones, lampHasPhotometry } from '$lib/stores/project';
import { calculationStatus } from '$lib/stores/calculationStatus';
import { compliance, type ComplianceSummary } from '$lib/stores/compliance';
import { auditProblems, type AuditItem } from '$lib/stores/audit';
import { userSettings } from '$lib/stores/settings';
import type { LampInstance } from '$lib/types/project';

export type NextStepId =
  | 'no-lamps'
  | 'lamps-excluded'
  | 'lamp-needs-model'
  | 'no-zones'
  | 'calculating'
  | 'calc-error'
  | 'stale'
  | 'never-calculated'
  | 'non-compliant'
  | 'near-limit'
  | 'warnings'
  | 'compliant'
  | 'up-to-date';

export type NextStepAction =
  | 'add-lamp'
  | 'include-lamps'
  | `open-lamp:${string}`
  | 'add-zone'
  | 'calculate'
  | 'review-safety'
  | 'open-audit'
  | 'generate-report';

export type NextStepTone = 'info' | 'progress' | 'warning' | 'danger' | 'success';

export interface NextStep {
  id: NextStepId;
  tone: NextStepTone;
  title: string;
  detail: string;
  /** Button label; absent when there is nothing to click (e.g. while calculating). */
  actionLabel?: string;
  action?: NextStepAction;
  /** Sidebar step this state belongs to (1 room, 2 lamps, 3 calculate). */
  step: 1 | 2 | 3;
}

export interface NextStepInput {
  lamps: LampInstance[];
  hasZones: boolean;
  hasResults: boolean;
  needsCalculation: boolean;
  isCalculating: boolean;
  lastError: string | null;
  autoRecalculate: boolean;
  compliance: ComplianceSummary;
  /** Audit items at warning or error level. */
  auditProblems: AuditItem[];
}

function lampLabel(lamp: LampInstance, index: number): string {
  return lamp.name || `Lamp ${index + 1}`;
}

const READY: NextStep = {
  id: 'never-calculated',
  tone: 'info',
  step: 3,
  title: 'Ready to calculate',
  detail: 'Run the simulation to see fluence and safety results.',
  actionLabel: 'Calculate',
  action: 'calculate',
};

export function computeNextStep(input: NextStepInput): NextStep {
  const { lamps: lampList } = input;

  if (lampList.length === 0) {
    return {
      id: 'no-lamps',
      tone: 'info',
      step: 2,
      title: 'Add a lamp to begin',
      detail: 'Place a lamp in the room to see how much UV it delivers and whether it is safe.',
      actionLabel: 'Add lamp',
      action: 'add-lamp',
    };
  }

  const enabledLamps = lampList.filter((l) => l.enabled !== false);
  if (enabledLamps.length === 0) {
    return {
      id: 'lamps-excluded',
      tone: 'warning',
      step: 2,
      title: 'Every lamp is excluded from the calculation',
      detail: 'Include at least one lamp to get results.',
      actionLabel: 'Include lamps',
      action: 'include-lamps',
    };
  }

  const unconfiguredIndex = lampList.findIndex((l) => l.enabled !== false && !lampHasPhotometry(l));
  if (unconfiguredIndex !== -1) {
    const lamp = lampList[unconfiguredIndex];
    return {
      id: 'lamp-needs-model',
      tone: 'info',
      step: 2,
      title: `Choose a model for ${lampLabel(lamp, unconfiguredIndex)}`,
      detail: 'A lamp needs photometric data before it can be calculated. Pick a built-in model or add your own.',
      actionLabel: 'Choose model',
      action: `open-lamp:${lamp.id}`,
    };
  }

  if (!input.hasZones) {
    return {
      id: 'no-zones',
      tone: 'warning',
      step: 3,
      title: 'Nothing to calculate',
      detail: 'Turn standard zones back on or add a calculation zone.',
      actionLabel: 'Add zone',
      action: 'add-zone',
    };
  }

  if (input.isCalculating) {
    return {
      id: 'calculating',
      tone: 'progress',
      step: 3,
      title: 'Calculating…',
      detail: 'Running the simulation.',
    };
  }

  if (input.lastError) {
    return {
      id: 'calc-error',
      tone: 'danger',
      step: 3,
      title: 'Calculation failed',
      detail: input.lastError,
      actionLabel: 'Retry',
      action: 'calculate',
    };
  }

  if (input.needsCalculation) {
    if (!input.hasResults) return READY;
    if (input.autoRecalculate) {
      return {
        id: 'stale',
        tone: 'progress',
        step: 3,
        title: 'Recalculating…',
        detail: 'Results update automatically after each change.',
      };
    }
    return {
      id: 'stale',
      tone: 'info',
      step: 3,
      title: 'Design changed since the last calculation',
      detail: 'The results shown are from the previous design.',
      actionLabel: 'Recalculate',
      action: 'calculate',
    };
  }

  if (!input.hasResults) return READY;

  const c = input.compliance;
  if (c.status === 'non-compliant') {
    const parts: string[] = [];
    if (c.skinNonCompliant) parts.push('skin');
    if (c.eyeNonCompliant) parts.push('eye');
    return {
      id: 'non-compliant',
      tone: 'danger',
      step: 3,
      title: 'Exposure exceeds the TLV',
      detail: `The 8-hour ${parts.join(' and ')} dose is over the limit. Dim the lamps or move them further from occupants.`,
      actionLabel: 'Review safety',
      action: 'review-safety',
    };
  }
  if (c.status === 'near-limit') {
    return {
      id: 'near-limit',
      tone: 'warning',
      step: 3,
      title: 'Within 10% of the TLV',
      detail: 'The design complies, but with little margin. Consider dimming slightly before installing.',
      actionLabel: 'Review safety',
      action: 'review-safety',
    };
  }

  const problems = input.auditProblems;
  if (problems.length > 0) {
    const first = problems[0];
    const more = problems.length - 1;
    return {
      id: 'warnings',
      tone: 'warning',
      step: 3,
      title: first.message,
      detail: more > 0 ? `${more} more item${more === 1 ? '' : 's'} in the design audit.` : 'See the design audit for details.',
      actionLabel: 'Open audit',
      action: 'open-audit',
    };
  }

  if (c.status === 'compliant') {
    return {
      id: 'compliant',
      tone: 'success',
      step: 3,
      title: 'Design complies with TLVs',
      detail: 'Export a report, or keep refining the design.',
      actionLabel: 'Generate report',
      action: 'generate-report',
    };
  }

  return {
    id: 'up-to-date',
    tone: 'success',
    step: 3,
    title: 'Results are up to date',
    detail: 'Export a report, or keep refining the design.',
    actionLabel: 'Generate report',
    action: 'generate-report',
  };
}

export const nextStep = derived(
  [lamps, results, needsCalculation, hasZones, calculationStatus, compliance, auditProblems, userSettings],
  ([$lamps, $results, $needsCalculation, $hasZones, $status, $compliance, $auditProblems, $settings]) =>
    computeNextStep({
      lamps: $lamps,
      hasZones: $hasZones,
      hasResults: !!$results,
      needsCalculation: $needsCalculation,
      isCalculating: $status.isCalculating,
      lastError: $status.lastError,
      autoRecalculate: $settings.autoRecalculate,
      compliance: $compliance,
      auditProblems: $auditProblems,
    })
);
