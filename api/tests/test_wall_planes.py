"""
Calc planes parallel to a wall are reported with their wall placement.
"""
import json

import numpy as np
import pytest

from guv_calcs.calc_zone import CalcPlane
from guv_calcs.geometry import Polygon2D

from api.v1.session_manager import get_session_manager

API = "/api/v1"

PENTAGON = [[0, 0], [6, 0], [6, 3], [3, 5], [0, 3]]


def _init(client, headers, room_extra=None, zones=None):
    room = {"x": 4.0, "y": 6.0, "z": 3.0, "units": "meters",
            "standard": "ANSI IES RP 27.1-22 (ACGIH Limits)", "useStandardZones": False}
    room.update(room_extra or {})
    resp = client.post(f"{API}/session/init",
                       json={"room": room, "lamps": [], "zones": zones or []},
                       headers=headers)
    assert resp.status_code == 200, resp.text


def _zone(client, headers, zone_id):
    zones = client.get(f"{API}/session/zones", headers=headers).json()["zones"]
    return next(z for z in zones if z["id"] == zone_id)


def _xz(direction=1, **extra):
    return {"id": "zone-1", "type": "plane", "ref_surface": "xz", "height": 0.5,
            "direction": direction, "x1": 0, "x2": 4, "y1": 0, "y2": 3,
            "num_x": 4, "num_y": 4, **extra}


def _pts(vertices):
    return sorted((round(a, 6), round(b, 6)) for a, b in vertices)


def test_legacy_xz_plane_reports_south_wall(client, session_headers):
    _init(client, session_headers, zones=[_xz()])
    z = _zone(client, session_headers, "zone-1")
    assert z["wall"] == {"wall_id": "south", "normal_offset": 0.5, "flip": False}
    assert z["vertices"] is None  # covers the whole wall


def test_partial_wall_region_reports_wall_coordinates(client, session_headers):
    _init(client, session_headers, zones=[_xz(x1=1, x2=3, y1=1, y2=2)])
    z = _zone(client, session_headers, "zone-1")
    assert z["wall"]["wall_id"] == "south"
    assert _pts(z["vertices"]) == [(1, 1), (1, 2), (3, 1), (3, 2)]


def test_legacy_xz_plane_facing_away_is_flipped(client, session_headers):
    _init(client, session_headers, zones=[_xz(direction=-1)])
    assert _zone(client, session_headers, "zone-1")["wall"]["flip"] is True


def test_horizontal_plane_has_no_wall(client, session_headers, minimal_zone_input):
    _init(client, session_headers, zones=[{**minimal_zone_input, "id": "zone-1"}])
    z = _zone(client, session_headers, "zone-1")
    assert z["wall"] is None
    assert z["vertices"] is None


def test_save_load_reports_wall(client, session_headers):
    _init(client, session_headers, zones=[_xz(x1=1, x2=3, y1=1, y2=2)])
    before = _zone(client, session_headers, "zone-1")
    saved = json.loads(client.get(f"{API}/session/save", headers=session_headers).content)
    new = client.post(f"{API}/session/create").json()
    headers = {"X-Session-ID": new["session_id"], "Authorization": f"Bearer {new['token']}"}
    resp = client.post(f"{API}/session/load", json=saved, headers=headers)
    assert resp.status_code == 200, resp.text
    loaded = next(z for z in resp.json()["zones"] if z["id"] == "zone-1")
    assert loaded["wall"] == before["wall"]
    assert _pts(loaded["vertices"]) == [(1, 1), (1, 2), (3, 1), (3, 2)]


