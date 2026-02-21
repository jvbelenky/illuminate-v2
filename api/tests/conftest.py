"""
Shared fixtures for illuminate-v2 API tests.

Fixture composition chain:
  client → session_id → session_headers → initialized_session → calculated_session
"""

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
    with patch("api.v1.session_routers.DEV_MODE", True):
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
        "standard": "ACGIH",
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
