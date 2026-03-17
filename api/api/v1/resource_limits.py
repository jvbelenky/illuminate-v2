"""
Resource cost estimation and budget enforcement.

Memory and time estimates are delegated to guv_calcs (performance.py), which
owns the coefficients since it knows its own data structures and caching
behavior. This module adds API-layer policy: limits, overhead padding,
error formatting, and suggestions.
"""
import logging
from math import prod
from typing import TYPE_CHECKING, List, Dict

from fastapi import HTTPException

if TYPE_CHECKING:
    from .session_manager import Session

logger = logging.getLogger(__name__)

# =============================================================================
# Resource Limits Constants
# =============================================================================

MAX_CONCURRENT_SESSIONS = 500
MAX_CONCURRENT_CALCULATIONS = 4  # Match server cores
QUEUE_TIMEOUT_SECONDS = 30  # Wait for calculation slot
CALCULATION_TIMEOUT_SECONDS = 600  # 10 minutes per calculation
MAX_CALC_TIME_SECONDS = CALCULATION_TIMEOUT_SECONDS * 0.7  # 420s, 30% headroom before timeout

# Peak memory limit per session (MB).
# On 8GB server with 6GB available and 4 concurrent calculations,
# each session can safely use up to 1.5 GB.
MAX_PEAK_MEMORY_MB = 1500

# Minimum spacing guard (5mm) - prevents accidental massive grids
MIN_SPACING = 0.005


# =============================================================================
# Cost Estimation Functions
# =============================================================================


def estimate_session_cost(session: "Session") -> dict:
    """
    Estimate memory and time cost for a session.

    Delegates to guv_calcs for raw estimates, then adds API-layer context
    (per-zone breakdown, reflectance pass info, time padding).

    Returns:
        Dictionary with memory breakdown (MB), time estimate, and per-zone details
    """
    # Per-zone breakdown for the frontend (guv_calcs doesn't track zone_id_map)
    zone_details: List[Dict] = []
    for zone_id, zone in session.zone_id_map.items():
        enabled = getattr(zone, 'enabled', True)
        points = prod(zone.num_points)
        zone_details.append({
            'id': zone_id,
            'name': getattr(zone, 'name', None) or zone_id,
            'type': zone.calctype.lower(),
            'enabled': enabled,
            'grid_points': points,
            'memory_mb': round(points * 90 / 1_000_000, 1) if enabled else 0,
        })
    zone_details.sort(key=lambda z: z['memory_mb'], reverse=True)

    # Delegate to guv_calcs for authoritative memory estimate
    mem = session.room.estimate_memory()

    # Reflectance info for display
    reflectance_enabled = (
        hasattr(session.room, 'ref_manager') and session.room.ref_manager.enabled
    )
    reflectance_passes = 0
    if reflectance_enabled:
        reflectance_passes = session.room.ref_manager.max_num_passes or 5

    # Time estimate — guv_calcs estimates pure calculation time;
    # pad with API overhead (budget checks, thread dispatch, result
    # serialization, JSON encoding). Uses 1.5x multiplier for large calcs
    # and +2s floor for trivially fast ones where fixed overhead dominates.
    raw_calc_time = session.room.estimate_calculation_time()
    calc_time = max(raw_calc_time * 1.5, raw_calc_time + 2.0)

    return {
        'total_grid_points': mem['total_zone_points'],
        'zones': zone_details,
        'lamp_count': mem['lamp_count'],
        'reflectance_enabled': reflectance_enabled,
        'reflectance_passes': reflectance_passes,
        'reflectance_grid_points': mem['reflectance_grid_points'],
        'lamp_memory_mb': round(mem['lamp_bytes'] / 1_000_000, 1),
        'zone_memory_mb': round(mem['zone_bytes'] / 1_000_000, 1),
        'reflectance_memory_mb': round(mem['reflectance_bytes'] / 1_000_000, 1),
        'peak_memory_mb': round(mem['peak_bytes'] / 1_000_000, 1),
        'calc_time_seconds': calc_time,
    }


def get_budget_reduction_suggestions(estimate: dict, time_exceeded: bool = False, memory_exceeded: bool = False) -> list:
    """
    Generate actionable suggestions based on what's using the most resources.
    """
    suggestions = []
    peak_mb = estimate['peak_memory_mb']
    if peak_mb <= 0:
        return suggestions

    # Time-specific suggestions
    if time_exceeded:
        if estimate['lamp_count'] > 1:
            suggestions.append(
                f"Reduce number of lamps (currently {estimate['lamp_count']} — "
                f"calculation time scales linearly with lamp count)"
            )

    # Memory-specific: reflectance dominates memory for large surface grids
    if memory_exceeded and estimate['reflectance_enabled']:
        refl_pct = estimate['reflectance_memory_mb'] / peak_mb * 100
        if refl_pct > 50:
            suggestions.append(
                f"Reduce reflectance surface resolution "
                f"({estimate['reflectance_grid_points']:,} total surface points — "
                f"memory scales quadratically with surface resolution)"
            )
        suggestions.append("Disable reflectance calculation")

    # Find the highest-memory zones
    zones = estimate.get('zones', [])
    high_mem_zones = [z for z in zones if z['enabled'] and z['memory_mb'] > peak_mb * 0.1]
    if high_mem_zones:
        for zone in high_mem_zones[:2]:
            suggestions.append(
                f"Reduce resolution of '{zone['name']}' zone "
                f"({zone['grid_points']:,} grid points)"
            )

    if estimate['lamp_count'] > 5 and not time_exceeded:
        suggestions.append(
            f"Disable some lamps (currently {estimate['lamp_count']} enabled)"
        )

    if not suggestions:
        suggestions.append("Remove or disable some calculation zones")

    return suggestions


