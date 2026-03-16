"""Resource limits unit tests and HTTP integration tests."""

from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from tests.conftest import API
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
        room.surfaces = {"floor": surface}
    else:
        room.surfaces = {}
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


# ============================================================
# HTTP integration tests for budget
# ============================================================

class TestBudgetHTTPIntegration:
    def test_budget_response_structure(
        self, client, session_headers, minimal_room_config, minimal_lamp_input
    ):
        """A huge zone should fail budget check with structured error."""
        resp = client.post(
            f"{API}/session/init",
            json={
                "room": minimal_room_config,
                "lamps": [minimal_lamp_input],
                "zones": [{
                    "type": "plane",
                    "height": 1.0,
                    "x1": 0.0, "x2": 4.0,
                    "y1": 0.0, "y2": 6.0,
                    "num_x": 3000, "num_y": 3000,
                }],
            },
            headers=session_headers,
        )
        assert resp.status_code == 200

        calc_resp = client.post(f"{API}/session/calculate", headers=session_headers)
        assert calc_resp.status_code == 400
        data = calc_resp.json()
        assert "detail" in data

    def test_estimate_response_under_budget(self, initialized_session):
        client, headers = initialized_session
        data = client.get(f"{API}/session/calculate/estimate", headers=headers).json()
        assert data["budget_percent"] < 100
        assert data["estimated_seconds"] >= 0

    def test_reflectance_budget_increase(
        self, client, session_headers, minimal_lamp_input, minimal_zone_input
    ):
        """Enabling reflectance should increase budget usage."""
        # Init without reflectance
        client.post(
            f"{API}/session/init",
            json={
                "room": {
                    "x": 4.0, "y": 6.0, "z": 2.7,
                    "units": "meters",
                    "standard": "ANSI IES RP 27.1-22 (ACGIH Limits)",
                },
                "lamps": [minimal_lamp_input],
                "zones": [minimal_zone_input],
            },
            headers=session_headers,
        )
        before = client.get(f"{API}/session/calculate/estimate", headers=session_headers).json()

        # Enable reflectance
        client.patch(
            f"{API}/session/room",
            json={"enable_reflectance": True},
            headers=session_headers,
        )
        after = client.get(f"{API}/session/calculate/estimate", headers=session_headers).json()

        assert after["budget_percent"] > before["budget_percent"]


# ============================================================
# Resource limit constants
# ============================================================

class TestResourceLimitConstants:
    def test_constants_are_positive(self):
        assert COST_PER_GRID_POINT > 0
        assert MAX_SESSION_BUDGET > 0
        assert MAX_CALC_TIME_SECONDS > 0

    def test_max_calc_time_less_than_timeout(self):
        from api.v1.resource_limits import CALCULATION_TIMEOUT_SECONDS
        # MAX_CALC_TIME should be less than timeout (20% headroom)
        assert MAX_CALC_TIME_SECONDS < CALCULATION_TIMEOUT_SECONDS
