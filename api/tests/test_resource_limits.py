"""Resource limits unit tests and HTTP integration tests."""

from math import prod
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from tests.conftest import API
from api.v1.resource_limits import (
    estimate_session_cost,
    check_budget,
    get_budget_reduction_suggestions,
    MAX_PEAK_MEMORY_MB,
    MAX_CALC_TIME_SECONDS,
)
from guv_calcs.performance import (
    BYTES_PER_ZONE_POINT_BASE,
    BYTES_PER_ZONE_POINT_PER_LAMP,
    BYTES_PER_LAMP,
    BYTES_PER_FORM_FACTOR_ENTRY,
    PEAK_MULTIPLIER,
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


def _make_session(zones=None, lamps=None, reflectance_enabled=False, surface_num_points=(10, 10)):
    session = MagicMock()
    zones = zones or []
    lamps = lamps or []
    session.zone_id_map = {f"z{i}": z for i, z in enumerate(zones)}
    session.lamp_id_map = {f"l{i}": l for i, l in enumerate(lamps)}

    # Room mock
    room = MagicMock()
    room.ref_manager.enabled = reflectance_enabled
    room.estimate_calculation_time.return_value = 1.0

    num_surfaces = 6
    if reflectance_enabled:
        surface = MagicMock()
        surface.plane.num_points = surface_num_points
        room.ref_manager.max_num_passes = 5
        room.surfaces = {
            "floor": surface, "ceiling": surface,
            "north": surface, "south": surface,
            "east": surface, "west": surface,
        }
    else:
        room.surfaces = {}
        room.ref_manager.max_num_passes = 0
        num_surfaces = 0

    # Build a realistic estimate_memory return value
    lamp_count = sum(
        1 for l in lamps
        if getattr(l, 'enabled', True) and getattr(l, 'ies', None) is not None
    )
    total_zone_points = sum(
        prod(z.num_points) for z in zones if getattr(z, 'enabled', True)
    )
    refl_grid_points = num_surfaces * prod(surface_num_points) if reflectance_enabled else 0
    lamp_bytes = lamp_count * BYTES_PER_LAMP
    zone_bytes = total_zone_points * (BYTES_PER_ZONE_POINT_BASE + lamp_count * BYTES_PER_ZONE_POINT_PER_LAMP)
    refl_bytes = 0
    if reflectance_enabled and refl_grid_points > 0:
        avg_per_surf = refl_grid_points / max(num_surfaces, 1)
        refl_bytes = (num_surfaces * avg_per_surf * total_zone_points * BYTES_PER_FORM_FACTOR_ENTRY
                      + refl_grid_points ** 2 * BYTES_PER_FORM_FACTOR_ENTRY)
    stored = lamp_bytes + zone_bytes + refl_bytes
    room.estimate_memory.return_value = {
        'lamp_bytes': lamp_bytes,
        'zone_bytes': zone_bytes,
        'reflectance_bytes': refl_bytes,
        'stored_bytes': stored,
        'peak_bytes': stored * PEAK_MULTIPLIER,
        'total_zone_points': total_zone_points,
        'lamp_count': lamp_count,
        'reflectance_grid_points': refl_grid_points,
        'num_surfaces': num_surfaces,
    }

    session.room = room
    return session


# ============================================================
# estimate_session_cost
# ============================================================

class TestEstimateSessionCost:
    def test_empty_session_returns_zero_memory(self):
        session = _make_session()
        est = estimate_session_cost(session)
        assert est["total_grid_points"] == 0
        assert est["peak_memory_mb"] == 0

    def test_single_zone_memory_proportional_to_points(self):
        zone = _make_zone(num_points=(100, 100))
        session = _make_session(zones=[zone])
        est = estimate_session_cost(session)
        assert est["total_grid_points"] == 10000
        # Zone memory should be proportional to grid points
        assert est["zone_memory_mb"] > 0

    def test_disabled_zone_excluded_from_memory(self):
        zone = _make_zone(num_points=(10, 10), enabled=False)
        session = _make_session(zones=[zone])
        est = estimate_session_cost(session)
        assert est["total_grid_points"] == 0
        assert len(est["zones"]) == 1
        assert est["zones"][0]["memory_mb"] == 0

    def test_lamp_count_only_includes_enabled_with_ies(self):
        lamps = [
            _make_lamp(enabled=True, has_ies=True),
            _make_lamp(enabled=True, has_ies=False),
            _make_lamp(enabled=False, has_ies=True),
        ]
        session = _make_session(lamps=lamps)
        est = estimate_session_cost(session)
        assert est["lamp_count"] == 1

    def test_reflectance_dominates_memory(self):
        """Reflectance with 10×10 surfaces should add significant memory."""
        zone = _make_zone(num_points=(10, 10))
        lamp = _make_lamp()
        no_refl = _make_session(zones=[zone], lamps=[lamp], reflectance_enabled=False)
        with_refl = _make_session(zones=[zone], lamps=[lamp], reflectance_enabled=True)
        est_no = estimate_session_cost(no_refl)
        est_yes = estimate_session_cost(with_refl)
        assert est_yes["peak_memory_mb"] > est_no["peak_memory_mb"] * 2
        assert est_yes["reflectance_memory_mb"] > 0

    def test_reflectance_memory_scales_quadratically(self):
        """Doubling surface resolution should ~4x the reflectance memory."""
        zone = _make_zone(num_points=(10, 10))
        lamp = _make_lamp()
        small = _make_session(zones=[zone], lamps=[lamp],
                              reflectance_enabled=True, surface_num_points=(5, 5))
        large = _make_session(zones=[zone], lamps=[lamp],
                              reflectance_enabled=True, surface_num_points=(10, 10))
        est_small = estimate_session_cost(small)
        est_large = estimate_session_cost(large)
        # 10×10 has 4× the points per surface → 16× total refl_points²
        ratio = est_large["reflectance_memory_mb"] / max(est_small["reflectance_memory_mb"], 0.01)
        assert ratio > 10  # Should be ~16x but exact ratio depends on surf-zone cross term

    def test_peak_memory_exceeds_stored(self):
        zone = _make_zone(num_points=(10, 10))
        session = _make_session(zones=[zone], lamps=[_make_lamp()])
        est = estimate_session_cost(session)
        assert est["peak_memory_mb"] >= est["stored_memory_mb"]


# ============================================================
# check_budget
# ============================================================

class TestCheckBudget:
    def test_under_budget_passes(self):
        session = _make_session(zones=[_make_zone(num_points=(5, 5))])
        # Should not raise
        check_budget(session)

    def test_over_memory_raises_400(self):
        """A massive reflectance grid should exceed memory limit."""
        zone = _make_zone(num_points=(100, 100))
        session = _make_session(
            zones=[zone], lamps=[_make_lamp()],
            reflectance_enabled=True, surface_num_points=(50, 50),
        )
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
    def test_high_memory_zone_gets_resolution_suggestion(self):
        estimate = {
            "peak_memory_mb": 200,
            "lamp_memory_mb": 10,
            "zone_memory_mb": 180,
            "reflectance_memory_mb": 0,
            "reflectance_enabled": False,
            "reflectance_passes": 0,
            "reflectance_grid_points": 0,
            "lamp_count": 1,
            "zones": [
                {"id": "z0", "name": "big zone", "enabled": True, "memory_mb": 90, "grid_points": 10000},
            ],
        }
        suggestions = get_budget_reduction_suggestions(estimate, memory_exceeded=True)
        assert any("resolution" in s.lower() or "big zone" in s for s in suggestions)

    def test_reflectance_gets_disable_suggestion(self):
        estimate = {
            "peak_memory_mb": 500,
            "lamp_memory_mb": 10,
            "zone_memory_mb": 10,
            "reflectance_memory_mb": 400,
            "reflectance_enabled": True,
            "reflectance_passes": 10,
            "reflectance_grid_points": 600,
            "lamp_count": 1,
            "zones": [],
        }
        suggestions = get_budget_reduction_suggestions(estimate, memory_exceeded=True)
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
        assert data["memory_percent"] < 100
        assert data["estimated_seconds"] >= 0

    def test_reflectance_memory_increase(
        self, client, session_headers, minimal_lamp_input, minimal_zone_input
    ):
        """Enabling reflectance should increase memory usage."""
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

        assert after["memory_percent"] > before["memory_percent"]


# ============================================================
# Resource limit constants
# ============================================================

class TestResourceLimitConstants:
    def test_constants_are_positive(self):
        assert MAX_PEAK_MEMORY_MB > 0
        assert MAX_CALC_TIME_SECONDS > 0
        assert BYTES_PER_ZONE_POINT_BASE > 0
        assert BYTES_PER_LAMP > 0

    def test_max_calc_time_less_than_timeout(self):
        from api.v1.resource_limits import CALCULATION_TIMEOUT_SECONDS
        assert MAX_CALC_TIME_SECONDS < CALCULATION_TIMEOUT_SECONDS
