"""Lamp catalog endpoint tests (no session needed)."""

from tests.conftest import API


class TestLampOptions:
    def test_returns_lamp_types(self, client):
        resp = client.get(f"{API}/lamps/options")
        assert resp.status_code == 200
        data = resp.json()
        assert "lamp_types" in data
        assert len(data["lamp_types"]) >= 2
        ids = [t["id"] for t in data["lamp_types"]]
        assert "krcl_222" in ids

    def test_returns_222nm_presets(self, client):
        resp = client.get(f"{API}/lamps/options")
        assert resp.status_code == 200
        data = resp.json()
        presets = data["presets_222nm"]
        assert len(presets) >= 1
        # All presets should have an id and name
        for p in presets:
            assert "id" in p
            assert "name" in p


class TestLampPresetDetails:
    def test_valid_preset_returns_details(self, client):
        resp = client.get(f"{API}/lamps/presets/ushio_b1")
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == "ushio_b1"
        assert data["wavelength"] == 222

    def test_invalid_preset_returns_404(self, client):
        resp = client.get(f"{API}/lamps/presets/nonexistent_lamp")
        assert resp.status_code == 404
