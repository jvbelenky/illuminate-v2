"""Golden-path workflow tests: init → CRUD → calculate → validate results."""

from tests.conftest import API


# ============================================================
# Core workflow
# ============================================================

class TestCoreWorkflow:
    def test_full_workflow_produces_results(self, calculated_session):
        _client, _headers, data = calculated_session
        assert data["success"] is True
        assert data["zones"]  # at least one zone
        for zone_id, zone in data["zones"].items():
            stats = zone["statistics"]
            assert "min" in stats
            assert "max" in stats
            assert "mean" in stats

    def test_calculate_without_lamps_returns_zeros(
        self, client, session_headers, minimal_room_config, minimal_zone_input
    ):
        # Init with zone but no lamps
        resp = client.post(
            f"{API}/session/init",
            json={"room": minimal_room_config, "zones": [minimal_zone_input]},
            headers=session_headers,
        )
        assert resp.status_code == 200

        resp = client.post(f"{API}/session/calculate", headers=session_headers)
        assert resp.status_code == 200
        data = resp.json()
        for zone_id, zone in data["zones"].items():
            stats = zone["statistics"]
            # With no lamps, all irradiance values should be zero
            assert stats["max"] == 0 or stats["max"] is None


# ============================================================
# Lamp CRUD
# ============================================================

class TestLampCRUD:
    def test_add_lamp(self, initialized_session, minimal_lamp_input):
        client, headers = initialized_session
        resp = client.post(
            f"{API}/session/lamps",
            json=minimal_lamp_input,
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True
        assert "lamp_id" in resp.json()

    def test_update_lamp_position(self, initialized_session):
        client, headers = initialized_session
        # Get status to find existing lamp ID
        status = client.get(f"{API}/session/status", headers=headers).json()
        lamp_id = status["lamp_ids"][0]

        resp = client.patch(
            f"{API}/session/lamps/{lamp_id}",
            json={"x": 1.0, "y": 1.0, "z": 2.5},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_delete_lamp(self, initialized_session):
        client, headers = initialized_session
        status = client.get(f"{API}/session/status", headers=headers).json()
        lamp_id = status["lamp_ids"][0]

        resp = client.delete(f"{API}/session/lamps/{lamp_id}", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_delete_nonexistent_lamp_returns_404(self, initialized_session):
        client, headers = initialized_session
        resp = client.delete(f"{API}/session/lamps/nonexistent", headers=headers)
        assert resp.status_code == 404


# ============================================================
# Zone CRUD
# ============================================================

class TestZoneCRUD:
    def test_add_plane_zone(self, initialized_session, minimal_zone_input):
        client, headers = initialized_session
        resp = client.post(
            f"{API}/session/zones",
            json=minimal_zone_input,
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True
        assert "zone_id" in resp.json()

    def test_add_volume_zone(self, initialized_session):
        client, headers = initialized_session
        resp = client.post(
            f"{API}/session/zones",
            json={
                "type": "volume",
                "x_min": 0.0, "x_max": 4.0,
                "y_min": 0.0, "y_max": 6.0,
                "z_min": 0.5, "z_max": 2.0,
                "num_x": 5, "num_y": 5, "num_z": 3,
            },
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_update_zone_resolution(self, initialized_session):
        client, headers = initialized_session
        status = client.get(f"{API}/session/status", headers=headers).json()
        zone_id = status["zone_ids"][0]

        resp = client.patch(
            f"{API}/session/zones/{zone_id}",
            json={"num_x": 3, "num_y": 3},
            headers=headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        # Backend should return computed spacing
        assert data["x_spacing"] is not None
        assert data["y_spacing"] is not None

    def test_delete_zone(self, initialized_session):
        client, headers = initialized_session
        status = client.get(f"{API}/session/status", headers=headers).json()
        zone_id = status["zone_ids"][0]

        resp = client.delete(f"{API}/session/zones/{zone_id}", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_list_zones(self, initialized_session):
        client, headers = initialized_session
        resp = client.get(f"{API}/session/zones", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "zones" in data
        assert len(data["zones"]) >= 1


# ============================================================
# Room mutations
# ============================================================

class TestRoomMutations:
    def test_update_room_dimensions(self, initialized_session):
        client, headers = initialized_session
        resp = client.patch(
            f"{API}/session/room",
            json={"x": 5.0, "y": 7.0},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_update_room_units(self, initialized_session):
        client, headers = initialized_session
        resp = client.patch(
            f"{API}/session/room",
            json={"units": "feet"},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True


# ============================================================
# Calculate result validation
# ============================================================

class TestCalculateResults:
    def test_calculated_zones_have_statistics(self, calculated_session):
        _client, _headers, data = calculated_session
        for zone_id, zone in data["zones"].items():
            assert "statistics" in zone
            stats = zone["statistics"]
            assert "min" in stats
            assert "max" in stats
            assert "mean" in stats

    def test_zone_values_are_2d_array(self, calculated_session):
        _client, _headers, data = calculated_session
        for zone_id, zone in data["zones"].items():
            if zone.get("values") is not None:
                values = zone["values"]
                assert isinstance(values, list)
                # For a plane zone, values should be a 2D list
                if isinstance(values[0], list):
                    assert all(isinstance(row, list) for row in values)

    def test_mean_fluence_is_positive(self, calculated_session):
        _client, _headers, data = calculated_session
        # mean_fluence comes from WholeRoomFluence zone; may be None if
        # that zone isn't present, but if set it should be positive.
        if data.get("mean_fluence") is not None:
            assert data["mean_fluence"] > 0

    def test_state_hashes_present(self, calculated_session):
        _client, _headers, data = calculated_session
        assert "state_hashes" in data
        hashes = data["state_hashes"]
        assert "calc_state" in hashes
        assert "update_state" in hashes
