"""Pure unit tests for resource_limits.py functions (no HTTP)."""

from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from api.v1.resource_limits import (
    estimate_session_cost,
    check_budget,
    get_budget_reduction_suggestions,
    COST_PER_GRID_POINT,
    MAX_SESSION_BUDGET,
    MAX_CALC_TIME_SECONDS,
)


def _make_zone(num_points=(5, 5), enabled=True, calctype="plane", name="test"):
    zone = MagicMock()
    zone.num_points = num_points
    zone.enabled = enabled
    zone.calctype = calctype
    zone.name = name
    return zone


def _make_lamp(enabled=True, has_ies=True):
    lamp = MagicMock()
    lamp.enabled = enabled
    lamp.ies = MagicMock() if has_ies else None
    return lamp


def _make_session(zones=None, lamps=None, reflectance_enabled=False):
    session = MagicMock()
    session.zone_id_map = {f"z{i}": z for i, z in enumerate(zones or [])}
    session.lamp_id_map = {f"l{i}": l for i, l in enumerate(lamps or [])}

    # Room mock
    room = MagicMock()
    room.ref_manager.enabled = reflectance_enabled
    room.estimate_calculation_time.return_value = 1.0
    if reflectance_enabled:
        surface = MagicMock()
        surface.plane.num_points = (10, 10)
        room.ref_manager.max_num_passes = 5
        room.ref_manager.surfaces = {"floor": surface}
    else:
        room.ref_manager.surfaces = {}
        room.ref_manager.max_num_passes = 0
    session.room = room
    return session


# ============================================================
# estimate_session_cost
# ============================================================

class TestEstimateSessionCost:
    def test_empty_session_returns_zero_cost(self):
        session = _make_session()
        est = estimate_session_cost(session)
        assert est["total_grid_points"] == 0
        assert est["budget_units"] == 0

    def test_single_zone_cost_is_points_times_coefficient(self):
        zone = _make_zone(num_points=(10, 10))
        session = _make_session(zones=[zone])
        est = estimate_session_cost(session)
        assert est["total_grid_points"] == 100
        assert est["grid_cost"] == 100 * COST_PER_GRID_POINT

    def test_disabled_zone_excluded_from_cost(self):
        zone = _make_zone(num_points=(10, 10), enabled=False)
        session = _make_session(zones=[zone])
        est = estimate_session_cost(session)
        assert est["total_grid_points"] == 0
        # Zone should still appear in details
        assert len(est["zones"]) == 1
        assert est["zones"][0]["cost"] == 0

    def test_lamp_count_only_includes_enabled_with_ies(self):
        lamps = [
            _make_lamp(enabled=True, has_ies=True),
            _make_lamp(enabled=True, has_ies=False),
            _make_lamp(enabled=False, has_ies=True),
        ]
        session = _make_session(lamps=lamps)
        est = estimate_session_cost(session)
        assert est["lamp_count"] == 1


# ============================================================
# check_budget
# ============================================================

class TestCheckBudget:
    def test_under_budget_passes(self):
        session = _make_session(zones=[_make_zone(num_points=(5, 5))])
        # Should not raise
        check_budget(session)

    def test_over_budget_raises_400(self):
        # Create a zone so large it exceeds the budget
        huge_points = int((MAX_SESSION_BUDGET / COST_PER_GRID_POINT) ** 0.5) + 100
        zone = _make_zone(num_points=(huge_points, huge_points))
        session = _make_session(zones=[zone])
        with pytest.raises(HTTPException) as exc_info:
            check_budget(session)
        assert exc_info.value.status_code == 400

    def test_time_exceeded_raises_400(self):
        zone = _make_zone(num_points=(5, 5))
        session = _make_session(zones=[zone])
        # Make the time estimate exceed the limit
        session.room.estimate_calculation_time.return_value = MAX_CALC_TIME_SECONDS + 100
        with pytest.raises(HTTPException) as exc_info:
            check_budget(session)
        assert exc_info.value.status_code == 400


# ============================================================
# get_budget_reduction_suggestions
# ============================================================

class TestBudgetSuggestions:
    def test_high_cost_zone_gets_resolution_suggestion(self):
        estimate = {
            "budget_units": 1000,
            "grid_cost": 800,
            "lamp_cost": 200,
            "reflectance_cost": 0,
            "reflectance_enabled": False,
            "reflectance_passes": 0,
            "lamp_count": 1,
            "zones": [
                {"id": "z0", "name": "big zone", "enabled": True, "cost": 800, "grid_points": 10000},
            ],
        }
        suggestions = get_budget_reduction_suggestions(estimate)
        assert any("resolution" in s.lower() or "big zone" in s for s in suggestions)

    def test_reflectance_gets_disable_suggestion(self):
        estimate = {
            "budget_units": 1000,
            "grid_cost": 200,
            "lamp_cost": 200,
            "reflectance_cost": 600,
            "reflectance_enabled": True,
            "reflectance_passes": 10,
            "lamp_count": 1,
            "zones": [],
        }
        suggestions = get_budget_reduction_suggestions(estimate)
        assert any("reflectance" in s.lower() for s in suggestions)
