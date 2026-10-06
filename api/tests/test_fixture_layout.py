"""Housing layout (beam face, roll, emitter offset) on session lamps."""

import io
import json

import pytest

from tests.conftest import API


def _advanced(client, headers, lamp_id):
    r = client.get(f"{API}/session/lamps/{lamp_id}/advanced-settings", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _patch(client, headers, lamp_id, body):
    r = client.patch(f"{API}/session/lamps/{lamp_id}", json=body, headers=headers)
    assert r.status_code == 200, r.text


def _new_session(client):
    data = client.post(f"{API}/session/create").json()
    return {"X-Session-ID": data["session_id"], "Authorization": f"Bearer {data['token']}"}


class TestLayoutRoundTrip:
    def test_defaults(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        adv = _advanced(client, headers, lamp_id)
        assert adv["beam_face"] == "bottom"
        assert adv["housing_roll"] == 0
        assert adv["emitter_offset"] == [0.0, 0.0, 0.0]

    def test_patch_layout(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        _patch(client, headers, lamp_id, {"beam_face": "front", "housing_roll": 90,
                                           "emitter_offset": [0.01, -0.02, 0.03]})
        adv = _advanced(client, headers, lamp_id)
        assert (adv["beam_face"], adv["housing_roll"]) == ("front", 90)
        assert adv["emitter_offset"] == pytest.approx([0.01, -0.02, 0.03])

    def test_negative_offset_accepted(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        _patch(client, headers, lamp_id, {"photometric_depth": -0.02})
        adv = _advanced(client, headers, lamp_id)
        assert adv["photometric_depth"] == pytest.approx(-0.02)
        assert adv["emitter_offset"] == pytest.approx([0.0, 0.0, -0.02])

    def test_invalid_face_roll_offset_422(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        for body in ({"beam_face": "side"}, {"housing_roll": 45}, {"emitter_offset": [0, 1]}):
            r = client.patch(f"{API}/session/lamps/{lamp_id}", json=body, headers=headers)
            assert r.status_code == 422, body

    def test_fixture_bounds_follow_layout(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        _patch(client, headers, lamp_id, {"housing_width": 0.1, "housing_length": 0.1,
                                           "housing_height": 0.1, "emitter_offset": [0, 0, -0.05]})
        r = client.get(f"{API}/session/lamps/{lamp_id}/photometric-web", headers=headers)
        assert r.status_code == 200, r.text
        zs = [c[2] for c in r.json()["fixture_bounds"]]
        assert min(zs) == pytest.approx(0.05) and max(zs) == pytest.approx(0.15)

    def test_survives_lamp_type_change(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        _patch(client, headers, lamp_id, {"beam_face": "left", "emitter_offset": [0.0, 0.0, 0.01]})
        _patch(client, headers, lamp_id, {"preset_id": "custom"})
        _patch(client, headers, lamp_id, {"lamp_type": "lp_254"})
        adv = _advanced(client, headers, lamp_id)
        assert adv["beam_face"] == "left"
        assert adv["emitter_offset"] == pytest.approx([0.0, 0.0, 0.01])

    def test_survives_ies_upload(self, custom_lamp_session, ies_file_bytes):
        client, headers, lamp_id = custom_lamp_session
        _patch(client, headers, lamp_id, {"beam_face": "top", "housing_roll": 180,
                                           "emitter_offset": [0.0, 0.0, -0.01]})
        r = client.post(
            f"{API}/session/lamps/{lamp_id}/ies",
            files={"file": ("a.ies", io.BytesIO(ies_file_bytes))},
            headers=headers,
        )
        assert r.status_code == 200, r.text
        adv = _advanced(client, headers, lamp_id)
        assert (adv["beam_face"], adv["housing_roll"]) == ("top", 180)
        assert adv["emitter_offset"] == pytest.approx([0.0, 0.0, -0.01])


class TestUnitsAndInit:
    def test_set_units_converts_offset(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        _patch(client, headers, lamp_id, {"emitter_offset": [0.1, 0.0, -0.02]})
        r = client.patch(f"{API}/session/units", json={"units": "centimeters"}, headers=headers)
        assert r.status_code == 200, r.text
        assert r.json()["lamps"][lamp_id]["emitter_offset"] == pytest.approx([10.0, 0.0, -2.0])
        adv = _advanced(client, headers, lamp_id)
        assert adv["emitter_offset"] == pytest.approx([10.0, 0.0, -2.0])

    def test_init_accepts_layout(self, client, session_headers, minimal_room_config):
        resp = client.post(
            f"{API}/session/init",
            json={
                "room": minimal_room_config,
                "lamps": [{
                    "lamp_type": "krcl_222", "preset_id": "aerolamp",
                    "x": 2.0, "y": 3.0, "z": 2.7, "aimx": 2.0, "aimy": 3.0, "aimz": 0.0,
                    "beam_face": "back", "housing_roll": 270, "emitter_offset": [0.0, 0.01, 0.0],
                }],
                "zones": [],
            },
            headers=session_headers,
        )
        assert resp.status_code == 200, resp.text
        lamp_id = client.get(f"{API}/session/status", headers=session_headers).json()["lamp_ids"][0]
        adv = _advanced(client, session_headers, lamp_id)
        assert (adv["beam_face"], adv["housing_roll"]) == ("back", 270)
        assert adv["emitter_offset"] == pytest.approx([0.0, 0.01, 0.0])


class TestSaveLoad:
    def test_guv_round_trip(self, lamp_with_ies_session, client):
        _, headers, lamp_id = lamp_with_ies_session
        _patch(client, headers, lamp_id, {"beam_face": "right", "housing_roll": 90,
                                           "emitter_offset": [0.0, 0.0, 0.02]})
        saved = json.loads(client.get(f"{API}/session/save", headers=headers).content)
        new_headers = _new_session(client)
        r = client.post(f"{API}/session/load", json=saved, headers=new_headers)
        assert r.status_code == 200, r.text
        loaded = r.json()["lamps"][0]
        assert (loaded["beam_face"], loaded["housing_roll"]) == ("right", 90)
        assert loaded["emitter_offset"] == pytest.approx([0.0, 0.0, 0.02])
        adv = _advanced(client, new_headers, lamp_id)
        assert adv["beam_face"] == "right"
