"""
Calc planes parallel to a wall are reported with their wall placement.
"""
import json

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
