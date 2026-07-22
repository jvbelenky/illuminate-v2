"""Client-supplied IDs are authoritative; collisions are 409s."""

from tests.conftest import API


class TestZoneClientId:
    def test_zone_add_honors_client_id(self, initialized_session, minimal_zone_input):
        client, headers = initialized_session
        payload = {**minimal_zone_input, "id": "zone-abc123"}
        resp = client.post(f"{API}/session/zones", json=payload, headers=headers)
        assert resp.status_code == 200, resp.text
        assert resp.json()["zone_id"] == "zone-abc123"

    def test_zone_add_duplicate_client_id_is_409(self, initialized_session, minimal_zone_input):
        client, headers = initialized_session
        payload = {**minimal_zone_input, "id": "zone-dup"}
        assert client.post(f"{API}/session/zones", json=payload, headers=headers).status_code == 200
        resp = client.post(f"{API}/session/zones", json=payload, headers=headers)
        assert resp.status_code == 409

    def test_zone_add_without_id_keeps_legacy_behavior(self, initialized_session, minimal_zone_input):
        client, headers = initialized_session
        r1 = client.post(f"{API}/session/zones", json=minimal_zone_input, headers=headers)
        r2 = client.post(f"{API}/session/zones", json=minimal_zone_input, headers=headers)
        assert r1.status_code == 200 and r2.status_code == 200
        assert r1.json()["zone_id"] != r2.json()["zone_id"]  # registry increments


class TestLampClientId:
    def test_lamp_add_honors_client_id(self, initialized_session, minimal_lamp_input):
        client, headers = initialized_session
        payload = {**minimal_lamp_input, "id": "lamp-abc123"}
        resp = client.post(f"{API}/session/lamps", json=payload, headers=headers)
        assert resp.status_code == 200, resp.text
        assert resp.json()["lamp_id"] == "lamp-abc123"

    def test_lamp_add_duplicate_client_id_is_409(self, initialized_session, minimal_lamp_input):
        client, headers = initialized_session
        payload = {**minimal_lamp_input, "id": "lamp-dup"}
        assert client.post(f"{API}/session/lamps", json=payload, headers=headers).status_code == 200
        resp = client.post(f"{API}/session/lamps", json=payload, headers=headers)
        assert resp.status_code == 409

    def test_lamp_add_without_id_keeps_legacy_behavior(self, initialized_session, minimal_lamp_input):
        client, headers = initialized_session
        r1 = client.post(f"{API}/session/lamps", json=minimal_lamp_input, headers=headers)
        r2 = client.post(f"{API}/session/lamps", json=minimal_lamp_input, headers=headers)
        assert r1.status_code == 200 and r2.status_code == 200
        assert r1.json()["lamp_id"] != r2.json()["lamp_id"]  # registry increments
