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


class TestValidatePreset:
    def test_valid_returns_true(self, client):
        resp = client.get(f"{API}/lamps/validate-preset/ushio_b1")
        assert resp.status_code == 200
        assert resp.json()["valid"] is True

    def test_invalid_returns_false(self, client):
        resp = client.get(f"{API}/lamps/validate-preset/nonexistent_lamp")
        assert resp.status_code == 200
        assert resp.json()["valid"] is False


class TestLampInfo:
    def test_returns_plots_and_power(self, client):
        resp = client.get(f"{API}/lamps/info/ushio_b1")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_power_mw"] > 0
        assert len(data["photometric_plot_base64"]) > 0
        assert data["has_spectrum"] is True

    def test_invalid_returns_404(self, client):
        resp = client.get(f"{API}/lamps/info/nonexistent_lamp")
        assert resp.status_code == 404


class TestCatalogPhotometricWeb:
    def test_returns_mesh_data(self, client):
        resp = client.post(
            f"{API}/lamps/photometric-web",
            json={"preset_id": "ushio_b1"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "vertices" in data
        assert "triangles" in data
        assert len(data["vertices"]) > 0

    def test_invalid_returns_400(self, client):
        resp = client.post(
            f"{API}/lamps/photometric-web",
            json={"preset_id": "nonexistent_lamp"},
        )
        assert resp.status_code == 400


class TestDownloadIES:
    def test_returns_file(self, client):
        resp = client.get(f"{API}/lamps/download/ies/ushio_b1")
        assert resp.status_code == 200
        assert "application/octet-stream" in resp.headers["content-type"]

    def test_starts_with_iesna_marker(self, client):
        resp = client.get(f"{API}/lamps/download/ies/ushio_b1")
        content = resp.content
        first_line = content.split(b"\n")[0].strip().upper()
        assert b"IESNA" in first_line

    def test_invalid_returns_404(self, client):
        resp = client.get(f"{API}/lamps/download/ies/nonexistent_lamp")
        assert resp.status_code == 404


class TestDownloadSpectrum:
    def test_returns_csv(self, client):
        resp = client.get(f"{API}/lamps/download/spectrum/ushio_b1")
        assert resp.status_code == 200
        assert "text/csv" in resp.headers["content-type"]

    def test_invalid_returns_404(self, client):
        resp = client.get(f"{API}/lamps/download/spectrum/nonexistent_lamp")
        assert resp.status_code == 404
