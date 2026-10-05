import base64
import io
import pytest
from PIL import Image

API = "/api/v1"


def _png():
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), (200, 30, 60)).save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def _body(**over):
    body = {"meta": {"title": "Lab 3"}, "pathogens": ["Human coronavirus"], "images": {"cover": _png(), "plan": _png()}}
    body.update(over)
    return body


def test_pdf_download(report_session):
    client, headers, _ = report_session
    resp = client.post(f"{API}/session/report/pdf", json=_body(), headers=headers)
    if resp.status_code == 503:
        pytest.skip(resp.json()["detail"])
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("application/pdf")
    assert 'filename="Lab_3_report.pdf"' in resp.headers["content-disposition"]
    assert resp.content[:5] == b"%PDF-"


def test_unknown_species_is_422_and_named(report_session):
    client, headers, _ = report_session
    resp = client.post(f"{API}/session/report/pdf", json=_body(pathogens=["Not a pathogen"]), headers=headers)
    assert resp.status_code == 422
    assert "Not a pathogen" in resp.json()["detail"]


def test_bad_image_is_422_and_named(report_session):
    client, headers, _ = report_session
    resp = client.post(f"{API}/session/report/pdf", json=_body(images={"plan": "data:image/jpeg;base64,AAAA"}), headers=headers)
    assert resp.status_code == 422 and "plan" in resp.json()["detail"]


def test_no_results_is_400(client, session_headers, minimal_room_config, minimal_lamp_input):
    resp = client.post(f"{API}/session/init", json={
        "room": minimal_room_config, "lamps": [minimal_lamp_input],
        "zones": [{"id": "SkinLimits", "type": "plane", "isStandard": True, "height": 1.8}]},
        headers=session_headers)
    assert resp.status_code == 200, resp.text
    resp = client.post(f"{API}/session/report/pdf", json=_body(), headers=session_headers)
    assert resp.status_code == 400
    assert "calculate" in resp.json()["detail"].lower()
