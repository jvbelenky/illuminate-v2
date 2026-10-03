"""Objects (obstacles): schemas, helpers, /session/objects CRUD, load/units/positions."""

import json

import numpy as np
import pytest

from guv_calcs import Object

from api.v1.session_schemas import SessionObjectInput
from api.v1.session_helpers import _create_object_from_input, _object_to_state
from tests.conftest import API


BOX = {
    "id": "object-1",
    "name": "Desk",
    "shape": "box",
    "width": 1.2,
    "length": 0.6,
    "height": 0.75,
    "x": 2.0,
    "y": 3.0,
    "z": 0.0,
    "yaw": 30.0,
    "reflectance": 0.1,
    "transmittance": 0.0,
}

L_VERTICES = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]]


# ---------------------------------------------------------------------------
# Helpers (no HTTP)
# ---------------------------------------------------------------------------

class TestHelpers:
    def test_box_input_builds_guv_object(self):
        obj = _create_object_from_input(SessionObjectInput(**BOX))
        assert isinstance(obj, Object)
        assert obj.id == "object-1"
        assert obj.name == "Desk"
        assert obj.to_dict()["shape"] == {"type": "box", "width": 1.2, "length": 0.6, "height": 0.75}
        assert obj.position == (2.0, 3.0, 0.0)
        assert obj.to_dict()["yaw"] == 30.0
        assert obj.R == 0.1 and obj.T == 0.0

    def test_extrusion_input_builds_walls_per_edge(self):
        obj = _create_object_from_input(SessionObjectInput(
            id="object-2", shape="extrusion", height=1.0, vertices=L_VERTICES, x=1, y=1,
        ))
        assert obj.to_dict()["shape"]["type"] == "extrusion"
        assert len(obj.face_ids) == 2 + len(L_VERTICES)

    def test_extrusion_without_vertices_rejected(self):
        with pytest.raises(ValueError):
            _create_object_from_input(SessionObjectInput(id="object-3", shape="extrusion", height=1.0))

    def test_state_round_trips_box(self):
        obj = _create_object_from_input(SessionObjectInput(**BOX))
        state = _object_to_state(obj)
        assert state.id == "object-1"
        assert state.shape == "box"
        assert (state.width, state.length, state.height) == (1.2, 0.6, 0.75)
        assert state.vertices is None
        assert (state.x, state.y, state.z) == (2.0, 3.0, 0.0)
        assert state.yaw == 30.0 and state.pitch == 0.0 and state.roll == 0.0
        assert state.reflectance == 0.1 and state.transmittance == 0.0
        assert state.enabled is True

    def test_state_reports_extrusion_vertices_and_bounding_size(self):
        obj = _create_object_from_input(SessionObjectInput(
            id="object-2", shape="extrusion", height=1.0, vertices=L_VERTICES,
        ))
        state = _object_to_state(obj)
        assert state.shape == "extrusion"
        assert state.vertices == [tuple(v) for v in L_VERTICES]
        assert (state.width, state.length, state.height) == (2.0, 2.0, 1.0)


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

