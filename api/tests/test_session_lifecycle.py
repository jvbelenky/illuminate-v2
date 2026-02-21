"""Session creation and authentication tests."""

from tests.conftest import API


class TestSessionCreate:
    def test_create_returns_session_id_and_token(self, client):
        resp = client.post(f"{API}/session/create")
        assert resp.status_code == 200
        data = resp.json()
        assert "session_id" in data
        assert "token" in data
        assert len(data["session_id"]) > 0
        assert len(data["token"]) > 0

    def test_create_returns_unique_ids(self, client):
        r1 = client.post(f"{API}/session/create").json()
        r2 = client.post(f"{API}/session/create").json()
        assert r1["session_id"] != r2["session_id"]
        assert r1["token"] != r2["token"]


class TestSessionInit:
    def test_init_minimal_room(self, client, session_headers, minimal_room_config):
        resp = client.post(
            f"{API}/session/init",
            json={"room": minimal_room_config},
            headers=session_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["lamp_count"] == 0
        assert data["zone_count"] == 0

    def test_init_with_lamp_and_zone(
        self, client, session_headers, minimal_room_config, minimal_lamp_input, minimal_zone_input
    ):
        resp = client.post(
            f"{API}/session/init",
            json={
                "room": minimal_room_config,
                "lamps": [minimal_lamp_input],
                "zones": [minimal_zone_input],
            },
            headers=session_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["lamp_count"] == 1
        assert data["zone_count"] == 1

    def test_init_replaces_existing_room(
        self, client, session_headers, minimal_room_config, minimal_lamp_input
    ):
        # First init with a lamp
        client.post(
            f"{API}/session/init",
            json={"room": minimal_room_config, "lamps": [minimal_lamp_input]},
            headers=session_headers,
        )
        # Second init without lamps
        resp = client.post(
            f"{API}/session/init",
            json={"room": minimal_room_config},
            headers=session_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["lamp_count"] == 0

    def test_init_invalid_dimensions_rejected(self, client, session_headers):
        resp = client.post(
            f"{API}/session/init",
            json={"room": {"x": -1, "y": 5, "z": 2.7}},
            headers=session_headers,
        )
        assert resp.status_code == 422


class TestSessionAuth:
    def test_missing_session_header_returns_400(self, client):
        resp = client.patch(f"{API}/session/room", json={"x": 5.0})
        assert resp.status_code == 400

    def test_nonexistent_session_returns_404(self, client):
        resp = client.patch(
            f"{API}/session/room",
            json={"x": 5.0},
            headers={"X-Session-ID": "nonexistent-id"},
        )
        assert resp.status_code == 404

    def test_uninitialized_session_returns_400_on_room_patch(self, client, session_headers):
        resp = client.patch(
            f"{API}/session/room",
            json={"x": 5.0},
            headers=session_headers,
        )
        assert resp.status_code == 400
