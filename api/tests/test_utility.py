"""Smoke tests for utility endpoints — proves the test rig works."""

from tests.conftest import API


class TestHealth:
    def test_health_returns_ok(self, client):
        resp = client.get(f"{API}/health")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}


class TestVersion:
    def test_version_returns_expected_fields(self, client):
        resp = client.get(f"{API}/version")
        assert resp.status_code == 200
        data = resp.json()
        assert "version" in data
        assert "guv_calcs_version" in data


class TestReady:
    def test_ready_returns_ok(self, client):
        resp = client.get(f"{API}/ready")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ready"
        assert data["checks"]["guv_calcs_import"] is True
