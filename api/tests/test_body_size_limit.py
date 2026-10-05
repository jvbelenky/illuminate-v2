"""Requests larger than the body cap are refused before any handler parses them."""
import base64
import pytest
from starlette.testclient import TestClient

from app.main import app
from api.v1 import body_limit

API = "/api/v1"


def test_oversized_body_is_413_before_parsing(monkeypatch):
    monkeypatch.setattr(body_limit, "MAX_BODY_BYTES", 1024)
    with TestClient(app) as c:
        big = {"meta": {"title": "x"}, "pathogens": ["a"], "images": {"cover": "data:image/png;base64," + "A" * 4096}}
        resp = c.post(f"{API}/session/report/pdf", json=big, headers={"X-Session-ID": "nope"})
    assert resp.status_code == 413
    assert "too large" in resp.json()["detail"].lower()


def test_small_body_passes_the_middleware():
    with TestClient(app) as c:
        resp = c.post(f"{API}/session/create")
    assert resp.status_code == 200


def test_default_cap_covers_twelve_full_size_images():
    # 12 images × 4 MB decoded ≈ 64 MB of base64 plus JSON overhead
    assert body_limit.MAX_BODY_BYTES >= 12 * (4 * 1024 * 1024 * 4 // 3) + 1024 * 1024
