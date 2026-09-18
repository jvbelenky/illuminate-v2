import { describe, it, expect } from 'vitest';
import { computeCompliance } from './compliance';
import type { CalcZone, CheckLampsResult, LampComplianceResult, SimulationResults } from '$lib/types/project';

function lampResult(overrides: Partial<LampComplianceResult> = {}): LampComplianceResult {
  return {
    lamp_id: 'lamp-1',
    lamp_name: 'Lamp 1',
    skin_dose_max: 10,
    eye_dose_max: 5,
    skin_tlv: 478.5,
    eye_tlv: 160.7,
    skin_dimming_required: 1,
    eye_dimming_required: 1,
    is_skin_compliant: true,
    is_eye_compliant: true,
    skin_near_limit: false,
    eye_near_limit: false,
    missing_spectrum: false,
    ...overrides,
  };
}

function checkLamps(overrides: Partial<CheckLampsResult> = {}, lampOverrides: Partial<LampComplianceResult> = {}): CheckLampsResult {
  return {
    status: 'compliant',
    lamp_results: { 'lamp-1': lampResult(lampOverrides) },
    warnings: [],
    max_skin_dose: 10,
    max_eye_dose: 5,
    is_skin_compliant: true,
    is_eye_compliant: true,
    skin_near_limit: false,
    eye_near_limit: false,
    ...overrides,
  } as CheckLampsResult;
}

function results(check?: CheckLampsResult, zoneMaxes: { skin?: number; eye?: number } = { skin: 10, eye: 5 }): SimulationResults {
  const zones: SimulationResults['zones'] = {};
  if (zoneMaxes.skin != null) zones['SkinLimits'] = { zone_id: 'SkinLimits', zone_type: 'plane', statistics: { max: zoneMaxes.skin } };
  if (zoneMaxes.eye != null) zones['EyeLimits'] = { zone_id: 'EyeLimits', zone_type: 'plane', statistics: { max: zoneMaxes.eye } };
  return { calculatedAt: '2026-01-01T00:00:00Z', zones, checkLamps: check };
}

const standardZones = [
  { id: 'SkinLimits', type: 'plane', enabled: true } as CalcZone,
  { id: 'EyeLimits', type: 'plane', enabled: true } as CalcZone,
];

describe('computeCompliance', () => {
  it('is none without results', () => {
    expect(computeCompliance({ results: null, zones: standardZones }).status).toBe('none');
  });

  it('is none until check_lamps has returned', () => {
    const c = computeCompliance({ results: results(undefined), zones: standardZones });
    expect(c.status).toBe('none');
    expect(c.hasSafetyResults).toBe(false);
    expect(c.skinMax).toBe(10);
  });

  it('is compliant when nothing is over or near the limit', () => {
    const c = computeCompliance({ results: results(checkLamps()), zones: standardZones });
    expect(c.status).toBe('compliant');
    expect(c.hasSafetyResults).toBe(true);
  });

  it('is non-compliant when the combined skin dose is over', () => {
    const c = computeCompliance({ results: results(checkLamps({ is_skin_compliant: false })), zones: standardZones });
    expect(c.status).toBe('non-compliant');
    expect(c.skinNonCompliant).toBe(true);
    expect(c.eyeNonCompliant).toBe(false);
  });

  it('is non-compliant when a single lamp is over even if the combined check passes', () => {
    const c = computeCompliance({ results: results(checkLamps({}, { is_eye_compliant: false })), zones: standardZones });
    expect(c.status).toBe('non-compliant');
    expect(c.eyeNonCompliant).toBe(true);
  });

  it('is near-limit from either the combined flag or a single lamp', () => {
    expect(computeCompliance({ results: results(checkLamps({ eye_near_limit: true })), zones: standardZones }).status).toBe('near-limit');
    expect(computeCompliance({ results: results(checkLamps({}, { skin_near_limit: true })), zones: standardZones }).status).toBe('near-limit');
  });

  it('non-compliance wins over near-limit', () => {
    const c = computeCompliance({ results: results(checkLamps({ is_skin_compliant: false, eye_near_limit: true })), zones: standardZones });
    expect(c.status).toBe('non-compliant');
    expect(c.anyNearLimit).toBe(false);
  });

  it('drops a disabled safety zone and reports none', () => {
    const zones = [{ id: 'SkinLimits', type: 'plane', enabled: false } as CalcZone, standardZones[1]];
    const c = computeCompliance({ results: results(checkLamps()), zones });
    expect(c.skinMax).toBeUndefined();
    expect(c.status).toBe('none');
  });
});
