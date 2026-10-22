"""Each zone's safety limits for the mix of lamps lighting it."""
import io
import zipfile

import numpy as np
import pytest
from tests.conftest import API

PLANE = {"type": "plane", "height": 1.8, "x1": 0.0, "x2": 4.0, "y1": 0.0, "y2": 6.0, "num_x": 9, "num_y": 13}


def _calculate(client, headers):
    resp = client.post(f"{API}/session/calculate", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()["zones"]


def test_one_lamp_type_has_one_limit_and_no_grid(initialized_session):
    client, headers = initialized_session
    zones = _calculate(client, headers)
    plane = next(z for z in zones.values() if z["zone_type"] == "plane")
    limits = plane["limits"]
    assert set(limits) == {"icnirp", "acgih_eye", "acgih_skin"}
    # 222 nm: ICNIRP is far stricter than ACGIH skin, and the same everywhere
    assert limits["icnirp"]["ref"] < limits["acgih_skin"]["ref"]
    assert all(limit["grid"] is None for limit in limits.values())


@pytest.fixture()
def mixed_session(client, session_headers, ies_file_bytes):
    resp = client.post(
        f"{API}/session/init",
        json={
            "room": {"x": 4.0, "y": 6.0, "z": 2.7, "units": "meters", "standard": "ANSI IES RP 27.1-22 (ACGIH Limits)"},
            "lamps": [
                {"id": "l222", "preset_id": "ushio_b1", "lamp_type": "krcl_222", "x": 2.0, "y": 4.5, "z": 2.7},
                {"id": "l254", "lamp_type": "lp_254", "scaling_factor": 0.05, "x": 2.0, "y": 1.5, "z": 2.7},
            ],
            "zones": [{"id": "EyeLimits", **PLANE}, {"id": "SkinLimits", **PLANE}],
        },
        headers=session_headers,
    )
    assert resp.status_code == 200, resp.text
    resp = client.post(
        f"{API}/session/lamps/l254/ies",
        files={"file": ("lamp.ies", ies_file_bytes, "application/octet-stream")},
        headers=session_headers,
    )
    assert resp.status_code == 200, resp.text
    return client, session_headers


def test_mixed_lamps_give_a_plane_its_limit_at_each_point(mixed_session):
    client, headers = mixed_session
    zones = _calculate(client, headers)
    icnirp = zones["EyeLimits"]["limits"]["icnirp"]
    grid = np.array(icnirp["grid"], dtype=float)
    assert grid.shape == np.array(zones["EyeLimits"]["values"], dtype=float).shape
    # Between the 254 nm limit (6) and the 222 nm one (~23), nearer each lamp's own beside it
    assert 6 - 1e-6 <= np.nanmin(grid) < np.nanmax(grid) <= 24
    assert grid[4, 1] < grid[4, -2]
    assert 6 <= icnirp["ref"] <= 24


def test_export_traces_limit_levels_on_their_own_limit(mixed_session):
    client, headers = mixed_session
    zones = _calculate(client, headers)
    ref = zones["EyeLimits"]["limits"]["icnirp"]["ref"]
    style = {"view": "contours", "levels": [ref * 0.5, ref], "level_limits": ["icnirp", "icnirp"]}
    resp = client.post(f"{API}/session/export", json={"include_plots": True, "plot_styles": {"EyeLimits": style}}, headers=headers)
    assert resp.status_code == 200, resp.text
    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        assert any(name.endswith("(contours).png") for name in zf.namelist())


def test_an_unknown_limit_is_refused(initialized_session):
    client, headers = initialized_session
    _calculate(client, headers)
    style = {"view": "contours", "levels": [1], "level_limits": ["osha"]}
    resp = client.post(f"{API}/session/export", json={"plot_styles": {"x": style}}, headers=headers)
    assert resp.status_code == 422
