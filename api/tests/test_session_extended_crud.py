"""Extended CRUD tests for zones, lamps, and room mutations."""

import pytest

from tests.conftest import API


class TestZoneUpdate:
    def test_update_height(self, initialized_session):
        client, headers = initialized_session
        status = client.get(f"{API}/session/status", headers=headers).json()
        zone_id = status["zone_ids"][0]
        resp = client.patch(
            f"{API}/session/zones/{zone_id}",
            json={"height": 1.2},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_update_bounds(self, initialized_session):
        client, headers = initialized_session
        status = client.get(f"{API}/session/status", headers=headers).json()
        zone_id = status["zone_ids"][0]
        resp = client.patch(
            f"{API}/session/zones/{zone_id}",
            json={"x1": 0.5, "x2": 3.5, "y1": 0.5, "y2": 5.5},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_update_enabled(self, initialized_session):
        client, headers = initialized_session
        status = client.get(f"{API}/session/status", headers=headers).json()
        zone_id = status["zone_ids"][0]
        resp = client.patch(
            f"{API}/session/zones/{zone_id}",
            json={"enabled": False},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_update_dose_mode(self, initialized_session):
        client, headers = initialized_session
        status = client.get(f"{API}/session/status", headers=headers).json()
        zone_id = status["zone_ids"][0]
        resp = client.patch(
            f"{API}/session/zones/{zone_id}",
            json={"dose": True, "hours": 4.0},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_nonexistent_returns_404(self, initialized_session):
        client, headers = initialized_session
        resp = client.patch(
            f"{API}/session/zones/nonexistent",
            json={"height": 1.0},
            headers=headers,
        )
        assert resp.status_code == 404


class TestZoneCopy:
    def test_returns_new_id(self, initialized_session):
        client, headers = initialized_session
        status = client.get(f"{API}/session/status", headers=headers).json()
        zone_id = status["zone_ids"][0]
        resp = client.post(f"{API}/session/zones/{zone_id}/copy", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["zone_id"] != zone_id

    def test_count_increases(self, initialized_session):
        client, headers = initialized_session
        before = client.get(f"{API}/session/status", headers=headers).json()["zone_count"]
        zone_id = before and client.get(f"{API}/session/status", headers=headers).json()["zone_ids"][0]
        client.post(f"{API}/session/zones/{zone_id}/copy", headers=headers)
        after = client.get(f"{API}/session/status", headers=headers).json()["zone_count"]
        assert after == before + 1

    def test_nonexistent_returns_404(self, initialized_session):
        client, headers = initialized_session
        resp = client.post(f"{API}/session/zones/nonexistent/copy", headers=headers)
        assert resp.status_code == 404


class TestLampCopy:
    def test_returns_new_id(self, initialized_session):
        client, headers = initialized_session
        status = client.get(f"{API}/session/status", headers=headers).json()
        lamp_id = status["lamp_ids"][0]
        resp = client.post(f"{API}/session/lamps/{lamp_id}/copy", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["lamp_id"] != lamp_id

    def test_count_increases(self, initialized_session):
        client, headers = initialized_session
        status = client.get(f"{API}/session/status", headers=headers).json()
        before = status["lamp_count"]
        lamp_id = status["lamp_ids"][0]
        client.post(f"{API}/session/lamps/{lamp_id}/copy", headers=headers)
        after = client.get(f"{API}/session/status", headers=headers).json()["lamp_count"]
        assert after == before + 1

    def test_nonexistent_returns_404(self, initialized_session):
        client, headers = initialized_session
        resp = client.post(f"{API}/session/lamps/nonexistent/copy", headers=headers)
        assert resp.status_code == 404


class TestLampPlace:
    def test_downlight_mode(self, initialized_session):
        client, headers = initialized_session
        status = client.get(f"{API}/session/status", headers=headers).json()
        lamp_id = status["lamp_ids"][0]
        resp = client.post(
            f"{API}/session/lamps/{lamp_id}/place",
            json={"mode": "downlight"},
            headers=headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "x" in data and "y" in data and "z" in data
        assert data["mode"] == "downlight"

    def test_corner_mode(self, initialized_session):
        client, headers = initialized_session
        status = client.get(f"{API}/session/status", headers=headers).json()
        lamp_id = status["lamp_ids"][0]
        resp = client.post(
            f"{API}/session/lamps/{lamp_id}/place",
            json={"mode": "corner", "position_index": 0},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["mode"] == "corner"

    def test_edge_mode(self, initialized_session):
        client, headers = initialized_session
        status = client.get(f"{API}/session/status", headers=headers).json()
        lamp_id = status["lamp_ids"][0]
        resp = client.post(
            f"{API}/session/lamps/{lamp_id}/place",
            json={"mode": "edge", "position_index": 0},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["mode"] == "edge"

    def test_nonexistent_returns_404(self, initialized_session):
        client, headers = initialized_session
        resp = client.post(
            f"{API}/session/lamps/nonexistent/place",
            json={"mode": "downlight"},
            headers=headers,
        )
        assert resp.status_code == 404


class TestRoomExtendedPatch:
    def test_update_air_changes(self, initialized_session):
        client, headers = initialized_session
        resp = client.patch(
            f"{API}/session/room",
            json={"air_changes": 3.0},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_update_ozone_decay(self, initialized_session):
        client, headers = initialized_session
        resp = client.patch(
            f"{API}/session/room",
            json={"ozone_decay_constant": 5.0},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_update_standard(self, initialized_session):
        client, headers = initialized_session
        resp = client.patch(
            f"{API}/session/room",
            json={"standard": "ICNIRP"},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_update_reflectance(self, initialized_session):
        client, headers = initialized_session
        resp = client.patch(
            f"{API}/session/room",
            json={"enable_reflectance": True},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True


# ============================================================
# Volume zone geometry updates
# ============================================================

@pytest.fixture()
def volume_zone_session(client, session_headers, minimal_room_config):
    """Session with a volume zone for geometry update tests."""
    resp = client.post(
        f"{API}/session/init",
        json={
            "room": minimal_room_config,
            "lamps": [{
                "preset_id": "ushio_b1",
                "lamp_type": "krcl_222",
                "x": 2.0, "y": 3.0, "z": 2.7,
                "aimx": 0.0, "aimy": 0.0, "aimz": -1.0,
            }],
            "zones": [{
                "type": "volume",
                "x_min": 0.0, "x_max": 4.0,
                "y_min": 0.0, "y_max": 6.0,
                "z_min": 0.5, "z_max": 2.0,
                "num_x": 3, "num_y": 3, "num_z": 3,
            }],
        },
        headers=session_headers,
    )
    assert resp.status_code == 200, resp.text
    status = client.get(f"{API}/session/status", headers=session_headers).json()
    zone_id = status["zone_ids"][0]
    return client, session_headers, zone_id


class TestVolumeZoneUpdate:
    def test_update_volume_bounds(self, volume_zone_session):
        client, headers, zone_id = volume_zone_session
        resp = client.patch(
            f"{API}/session/zones/{zone_id}",
            json={"x_min": 0.5, "x_max": 3.5, "y_min": 0.5, "y_max": 5.5},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_update_volume_z_bounds(self, volume_zone_session):
        client, headers, zone_id = volume_zone_session
        resp = client.patch(
            f"{API}/session/zones/{zone_id}",
            json={"z_min": 0.2, "z_max": 2.5},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_update_volume_all_bounds(self, volume_zone_session):
        client, headers, zone_id = volume_zone_session
        resp = client.patch(
            f"{API}/session/zones/{zone_id}",
            json={
                "x_min": 1.0, "x_max": 3.0,
                "y_min": 1.0, "y_max": 5.0,
                "z_min": 0.3, "z_max": 1.8,
            },
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_update_volume_num_points(self, volume_zone_session):
        client, headers, zone_id = volume_zone_session
        resp = client.patch(
            f"{API}/session/zones/{zone_id}",
            json={"num_x": 4, "num_y": 4, "num_z": 2},
            headers=headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["num_x"] == 4
        assert data["num_y"] == 4
        assert data["num_z"] == 2

    def test_update_volume_spacing(self, volume_zone_session):
        client, headers, zone_id = volume_zone_session
        resp = client.patch(
            f"{API}/session/zones/{zone_id}",
            json={"x_spacing": 0.5, "y_spacing": 0.5, "z_spacing": 0.5},
            headers=headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["x_spacing"] is not None
        assert data["z_spacing"] is not None

    def test_update_volume_enabled(self, volume_zone_session):
        client, headers, zone_id = volume_zone_session
        resp = client.patch(
            f"{API}/session/zones/{zone_id}",
            json={"enabled": False},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True


# ============================================================
# Lamp scaling methods
# ============================================================

class TestLampScaling:
    def test_scale_by_factor(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        resp = client.patch(
            f"{API}/session/lamps/{lamp_id}",
            json={"scaling_method": "factor", "scaling_value": 2.0},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_scale_to_max(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        resp = client.patch(
            f"{API}/session/lamps/{lamp_id}",
            json={"scaling_method": "max", "scaling_value": 50.0},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_scale_to_total(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        resp = client.patch(
            f"{API}/session/lamps/{lamp_id}",
            json={"scaling_method": "total", "scaling_value": 100.0},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_scale_to_center(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        resp = client.patch(
            f"{API}/session/lamps/{lamp_id}",
            json={"scaling_method": "center", "scaling_value": 25.0},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_scaling_factor_fallback(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        resp = client.patch(
            f"{API}/session/lamps/{lamp_id}",
            json={"scaling_factor": 0.5},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_scale_affects_power(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        # Get baseline power
        before = client.get(
            f"{API}/session/lamps/{lamp_id}/advanced-settings",
            headers=headers,
        ).json()
        # Scale by factor 2
        client.patch(
            f"{API}/session/lamps/{lamp_id}",
            json={"scaling_method": "factor", "scaling_value": 2.0},
            headers=headers,
        )
        after = client.get(
            f"{API}/session/lamps/{lamp_id}/advanced-settings",
            headers=headers,
        ).json()
        assert after["scaling_factor"] != before["scaling_factor"]


class TestLampAdvancedUpdates:
    def test_update_name(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        resp = client.patch(
            f"{API}/session/lamps/{lamp_id}",
            json={"name": "My Custom Lamp"},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_update_enabled(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        resp = client.patch(
            f"{API}/session/lamps/{lamp_id}",
            json={"enabled": False},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_update_tilt_and_orientation(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        resp = client.patch(
            f"{API}/session/lamps/{lamp_id}",
            json={"tilt": 15.0, "orientation": 45.0},
            headers=headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["tilt"] is not None
        assert data["orientation"] is not None

    def test_update_intensity_units(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        resp = client.patch(
            f"{API}/session/lamps/{lamp_id}",
            json={"intensity_units": "uW/cm2"},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_update_source_dimensions(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        resp = client.patch(
            f"{API}/session/lamps/{lamp_id}",
            json={"source_width": 0.05, "source_length": 0.1},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_update_source_density(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        resp = client.patch(
            f"{API}/session/lamps/{lamp_id}",
            json={"source_density": 3},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_update_housing_dimensions(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        resp = client.patch(
            f"{API}/session/lamps/{lamp_id}",
            json={
                "housing_width": 0.15,
                "housing_length": 0.30,
                "housing_height": 0.10,
            },
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True
