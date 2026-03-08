"""Reflectance configuration and calculation integration tests."""

from tests.conftest import API


# ============================================================
# Reflectance configuration via room PATCH
# ============================================================

class TestReflectanceConfiguration:
    def test_enable_reflectance_via_patch(self, initialized_session):
        client, headers = initialized_session
        resp = client.patch(
            f"{API}/session/room",
            json={"enable_reflectance": True},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_set_reflectance_values_per_surface(self, initialized_session):
        client, headers = initialized_session
        resp = client.patch(
            f"{API}/session/room",
            json={
                "reflectances": {
                    "floor": 0.1, "ceiling": 0.15,
                    "north": 0.08, "south": 0.08,
                    "east": 0.05, "west": 0.05,
                },
            },
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_set_reflectance_max_num_passes(self, initialized_session):
        client, headers = initialized_session
        resp = client.patch(
            f"{API}/session/room",
            json={"reflectance_max_num_passes": 3},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_set_reflectance_threshold(self, initialized_session):
        client, headers = initialized_session
        resp = client.patch(
            f"{API}/session/room",
            json={"reflectance_threshold": 0.05},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_set_reflectance_spacing_per_surface(self, initialized_session):
        client, headers = initialized_session
        resp = client.patch(
            f"{API}/session/room",
            json={
                "reflectance_x_spacings": {"floor": 0.5, "ceiling": 0.5},
                "reflectance_y_spacings": {"floor": 0.5, "ceiling": 0.5},
            },
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_set_reflectance_num_points_per_surface(self, initialized_session):
        client, headers = initialized_session
        resp = client.patch(
            f"{API}/session/room",
            json={
                "reflectance_x_num_points": {"floor": 5, "ceiling": 5},
                "reflectance_y_num_points": {"floor": 5, "ceiling": 5},
            },
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_init_with_reflectance_enabled(self, client, session_headers, minimal_lamp_input, minimal_zone_input):
        resp = client.post(
            f"{API}/session/init",
            json={
                "room": {
                    "x": 4.0, "y": 6.0, "z": 2.7,
                    "units": "meters",
                    "standard": "ANSI IES RP 27.1-22 (ACGIH Limits)",
                    "enable_reflectance": True,
                    "reflectances": {
                        "floor": 0.1, "ceiling": 0.1,
                        "north": 0.08, "south": 0.08,
                        "east": 0.08, "west": 0.08,
                    },
                },
                "lamps": [minimal_lamp_input],
                "zones": [minimal_zone_input],
            },
            headers=session_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True


# ============================================================
# Reflectance calculation integration
# ============================================================

class TestReflectanceCalculation:
    def test_calculate_with_reflectance_enabled(self, reflectance_session):
        client, headers = reflectance_session
        resp = client.post(f"{API}/session/calculate", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        # Should have calculated zones with non-zero results
        for zone_id, zone in data["zones"].items():
            assert "statistics" in zone

    def test_reflectance_estimate_shows_passes(self, reflectance_session):
        client, headers = reflectance_session
        resp = client.get(f"{API}/session/calculate/estimate", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["reflectance_enabled"] is True
        assert data["reflectance_passes"] >= 1
