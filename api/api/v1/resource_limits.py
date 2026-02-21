"""
Resource cost estimation and budget enforcement.

Provides flexible limits - users can trade off between zones, lamps, and reflectance.
Implements a dynamic budget system that protects the server from resource exhaustion
while allowing users flexibility in how they allocate compute resources.
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

# Budget for 8GB server, 6GB available, targeting ~500MB peak per session
MAX_SESSION_BUDGET = 50_000_000  # 50M units
MAX_CONCURRENT_SESSIONS = 500
MAX_CONCURRENT_CALCULATIONS = 4  # Match server cores
QUEUE_TIMEOUT_SECONDS = 30  # Wait for calculation slot
CALCULATION_TIMEOUT_SECONDS = 300  # 5 minutes per calculation
MAX_CALC_TIME_SECONDS = CALCULATION_TIMEOUT_SECONDS * 0.8  # 240s, 20% headroom before timeout

# Cost coefficients (tunable based on validation data)
COST_PER_GRID_POINT = 10
COST_PER_LAMP = 50_000
COST_PER_REFLECTANCE_POINT = 1  # Per reflectance grid point per pass

# Minimum spacing guard (5mm) - prevents accidental massive grids
MIN_SPACING = 0.005


# =============================================================================
# Cost Estimation Functions
# =============================================================================


def estimate_session_cost(session: "Session") -> dict:
    """
    Estimate total resource cost for a session.

    Args:
        session: Session object with room, zone_id_map, and lamp_id_map

    Returns:
        Dictionary with cost breakdown including per-zone details
    """
    total_grid_points = 0
    zone_details: List[Dict] = []

    # Count grid points across all enabled zones
    for zone_id, zone in session.zone_id_map.items():
        enabled = getattr(zone, 'enabled', True)
        points = prod(zone.num_points)
        zone_cost = points * COST_PER_GRID_POINT

        zone_info = {
            'id': zone_id,
            'name': getattr(zone, 'name', None) or zone_id,
            'type': zone.calctype.lower(),
            'enabled': enabled,
            'grid_points': points,
            'cost': zone_cost if enabled else 0,
        }
        zone_details.append(zone_info)

        if enabled:
            total_grid_points += points

    # Sort zones by cost (highest first) for display
    zone_details.sort(key=lambda z: z['cost'], reverse=True)

    # Count enabled lamps with photometric data
    lamp_count = 0
    for lamp in session.lamp_id_map.values():
        if getattr(lamp, 'enabled', True) and getattr(lamp, 'ies', None) is not None:
            lamp_count += 1

    # Reflectance - only count if enabled
    reflectance_enabled = False
    reflectance_passes = 0
    reflectance_grid_points = 0
    reflectance_cost = 0

    # Check reflectance via ref_manager (the correct guv_calcs API)
    if session.room and hasattr(session.room, 'ref_manager') and session.room.ref_manager.enabled:
        reflectance_enabled = True
        reflectance_passes = session.room.ref_manager.max_num_passes or 5

        reflectance_grid_points = sum(
            prod(s.plane.num_points) for s in session.room.ref_manager.surfaces.values()
        )

        # Reflectance cost: grid points × passes × cost per point
        reflectance_cost = reflectance_grid_points * reflectance_passes * COST_PER_REFLECTANCE_POINT

    # Calculate total budget units
    grid_cost = total_grid_points * COST_PER_GRID_POINT
    lamp_cost = lamp_count * COST_PER_LAMP
    budget_units = grid_cost + lamp_cost + reflectance_cost

    # Memory estimates (bytes)
    stored_memory = total_grid_points * 8 + lamp_count * 40_000
    if reflectance_enabled:
        stored_memory += reflectance_grid_points * 8
    peak_memory = stored_memory + total_grid_points * 80

    # Time estimate (seconds) — delegated to guv_calcs which knows its own
    # calculation structure and caching state
    calc_time = session.room.estimate_calculation_time()

    return {
        'total_grid_points': total_grid_points,
        'zones': zone_details,
        'lamp_count': lamp_count,
        'reflectance_enabled': reflectance_enabled,
        'reflectance_passes': reflectance_passes,
        'reflectance_grid_points': reflectance_grid_points,
        'reflectance_cost': reflectance_cost,
        'grid_cost': grid_cost,
        'lamp_cost': lamp_cost,
        'stored_memory_mb': stored_memory / 1_000_000,
        'peak_memory_mb': peak_memory / 1_000_000,
        'calc_time_seconds': calc_time,
        'budget_units': budget_units,
    }


def get_budget_reduction_suggestions(estimate: dict, time_exceeded: bool = False) -> list:
    """
    Generate actionable suggestions based on what's using the most budget.

    Args:
        estimate: Result from estimate_session_cost()
        time_exceeded: Whether the time limit was the bottleneck

    Returns:
        List of suggestion strings
    """
    suggestions = []
    budget_units = estimate['budget_units']

    if budget_units == 0:
        return suggestions

    grid_cost = estimate['grid_cost']
    lamp_cost = estimate['lamp_cost']
    reflectance_cost = estimate['reflectance_cost']

    # Time-specific suggestions (time scales with lamp_count * grid_points)
    if time_exceeded:
        if estimate['lamp_count'] > 1:
            suggestions.append(
                f"Reduce number of lamps (currently {estimate['lamp_count']} — "
                f"calculation time scales linearly with lamp count)"
            )

    # Find the highest-cost zones
    zones = estimate.get('zones', [])
    high_cost_zones = [z for z in zones if z['enabled'] and z['cost'] > budget_units * 0.2]

    if high_cost_zones:
        for zone in high_cost_zones[:2]:  # Top 2 expensive zones
            suggestions.append(
                f"Reduce resolution of '{zone['name']}' zone "
                f"({zone['grid_points']:,} grid points)"
            )

    if grid_cost / budget_units > 0.5 and not high_cost_zones:
        suggestions.append(
            "Reduce grid resolution (increase spacing or decrease num_x/num_y/num_z)"
        )

    if estimate['reflectance_enabled']:
        if reflectance_cost / budget_units > 0.3:
            suggestions.append(
                f"Reduce reflectance passes (currently {estimate['reflectance_passes']})"
            )
        suggestions.append("Disable reflectance calculation")

    if estimate['lamp_count'] > 5 and not time_exceeded:
        suggestions.append(
            f"Disable some lamps (currently {estimate['lamp_count']} enabled)"
        )

    # If we still don't have suggestions, add generic ones
    if not suggestions:
        suggestions.append("Remove or disable some calculation zones")

    return suggestions


def check_budget(session: "Session", additional_cost: int = 0) -> None:
    """
    Check if session exceeds budget and raise HTTPException if so.

    Enforces two limits:
    1. Memory budget (MAX_SESSION_BUDGET)
    2. Estimated calculation time (MAX_CALC_TIME_SECONDS)

    Args:
        session: Session object to check
        additional_cost: Additional budget units to add (for pre-flight checks)

    Raises:
        HTTPException: 400 error with detailed budget breakdown if over limit
    """
    estimate = estimate_session_cost(session)
    total = estimate['budget_units'] + additional_cost
    calc_time = estimate['calc_time_seconds']

    budget_exceeded = total > MAX_SESSION_BUDGET
    time_exceeded = calc_time > MAX_CALC_TIME_SECONDS

    if not budget_exceeded and not time_exceeded:
        return

    # Avoid division by zero
    budget_units = estimate['budget_units'] or 1

    # Build zone breakdown for frontend
    zone_breakdown = []
    for zone in estimate['zones']:
        if zone['enabled']:
            zone_breakdown.append({
                'id': zone['id'],
                'name': zone['name'],
                'type': zone['type'],
                'grid_points': zone['grid_points'],
                'cost': zone['cost'],
                'percent': round(zone['cost'] / budget_units * 100) if budget_units else 0,
            })

    detail = {
        "error": "budget_exceeded",
        "message": "Session exceeds compute budget" if budget_exceeded else "Estimated calculation time exceeds limit",
        "budget": {
            "used": total,
            "max": MAX_SESSION_BUDGET,
            "percent": round(total / MAX_SESSION_BUDGET * 100),
        },
        "breakdown": {
            "zones": zone_breakdown,
            "lamps": {
                "count": estimate['lamp_count'],
                "cost": estimate['lamp_cost'],
                "percent": round(estimate['lamp_cost'] / budget_units * 100) if budget_units else 0,
            },
        },
        "suggestions": get_budget_reduction_suggestions(estimate, time_exceeded=time_exceeded),
    }

    # Include time estimate when time is exceeded (or when it's close)
    if time_exceeded or calc_time > MAX_CALC_TIME_SECONDS * 0.5:
        detail["time_estimate"] = {
            "estimated_seconds": round(calc_time, 1),
            "max_seconds": MAX_CALC_TIME_SECONDS,
            "percent": round(calc_time / MAX_CALC_TIME_SECONDS * 100),
        }

    # Only include reflectance in breakdown if enabled
    if estimate['reflectance_enabled']:
        detail["breakdown"]["reflectance"] = {
            "enabled": True,
            "passes": estimate['reflectance_passes'],
            "grid_points": estimate['reflectance_grid_points'],
            "cost": estimate['reflectance_cost'],
            "percent": round(estimate['reflectance_cost'] / budget_units * 100) if budget_units else 0,
        }

    raise HTTPException(status_code=400, detail=detail)


def log_calculation_start(session: "Session") -> dict:
    """
    Log calculation start with cost estimate. Returns estimate for later comparison.

    Args:
        session: Session about to run calculation

    Returns:
        Cost estimate dictionary
    """
    estimate = estimate_session_cost(session)

    refl_info = ""
    if estimate['reflectance_enabled']:
        refl_info = f", reflectance={estimate['reflectance_passes']} passes"

    logger.info(
        f"Calculation starting: grid={estimate['total_grid_points']:,}, "
        f"lamps={estimate['lamp_count']}{refl_info}, "
        f"est_time={estimate['calc_time_seconds']:.1f}s, "
        f"budget={estimate['budget_units']:,}/{MAX_SESSION_BUDGET:,}"
    )

    return estimate


def log_calculation_complete(estimate: dict, actual_time: float) -> None:
    """
    Log calculation completion with actual vs estimated time for model validation.

    Args:
        estimate: Cost estimate from log_calculation_start()
        actual_time: Actual calculation time in seconds
    """
    estimated_time = estimate['calc_time_seconds']
    ratio = actual_time / max(estimated_time, 0.1)

    logger.info(
        f"Calculation complete: actual={actual_time:.1f}s, "
        f"estimated={estimated_time:.1f}s, "
        f"ratio={ratio:.2f}"
    )

    # Warn if estimate is significantly off
    if ratio > 2.0 or ratio < 0.5:
        logger.warning(
            f"Time estimate inaccurate: {ratio:.2f}x off. "
            f"Consider adjusting COST coefficients."
        )
