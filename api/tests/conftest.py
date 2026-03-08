"""
Shared fixtures for illuminate-v2 API tests.

Fixture composition chain:
  client → session_id → session_headers → initialized_session → calculated_session
"""

import pathlib

import pytest
from unittest.mock import patch

from starlette.testclient import TestClient

from app.main import app

API = "/api/v1"


# ---------------------------------------------------------------------------
# DEV_MODE — patched once per test session so token validation is skipped.
# Must patch the module-level variable directly (it's cached at import time
# from os.getenv on session_routers line 94).
# ---------------------------------------------------------------------------
@pytest.fixture(scope="session", autouse=True)
def set_dev_mode():
    with patch("api.v1.session_helpers.DEV_MODE", True):
        yield


# ---------------------------------------------------------------------------
# Fresh TestClient per test (lifespan starts/stops SessionManager)
# ---------------------------------------------------------------------------
@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


# ---------------------------------------------------------------------------
# Session creation — returns (session_id, token)
# ---------------------------------------------------------------------------
@pytest.fixture()
def session_id(client):
    resp = client.post(f"{API}/session/create")
    assert resp.status_code == 200
    data = resp.json()
    return data["session_id"], data["token"]


# ---------------------------------------------------------------------------
# Convenience headers dict
# ---------------------------------------------------------------------------
@pytest.fixture()
def session_headers(session_id):
    sid, token = session_id
    return {
        "X-Session-ID": sid,
        "Authorization": f"Bearer {token}",
    }


# ---------------------------------------------------------------------------
# Reusable payloads
# ---------------------------------------------------------------------------
@pytest.fixture()
def minimal_room_config():
    return {
        "x": 4.0,
        "y": 6.0,
        "z": 2.7,
        "units": "meters",
        "standard": "ANSI IES RP 27.1-22 (ACGIH Limits)",
    }


@pytest.fixture()
def minimal_lamp_input():
    return {
        "preset_id": "ushio_b1",
        "lamp_type": "krcl_222",
        "x": 2.0,
        "y": 3.0,
        "z": 2.7,
        "aimx": 0.0,
        "aimy": 0.0,
        "aimz": -1.0,
    }


@pytest.fixture()
def minimal_zone_input():
    return {
        "type": "plane",
        "height": 1.8,
        "x1": 0.0,
        "x2": 4.0,
        "y1": 0.0,
        "y2": 6.0,
        "num_x": 5,
        "num_y": 5,
    }


# ---------------------------------------------------------------------------
# Initialized session — room + 1 lamp + 1 zone (5×5 grid)
# ---------------------------------------------------------------------------
@pytest.fixture()
def initialized_session(client, session_headers, minimal_room_config, minimal_lamp_input, minimal_zone_input):
    resp = client.post(
        f"{API}/session/init",
        json={
            "room": minimal_room_config,
            "lamps": [minimal_lamp_input],
            "zones": [minimal_zone_input],
        },
        headers=session_headers,
    )
    assert resp.status_code == 200, resp.text
    return client, session_headers


# ---------------------------------------------------------------------------
# Calculated session — initialized + POST /session/calculate completed
# ---------------------------------------------------------------------------
@pytest.fixture()
def calculated_session(initialized_session):
    client, headers = initialized_session
    resp = client.post(f"{API}/session/calculate", headers=headers)
    assert resp.status_code == 200, resp.text
    return client, headers, resp.json()


# ---------------------------------------------------------------------------
# IES file bytes — reads ushio_b1.ies from guv-calcs data directory
# ---------------------------------------------------------------------------
@pytest.fixture()
def ies_file_bytes():
    ies_path = pathlib.Path.home() / "projects/guv-calcs/src/guv_calcs/data/lamp_data/ushio_b1.ies"
    return ies_path.read_bytes()


# ---------------------------------------------------------------------------
# Minimal spectrum CSV — 2-column CSV (wavelength, intensity)
# ---------------------------------------------------------------------------
@pytest.fixture()
def minimal_spectrum_csv():
    return b"200,0.0\n210,0.1\n220,0.5\n222,1.0\n230,0.3\n240,0.1\n250,0.0\n"


# ---------------------------------------------------------------------------
# Minimal intensity map CSV — 3×3 float grid
# ---------------------------------------------------------------------------
@pytest.fixture()
def minimal_intensity_map_csv():
    return b"0.5,0.8,0.5\n0.8,1.0,0.8\n0.5,0.8,0.5\n"