def check_budget(session: "Session", additional_memory_mb: float = 0) -> None:
    """
    Check if session exceeds memory or time limits and raise HTTPException if so.

    Enforces two limits:
    1. Peak memory estimate (MAX_PEAK_MEMORY_MB)
    2. Estimated calculation time (MAX_CALC_TIME_SECONDS)
    """
    estimate = estimate_session_cost(session)
    peak_mb = estimate['peak_memory_mb'] + additional_memory_mb
    calc_time = estimate['calc_time_seconds']

    memory_exceeded = peak_mb > MAX_PEAK_MEMORY_MB
    time_exceeded = calc_time > MAX_CALC_TIME_SECONDS

    if not memory_exceeded and not time_exceeded:
        return

    detail = {
        "error": "budget_exceeded",
        "message": (
            f"Estimated peak memory ({peak_mb:.0f} MB) exceeds limit ({MAX_PEAK_MEMORY_MB} MB)"
            if memory_exceeded else
            "Estimated calculation time exceeds limit"
        ),
        "budget": {
            "used": round(peak_mb),
            "max": MAX_PEAK_MEMORY_MB,
            "percent": round(peak_mb / MAX_PEAK_MEMORY_MB * 100),
        },
        "breakdown": {
            "zones": [
                {
                    'id': z['id'],
                    'name': z['name'],
                    'type': z['type'],
                    'grid_points': z['grid_points'],
                    'memory_mb': z['memory_mb'],
                    'percent': round(z['memory_mb'] / peak_mb * 100) if peak_mb > 0 else 0,
                }
                for z in estimate['zones'] if z['enabled']
            ],
            "lamps": {
                "count": estimate['lamp_count'],
                "memory_mb": estimate['lamp_memory_mb'],
                "percent": round(estimate['lamp_memory_mb'] / peak_mb * 100) if peak_mb > 0 else 0,
            },
        },
        "suggestions": get_budget_reduction_suggestions(
            estimate, time_exceeded=time_exceeded, memory_exceeded=memory_exceeded
        ),
    }

    # Include time estimate when time is exceeded (or when it's close)
    if time_exceeded or calc_time > MAX_CALC_TIME_SECONDS * 0.5:
        detail["time_estimate"] = {
            "estimated_seconds": round(calc_time, 1),
            "max_seconds": MAX_CALC_TIME_SECONDS,
            "percent": round(calc_time / MAX_CALC_TIME_SECONDS * 100),
        }

    # Include reflectance in breakdown if enabled
    if estimate['reflectance_enabled']:
        detail["breakdown"]["reflectance"] = {
            "enabled": True,
            "passes": estimate['reflectance_passes'],
            "grid_points": estimate['reflectance_grid_points'],
            "memory_mb": estimate['reflectance_memory_mb'],
            "percent": round(estimate['reflectance_memory_mb'] / peak_mb * 100) if peak_mb > 0 else 0,
        }

    raise HTTPException(status_code=400, detail=detail)


def log_calculation_start(session: "Session") -> dict:
    """Log calculation start with cost estimate. Returns estimate for later comparison."""
    estimate = estimate_session_cost(session)

    refl_info = ""
    if estimate['reflectance_enabled']:
        refl_info = f", reflectance={estimate['reflectance_passes']} passes"

    logger.info(
        f"Calculation starting: grid={estimate['total_grid_points']:,}, "
        f"lamps={estimate['lamp_count']}{refl_info}, "
        f"est_time={estimate['calc_time_seconds']:.1f}s, "
        f"peak_memory={estimate['peak_memory_mb']:.0f}MB/{MAX_PEAK_MEMORY_MB}MB"
    )

    return estimate


def log_calculation_complete(estimate: dict, actual_time: float) -> None:
    """Log calculation completion with actual vs estimated time for model validation."""
    estimated_time = estimate['calc_time_seconds']
    ratio = actual_time / max(estimated_time, 0.1)

    logger.info(
        f"Calculation complete: actual={actual_time:.1f}s, "
        f"estimated={estimated_time:.1f}s, "
        f"ratio={ratio:.2f}"
    )

    if ratio > 2.0 or ratio < 0.5:
        logger.warning(
            f"Time estimate inaccurate: {ratio:.2f}x off. "
            f"Consider adjusting coefficients."
        )
