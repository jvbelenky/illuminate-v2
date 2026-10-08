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
    def test_analysis_reports_the_unscaled_power_figures(self, client, ies_file_bytes):
        body = _analyze(client, ies_file_bytes)
        lamp = Lamp(filedata=ies_file_bytes, x=0, y=0, z=0, aimx=0, aimy=0, aimz=-1)
        assert body["total_power_mw"] == pytest.approx(lamp.get_total_power())
        assert body["max_irradiance"] == pytest.approx(lamp.max())
        assert body["center_irradiance"] == pytest.approx(lamp.center())
        assert body["total_power_mw"] > 0


class TestPolarPlot:
    def test_renders_a_png(self, client, ies_file_bytes):
        r = client.post(f"{API}/lamps/ies-plot?theme=light", files={"ies_file": ("a.ies", io.BytesIO(ies_file_bytes))})
        assert r.status_code == 200, r.text
        png = base64.b64decode(r.json()["photometric_plot_base64"])
        assert png[:8] == b"\x89PNG\r\n\x1a\n"

    def test_invalid_file_400(self, client):
        r = client.post(f"{API}/lamps/ies-plot", files={"ies_file": ("a.ies", io.BytesIO(b"nope"))})
        assert r.status_code == 400
