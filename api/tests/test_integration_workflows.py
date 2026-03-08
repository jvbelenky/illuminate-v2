"""Multi-step workflow integration tests that catch state mutation bugs."""

import pytest

from tests.conftest import API


# ============================================================
# Calculate → mutate → recalculate
# ============================================================

class TestCalculateRecalculate:
    def test_change_room_height_then_recalculate(self, calculated_session):
        client, headers, data1 = calculated_session
        first_stats = list(data1["zones"].values())[0]["statistics"]

        # Change room height — lamp stays at z=2.7 but room z changes to 4.0,
        # which moves the lamp away from ceiling, affecting the calculation.
        status = client.get(f"{API}/session/status", headers=headers).json()
        lamp_id = status["lamp_ids"][0]
        client.patch(
            f"{API}/session/lamps/{lamp_id}",
            json={"z": 4.0},
            headers=headers,
        )
        client.patch(f"{API}/session/room", json={"z": 4.0}, headers=headers)

        # Recalculate
        resp = client.post(f"{API}/session/calculate", headers=headers)
        assert resp.status_code == 200
        data2 = resp.json()
        second_stats = list(data2["zones"].values())[0]["statistics"]

        # Stats should differ — lamp is now further from the zone
        assert first_stats["mean"] != second_stats["mean"]

    def test_add_lamp_changes_state_hash(self, initialized_session, minimal_lamp_input):
        client, headers = initialized_session
        before = client.get(f"{API}/session/state-hashes", headers=headers).json()

        client.post(f"{API}/session/lamps", json=minimal_lamp_input, headers=headers)

        after = client.get(f"{API}/session/state-hashes", headers=headers).json()
        assert before != after

    def test_add_lamp_then_recalculate(self, calculated_session, minimal_lamp_input):
        client, headers, data1 = calculated_session
        first_stats = list(data1["zones"].values())[0]["statistics"]

        # Add a second lamp
        client.post(f"{API}/session/lamps", json=minimal_lamp_input, headers=headers)

        # Recalculate — with two lamps irradiance should be higher
        resp = client.post(f"{API}/session/calculate", headers=headers)
        assert resp.status_code == 200
        data2 = resp.json()
        second_stats = list(data2["zones"].values())[0]["statistics"]

        assert second_stats["max"] >= first_stats["max"]

    def test_delete_lamp_then_recalculate(self, calculated_session):
        client, headers, _ = calculated_session
        status = client.get(f"{API}/session/status", headers=headers).json()
        lamp_id = status["lamp_ids"][0]

        # Delete the only lamp
        client.delete(f"{API}/session/lamps/{lamp_id}", headers=headers)

        # Recalculate — with no lamps, all values should be zero
        resp = client.post(f"{API}/session/calculate", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        for zone in data["zones"].values():
            assert zone["statistics"]["max"] == 0 or zone["statistics"]["max"] is None


# ============================================================
# Full safety workflow
# ============================================================

class TestFullSafetyWorkflow:
    def test_init_with_standard_zones_calculate_then_check_lamps(self, standard_zones_session):
        client, headers = standard_zones_session

        # Calculate
        calc_resp = client.post(f"{API}/session/calculate", headers=headers)
        assert calc_resp.status_code == 200

        # Check lamps
        resp = client.post(f"{API}/session/check-lamps", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "status" in data
        assert data["status"] in (
            "compliant", "non_compliant",
            "compliant_with_dimming", "non_compliant_even_with_dimming",
        )

    def test_check_lamps_without_calculation_returns_409(self, standard_zones_session):
        client, headers = standard_zones_session
        # Skip calculation — safety check should fail
        resp = client.post(f"{API}/session/check-lamps", headers=headers)
        assert resp.status_code == 409


# ============================================================
# Unit conversion integration
# ============================================================

class TestUnitConversionIntegration:
    def test_meters_to_feet_converts_all_coordinates(self, initialized_session):
        client, headers = initialized_session
        resp = client.patch(
            f"{API}/session/units",
            json={"units": "feet"},
            headers=headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["units"] == "feet"
        # Room dimensions should be converted
        assert data["room"]["x"] > 4.0  # 4m ≈ 13.1ft
        # Lamp coordinates should be present
        assert len(data["lamps"]) >= 1
        # Zone coordinates should be present
        assert len(data["zones"]) >= 1

    def test_feet_to_meters_roundtrip(self, initialized_session):
        client, headers = initialized_session

        # Get original room dimensions
        status_before = client.get(f"{API}/session/status", headers=headers).json()
        orig_x = status_before["room"]["dimensions"][0]

        # Convert to feet
        client.patch(f"{API}/session/units", json={"units": "feet"}, headers=headers)

        # Convert back to meters
        resp = client.patch(
            f"{API}/session/units",
            json={"units": "meters"},
            headers=headers,
        )
        assert resp.status_code == 200
        # Should be within tolerance of original
        assert abs(resp.json()["room"]["x"] - orig_x) < 0.01

    def test_unit_conversion_changes_state_hashes(self, initialized_session):
        client, headers = initialized_session
        before = client.get(f"{API}/session/state-hashes", headers=headers).json()

        client.patch(f"{API}/session/units", json={"units": "feet"}, headers=headers)

        after = client.get(f"{API}/session/state-hashes", headers=headers).json()
        assert before != after

    def test_unit_conversion_converts_zone_bounds(self, multi_zone_session):
        client, headers, plane_id, volume_id = multi_zone_session
        resp = client.patch(
            f"{API}/session/units",
            json={"units": "feet"},
            headers=headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        # Both zone types should have converted coordinates
        assert plane_id in data["zones"] or volume_id in data["zones"]
        zones = data["zones"]
        if plane_id in zones:
            assert zones[plane_id]["height"] is not None
        if volume_id in zones:
            assert zones[volume_id]["x_max"] is not None


# ============================================================
# Init variations
# ============================================================

class TestInitVariations:
    def test_init_with_empty_lamps_and_zones(self, client, session_headers, minimal_room_config):
        resp = client.post(
            f"{API}/session/init",
            json={"room": minimal_room_config, "lamps": [], "zones": []},
            headers=session_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["lamp_count"] == 0
        assert data["zone_count"] == 0

        # Session should be active
        status = client.get(f"{API}/session/status", headers=session_headers).json()
        assert status["active"] is True

    def test_reinit_replaces_calculation_state(
        self, calculated_session, minimal_room_config, minimal_zone_input
    ):
        client, headers, calc_data = calculated_session
        first_zone_count = len(calc_data["zones"])
        assert first_zone_count >= 1

        # Re-init with a different room (no lamps/zones)
        resp = client.post(
            f"{API}/session/init",
            json={"room": {"x": 10.0, "y": 10.0, "z": 3.0, "units": "meters",
                           "standard": "ANSI IES RP 27.1-22 (ACGIH Limits)"}},
            headers=headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["lamp_count"] == 0
        assert data["zone_count"] == 0