def test_polygon_room_angled_wall_plane(client, session_headers, session_id):
    _init(client, session_headers, room_extra={"polygon": PENTAGON, "z": 2.7})
    room = get_session_manager().get_session(session_id[0]).room
    tri = Polygon2D(vertices=((0.5, 0.5), (2.0, 0.5), (0.5, 2.0)))
    room.add_calc_zone(
        CalcPlane.from_wall_region("wall_2", room.dim, polygon=tri, normal_offset=0.3,
                                   zone_id="zone-1", num_points=(4, 4))
    )
    z = _zone(client, session_headers, "zone-1")
    assert z["wall"]["wall_id"] == "wall_2"
    assert abs(z["wall"]["normal_offset"] - 0.3) < 1e-6
    assert z["wall"]["flip"] is False
    assert _pts(z["vertices"]) == [(0.5, 0.5), (0.5, 2.0), (2.0, 0.5)]


# ---------------------------------------------------------------------------
# Write path
# ---------------------------------------------------------------------------

def _add(client, headers, body):
    resp = client.post(f"{API}/session/zones", json=body, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp


def test_create_whole_wall_plane(client, session_headers):
    _init(client, session_headers, room_extra={"z": 3.0})
    _add(client, session_headers, {"id": "zone-1", "type": "plane", "wall": {"wall_id": "east"},
                                   "num_x": 5, "num_y": 4})
    z = _zone(client, session_headers, "zone-1")
    assert z["wall"] == {"wall_id": "east", "normal_offset": 0.0, "flip": False}
    assert z["vertices"] is None
    assert (z["num_x"], z["num_y"]) == (5, 4)


def test_create_region_on_angled_wall(client, session_headers):
    _init(client, session_headers, room_extra={"polygon": PENTAGON, "z": 2.7})
    region = [[0.5, 0.5], [2, 0.5], [2, 2], [0.5, 2]]
    _add(client, session_headers, {"id": "zone-1", "type": "plane",
                                   "wall": {"wall_id": "wall_1", "normal_offset": 0.2},
                                   "vertices": region, "num_x": 4, "num_y": 4})
    z = _zone(client, session_headers, "zone-1")
    assert z["wall"]["wall_id"] == "wall_1"
    assert abs(z["wall"]["normal_offset"] - 0.2) < 1e-6
    assert _pts(z["vertices"]) == _pts(region)


def test_patch_wall_offset_and_flip(client, session_headers):
    _init(client, session_headers)
    _add(client, session_headers, {"id": "zone-1", "type": "plane", "wall": {"wall_id": "east"},
                                   "num_x": 5, "num_y": 4})
    resp = client.patch(f"{API}/session/zones/zone-1", headers=session_headers,
                        json={"wall": {"wall_id": "east", "normal_offset": 0.3, "flip": True}})
    assert resp.status_code == 200, resp.text
    z = _zone(client, session_headers, "zone-1")
    assert z["wall"] == {"wall_id": "east", "normal_offset": pytest.approx(0.3), "flip": True}
    assert z["vertices"] is None
    assert (z["num_x"], z["num_y"]) == (5, 4)


def test_patch_wall_keeps_region_unless_vertices_sent(client, session_headers):
    _init(client, session_headers)
    _add(client, session_headers, {"id": "zone-1", "type": "plane", "wall": {"wall_id": "east"},
                                   "vertices": [[1, 1], [3, 1], [3, 2], [1, 2]], "num_x": 3, "num_y": 3})
    client.patch(f"{API}/session/zones/zone-1", headers=session_headers,
                 json={"wall": {"wall_id": "east", "normal_offset": 0.1}})
    assert _pts(_zone(client, session_headers, "zone-1")["vertices"]) == [(1, 1), (1, 2), (3, 1), (3, 2)]
    client.patch(f"{API}/session/zones/zone-1", headers=session_headers,
                 json={"wall": {"wall_id": "east"}, "vertices": None})
    assert _zone(client, session_headers, "zone-1")["vertices"] is None


def test_patch_legacy_fields_on_wall_plane_is_400(client, session_headers):
    _init(client, session_headers)
    _add(client, session_headers, {"id": "zone-1", "type": "plane", "wall": {"wall_id": "east"},
                                   "num_x": 5, "num_y": 4})
    for body in ({"height": 1}, {"ref_surface": "xz"}, {"x1": 0.5}):
        resp = client.patch(f"{API}/session/zones/zone-1", json=body, headers=session_headers)
        assert resp.status_code == 400, body
        assert "send wall" in resp.json()["detail"]


def test_calculate_wall_plane_has_values(client, session_headers):
    lamp = {"id": "lamp-1", "lamp_type": "krcl_222", "preset_id": "ushio_b1",
            "x": 2, "y": 3, "z": 2.6, "aimx": 1, "aimy": 0, "aimz": 0}
    _init(client, session_headers, zones=[{"id": "zone-1", "type": "plane", "wall": {"wall_id": "east"},
                                           "num_x": 5, "num_y": 4}],
          )
    client.post(f"{API}/session/lamps", json=lamp, headers=session_headers)
    resp = client.post(f"{API}/session/calculate", json={}, headers=session_headers)
    assert resp.status_code == 200, resp.text
    zone = resp.json()["zones"]["zone-1"]
    values = np.asarray(zone["values"], float)
    assert values.shape == (5, 4)
    assert np.isfinite(values).all()
    assert zone["statistics"]["mean"] > 0


def test_outline_outside_wall_is_accepted(client, session_headers):
    _init(client, session_headers)
    with pytest.warns(UserWarning, match="outside the wall"):
        resp = client.post(f"{API}/session/zones", headers=session_headers, json={
            "id": "zone-1", "type": "plane", "wall": {"wall_id": "east"}, "num_x": 4, "num_y": 4,
            "vertices": [[1, 1], [3, 1], [3, 3.5], [1, 3.5]]})
    assert resp.status_code == 200, resp.text
    assert "warn" not in resp.text.lower()
    # The outline is kept as drawn, outside or not
    assert _pts(_zone(client, session_headers, "zone-1")["vertices"]) == [(1, 1), (1, 3.5), (3, 1), (3, 3.5)]


def test_patch_wall_ignores_legacy_fields(client, session_headers):
    _init(client, session_headers)
    _add(client, session_headers, {"id": "zone-1", "type": "plane", "wall": {"wall_id": "east"},
                                   "num_x": 5, "num_y": 4})
    resp = client.patch(f"{API}/session/zones/zone-1", headers=session_headers, json={
        "wall": {"wall_id": "east", "normal_offset": 0.2}, "height": 1, "ref_surface": "xy",
        "x1": 0.5, "x2": 1, "y1": 0.5, "y2": 1, "direction": -1})
    assert resp.status_code == 200, resp.text
    z = _zone(client, session_headers, "zone-1")
    assert z["wall"] == {"wall_id": "east", "normal_offset": pytest.approx(0.2), "flip": False}
    assert z["vertices"] is None


def test_patch_direction_on_wall_plane_is_400(client, session_headers):
    _init(client, session_headers)
    _add(client, session_headers, {"id": "zone-1", "type": "plane", "wall": {"wall_id": "east"}})
    resp = client.patch(f"{API}/session/zones/zone-1", json={"direction": -1}, headers=session_headers)
    assert resp.status_code == 400
    assert "send wall" in resp.json()["detail"]


def test_patch_to_different_wall_resets_to_whole_wall(client, session_headers):
    _init(client, session_headers)
    _add(client, session_headers, {"id": "zone-1", "type": "plane", "wall": {"wall_id": "east"},
                                   "vertices": [[1, 1], [3, 1], [3, 2], [1, 2]], "num_x": 3, "num_y": 3})
    resp = client.patch(f"{API}/session/zones/zone-1", headers=session_headers,
                        json={"wall": {"wall_id": "north"}})
    assert resp.status_code == 200, resp.text
    z = _zone(client, session_headers, "zone-1")
    assert z["wall"]["wall_id"] == "north"
    assert z["vertices"] is None


def test_patch_horizontal_plane_onto_wall(client, session_headers, minimal_zone_input):
    _init(client, session_headers, zones=[{**minimal_zone_input, "id": "zone-1"}])
    resp = client.patch(f"{API}/session/zones/zone-1", headers=session_headers,
                        json={"wall": {"wall_id": "west"}})
    assert resp.status_code == 200, resp.text
    z = _zone(client, session_headers, "zone-1")
    assert z["wall"]["wall_id"] == "west"
    assert (z["num_x"], z["num_y"]) == (5, 5)


def test_calculate_after_wall_patch_recomputes(client, session_headers):
    lamp = {"id": "lamp-1", "lamp_type": "krcl_222", "preset_id": "ushio_b1",
            "x": 2, "y": 3, "z": 2.6, "aimx": 1, "aimy": 0, "aimz": 0}
    _init(client, session_headers, zones=[{"id": "zone-1", "type": "plane", "wall": {"wall_id": "east"},
                                           "num_x": 5, "num_y": 4}])
    client.post(f"{API}/session/lamps", json=lamp, headers=session_headers)
    first = client.post(f"{API}/session/calculate", json={}, headers=session_headers).json()
    v1 = np.asarray(first["zones"]["zone-1"]["values"], float)
    resp = client.patch(f"{API}/session/zones/zone-1", headers=session_headers, json={
        "wall": {"wall_id": "east", "normal_offset": 1.0}})
    assert resp.status_code == 200, resp.text
    second = client.post(f"{API}/session/calculate", json={}, headers=session_headers).json()
    v2 = np.asarray(second["zones"]["zone-1"]["values"], float)
    assert v1.shape == v2.shape == (5, 4)
    assert np.isfinite(v2).all()
    assert not np.allclose(v1, v2)
    client.patch(f"{API}/session/zones/zone-1", headers=session_headers, json={"num_x": 6, "num_y": 3})
    third = client.post(f"{API}/session/calculate", json={}, headers=session_headers).json()
    assert np.asarray(third["zones"]["zone-1"]["values"], float).shape == (6, 3)


def test_unknown_wall_id_is_rejected(client, session_headers):
    _init(client, session_headers)
    resp = client.post(f"{API}/session/zones", headers=session_headers,
                       json={"id": "zone-1", "type": "plane", "wall": {"wall_id": "wall_9"}})
    assert resp.status_code == 400
    resp = client.post(f"{API}/session/zones", headers=session_headers,
                       json={"id": "zone-2", "type": "plane", "wall": {"wall_id": "ceiling"}})
    assert resp.status_code == 422


def test_whole_wall_plane_follows_room_resize_with_null_vertices(client, session_headers):
    _init(client, session_headers)
    _add(client, session_headers, {"id": "zone-1", "type": "plane", "wall": {"wall_id": "south"},
                                   "vertices": None, "num_x": 4, "num_y": 4})
    resp = client.patch(f"{API}/session/room", headers=session_headers, json={"x": 8.0, "z": 4.0})
    assert resp.status_code == 200, resp.text
    resp = client.patch(f"{API}/session/zones/zone-1", headers=session_headers,
                        json={"wall": {"wall_id": "south", "normal_offset": 0, "flip": False}, "vertices": None})
    assert resp.status_code == 200, resp.text
    z = _zone(client, session_headers, "zone-1")
    assert z["wall"]["wall_id"] == "south"
    assert z["vertices"] is None  # the whole new 8 x 4 wall


def test_nudge_leaves_wall_plane_outline(client, session_headers):
    _init(client, session_headers)
    region = [[2.5, 0.5], [3.8, 0.5], [3.8, 2], [2.5, 2]]
    _add(client, session_headers, {"id": "zone-1", "type": "plane", "wall": {"wall_id": "south"},
                                   "vertices": region, "num_x": 4, "num_y": 4})
    client.patch(f"{API}/session/room", headers=session_headers, json={"x": 3.0})
    resp = client.post(f"{API}/session/nudge-into-bounds", headers=session_headers)
    assert resp.status_code == 200, resp.text
    assert all(z["id"] != "zone-1" for z in resp.json()["zones"])
    z = _zone(client, session_headers, "zone-1")
    assert z["wall"]["wall_id"] == "south"
    assert _pts(z["vertices"]) == _pts(region)
