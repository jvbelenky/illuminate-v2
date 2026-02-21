"""Extended CRUD tests for zones, lamps, and room mutations."""

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
