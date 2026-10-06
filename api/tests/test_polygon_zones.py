"""
Calc planes and volumes with a drawn polygon footprint.
"""
import json
import math

API = "/api/v1"

L_SHAPE = [[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]]
TRIANGLE = [[1, 1], [5, 1], [1, 3]]
BOWTIE = [[0, 0], [2, 2], [2, 0], [0, 2]]


def _init(client, headers, zones=None, lamps=None):
    room = {"x": 6.0, "y": 4.0, "z": 2.7, "units": "meters",
            "standard": "ANSI IES RP 27.1-22 (ACGIH Limits)", "useStandardZones": False}
    resp = client.post(f"{API}/session/init",
                       json={"room": room, "lamps": lamps or [], "zones": zones or []},
                       headers=headers)
    assert resp.status_code == 200, resp.text


def _zone(client, headers, zone_id):
    zones = client.get(f"{API}/session/zones", headers=headers).json()["zones"]
    return next(z for z in zones if z["id"] == zone_id)


def _same_polygon(a, b):
    """Same corners in the same cyclic order (either winding)."""
    a = [tuple(round(v, 6) for v in p) for p in a]
    b = [tuple(round(v, 6) for v in p) for p in b]
    if len(a) != len(b):
        return False
    n = len(a)
    for start in range(n):
        for step in (1, -1):
            if all(a[i] == b[(start + step * i) % n] for i in range(n)):
                return True
    return False


PLANE = {"id": "zone-1", "type": "plane", "height": 1.8, "vertices": L_SHAPE, "num_x": 8, "num_y": 8}
VOLUME = {"id": "zone-2", "type": "volume", "z_min": 0.5, "z_max": 2.0, "vertices": TRIANGLE,
          "num_x": 5, "num_y": 5, "num_z": 4}


class TestPolygonPlane:
    def test_add_reports_outline_and_bounds(self, client, session_headers):
        _init(client, session_headers)
        resp = client.post(f"{API}/session/zones", json=PLANE, headers=session_headers)
        assert resp.status_code == 200, resp.text
        z = _zone(client, session_headers, "zone-1")
        assert _same_polygon(z["vertices"], L_SHAPE)
        assert (z["x1"], z["x2"], z["y1"], z["y2"]) == (0, 4, 0, 4)
        assert z["height"] == 1.8

    def test_rectangles_report_no_outline(self, client, session_headers, minimal_zone_input):
        _init(client, session_headers)
        client.post(f"{API}/session/zones", json={**minimal_zone_input, "id": "zone-1"}, headers=session_headers)
        assert _zone(client, session_headers, "zone-1")["vertices"] is None

    def test_update_outline_then_height_keeps_the_polygon(self, client, session_headers, minimal_zone_input):
        _init(client, session_headers)
        client.post(f"{API}/session/zones", json={**minimal_zone_input, "id": "zone-1"}, headers=session_headers)
        resp = client.patch(f"{API}/session/zones/zone-1", json={"vertices": TRIANGLE}, headers=session_headers)
        assert resp.status_code == 200, resp.text
        resp = client.patch(f"{API}/session/zones/zone-1", json={"height": 0.9}, headers=session_headers)
        assert resp.status_code == 200, resp.text
        z = _zone(client, session_headers, "zone-1")
        assert _same_polygon(z["vertices"], TRIANGLE)
        assert z["height"] == 0.9

    def test_rectangular_outline_returns_to_a_plain_rectangle(self, client, session_headers):
        _init(client, session_headers, zones=[PLANE])
        rect = [[1, 1], [3, 1], [3, 2], [1, 2]]
        client.patch(f"{API}/session/zones/zone-1", json={"vertices": rect}, headers=session_headers)
        z = _zone(client, session_headers, "zone-1")
        assert z["vertices"] is None
        assert (z["x1"], z["x2"], z["y1"], z["y2"]) == (1, 3, 1, 2)

    def test_self_crossing_outline_is_a_400_with_the_reason(self, client, session_headers):
        _init(client, session_headers, zones=[PLANE])
        resp = client.patch(f"{API}/session/zones/zone-1", json={"vertices": BOWTIE}, headers=session_headers)
        assert resp.status_code == 400
        assert "Internal" not in resp.json()["detail"]
        assert _same_polygon(_zone(client, session_headers, "zone-1")["vertices"], L_SHAPE)

    def test_outline_size_and_shape_are_bounded(self, client, session_headers):
        _init(client, session_headers, zones=[PLANE])
        too_many = [[3 + math.cos(2 * math.pi * i / 300), 2 + math.sin(2 * math.pi * i / 300)] for i in range(300)]
        resp = client.patch(f"{API}/session/zones/zone-1", json={"vertices": too_many}, headers=session_headers)
        assert resp.status_code == 422
        resp = client.patch(f"{API}/session/zones/zone-1", json={"vertices": [[0, 0, 0], [1, 0, 0], [1, 1, 0]]}, headers=session_headers)
        assert resp.status_code == 422

    def test_calculates_with_the_outline_masked(self, client, session_headers):
        lamp = {"id": "lamp-1", "lamp_type": "krcl_222", "preset_id": "ushio_b1",
                "x": 1, "y": 1, "z": 2.6, "aimx": 1, "aimy": 1, "aimz": 0}
        _init(client, session_headers, zones=[PLANE], lamps=[lamp])
        resp = client.post(f"{API}/session/calculate", json={}, headers=session_headers)
        assert resp.status_code == 200, resp.text
        stats = resp.json()["zones"]["zone-1"]["statistics"]
        assert stats["mean"] > 0


class TestPolygonVolume:
    def test_add_and_change_the_z_range_without_losing_the_footprint(self, client, session_headers):
        _init(client, session_headers, zones=[VOLUME])
        z = _zone(client, session_headers, "zone-2")
        assert _same_polygon(z["vertices"], TRIANGLE)
        assert (z["z_min"], z["z_max"]) == (0.5, 2.0)
        resp = client.patch(f"{API}/session/zones/zone-2", json={"z_min": 0.0, "z_max": 2.7}, headers=session_headers)
        assert resp.status_code == 200, resp.text
        z = _zone(client, session_headers, "zone-2")
        assert _same_polygon(z["vertices"], TRIANGLE)
        assert (z["z_min"], z["z_max"]) == (0.0, 2.7)


class TestPolygonZonePersistence:
    def test_save_and_load_keep_the_outline(self, client, session_headers):
        _init(client, session_headers, zones=[PLANE, VOLUME])
        saved = json.loads(client.get(f"{API}/session/save", headers=session_headers).content)
        resp = client.post(f"{API}/session/load", json=saved, headers=session_headers)
        assert resp.status_code == 200, resp.text
        loaded = {z["id"]: z for z in resp.json()["zones"]}
        assert _same_polygon(loaded["zone-1"]["vertices"], L_SHAPE)
        assert _same_polygon(loaded["zone-2"]["vertices"], TRIANGLE)

    def test_units_switch_converts_the_outline(self, client, session_headers):
        _init(client, session_headers, zones=[PLANE])
        resp = client.patch(f"{API}/session/units", json={"units": "centimeters"}, headers=session_headers)
        assert resp.status_code == 200, resp.text
        coords = resp.json()["zones"]["zone-1"]
        assert _same_polygon(coords["vertices"], [[x * 100, y * 100] for x, y in L_SHAPE])
