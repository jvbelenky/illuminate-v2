/**
 * Photobiological compliance summary derived from the latest results.
 *
 * One place computes "is this design over the TLV" so the results panel, the
 * next-step card and the audit agree. Mirrors the rules the results panel used
 * to compute privately: a design is non-compliant if any single lamp or the
 * combined dose exceeds the limit, and near-limit if any lamp or the combined
 * dose is within 10% of it.
 */
import { derived } from 'svelte/store';
import { results, zones } from '$lib/stores/project';
import type { CalcZone, LampComplianceResult, SimulationResults } from '$lib/types/project';

export type ComplianceLevel = 'none' | 'compliant' | 'near-limit' | 'non-compliant';

export interface ComplianceSummary {
  /** True when both safety zones have results and check_lamps has returned. */
  hasSafetyResults: boolean;
  skinMax?: number;
  eyeMax?: number;
  skinNonCompliant: boolean;
  skinNearLimit: boolean;
  eyeNonCompliant: boolean;
  eyeNearLimit: boolean;
  anyNonCompliant: boolean;
  anyNearLimit: boolean;
  status: ComplianceLevel;
}

export interface ComplianceInput {
  results: SimulationResults | null | undefined;
  zones: CalcZone[];
}

const NONE: ComplianceSummary = {
  hasSafetyResults: false,
  skinNonCompliant: false,
  skinNearLimit: false,
  eyeNonCompliant: false,
  eyeNearLimit: false,
  anyNonCompliant: false,
  anyNearLimit: false,
  status: 'none',
};

export function computeCompliance({ results, zones }: ComplianceInput): ComplianceSummary {
  if (!results) return NONE;

  const skinEnabled = zones.find((z) => z.id === 'SkinLimits')?.enabled !== false;
  const eyeEnabled = zones.find((z) => z.id === 'EyeLimits')?.enabled !== false;
  const skinMax = skinEnabled ? results.zones?.['SkinLimits']?.statistics?.max : undefined;
  const eyeMax = eyeEnabled ? results.zones?.['EyeLimits']?.statistics?.max : undefined;

  const check = results.checkLamps;
  const lampResults: LampComplianceResult[] = check?.lamp_results ? Object.values(check.lamp_results) : [];

  const skinNonCompliant = lampResults.some((l) => !l.is_skin_compliant) || check?.is_skin_compliant === false;
  const skinNearLimit = !skinNonCompliant && (lampResults.some((l) => l.skin_near_limit) || (check?.skin_near_limit ?? false));
  const eyeNonCompliant = lampResults.some((l) => !l.is_eye_compliant) || check?.is_eye_compliant === false;
  const eyeNearLimit = !eyeNonCompliant && (lampResults.some((l) => l.eye_near_limit) || (check?.eye_near_limit ?? false));

  const anyNonCompliant = skinNonCompliant || eyeNonCompliant;
  const anyNearLimit = !anyNonCompliant && (skinNearLimit || eyeNearLimit);

  const hasSafetyResults = !!check && skinMax != null && eyeMax != null;
  const status: ComplianceLevel = !hasSafetyResults
    ? 'none'
    : anyNonCompliant
      ? 'non-compliant'
      : anyNearLimit
        ? 'near-limit'
        : 'compliant';

  return {
    hasSafetyResults,
    skinMax,
    eyeMax,
    skinNonCompliant,
    skinNearLimit,
    eyeNonCompliant,
    eyeNearLimit,
    anyNonCompliant,
    anyNearLimit,
    status,
  };
}

export const compliance = derived([results, zones], ([$results, $zones]) =>
  computeCompliance({ results: $results, zones: $zones })
);
