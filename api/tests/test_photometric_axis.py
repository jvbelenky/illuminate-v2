"""Photometric axis / depth pass-through on session lamps."""

import copy
import io
import json
import pathlib

import pytest

from tests.conftest import API


def _advanced(client, headers, lamp_id):
    r = client.get(f"{API}/session/lamps/{lamp_id}/advanced-settings", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _new_session(client):
    data = client.post(f"{API}/session/create").json()
    return {"X-Session-ID": data["session_id"], "Authorization": f"Bearer {data['token']}"}


class TestPatchRoundTrip:
    def test_defaults(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        adv = _advanced(client, headers, lamp_id)
        assert adv["photometric_axis"] == "down"
        assert adv["photometric_depth"] == 0.0

    def test_patch_axis_and_depth(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        r = client.patch(
            f"{API}/session/lamps/{lamp_id}",
            json={"photometric_axis": "horizontal_0", "photometric_depth": 0.05},
            headers=headers,
        )
        assert r.status_code == 200, r.text
        adv = _advanced(client, headers, lamp_id)
        assert adv["photometric_axis"] == "horizontal_0"
        assert adv["photometric_depth"] == pytest.approx(0.05)

    def test_invalid_axis_422(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        r = client.patch(f"{API}/session/lamps/{lamp_id}", json={"photometric_axis": "sideways"}, headers=headers)
        assert r.status_code == 422

    def test_axis_permutes_ies_dimensions(self, lamp_with_ies_session):
        # ushio_b1 ies: width 0.045 (y), length 0.06 (x), height 0
        client, headers, lamp_id = lamp_with_ies_session
        client.patch(f"{API}/session/lamps/{lamp_id}", json={"photometric_axis": "horizontal_0"}, headers=headers)
        adv = _advanced(client, headers, lamp_id)
        assert adv["source_length"] == pytest.approx(0.0)
        assert adv["source_width"] == pytest.approx(0.045)
        assert adv["source_depth"] == pytest.approx(0.06)

    def test_survives_lamp_type_change(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        client.patch(f"{API}/session/lamps/{lamp_id}", json={"preset_id": "custom"}, headers=headers)
        client.patch(
            f"{API}/session/lamps/{lamp_id}",
            json={"photometric_axis": "horizontal_90", "photometric_depth": 0.02},
            headers=headers,
        )
        r = client.patch(f"{API}/session/lamps/{lamp_id}", json={"lamp_type": "lp_254"}, headers=headers)
        assert r.status_code == 200, r.text
        adv = _advanced(client, headers, lamp_id)
        assert adv["photometric_axis"] == "horizontal_90"
        assert adv["photometric_depth"] == pytest.approx(0.02)

    def test_survives_ies_upload(self, custom_lamp_session, ies_file_bytes):
        client, headers, lamp_id = custom_lamp_session
        client.patch(
            f"{API}/session/lamps/{lamp_id}",
            json={"photometric_axis": "horizontal_0", "photometric_depth": 0.03},
            headers=headers,
        )
        r = client.post(
            f"{API}/session/lamps/{lamp_id}/ies",
            files={"file": ("a.ies", io.BytesIO(ies_file_bytes))},
            headers=headers,
        )
        assert r.status_code == 200, r.text
        adv = _advanced(client, headers, lamp_id)
        assert adv["photometric_axis"] == "horizontal_0"
        assert adv["photometric_depth"] == pytest.approx(0.03)
        assert adv["source_depth"] == pytest.approx(0.06)  # ies length became depth


class TestUnitsAndInit:
    def test_set_units_converts_depth(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        client.patch(f"{API}/session/lamps/{lamp_id}", json={"photometric_depth": 0.3048}, headers=headers)
        r = client.patch(f"{API}/session/units", json={"units": "feet"}, headers=headers)
        assert r.status_code == 200, r.text
        assert r.json()["lamps"][lamp_id]["photometric_depth"] == pytest.approx(1.0, abs=1e-6)
        adv = _advanced(client, headers, lamp_id)
        assert adv["photometric_axis"] == "down"

    def test_init_accepts_fields(self, client, session_headers, minimal_room_config):
        resp = client.post(
            f"{API}/session/init",
            json={
                "room": minimal_room_config,
                "lamps": [{
                    "lamp_type": "krcl_222", "preset_id": "aerolamp",
                    "x": 2.0, "y": 3.0, "z": 2.7, "aimx": 2.0, "aimy": 3.0, "aimz": 0.0,
                    "photometric_axis": "up", "photometric_depth": 0.01,
                }],
                "zones": [],
            },
            headers=session_headers,
        )
        assert resp.status_code == 200, resp.text
        lamp_id = client.get(f"{API}/session/status", headers=session_headers).json()["lamp_ids"][0]
        adv = _advanced(client, session_headers, lamp_id)
        assert adv["photometric_axis"] == "up"
        assert adv["photometric_depth"] == pytest.approx(0.01)


class TestSaveLoad:
    def test_legacy_guv_loads_with_defaults(self, client):
        legacy = json.loads((pathlib.Path(__file__).parent / "fixtures" / "legacy_preview_lamp.guv").read_text())
        headers = _new_session(client)
        r = client.post(f"{API}/session/load", json=copy.deepcopy(legacy), headers=headers)
        assert r.status_code == 200, r.text
        lamp_id = r.json()["lamps"][0]["id"]
        adv = _advanced(client, headers, lamp_id)
        assert adv["photometric_axis"] == "down"
        assert adv["photometric_depth"] == 0.0

    def test_guv_round_trip(self, lamp_with_ies_session, client):
        _, headers, lamp_id = lamp_with_ies_session
        client.patch(
            f"{API}/session/lamps/{lamp_id}",
            json={"photometric_axis": "horizontal_270", "photometric_depth": 0.07},
            headers=headers,
        )
        saved = json.loads(client.get(f"{API}/session/save", headers=headers).content)
        new_headers = _new_session(client)
        r = client.post(f"{API}/session/load", json=saved, headers=new_headers)
        assert r.status_code == 200, r.text
        adv = _advanced(client, new_headers, lamp_id)
        assert adv["photometric_axis"] == "horizontal_270"
        assert adv["photometric_depth"] == pytest.approx(0.07)
