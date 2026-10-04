"""Every supported length unit through the session API: init, conversion
between every pair, unit-aware limits, photometric webs and file loading."""

import itertools
import json

import pytest

from guv_calcs import Room
from guv_calcs.units import LengthUnits, convert_length

API = "/api/v1"
# Fixes that ship with the next guv-calcs release (float-tolerant grid point
# counts); CI runs against the pinned PyPI version until the pin is bumped.
NEW_GUV_CALCS = hasattr(LengthUnits.METERS, "abbreviation")
needs_new_guv_calcs = pytest.mark.skipif(not NEW_GUV_CALCS, reason="needs unreleased guv-calcs")
UNITS = ["meters", "centimeters", "millimeters", "feet", "inches"]
PAIRS = list(itertools.permutations(UNITS, 2))


def _k(src, dst):
    return float(convert_length(src, dst, 1.0))


def _furnish(client, headers, units):
    """Init a 6x4x2.7 m-equivalent room with a lamp, plane, volume and box."""
    k = _k("meters", units)
    resp = client.post(
        f"{API}/session/init",
        json={
            "room": {"x": 6 * k, "y": 4 * k, "z": 2.7 * k, "units": units,
                     "standard": "ANSI IES RP 27.1-22 (ACGIH Limits)"},
            "lamps": [{"preset_id": "ushio_b1", "lamp_type": "krcl_222",
                       "x": 3 * k, "y": 2 * k, "z": 2.6 * k,
                       "aimx": 3 * k, "aimy": 2 * k, "aimz": 0.0}],
            "zones": [
                {"id": "plane", "type": "plane", "height": 1.0 * k,
                 "x1": 1 * k, "x2": 5 * k, "y1": 1 * k, "y2": 3 * k,
                 "num_x": 8, "num_y": 4},
                {"id": "vol", "type": "volume",
                 "x_min": 0, "x_max": 6 * k, "y_min": 0, "y_max": 4 * k,
                 "z_min": 0, "z_max": 2 * k, "num_x": 6, "num_y": 4, "num_z": 4},
            ],
        },
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    obj = client.post(
        f"{API}/session/objects",
        json={"id": "desk", "shape": "box", "width": 1.2 * k, "length": 0.6 * k,
              "height": 0.75 * k, "x": 2 * k, "y": 3 * k, "z": 0},
        headers=headers,
    )
    assert obj.status_code == 200, obj.text
    return resp.json()


def _saved_room(client, headers):
    """The room dict inside a GET /session/save payload (lamp positions live here)."""
    payload = json.loads(client.get(f"{API}/session/save", headers=headers).content)
    data = payload["data"]
    if "rooms" in data:
        return next(iter(data["rooms"].values()))
    return data


def _geometry(client, headers):
    """Flat dict of lengths from the current session, in its units."""
    status = client.get(f"{API}/session/status", headers=headers).json()
    zones = client.get(f"{API}/session/zones", headers=headers).json()
    objects = client.get(f"{API}/session/objects", headers=headers).json()
    lamp = next(iter(_saved_room(client, headers)["lamps"].values()))
    zmap = {z["id"]: z for z in zones["zones"]} if isinstance(zones["zones"], list) else zones["zones"]
    omap = {o["id"]: o for o in objects["objects"]} if isinstance(objects["objects"], list) else objects["objects"]
    dims = status["room"]["dimensions"]
    return {
        "units": status["room"]["units"],
        "x": dims[0], "y": dims[1], "z": dims[2],
        "lamp_x": lamp["x"], "lamp_z": lamp["z"], "lamp_aimz": lamp["aimz"],
        "plane_x1": zmap["plane"]["x1"], "plane_x2": zmap["plane"]["x2"],
        "plane_h": zmap["plane"]["height"],
        "vol_x_max": zmap["vol"]["x_max"], "vol_z_max": zmap["vol"]["z_max"],
        "desk_x": omap["desk"]["x"], "desk_w": omap["desk"]["width"],
        "desk_h": omap["desk"]["height"],
    }


def _set_units(client, headers, units):
    resp = client.patch(f"{API}/session/units", json={"units": units}, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


# ---------------------------------------------------------------------------
# Init
# ---------------------------------------------------------------------------

class TestInitInEveryUnit:

    @pytest.mark.parametrize("units", UNITS)
    def test_init_reports_units_and_dimensions(self, client, session_headers, units):
        _furnish(client, session_headers, units)
        geo = _geometry(client, session_headers)
        k = _k("meters", units)
        assert geo["units"] == units
        assert geo["x"] == pytest.approx(6 * k, rel=1e-9)
        assert geo["z"] == pytest.approx(2.7 * k, rel=1e-9)
        assert geo["lamp_x"] == pytest.approx(3 * k, rel=1e-9)
        assert geo["plane_h"] == pytest.approx(1.0 * k, rel=1e-9)
        assert geo["desk_w"] == pytest.approx(1.2 * k, rel=1e-9)

    def test_unsupported_unit_is_422(self, client, session_headers):
        resp = client.post(
            f"{API}/session/init",
            json={"room": {"x": 6, "y": 4, "z": 2.7, "units": "yards"}, "lamps": [], "zones": []},
            headers=session_headers,
        )
        assert resp.status_code == 422

    @pytest.mark.parametrize("units", UNITS)
    def test_standard_zones_fit_the_room(self, client, session_headers, units):
        k = _k("meters", units)
        resp = client.post(
            f"{API}/session/init",
            json={"room": {"x": 6 * k, "y": 4 * k, "z": 2.7 * k, "units": units},
                  "lamps": [], "zones": [{"id": "EyeLimits", "type": "plane", "isStandard": True}]},
            headers=session_headers,
        )
        assert resp.status_code == 200, resp.text
        zones = client.get(f"{API}/session/zones", headers=session_headers).json()["zones"]
        zmap = {z["id"]: z for z in zones} if isinstance(zones, list) else zones
        eye = zmap["EyeLimits"]
        assert 0 < eye["height"] < 2.7 * k
        assert eye["x2"] == pytest.approx(6 * k, rel=1e-6)


# ---------------------------------------------------------------------------
# PATCH /session/units across every pair
# ---------------------------------------------------------------------------

class TestConvertEveryPair:

    @pytest.mark.parametrize("src,dst", PAIRS)
    def test_everything_scales(self, client, session_headers, src, dst):
        _furnish(client, session_headers, src)
        before = _geometry(client, session_headers)
        data = _set_units(client, session_headers, dst)
        assert data["units"] == dst
        after = _geometry(client, session_headers)
        k = _k(src, dst)
        assert after["units"] == dst
        for key, v in before.items():
            if key == "units":
                continue
            assert after[key] == pytest.approx(v * k, rel=1e-6), key
        # the echo carries the same converted values the GETs report
        assert data["room"]["x"] == pytest.approx(after["x"], rel=1e-9)
        assert data["objects"]["desk"]["width"] == pytest.approx(after["desk_w"], rel=1e-9)
        assert data["zones"]["plane"]["height"] == pytest.approx(after["plane_h"], rel=1e-9)

    @pytest.mark.parametrize("src,dst", PAIRS)
    def test_round_trip_restores(self, client, session_headers, src, dst):
        _furnish(client, session_headers, src)
        before = _geometry(client, session_headers)
        _set_units(client, session_headers, dst)
        _set_units(client, session_headers, src)
        after = _geometry(client, session_headers)
        for key, v in before.items():
            if key == "units":
                continue
            assert after[key] == pytest.approx(v, rel=1e-6, abs=1e-9), key

    def test_chain_through_every_unit(self, client, session_headers):
        _furnish(client, session_headers, "meters")
        before = _geometry(client, session_headers)
        for u in ["inches", "centimeters", "feet", "millimeters", "meters"]:
            _set_units(client, session_headers, u)
        after = _geometry(client, session_headers)
        for key, v in before.items():
            if key == "units":
                continue
            assert after[key] == pytest.approx(v, rel=1e-6, abs=1e-9), key

    @needs_new_guv_calcs
    @pytest.mark.parametrize("dst", UNITS)
    def test_grid_point_counts_unchanged(self, client, session_headers, dst):
        _furnish(client, session_headers, "meters")
        data = _set_units(client, session_headers, dst)
        assert (data["zones"]["plane"]["num_x"], data["zones"]["plane"]["num_y"]) == (8, 4)
        assert (data["zones"]["vol"]["num_x"], data["zones"]["vol"]["num_z"]) == (6, 4)

    def test_same_units_is_a_noop(self, client, session_headers):
        _furnish(client, session_headers, "inches")
        before = _geometry(client, session_headers)
        _set_units(client, session_headers, "inches")
        assert _geometry(client, session_headers) == before

    def test_results_survive_conversion(self, client, session_headers):
        _furnish(client, session_headers, "meters")
        calc = client.post(f"{API}/session/calculate", headers=session_headers)
        assert calc.status_code == 200, calc.text
        mean_m = calc.json()["zones"]["plane"]["statistics"]["mean"]
        _set_units(client, session_headers, "inches")
        hashes = client.get(f"{API}/session/state-hashes", headers=session_headers).json()
        assert hashes  # still a valid session
        calc2 = client.post(f"{API}/session/calculate", headers=session_headers)
        assert calc2.status_code == 200, calc2.text
        # irradiance is physical: the same room in inches gives the same numbers
        assert calc2.json()["zones"]["plane"]["statistics"]["mean"] == pytest.approx(mean_m, rel=1e-3)


# ---------------------------------------------------------------------------
# Unit-aware limits
# ---------------------------------------------------------------------------

class TestUnitAwareLimits:

    def _init(self, client, headers, room):
        room.setdefault("standard", "ANSI IES RP 27.1-22 (ACGIH Limits)")
        return client.post(f"{API}/session/init", json={"room": room, "lamps": [], "zones": []}, headers=headers)

    @pytest.mark.parametrize("units,x,ok", [
        ("meters", 1000, True), ("meters", 1001, False),
        ("centimeters", 100_000, True), ("centimeters", 100_001, False),
        ("millimeters", 1_000_000, True), ("millimeters", 1_000_001, False),
        ("feet", 3280, True), ("feet", 3281, False),
        ("inches", 39370, True), ("inches", 39371, False),
    ])
    def test_room_extent_limit_follows_units(self, client, session_headers, units, x, ok):
        resp = self._init(client, session_headers, {"x": x, "y": 1, "z": 1, "units": units})
        assert (resp.status_code == 200) is ok, resp.text
        if not ok:
            assert "Room x must be <=" in resp.text

    @pytest.mark.parametrize("units,z,ok", [
        ("meters", 100, True), ("meters", 101, False),
        ("centimeters", 10_000, True), ("centimeters", 10_001, False),
        ("inches", 3937, True), ("inches", 3938, False),
    ])
    def test_room_height_limit_follows_units(self, client, session_headers, units, z, ok):
        resp = self._init(client, session_headers, {"x": 1, "y": 1, "z": z, "units": units})
        assert (resp.status_code == 200) is ok, resp.text

    def test_polygon_vertices_limit_follows_units(self, client, session_headers):
        big = [[0, 0], [5000, 0], [5000, 3000], [0, 3000]]  # 50 x 30 m in cm
        resp = self._init(client, session_headers,
                          {"x": 1, "y": 1, "z": 270, "units": "centimeters", "polygon": big})
        assert resp.status_code == 200, resp.text
        resp = self._init(client, session_headers,
                          {"x": 1, "y": 1, "z": 2.7, "units": "meters", "polygon": big})
        assert resp.status_code == 422

    def test_room_update_limit_uses_session_units(self, client, session_headers):
        _furnish(client, session_headers, "millimeters")
        ok = client.patch(f"{API}/session/room", json={"x": 500_000}, headers=session_headers)
        assert ok.status_code == 200, ok.text
        bad = client.patch(f"{API}/session/room", json={"x": 2_000_000}, headers=session_headers)
        assert bad.status_code == 400
        assert "mm" in bad.json()["detail"]
        bad_z = client.patch(f"{API}/session/room", json={"z": 200_000}, headers=session_headers)
        assert bad_z.status_code == 400

    @pytest.mark.parametrize("units,spacing,ok", [
        ("meters", 0.01, True), ("meters", 0.004, False),
        ("centimeters", 1.0, True), ("centimeters", 0.4, False),
        ("millimeters", 10.0, True), ("millimeters", 4.0, False),
        ("inches", 0.25, True), ("inches", 0.15, False),
        ("feet", 0.02, True), ("feet", 0.01, False),
    ])
    def test_zone_spacing_floor_follows_units(self, client, session_headers, units, spacing, ok):
        _furnish(client, session_headers, units)
        k = _k("meters", units)
        resp = client.post(
            f"{API}/session/zones",
            json={"id": "fine", "type": "plane", "height": 1.0 * k,
                  "x1": 0, "x2": 0.2 * k, "y1": 0, "y2": 0.2 * k,
                  "x_spacing": spacing, "y_spacing": spacing},
            headers=session_headers,
        )
        assert (resp.status_code == 200) is ok, resp.text
        if not ok:
            assert "spacing must be >" in resp.json()["detail"]

    def test_zone_spacing_update_floor_follows_units(self, client, session_headers):
        _furnish(client, session_headers, "centimeters")
        bad = client.patch(f"{API}/session/zones/plane", json={"x_spacing": 0.3}, headers=session_headers)
        assert bad.status_code == 400
        good = client.patch(f"{API}/session/zones/plane", json={"x_spacing": 25.0}, headers=session_headers)
        assert good.status_code == 200, good.text
        assert good.json()["x_spacing"] == pytest.approx(25.0)


# ---------------------------------------------------------------------------
# Photometric webs
# ---------------------------------------------------------------------------

class TestPhotometricWebUnits:

    @pytest.mark.parametrize("units", UNITS)
    def test_catalog_web_scales_with_units(self, client, units):
        base = client.post(f"{API}/lamps/photometric-web", json={"preset_id": "ushio_b1"}).json()
        resp = client.post(f"{API}/lamps/photometric-web", json={"preset_id": "ushio_b1", "units": units})
        assert resp.status_code == 200, resp.text
        data = resp.json()
        k = _k("meters", units)
        assert len(data["vertices"]) == len(base["vertices"])
        assert data["vertices"][0][2] == pytest.approx(base["vertices"][0][2] * k, rel=1e-6)
        assert data["aim_line"][1][2] == pytest.approx(base["aim_line"][1][2] * k, rel=1e-6)

    def test_catalog_web_rejects_unknown_units(self, client):
        resp = client.post(f"{API}/lamps/photometric-web", json={"preset_id": "ushio_b1", "units": "yards"})
        assert resp.status_code == 422

    @pytest.mark.parametrize("units", UNITS)
    def test_session_web_in_room_units(self, client, session_headers, units):
        _furnish(client, session_headers, units)
        lamp_id = client.get(f"{API}/session/status", headers=session_headers).json()["lamp_ids"][0]
        resp = client.get(f"{API}/session/lamps/{lamp_id}/photometric-web", headers=session_headers)
        assert resp.status_code == 200, resp.text
        k = _k("meters", units)
        assert resp.json()["aim_line"][1][2] == pytest.approx(-1.0 * k, rel=1e-9)


# ---------------------------------------------------------------------------
# Files
# ---------------------------------------------------------------------------

class TestFileRoundTrips:

    @pytest.mark.parametrize("units", UNITS)
    def test_save_load_keeps_units_and_geometry(self, client, session_headers, units):
        _furnish(client, session_headers, units)
        before = _geometry(client, session_headers)
        saved = json.loads(client.get(f"{API}/session/save", headers=session_headers).content)
        resp = client.post(f"{API}/session/load", json=saved, headers=session_headers)
        assert resp.status_code == 200, resp.text
        assert resp.json()["room"]["units"] == units
        after = _geometry(client, session_headers)
        for key, v in before.items():
            if key == "units":
                continue
            assert after[key] == pytest.approx(v, rel=1e-6, abs=1e-9), key

    def test_yards_file_loads_as_meters(self, client, session_headers):
        room = Room(x=7, y=5, z=3, units="yards")
        payload = json.loads(room.save())
        resp = client.post(f"{API}/session/load", json=payload, headers=session_headers)
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["room"]["units"] == "meters"
        assert data["room"]["x"] == pytest.approx(7 * 0.9144, rel=1e-9)
        assert data["room"]["z"] == pytest.approx(3 * 0.9144, rel=1e-9)
