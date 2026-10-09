"""Stateless previews of a freshly chosen IES file: power figures and the polar plot."""

import base64
import io

import pytest
from guv_calcs import Lamp

from tests.conftest import API


def _analyze(client, data):
    r = client.post(f"{API}/lamps/analyze-ies", files={"ies_file": ("a.ies", io.BytesIO(data))})
    assert r.status_code == 200, r.text
    return r.json()


class TestPowerFigures:
    @pytest.mark.parametrize("units", ["mw/sr", "uw/cm2"])
    def test_reports_the_unscaled_figures_for_each_intensity_unit(self, client, ies_file_bytes, units):
        body = _analyze(client, ies_file_bytes)
        figures = {f["units"]: f for f in body["file_figures"]}
        assert set(figures) == {"mw/sr", "uw/cm2"}
        lamp = Lamp(filedata=ies_file_bytes, x=0, y=0, z=0, aimx=0, aimy=0, aimz=-1, intensity_units=units)
        f = figures[units]
        assert f["total_power_mw"] == pytest.approx(lamp.get_total_power())
        assert f["max_irradiance"] == pytest.approx(lamp.max())
        assert f["center_irradiance"] == pytest.approx(lamp.center())
        assert f["total_power_mw"] > 0

    def test_microwatts_per_cm2_reads_ten_times_milliwatts_per_sr(self, client, ies_file_bytes):
        figures = {f["units"]: f for f in _analyze(client, ies_file_bytes)["file_figures"]}
        for key in ("total_power_mw", "max_irradiance", "center_irradiance"):
            assert figures["uw/cm2"][key] == pytest.approx(10 * figures["mw/sr"][key])


class TestPolarPlot:
    def test_renders_a_png(self, client, ies_file_bytes):
        r = client.post(f"{API}/lamps/ies-plot?theme=light", files={"ies_file": ("a.ies", io.BytesIO(ies_file_bytes))})
        assert r.status_code == 200, r.text
        png = base64.b64decode(r.json()["photometric_plot_base64"])
        assert png[:8] == b"\x89PNG\r\n\x1a\n"

    def test_invalid_file_400(self, client):
        r = client.post(f"{API}/lamps/ies-plot", files={"ies_file": ("a.ies", io.BytesIO(b"nope"))})
        assert r.status_code == 400

    def test_busy_server_answers_503_instead_of_queueing(self, client, ies_file_bytes, monkeypatch):
        import asyncio
        from api.v1 import lamp_routers
        # every render slot taken: a stateless plot must not pile up behind the plot lock
        monkeypatch.setattr(lamp_routers, "_IES_PLOT_SLOTS", asyncio.Semaphore(0))
        r = client.post(f"{API}/lamps/ies-plot", files={"ies_file": ("a.ies", io.BytesIO(ies_file_bytes))})
        assert r.status_code == 503