# ---------------------------------------------------------------------------
# Custom lamp session — session with a lamp that has no preset/IES
# Returns (client, headers, lamp_id)
# ---------------------------------------------------------------------------
@pytest.fixture()
def custom_lamp_session(client, session_headers, minimal_room_config):
    resp = client.post(
        f"{API}/session/init",
        json={
            "room": minimal_room_config,
            "lamps": [{
                "lamp_type": "lp_254",
                "x": 2.0, "y": 3.0, "z": 2.7,
                "aimx": 0.0, "aimy": 0.0, "aimz": -1.0,
            }],
            "zones": [],
        },
        headers=session_headers,
    )
    assert resp.status_code == 200, resp.text
    status = client.get(f"{API}/session/status", headers=session_headers).json()
    lamp_id = status["lamp_ids"][0]
    return client, session_headers, lamp_id


# ---------------------------------------------------------------------------
# Lamp-with-IES session — session with preset lamp (ushio_b1) that has IES data
# Returns (client, headers, lamp_id)
# ---------------------------------------------------------------------------
@pytest.fixture()
def lamp_with_ies_session(initialized_session):
    client, headers = initialized_session
    status = client.get(f"{API}/session/status", headers=headers).json()
    lamp_id = status["lamp_ids"][0]
    return client, headers, lamp_id


# ---------------------------------------------------------------------------
# Reflectance session — initialized with reflectance enabled and values set
# Returns (client, headers)
# ---------------------------------------------------------------------------
@pytest.fixture()
def reflectance_session(client, session_headers, minimal_lamp_input, minimal_zone_input):
    resp = client.post(
        f"{API}/session/init",
        json={
            "room": {
                "x": 4.0,
                "y": 6.0,
                "z": 2.7,
                "units": "meters",
                "standard": "ANSI IES RP 27.1-22 (ACGIH Limits)",
                "enable_reflectance": True,
                "reflectances": {
                    "floor": 0.1, "ceiling": 0.1,
                    "north": 0.08, "south": 0.08,
                    "east": 0.08, "west": 0.08,
                },
                "reflectance_max_num_passes": 3,
                "reflectance_threshold": 0.05,
            },
            "lamps": [minimal_lamp_input],
            "zones": [minimal_zone_input],
        },
        headers=session_headers,
    )
    assert resp.status_code == 200, resp.text
    return client, session_headers


# ---------------------------------------------------------------------------
# Multi-zone session — one plane zone (5×5) + one volume zone (3×3×3)
# Returns (client, headers, plane_zone_id, volume_zone_id)
# ---------------------------------------------------------------------------
@pytest.fixture()
def multi_zone_session(client, session_headers, minimal_room_config, minimal_lamp_input):
    resp = client.post(
        f"{API}/session/init",
        json={
            "room": minimal_room_config,
            "lamps": [minimal_lamp_input],
            "zones": [
                {
                    "type": "plane",
                    "height": 1.8,
                    "x1": 0.0, "x2": 4.0,
                    "y1": 0.0, "y2": 6.0,
                    "num_x": 5, "num_y": 5,
                },
                {
                    "type": "volume",
                    "x_min": 0.0, "x_max": 4.0,
                    "y_min": 0.0, "y_max": 6.0,
                    "z_min": 0.5, "z_max": 2.0,
                    "num_x": 3, "num_y": 3, "num_z": 3,
                },
            ],
        },
        headers=session_headers,
    )
    assert resp.status_code == 200, resp.text
    status = client.get(f"{API}/session/status", headers=session_headers).json()
    zone_ids = status["zone_ids"]
    # First zone is plane, second is volume
    return client, session_headers, zone_ids[0], zone_ids[1]


# ---------------------------------------------------------------------------
# Standard-zones session — EyeLimits + SkinLimits + WholeRoomFluence
# Returns (client, headers)
# ---------------------------------------------------------------------------
@pytest.fixture()
def standard_zones_session(client, session_headers, minimal_room_config, minimal_lamp_input):
    resp = client.post(
        f"{API}/session/init",
        json={
            "room": minimal_room_config,
            "lamps": [minimal_lamp_input],
            "zones": [
                {"id": "WholeRoomFluence", "type": "plane", "isStandard": True, "height": 1.2},
                {"id": "EyeLimits", "type": "plane", "isStandard": True, "height": 1.8,
                 "x1": 0.0, "x2": 4.0, "y1": 0.0, "y2": 6.0, "num_x": 5, "num_y": 5},
                {"id": "SkinLimits", "type": "plane", "isStandard": True, "height": 1.8,
                 "x1": 0.0, "x2": 4.0, "y1": 0.0, "y2": 6.0, "num_x": 5, "num_y": 5},
            ],
        },
        headers=session_headers,
    )
    assert resp.status_code == 200, resp.text
    return client, session_headers