def _add(client, headers, payload=BOX):
    resp = client.post(f"{API}/session/objects", json=payload, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


class TestObjectCrud:
    def test_add_honors_client_id_and_echoes_state(self, initialized_session):
        client, headers = initialized_session
        data = _add(client, headers)
        assert data["object_id"] == "object-1"
        assert data["state"]["name"] == "Desk"
        assert data["state"]["width"] == 1.2
        assert data["state"]["yaw"] == 30.0
        assert "objects" in data["state_hashes"]["calc_state"]

    def test_add_duplicate_id_is_409(self, initialized_session):
        client, headers = initialized_session
        _add(client, headers)
        resp = client.post(f"{API}/session/objects", json=BOX, headers=headers)
        assert resp.status_code == 409
        assert "object-1" in resp.json()["detail"]

    def test_add_without_id_keeps_registry_naming(self, initialized_session):
        client, headers = initialized_session
        payload = {k: v for k, v in BOX.items() if k != "id"}
        r1 = _add(client, headers, payload)
        r2 = _add(client, headers, payload)
        assert r1["object_id"] == "Object"
        assert r2["object_id"] != r1["object_id"]

    def test_add_rejects_non_positive_dimension(self, initialized_session):
        client, headers = initialized_session
        resp = client.post(f"{API}/session/objects", json={**BOX, "width": 0}, headers=headers)
        assert resp.status_code == 422

    def test_add_rejects_reflectance_plus_transmittance_over_one(self, initialized_session):
        client, headers = initialized_session
        payload = {**BOX, "reflectance": 0.7, "transmittance": 0.5}
        resp = client.post(f"{API}/session/objects", json=payload, headers=headers)
        assert resp.status_code == 400
        assert "R + T" in resp.json()["detail"]

    def test_update_fields_echo(self, initialized_session):
        client, headers = initialized_session
        _add(client, headers)
        resp = client.patch(
            f"{API}/session/objects/object-1",
            json={"name": "Cabinet", "enabled": False, "x": 1.0, "yaw": 90.0,
                  "width": 2.0, "reflectance": 0.3, "pitch": 5.0},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        state = resp.json()["state"]
        assert state["name"] == "Cabinet"
        assert state["enabled"] is False
        assert state["x"] == 1.0 and state["y"] == 3.0
        assert state["yaw"] == 90.0 and state["pitch"] == 5.0
        assert state["width"] == 2.0 and state["length"] == 0.6
        assert state["reflectance"] == 0.3 and state["transmittance"] == 0.0

        listing = client.get(f"{API}/session/objects", headers=headers).json()["objects"]
        assert listing[0]["name"] == "Cabinet"

    def test_update_reflectance_plus_transmittance_over_one_is_400(self, initialized_session):
        client, headers = initialized_session
        _add(client, headers)
        resp = client.patch(
            f"{API}/session/objects/object-1",
            json={"reflectance": 0.7, "transmittance": 0.5},
            headers=headers,
        )
        assert resp.status_code == 400
        assert "R + T" in resp.json()["detail"]
        # Nothing was applied
        state = client.get(f"{API}/session/objects", headers=headers).json()["objects"][0]
        assert state["reflectance"] == 0.1 and state["transmittance"] == 0.0

    def test_update_transmittance_alone_is_checked_against_current_reflectance(self, initialized_session):
        client, headers = initialized_session
        _add(client, headers, {**BOX, "reflectance": 0.6})
        resp = client.patch(
            f"{API}/session/objects/object-1", json={"transmittance": 0.5}, headers=headers,
        )
        assert resp.status_code == 400

    def test_non_finite_position_is_rejected(self, initialized_session):
        client, headers = initialized_session
        _add(client, headers)
        resp = client.patch(
            f"{API}/session/objects/object-1",
            content='{"x": NaN}', headers={**headers, "Content-Type": "application/json"},
        )
        assert resp.status_code == 422
        resp = client.post(
            f"{API}/session/objects",
            content='{"id": "object-9", "yaw": Infinity}', headers={**headers, "Content-Type": "application/json"},
        )
        assert resp.status_code == 422

    def test_object_cap(self, initialized_session, monkeypatch):
        from api.v1 import object_session_routers
        monkeypatch.setattr(object_session_routers, "MAX_OBJECTS_PER_ROOM", 2)
        client, headers = initialized_session
        _add(client, headers, {**BOX, "id": "a"})
        _add(client, headers, {**BOX, "id": "b"})
        resp = client.post(f"{API}/session/objects", json={**BOX, "id": "c"}, headers=headers)
        assert resp.status_code == 400
        assert "at most 2" in resp.json()["detail"]
        resp = client.post(f"{API}/session/objects/a/copy", json={"new_id": "d"}, headers=headers)
        assert resp.status_code == 400

    def test_update_unknown_is_404(self, initialized_session):
        client, headers = initialized_session
        resp = client.patch(f"{API}/session/objects/nope", json={"x": 1}, headers=headers)
        assert resp.status_code == 404

    def test_delete(self, initialized_session):
        client, headers = initialized_session
        _add(client, headers)
        resp = client.delete(f"{API}/session/objects/object-1", headers=headers)
        assert resp.status_code == 200
        assert client.get(f"{API}/session/objects", headers=headers).json()["objects"] == []
        assert client.delete(f"{API}/session/objects/object-1", headers=headers).status_code == 404

    def test_copy_honors_new_id_and_collides_409(self, initialized_session):
        client, headers = initialized_session
        _add(client, headers)
        resp = client.post(
            f"{API}/session/objects/object-1/copy", json={"new_id": "object-2"}, headers=headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["object_id"] == "object-2"
        assert resp.json()["state"]["width"] == 1.2
        ids = [o["id"] for o in client.get(f"{API}/session/objects", headers=headers).json()["objects"]]
        assert ids == ["object-1", "object-2"]
        resp = client.post(
            f"{API}/session/objects/object-1/copy", json={"new_id": "object-2"}, headers=headers,
        )
        assert resp.status_code == 409

    def test_init_with_objects_and_status_count(self, client, session_headers, minimal_room_config):
        resp = client.post(
            f"{API}/session/init",
            json={"room": minimal_room_config, "lamps": [], "zones": [], "objects": [BOX]},
            headers=session_headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["object_count"] == 1
        status = client.get(f"{API}/session/status", headers=session_headers).json()
        assert status["object_count"] == 1
        assert status["object_ids"] == ["object-1"]


# ---------------------------------------------------------------------------
# Load / units / positions / calculate
# ---------------------------------------------------------------------------

class TestObjectIntegration:
    def test_save_load_round_trip_keeps_objects_and_face_properties(self, initialized_session):
        client, headers = initialized_session
        _add(client, headers)
        _add(client, headers, {"id": "object-2", "shape": "extrusion", "height": 1.0,
                               "vertices": L_VERTICES, "x": 1, "y": 1})
        saved = client.get(f"{API}/session/save", headers=headers)
        assert saved.status_code == 200
        payload = json.loads(saved.content)
        # Simulate a Python user who set one face differently
        room_key = next(iter(payload["data"]["rooms"])) if "rooms" in payload["data"] else None
        room_data = payload["data"]["rooms"][room_key] if room_key else payload["data"]
        room_data["objects"]["object-1"]["face_properties"] = {"top": {"R": 0.5, "T": 0.0}}

        loaded = client.post(f"{API}/session/load", json=payload, headers=headers)
        assert loaded.status_code == 200, loaded.text
        objects = {o["id"]: o for o in loaded.json()["objects"]}
        assert set(objects) == {"object-1", "object-2"}
        assert objects["object-1"]["width"] == 1.2
        assert objects["object-2"]["shape"] == "extrusion"
        assert len(objects["object-2"]["vertices"]) == 6

        # Untouched per-face properties survive a re-save
        resaved = json.loads(client.get(f"{API}/session/save", headers=headers).text)
        resaved_room = resaved["data"]["rooms"][room_key] if room_key else resaved["data"]
        assert resaved_room["objects"]["object-1"]["face_properties"] == {"top": {"R": 0.5, "T": 0.0}}

    def test_units_change_echoes_converted_objects(self, initialized_session):
        client, headers = initialized_session
        _add(client, headers)
        _add(client, headers, {"id": "object-2", "shape": "extrusion", "height": 1.0,
                               "vertices": L_VERTICES, "x": 1, "y": 1})
        resp = client.patch(f"{API}/session/units", json={"units": "feet"}, headers=headers)
        assert resp.status_code == 200, resp.text
        objs = resp.json()["objects"]
        ft = 1 / 0.3048
        assert objs["object-1"]["x"] == pytest.approx(2.0 * ft)
        assert objs["object-1"]["width"] == pytest.approx(1.2 * ft)
        assert objs["object-1"]["height"] == pytest.approx(0.75 * ft)
        assert objs["object-2"]["vertices"][1][0] == pytest.approx(2.0 * ft)

    def test_check_positions_and_nudge_include_objects(self, initialized_session):
        client, headers = initialized_session
        # Room is 4 x 6; a 1.2 m wide box centred at x=3.8 sticks out of the east wall
        _add(client, headers, {**BOX, "x": 3.8, "yaw": 0.0})
        warnings = client.post(f"{API}/session/check-positions", headers=headers).json()["warnings"]
        assert any(w["id"] == "object-1" for w in warnings)

        nudged = client.post(f"{API}/session/nudge-into-bounds", headers=headers).json()
        moved = {o["id"]: o for o in nudged["objects"]}
        assert "object-1" in moved
        assert moved["object-1"]["x"] + 0.6 <= 4.0 + 1e-6

        warnings = client.post(f"{API}/session/check-positions", headers=headers).json()["warnings"]
        assert not any(w["id"] == "object-1" for w in warnings)

    def test_object_lowers_irradiance_below_it(self, initialized_session):
        client, headers = initialized_session
        # The fixture zone is a 5x5 plane at 1.8 m under a lamp at (2, 3, 2.7)
        before = client.post(f"{API}/session/calculate", headers=headers)
        assert before.status_code == 200, before.text
        zone_id = next(iter(before.json()["zones"]))
        vals_before = np.array(before.json()["zones"][zone_id]["values"], dtype=float)

        _add(client, headers, {**BOX, "x": 2.0, "y": 3.0, "z": 1.9, "width": 3.0, "length": 3.0,
                               "height": 0.3, "yaw": 0.0, "reflectance": 0.0, "transmittance": 0.0})
        after = client.post(f"{API}/session/calculate", headers=headers)
        assert after.status_code == 200, after.text
        vals_after = np.array(after.json()["zones"][zone_id]["values"], dtype=float)
        assert np.nanmean(vals_after) < np.nanmean(vals_before)

        # Disabling the object restores the unobstructed result
        client.patch(f"{API}/session/objects/object-1", json={"enabled": False}, headers=headers)
        again = client.post(f"{API}/session/calculate", headers=headers)
        vals_again = np.array(again.json()["zones"][zone_id]["values"], dtype=float)
        assert np.nanmean(vals_again) == pytest.approx(np.nanmean(vals_before), rel=1e-6)


class TestObjectReport:
    def test_report_lists_objects(self, initialized_session):
        client, headers = initialized_session
        _add(client, headers)
        _add(client, headers, {"id": "object-2", "shape": "extrusion", "height": 1.0,
                               "vertices": L_VERTICES, "x": 1, "y": 1})
        resp = client.get(f"{API}/session/report", headers=headers)
        assert resp.status_code == 200
        text = resp.content.decode()
        assert "Objects" in text
        assert "object-1,Desk,box,1.2,0.6,0.75,2.0,3.0,0.0,30.0" in text
        assert "object-2,object-2,extrusion" in text
        assert "Footprint" in text
