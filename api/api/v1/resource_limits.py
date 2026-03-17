"""
Resource cost estimation and budget enforcement.

Memory estimates are calibrated from tracemalloc profiling of guv_calcs Room
objects across 11 configurations (varying lamp count, room size, surface
resolution, and reflectance value).  The dominant memory consumer is
reflectance form-factor matrices, which scale as O(surface_points² ×
zone_points).

Time estimates come from guv_calcs' estimate_calculation_time(), padded with
measured API overhead (budget checks, thread dispatch, serialization).
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

# Memory coefficients — calibrated from tracemalloc profiling.
# See plan file for validation table.
BYTES_PER_LAMP = 1_000_000         # ~1 MB (IES photometry + spectrum + metadata)
BYTES_PER_ZONE_POINT_BASE = 90     # Zone result arrays + overhead
BYTES_PER_ZONE_POINT_PER_LAMP = 8  # 2 × float32 per lamp in cache
BYTES_PER_FORM_FACTOR_ENTRY = 8    # form_factors + theta_zone: 2 × float32

# Peak multiplier: temporaries during form factor computation use ~2×
PEAK_MULTIPLIER = 2.0

# Minimum spacing guard (5mm) - prevents accidental massive grids
MIN_SPACING = 0.005


# =============================================================================
# Cost Estimation Functions
# =============================================================================


def estimate_session_cost(session: "Session") -> dict:
    """
    Estimate memory and time cost for a session.

    Memory model (empirically calibrated):
    - Per lamp: ~1 MB (IES data, spectrum, metadata)
    - Per zone point: 90 bytes base + 8 bytes per lamp (cache entries)
    - Reflectance form factors: 8 bytes × surface_points × zone_points per surface
      + 8 bytes × total_surface_points² (surface↔surface interreflection)
    - Peak ≈ 2× allocated (temporaries during form factor computation)

    Returns:
        Dictionary with memory breakdown, time estimate, and per-zone details
    """
    total_grid_points = 0
    zone_details: List[Dict] = []

    # Count grid points across all enabled zones
    for zone_id, zone in session.zone_id_map.items():
        enabled = getattr(zone, 'enabled', True)
        points = prod(zone.num_points)
        zone_mem_bytes = points * BYTES_PER_ZONE_POINT_BASE

        zone_info = {
            'id': zone_id,
            'name': getattr(zone, 'name', None) or zone_id,
            'type': zone.calctype.lower(),
            'enabled': enabled,
            'grid_points': points,
            'memory_mb': round(zone_mem_bytes / 1_000_000, 1) if enabled else 0,
        }
        zone_details.append(zone_info)

        if enabled:
            total_grid_points += points

    # Sort zones by memory (highest first) for display
    zone_details.sort(key=lambda z: z['memory_mb'], reverse=True)

    # Count enabled lamps with photometric data
    lamp_count = 0
    for lamp in session.lamp_id_map.values():
        if getattr(lamp, 'enabled', True) and getattr(lamp, 'ies', None) is not None:
            lamp_count += 1

    # Reflectance surface info
    reflectance_enabled = False
    reflectance_passes = 0
    reflectance_grid_points = 0
    num_surfaces = 0

    if session.room and hasattr(session.room, 'ref_manager') and session.room.ref_manager.enabled:
        reflectance_enabled = True
        reflectance_passes = session.room.ref_manager.max_num_passes or 5
        num_surfaces = len(session.room.surfaces)
        reflectance_grid_points = sum(
            prod(s.plane.num_points) for s in session.room.surfaces.values()
        )

    # Memory estimate (bytes)
    lamp_mem = lamp_count * BYTES_PER_LAMP
    zone_mem = total_grid_points * (
        BYTES_PER_ZONE_POINT_BASE + lamp_count * BYTES_PER_ZONE_POINT_PER_LAMP
    )

    refl_mem = 0
    if reflectance_enabled and reflectance_grid_points > 0:
        # Surface → zone form factors: each surface caches (surface_points × zone_points)
        # for form_factors + theta_zone arrays
        avg_pts_per_surface = reflectance_grid_points / max(num_surfaces, 1)
        surf_zone_ff = (num_surfaces * avg_pts_per_surface
                        * total_grid_points * BYTES_PER_FORM_FACTOR_ENTRY)
        # Surface ↔ surface form factors during interreflection
        surf_surf_ff = reflectance_grid_points ** 2 * BYTES_PER_FORM_FACTOR_ENTRY
        refl_mem = surf_zone_ff + surf_surf_ff

    stored_memory = lamp_mem + zone_mem + refl_mem
    peak_memory = stored_memory * PEAK_MULTIPLIER

    # Time estimate (seconds) — guv_calcs estimates pure calculation time;
    # pad with API overhead (budget checks, thread dispatch, result
    # serialization, JSON encoding). Uses 1.5x multiplier for large calcs
    # and +2s floor for trivially fast ones where fixed overhead dominates.
    raw_calc_time = session.room.estimate_calculation_time()
    calc_time = max(raw_calc_time * 1.5, raw_calc_time + 2.0)

    return {
        'total_grid_points': total_grid_points,
        'zones': zone_details,
        'lamp_count': lamp_count,
        'reflectance_enabled': reflectance_enabled,
        'reflectance_passes': reflectance_passes,
        'reflectance_grid_points': reflectance_grid_points,
        'lamp_memory_mb': round(lamp_mem / 1_000_000, 1),
        'zone_memory_mb': round(zone_mem / 1_000_000, 1),
        'reflectance_memory_mb': round(refl_mem / 1_000_000, 1),
        'stored_memory_mb': round(stored_memory / 1_000_000, 1),
        'peak_memory_mb': round(peak_memory / 1_000_000, 1),
        'calc_time_seconds': calc_time,
    }


def get_budget_reduction_suggestions(estimate: dict, time_exceeded: bool = False, memory_exceeded: bool = False) -> list:
    """
    Generate actionable suggestions based on what's using the most resources.

    Args:
        estimate: Result from estimate_session_cost()
        time_exceeded: Whether the time limit was the bottleneck
        memory_exceeded: Whether the memory limit was the bottleneck

    Returns:
        List of suggestion strings
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

    Args:
        session: Session object to check
        additional_memory_mb: Additional memory in MB to add (for pre-flight checks)

    Raises:
        HTTPException: 400 error with detailed breakdown if over limit
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
    """
    Log calculation start with cost estimate. Returns estimate for later comparison.
    """
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
    """
    Log calculation completion with actual vs estimated time for model validation.
    """
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
