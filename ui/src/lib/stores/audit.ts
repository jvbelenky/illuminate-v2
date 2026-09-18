/**
 * Design audit items, derived once and shared by the audit modal, the results
 * header badge and the next-step card.
 *
 * Position warnings come from the backend (`/session/check-positions`) and are
 * held in a writable that `refreshPositionWarnings()` fills; everything else is
 * a pure function of store state.
 */
import { derived, writable } from 'svelte/store';
import { room, lamps, results, stateHashes, lampsStale, roomStale, needsCalculation } from '$lib/stores/project';
import { checkPositions } from '$lib/api/client';
import type { LampComplianceResult, LampInstance, RoomConfig, SafetyWarning, SimulationResults, StateHashes } from '$lib/types/project';

export type AuditLevel = 'error' | 'warning' | 'info';
export type AuditCategory = 'design' | 'safety' | 'configuration' | 'staleness';

export interface AuditItem {
  level: AuditLevel;
  category: AuditCategory;
  message: string;
  lamp_id?: string;
}

export interface AuditInput {
  room: Pick<RoomConfig, 'useStandardZones'>;
  lamps: LampInstance[];
  results: SimulationResults | null | undefined;
  positionWarnings: AuditItem[];
  needsCalculation: boolean;
  lampsStale: boolean;
  roomStale: boolean;
  stateHashes: { current: StateHashes | null; lastCalculated: StateHashes | null };
}

/** Backend position warnings (lamps or zones outside the room). */
export const positionWarnings = writable<AuditItem[]>([]);

let positionRefreshInFlight: Promise<void> | null = null;

/** Re-fetch position warnings from the backend. Concurrent calls share one request. */
export function refreshPositionWarnings(): Promise<void> {
  if (positionRefreshInFlight) return positionRefreshInFlight;
  positionRefreshInFlight = checkPositions()
    .then((response) => {
      positionWarnings.set(
        response.warnings.map((w) => ({ level: 'warning' as AuditLevel, category: 'design' as AuditCategory, message: w.message }))
      );
    })
    .catch((err) => {
      console.warn('Failed to check positions:', err);
    })
    .finally(() => {
      positionRefreshInFlight = null;
    });
  return positionRefreshInFlight;
}

function zonesChangedSince(sh: AuditInput['stateHashes']): boolean {
  if (!sh.current || !sh.lastCalculated) return false;
  const currentZones = sh.current.calc_state.calc_zones;
  const lastZones = sh.lastCalculated.calc_state.calc_zones;
  for (const id of Object.keys(currentZones)) {
    if (currentZones[id] !== lastZones[id]) return true;
  }
  for (const id of Object.keys(lastZones)) {
    if (!(id in currentZones)) return true;
  }
  return false;
}

export function computeAuditItems(input: AuditInput): AuditItem[] {
  const items: AuditItem[] = [];
  const { room: r, lamps: lampList, results: res } = input;

  if (lampList.length === 0) {
    items.push({ level: 'info', category: 'configuration', message: 'No lamps have been added to the project.' });
  }

  items.push(...input.positionWarnings);

  const lampNameById: Record<string, string> = {};
  for (const lamp of lampList) lampNameById[lamp.id] = lamp.name || lamp.id;

  // Backend lamp names can differ from user-facing names; map them for message rewriting.
  const backendNameToUserName: Record<string, string> = {};
  if (res?.checkLamps?.lamp_results) {
    for (const [id, lr] of Object.entries(res.checkLamps.lamp_results)) {
      const result = lr as LampComplianceResult;
      const userName = lampNameById[result.lamp_id] || lampNameById[id];
      if (userName && result.lamp_name && result.lamp_name !== userName) {
        backendNameToUserName[result.lamp_name] = userName;
      }
    }
  }
  const rewriteLampNames = (msg: string): string => {
    let out = msg;
    for (const [backendName, userName] of Object.entries(backendNameToUserName)) {
      out = out.replaceAll(backendName, userName);
    }
    return out;
  };

  if (res?.checkLamps?.warnings) {
    const zoneNotFound = res.checkLamps.warnings.filter((w: SafetyWarning) => w.message.includes('zone not found'));
    const skinMissing = zoneNotFound.some((w) => w.message.includes('SkinLimits'));
    const eyeMissing = zoneNotFound.some((w) => w.message.includes('EyeLimits'));
    if (skinMissing !== eyeMissing) {
      if (skinMissing) {
        items.push({ level: 'warning', category: 'safety', message: 'The Skin Limits safety zone is missing. Enable standard zones in room settings to include it.' });
      }
      if (eyeMissing) {
        items.push({ level: 'warning', category: 'safety', message: 'The Eye Limits safety zone is missing. Enable standard zones in room settings to include it.' });
      }
    }
    for (const warning of res.checkLamps.warnings) {
      if (warning.message.includes('zone not found')) continue;
      const level: AuditLevel = warning.level === 'error' ? 'error' : warning.level === 'warning' ? 'warning' : 'info';
      if (r.useStandardZones) {
        items.push({ level, category: 'safety', message: rewriteLampNames(warning.message), lamp_id: warning.lamp_id ?? undefined });
      }
    }
  }

  if (r.useStandardZones && res?.checkLamps?.lamp_results) {
    for (const lr of Object.values(res.checkLamps.lamp_results) as LampComplianceResult[]) {
      if (lr.missing_spectrum) {
        const displayName = lampNameById[lr.lamp_id] || lr.lamp_name;
        items.push({
          level: 'warning',
          category: 'safety',
          message: `Lamp "${displayName}" is missing spectrum data. Safety calculations may be inaccurate.`,
          lamp_id: lr.lamp_id,
        });
      }
    }
  }

  if (input.needsCalculation && res) {
    const changed: string[] = [];
    if (input.lampsStale) changed.push('lamps');
    if (input.roomStale) changed.push('room');
    if (zonesChangedSince(input.stateHashes)) changed.push('zones');
    if (changed.length > 0) {
      items.push({
        level: 'info',
        category: 'staleness',
        message: `Results are stale. The ${changed.join(', ')} ${changed.length === 1 ? 'has' : 'have'} changed since the last calculation.`,
      });
    }
  }

  return items;
}

export const auditItems = derived(
  [room, lamps, results, positionWarnings, needsCalculation, lampsStale, roomStale, stateHashes],
  ([$room, $lamps, $results, $positionWarnings, $needsCalculation, $lampsStale, $roomStale, $stateHashes]) =>
    computeAuditItems({
      room: $room,
      lamps: $lamps,
      results: $results,
      positionWarnings: $positionWarnings,
      needsCalculation: $needsCalculation,
      lampsStale: $lampsStale,
      roomStale: $roomStale,
      stateHashes: $stateHashes,
    })
);

/** Warnings and errors only (what the results header badge and next-step card care about). */
export const auditProblems = derived(auditItems, ($items) => $items.filter((i) => i.level !== 'info'));
