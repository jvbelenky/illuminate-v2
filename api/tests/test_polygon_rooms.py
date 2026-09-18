"""
Polygon (non-rectangular) room support through the session API.
"""

API = "/api/v1"

L_SHAPE = [[0, 0], [6, 0], [6, 2], [3, 2], [3, 4], [0, 4]]
PENTAGON = [[0, 0], [6, 0], [6, 3], [3, 5], [0, 3]]
BOWTIE = [[0, 0], [2, 2], [2, 0], [0, 2]]


def _init(client, headers, room_extra=None, zones=None, lamps=None):
    room = {
        "x": 6.0, "y": 4.0, "z": 2.7, "units": "meters",
        "standard": "ANSI IES RP 27.1-22 (ACGIH Limits)",
    }
    room.update(room_extra or {})
    resp = client.post(
        f"{API}/session/init",
        json={"room": room, "lamps": lamps or [], "zones": zones or []},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    return resp


class TestPolygonInit:
    def test_init_with_polygon_creates_indexed_walls(self, client, session_headers):
        _init(client, session_headers, {"polygon": L_SHAPE})
        resp = client.get(f"{API}/session/room/surfaces", headers=session_headers)
        assert resp.status_code == 200
        keys = list(resp.json()["surfaces"].keys())
        assert keys == ["floor", "ceiling"] + [f"wall_{i}" for i in range(6)]

    def test_init_polygon_ignores_cardinal_reflectances(self, client, session_headers):
        # Frontend may still send cardinal keys; they must not 400 a polygon room.
        _init(client, session_headers, {
            "polygon": L_SHAPE,
            "reflectances": {"floor": 0.1, "south": 0.3, "wall_1": 0.5},
        })
        resp = client.patch(f"{API}/session/room", json={"z": 2.7}, headers=session_headers)
        refl = resp.json()["room"]["reflectances"]
        assert refl["floor"] == 0.1
        assert refl["wall_1"] == 0.5

    def test_init_rejects_too_few_vertices(self, client, session_headers):
        resp = client.post(
            f"{API}/session/init",
            json={"room": {"x": 6, "y": 4, "z": 2.7, "polygon": [[0, 0], [1, 0]]},
                  "lamps": [], "zones": []},
            headers=session_headers,
        )
        assert resp.status_code == 422

    def test_init_rejects_negative_vertex(self, client, session_headers):
        resp = client.post(
            f"{API}/session/init",
            json={"room": {"x": 6, "y": 4, "z": 2.7, "polygon": [[-1, 0], [1, 0], [1, 1]]},
                  "lamps": [], "zones": []},
            headers=session_headers,
        )
        assert resp.status_code == 422


class TestPolygonPatch:
    def test_rectangle_to_polygon_echo(self, client, session_headers):
        _init(client, session_headers)
        client.patch(f"{API}/session/room",
                     json={"reflectances": {"south": 0.3, "east": 0.5, "floor": 0.1}},
                     headers=session_headers)
        resp = client.patch(f"{API}/session/room", json={"polygon": L_SHAPE}, headers=session_headers)
        assert resp.status_code == 200, resp.text
        room = resp.json()["room"]
        assert room["shape"] == "polygon"
        assert room["vertices"] == [[float(x), float(y)] for x, y in L_SHAPE]
        assert room["wall_ids"] == [f"wall_{i}" for i in range(6)]
        assert (room["x"], room["y"], room["z"]) == (6.0, 4.0, 2.7)
        # Reflectances carried over by edge index (south -> wall_0, east -> wall_1)
        assert room["reflectances"]["wall_0"] == 0.3
        assert room["reflectances"]["wall_1"] == 0.5
        assert room["reflectances"]["floor"] == 0.1
        assert "south" not in room["reflectances"]
        assert set(room["reflectance_num_points"].keys()) == set(room["reflectances"].keys())

    def test_polygon_to_rectangle_via_xy(self, client, session_headers):
        _init(client, session_headers, {"polygon": L_SHAPE})
        resp = client.patch(f"{API}/session/room", json={"x": 8.0, "y": 5.0}, headers=session_headers)
        assert resp.status_code == 200, resp.text
        room = resp.json()["room"]
        assert room["shape"] == "rectangle"
        assert room["wall_ids"] == ["south", "east", "north", "west"]
        assert (room["x"], room["y"]) == (8.0, 5.0)

    def test_vertex_count_change_drops_stale_wall(self, client, session_headers):
        _init(client, session_headers, {"polygon": L_SHAPE})
        resp = client.patch(f"{API}/session/room", json={"polygon": PENTAGON}, headers=session_headers)
        room = resp.json()["room"]
        assert room["wall_ids"] == [f"wall_{i}" for i in range(5)]
        assert "wall_5" not in room["reflectances"]

    def test_polygon_with_height(self, client, session_headers):
        _init(client, session_headers)
        resp = client.patch(f"{API}/session/room", json={"polygon": PENTAGON, "z": 3.2}, headers=session_headers)
        assert resp.json()["room"]["z"] == 3.2

    def test_self_intersecting_polygon_is_400_with_message(self, client, session_headers):
        _init(client, session_headers)
        resp = client.patch(f"{API}/session/room", json={"polygon": BOWTIE}, headers=session_headers)
        assert resp.status_code == 400
        assert "self-intersect" in resp.json()["detail"]

    def test_polygon_and_xy_together_is_422(self, client, session_headers):
        _init(client, session_headers)
        resp = client.patch(f"{API}/session/room", json={"polygon": L_SHAPE, "x": 3.0}, headers=session_headers)
        assert resp.status_code == 422

    def test_rectangle_patch_echo_unchanged_shape(self, client, session_headers):
        _init(client, session_headers)
        resp = client.patch(f"{API}/session/room", json={"x": 5.0}, headers=session_headers)
        room = resp.json()["room"]
        assert room["shape"] == "rectangle"
        assert room["vertices"] == [[0.0, 0.0], [5.0, 0.0], [5.0, 4.0], [0.0, 4.0]]


class TestPolygonUnits:
    def test_units_echo_scales_vertices(self, client, session_headers):
        _init(client, session_headers, {"polygon": L_SHAPE})
        resp = client.patch(f"{API}/session/units", json={"units": "feet"}, headers=session_headers)
        assert resp.status_code == 200, resp.text
        room = resp.json()["room"]
        assert room["shape"] == "polygon"
        assert len(room["vertices"]) == 6
        assert abs(room["x"] - 6 / 0.3048) < 1e-6
        assert abs(max(v[0] for v in room["vertices"]) - 6 / 0.3048) < 1e-6


class TestPolygonCalculate:
    def test_masked_zone_values_expand_to_full_grid(self, client, session_headers):
        _init(
            client, session_headers, {"polygon": L_SHAPE},
            lamps=[{"preset_id": "ushio_b1", "lamp_type": "krcl_222",
                    "x": 1.5, "y": 1.0, "z": 2.7, "aimx": 1.5, "aimy": 1.0, "aimz": 0.0}],
            zones=[{"id": "EyeLimits", "type": "plane", "isStandard": True},
                   {"id": "WholeRoomFluence", "type": "volume", "isStandard": True}],
        )
        resp = client.post(f"{API}/session/calculate", headers=session_headers)
        assert resp.status_code == 200, resp.text
        zones = resp.json()["zones"]

        eye = zones["EyeLimits"]
        assert eye["num_points"] == [50, 50]
        values = eye["values"]
        assert len(values) == 50 and len(values[0]) == 50
        flat = [v for row in values for v in row]
        holes = sum(1 for v in flat if v is None)
        inside = [v for v in flat if v is not None]
        # The cut-out corner (x in (3, 6), y in (2, 4)) is exactly the top-right
        # 25x25 block of offset cell centres
        assert holes == 625
        assert all(v >= 0 for v in inside)
        # Cell centre (5.9, 3.9) is in the cut-out corner of the L
        assert values[49][49] is None
        # Cell centre (0.06, 0.04) is inside
        assert values[0][0] is not None
        assert eye["statistics"]["max"] is not None

        wrf = zones["WholeRoomFluence"]
        assert wrf["num_points"] == [25, 25, 25]
        wrf_flat = [v for plane in wrf["values"] for row in plane for v in row]
        # ~25% of the bounding box is cut out; cell centres that land exactly on
        # the x=3 edge count as outside, so allow a little slack around 25^3/4
        wrf_holes = sum(1 for v in wrf_flat if v is None)
        assert 25 * 25 * 25 * 0.2 < wrf_holes < 25 * 25 * 25 * 0.3
        assert wrf["values"][24][24][0] is None
        assert wrf["values"][0][0][0] is not None


class TestPolygonSaveLoad:
    def test_save_load_round_trip(self, client, session_headers):
        _init(client, session_headers, {"polygon": L_SHAPE})
        client.patch(f"{API}/session/room", json={"reflectances": {"wall_2": 0.4}}, headers=session_headers)
        saved = client.get(f"{API}/session/save", headers=session_headers)
        assert saved.status_code == 200, saved.text

        loaded = client.post(f"{API}/session/load", json=saved.json(), headers=session_headers)
        assert loaded.status_code == 200, loaded.text
        room = loaded.json()["room"]
        assert room["shape"] == "polygon"
        assert room["vertices"] == [[float(x), float(y)] for x, y in L_SHAPE]
        assert room["wall_ids"] == [f"wall_{i}" for i in range(6)]
        assert room["reflectances"]["wall_2"] == 0.4

    def test_rectangle_load_reports_rectangle(self, client, session_headers):
        _init(client, session_headers)
        saved = client.get(f"{API}/session/save", headers=session_headers)
        loaded = client.post(f"{API}/session/load", json=saved.json(), headers=session_headers)
        room = loaded.json()["room"]
        assert room["shape"] == "rectangle"
        assert room["wall_ids"] == ["south", "east", "north", "west"]


class TestSurfaceIds:
    def test_unknown_surface_id_is_a_clear_400(self, client, session_headers):
        _init(client, session_headers, {"polygon": L_SHAPE})
        resp = client.patch(f"{API}/session/room", json={"reflectances": {"south": 0.3}}, headers=session_headers)
        assert resp.status_code == 400
        assert "Unknown surface id" in resp.json()["detail"]
        assert "wall_0" in resp.json()["detail"]

    def test_reflectances_in_same_patch_as_polygon_apply_to_new_walls(self, client, session_headers):
        _init(client, session_headers)
        resp = client.patch(
            f"{API}/session/room",
            json={"polygon": PENTAGON, "reflectances": {"wall_4": 0.25, "floor": 0.1}},
            headers=session_headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["room"]["reflectances"]["wall_4"] == 0.25
        assert resp.json()["room"]["reflectances"]["floor"] == 0.1
