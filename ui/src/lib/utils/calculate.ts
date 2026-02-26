import { get } from 'svelte/store';
import { project, stateHashes } from '$lib/stores/project';
import { calculationProgress } from '$lib/stores/calculationProgress';
import {
  calculateSession,
  checkLampsSession,
  getCalculationEstimate,
  getEfficacyExploreData,
  ApiError,
  parseBudgetError,
  type BudgetError
} from '$lib/api/client';
import type { ZoneResult, ZoneDimensionSnapshot, CalcZone } from '$lib/types/project';

export interface CalculationResult {
  success: boolean;
  error?: string;
  budgetError?: BudgetError;
}

function snapshotDimensions(zone: CalcZone): ZoneDimensionSnapshot {
  if (zone.type === 'volume') {
    return {
      x_min: zone.x_min, x_max: zone.x_max,
      y_min: zone.y_min, y_max: zone.y_max,
      z_min: zone.z_min, z_max: zone.z_max,
      num_x: zone.num_x, num_y: zone.num_y, num_z: zone.num_z,
    };
  }
  return {
    x1: zone.x1, x2: zone.x2,
    y1: zone.y1, y2: zone.y2,
    height: zone.height,
    ref_surface: zone.ref_surface,
    direction: zone.direction,
    num_x: zone.num_x, num_y: zone.num_y,
  };
}

/**
 * Perform a calculation: call the API, process zone results, update stores.
 * Returns success/error info so callers can handle UI concerns.
 *
 * @param trackProgress If true, use getCalculationEstimate and calculationProgress store
 */
export async function performCalculation(trackProgress = true): Promise<CalculationResult> {
  try {
    // Ensure session is initialized
    if (!project.isSessionInitialized()) {
      await project.initSession();
    }

    if (trackProgress) {
      // Get estimate first to show progress
      let estimatedSeconds = 5;
      try {
        const estimate = await getCalculationEstimate();
        estimatedSeconds = Math.max(1, estimate.estimated_seconds * 1.2 + 0.5);
      } catch {
        // If estimate fails, use default
      }
      calculationProgress.startCalculation(estimatedSeconds);
    }

    const result = await calculateSession();

    if (result.success && result.zones) {
      const zoneResults: Record<string, ZoneResult> = {};
      const currentZones = get(project).zones;

      for (const [zoneId, apiZone] of Object.entries(result.zones)) {
        const zone = currentZones.find(z => z.id === zoneId);
        zoneResults[zoneId] = {
          zone_id: apiZone.zone_id,
          zone_name: apiZone.zone_name,
          zone_type: apiZone.zone_type,
          statistics: apiZone.statistics,
          units: '\u00B5W/cm\u00B2',
          num_points: apiZone.num_points,
          values: apiZone.values,
          dimensionSnapshot: zone ? snapshotDimensions(zone) : undefined,
          doseAtCalcTime: zone?.dose ?? false,
          hoursAtCalcTime: zone?.hours ?? 8
        };
      }

      // Save state hashes from the calculate response as "last calculated"
      if (result.state_hashes) {
        stateHashes.update(sh => ({
          ...sh,
          lastCalculated: result.state_hashes!,
          current: result.state_hashes!,
        }));
      }

      // Backend returns UTC datetime without Z suffix (e.g. "2026-02-09 18:33:00"),
      // so append 'Z' to ensure it's parsed as UTC rather than local time.
      let calculatedAt = 'calculated_at' in result ? String(result.calculated_at) : new Date().toISOString();
      if (calculatedAt && !calculatedAt.endsWith('Z') && !calculatedAt.includes('+')) {
        calculatedAt = calculatedAt.replace(' ', 'T') + 'Z';
      }

      // Set results immediately so UI updates fast
      project.setResults({
        calculatedAt,
        lastStateHashes: result.state_hashes ?? undefined,
        zones: zoneResults,
        ozoneIncreasePpb: result.ozone_increase_ppb ?? undefined,
      });

      // Fire check_lamps concurrently — update results when it arrives
      const currentProject = get(project);
      if (currentProject.room.useStandardZones) {
        checkLampsSession().then((checkLampsResult) => {
          const latest = get(project);
          if (latest.results) {
            project.setResults({
              ...latest.results,
              checkLamps: checkLampsResult,
            });
          }
        }).catch((e) => {
          console.warn('check_lamps failed:', e);
        });
      }

      // Prefetch explore data (lru_cached on backend, fast) for client-side table/plot
      getEfficacyExploreData().then((exploreData) => {
        const latest = get(project);
        if (latest.results) {
          project.setResults({
            ...latest.results,
            exploreData,
          });
        }
      }).catch((e) => {
        console.warn('explore data prefetch failed:', e);
      });

      return { success: true };
    } else {
      return { success: false, error: 'Simulation failed' };
    }
  } catch (e) {
    const parsedBudgetError = parseBudgetError(e);
    if (parsedBudgetError) {
      return { success: false, budgetError: parsedBudgetError };
    } else if (e instanceof ApiError) {
      if (e.status === 503) {
        return { success: false, error: 'Server busy. Please try again in a moment.' };
      } else if (e.status === 408) {
        return { success: false, error: 'Calculation timed out. Try reducing grid resolution.' };
      } else {
        return { success: false, error: `API Error (${e.status}): ${e.message}` };
      }
    } else if (e instanceof Error) {
      return { success: false, error: e.message };
    } else {
      return { success: false, error: 'Unknown error occurred' };
    }
  } finally {
    if (trackProgress) {
      calculationProgress.stopCalculation();
    }
  }
}
