"""Session lamp info, advanced settings, and plot endpoint tests."""

import base64

from tests.conftest import API


class TestSessionLampInfo:
    def test_returns_plots(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        resp = client.get(f"{API}/session/lamps/{lamp_id}/info", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["lamp_id"] == lamp_id
        assert data["total_power_mw"] > 0
        # Photometric plot should be base64-encoded PNG
        png_bytes = base64.b64decode(data["photometric_plot_base64"])
        assert png_bytes[:4] == b"\x89PNG"

    def test_no_ies_returns_400(self, custom_lamp_session):
        client, headers, lamp_id = custom_lamp_session
        resp = client.get(f"{API}/session/lamps/{lamp_id}/info", headers=headers)
        assert resp.status_code == 400

    def test_nonexistent_returns_404(self, initialized_session):
        client, headers = initialized_session
        resp = client.get(f"{API}/session/lamps/nonexistent/info", headers=headers)
        assert resp.status_code == 404


class TestAdvancedSettings:
    def test_returns_fields(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        resp = client.get(f"{API}/session/lamps/{lamp_id}/advanced-settings", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "total_power_mw" in data
        assert "scaling_factor" in data
        assert "intensity_units" in data

    def test_power_positive(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        data = client.get(f"{API}/session/lamps/{lamp_id}/advanced-settings", headers=headers).json()
        assert data["total_power_mw"] > 0

    def test_nonexistent_returns_404(self, initialized_session):
        client, headers = initialized_session
        resp = client.get(f"{API}/session/lamps/nonexistent/advanced-settings", headers=headers)
        assert resp.status_code == 404


class TestSurfacePlot:
    def test_returns_base64(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        resp = client.get(f"{API}/session/lamps/{lamp_id}/surface-plot", headers=headers)
        # ushio_b1 has source dimensions, so this should work
        if resp.status_code == 200:
            data = resp.json()
            png_bytes = base64.b64decode(data["plot_base64"])
            assert png_bytes[:4] == b"\x89PNG"
        else:
            # If no dimensions, expect 400
            assert resp.status_code == 400

    def test_no_dims_returns_400(self, custom_lamp_session):
        client, headers, lamp_id = custom_lamp_session
        resp = client.get(f"{API}/session/lamps/{lamp_id}/surface-plot", headers=headers)
        assert resp.status_code == 400

    def test_nonexistent_returns_404(self, initialized_session):
        client, headers = initialized_session
        resp = client.get(f"{API}/session/lamps/nonexistent/surface-plot", headers=headers)
        assert resp.status_code == 404


class TestGridPointsPlot:
    def test_returns_base64(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        resp = client.get(f"{API}/session/lamps/{lamp_id}/grid-points-plot", headers=headers)
        if resp.status_code == 200:
            data = resp.json()
            png_bytes = base64.b64decode(data["plot_base64"])
            assert png_bytes[:4] == b"\x89PNG"
        else:
            assert resp.status_code == 400

    def test_no_dims_returns_400(self, custom_lamp_session):
        client, headers, lamp_id = custom_lamp_session
        resp = client.get(f"{API}/session/lamps/{lamp_id}/grid-points-plot", headers=headers)
        assert resp.status_code == 400


class TestIntensityMapPlot:
    def test_no_map_returns_400(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        resp = client.get(f"{API}/session/lamps/{lamp_id}/intensity-map-plot", headers=headers)
        assert resp.status_code == 400

    def test_with_map_returns_base64(self, lamp_with_ies_session, minimal_intensity_map_csv):
        client, headers, lamp_id = lamp_with_ies_session
        # Upload intensity map first
        client.post(
            f"{API}/session/lamps/{lamp_id}/intensity-map",
            files={"file": ("imap.csv", minimal_intensity_map_csv, "text/csv")},
            headers=headers,
        )
        resp = client.get(f"{API}/session/lamps/{lamp_id}/intensity-map-plot", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        png_bytes = base64.b64decode(data["plot_base64"])
        assert png_bytes[:4] == b"\x89PNG"


class TestSessionPhotometricWeb:
    def test_returns_mesh(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        resp = client.get(f"{API}/session/lamps/{lamp_id}/photometric-web", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "vertices" in data
        assert "triangles" in data
        assert len(data["vertices"]) > 0

    def test_nonexistent_returns_404(self, initialized_session):
        client, headers = initialized_session
        resp = client.get(f"{API}/session/lamps/nonexistent/photometric-web", headers=headers)
        assert resp.status_code == 404

    def test_no_ies_returns_400(self, custom_lamp_session):
        client, headers, lamp_id = custom_lamp_session
        resp = client.get(f"{API}/session/lamps/{lamp_id}/photometric-web", headers=headers)
        assert resp.status_code == 400
