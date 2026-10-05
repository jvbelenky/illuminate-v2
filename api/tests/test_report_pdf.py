import io
import re
import pytest
from api.v1.session_schemas import ReportRequest
from api.report.context import build_report_context, Versions
from api.report.plots import attach_plots
from api.report import render

pypdf = pytest.importorskip("pypdf")
API = "/api/v1"


def _ctx(room, **meta):
    req = ReportRequest(meta={"title": "Lab 3 GUV design", "client": "Acme Clinics", "prepared_by": "V. Belenky", **meta},
                        pathogens=["Human coronavirus", "Influenza virus"])
    ctx = build_report_context(room, req, images={}, versions=Versions("0.5.0", "0.7.3"))
    attach_plots(ctx, room)
    return ctx


def test_html_has_every_section_and_no_none(report_session):
    _, _, room = report_session
    html = render.render_html(_ctx(room))
    for heading in ("Summary", "Room and installation", "Photobiological safety",
                    "Pathogen reduction in air", "Custom calculation zones", "Appendix"):
        assert heading in html
    body = html.split("</style>", 1)[-1]
    assert "None" not in body and ">nan<" not in body.lower()
    assert "Acme Clinics" in html and "V. Belenky" in html
    assert "Dim to" in html or "Compliant" in html
    assert "@page" in html and "size: A4" in html


def test_pdf_renders_with_expected_pages_and_text(report_session):
    _, _, room = report_session
    try:
        pdf = render.render_pdf(_ctx(room))
    except render.WeasyPrintUnavailable as e:
        pytest.skip(str(e))
    assert pdf[:5] == b"%PDF-"
    reader = pypdf.PdfReader(io.BytesIO(pdf))
    assert 6 <= len(reader.pages) <= 14
    text = "\n".join(p.extract_text() or "" for p in reader.pages)
    assert "Lab 3 GUV design" in text and "eACH" in text and "Human coronavirus" in text
    assert re.search(r"page \d+ of \d+", text)


def test_missing_image_renders_placeholder(report_session):
    _, _, room = report_session
    html = render.render_html(_ctx(room))
    assert "No 3D view was captured" in html


def test_sections_drop_when_empty():
    # Standard zones only, no custom zones, no 222 nm lamp → no custom section, no ozone.
    # Built directly in guv_calcs: a 254 nm lamp with photometry needs the preset's IES
    # but not its spectrum, which from_keyword skips when a conflicting wavelength is given.
    from guv_calcs import Room, Lamp
    room = Room(x=4.0, y=6.0, z=2.7, units="meters", enable_reflectance=False)
    room.add_lamp(Lamp.from_keyword("ushio_b1", lamp_id="L", x=2.0, y=3.0, z=2.7, aimx=2.0, aimy=3.0, aimz=0.0,
                                    wavelength=254, guv_type="LPHG"))
    room.add_standard_zones()
    for zid in ("SkinLimits", "EyeLimits"):
        room.zone(zid).set_num_points(4, 4)
    room.calculate()
    req = ReportRequest(meta={"title": "T"}, options={"include_lamp_appendix": False, "include_methodology": False},
                        pathogens=["Human coronavirus"])
    ctx = build_report_context(room, req, images={}, versions=Versions("t", "t"))
    attach_plots(ctx, room)
    html = render.render_html(ctx)
    assert "Custom calculation zones" not in html and "ozone-box muted" in html
    assert "Lamp photometrics" not in html and "Methodology" not in html
    assert "254 nm" in html


EVIL_TITLE = 'x"; } @import url("http://127.0.0.1:1/x"); @page { margin: 0; /*'


def test_title_never_reaches_the_stylesheet(report_session):
    _, _, room = report_session
    html = render.render_html(_ctx(room, title=EVIL_TITLE))
    style = html.split("<style>", 1)[1].split("</style>", 1)[0]
    assert "@import" not in style and "127.0.0.1" not in style
    # the title is still shown, HTML-escaped, in the body
    assert "&#34;; } @import" in html or "&quot;; } @import" in html


def test_url_fetcher_only_serves_bundled_files_and_data_uris():
    with pytest.raises(ValueError):
        render.restricted_url_fetcher("http://example.com/x.png")
    with pytest.raises(ValueError):
        render.restricted_url_fetcher("file:///etc/passwd")
    ok = render.restricted_url_fetcher((render.TEMPLATES / "fonts" / "LICENSE.txt").as_uri())
    assert ok["mime_type"] == "text/plain" and ok["file_obj"].read(5)
    ok["file_obj"].close()
    data = render.restricted_url_fetcher("data:text/plain;base64,aGk=")
    # WeasyPrint's default fetcher returns a dict (older) or a file-like URLFetcherResponse (69+)
    assert (data["string"] if isinstance(data, dict) else data.read()) == b"hi"


def test_stylesheet_is_not_html_escaped(report_session):
    _, _, room = report_session
    html = render.render_html(_ctx(room))
    style = html.split("<style>", 1)[1].split("</style>", 1)[0]
    assert 'font-family: "Report Sans"' in style
    assert "&#34;" not in style and "&quot;" not in style


def _reflectance_room(enabled: bool):
    from guv_calcs import Room, Lamp
    room = Room(x=4.0, y=6.0, z=2.7, units="meters", enable_reflectance=enabled,
                reflectance_max_num_passes=2, reflectance_threshold=0.1)
    room.add_lamp(Lamp.from_keyword("ushio_b1", lamp_id="L", x=2.0, y=3.0, z=2.7, aimx=2.0, aimy=3.0, aimz=0.0))
    room.set_reflectance(0.078)
    room.add_standard_zones()
    for zid in ("SkinLimits", "EyeLimits"):
        room.zone(zid).set_num_points(3, 3)
    room.calculate()
    return room


def test_reflectance_table_hidden_when_reflections_are_off():
    room = _reflectance_room(False)
    req = ReportRequest(meta={"title": "T"}, pathogens=["Human coronavirus"])
    ctx = build_report_context(room, req, images={}, versions=Versions("t", "t"))
    html = render.render_html(ctx)
    assert "Surface reflectance" not in html
    assert "Reflections are not included" in html


def test_reflectance_values_print_at_full_precision():
    room = _reflectance_room(True)
    req = ReportRequest(meta={"title": "T"}, pathogens=["Human coronavirus"])
    ctx = build_report_context(room, req, images={}, versions=Versions("t", "t"))
    html = render.render_html(ctx)
    assert "Surface reflectance" in html
    assert "7.8 %" in html and ">8 %<" not in html


OZONE_LABELS = ("Estimated air changes from ventilation", "Estimated ozone decay constant", "Estimated increase of ozone from UV")


def test_room_block_has_no_shape_or_air_changes_rows(report_session):
    _, _, room = report_session
    html = render.render_html(_ctx(room))
    room_block = html.split("Room and installation", 1)[1].split("Luminaires", 1)[0]
    assert "<th>Shape</th>" not in room_block and "<th>Air changes</th>" not in room_block


def test_ozone_box_with_222nm_sources(report_session):
    _, _, room = report_session
    ctx = _ctx(room)
    assert ctx.safety.has_222nm is True
    html = render.render_html(ctx)
    for label in OZONE_LABELS:
        assert label in html
    assert "ozone-box muted" not in html
    assert f"{ctx.safety.ozone_ppb:.2f} ppb" in html


def test_ozone_box_greyed_out_without_222nm_sources():
    from guv_calcs import Room, Lamp
    room = Room(x=4.0, y=6.0, z=2.7, units="meters", enable_reflectance=False)
    room.add_lamp(Lamp.from_keyword("ushio_b1", lamp_id="L", x=2.0, y=3.0, z=2.7, aimx=2.0, aimy=3.0, aimz=0.0,
                                    wavelength=254, guv_type="LPHG"))
    room.add_standard_zones()
    for zid in ("SkinLimits", "EyeLimits"):
        room.zone(zid).set_num_points(3, 3)
    room.calculate()
    req = ReportRequest(meta={"title": "T"}, pathogens=["Human coronavirus"])
    ctx = build_report_context(room, req, images={}, versions=Versions("t", "t"))
    assert ctx.safety.has_222nm is False and ctx.safety.ozone_ppb is None
    html = render.render_html(ctx)
    assert "ozone-box muted" in html
    for label in OZONE_LABELS:
        assert label in html
    assert "No 222 nm sources" in html


def test_report_iso_levels_match_the_frontend_rule():
    from api.report.context import report_iso_levels
    assert report_iso_levels(0.4237) == [0.21, 0.42, 0.85]
    assert report_iso_levels(12.5) == [6.3, 13.0, 25.0]
    assert report_iso_levels(0) == [] and report_iso_levels(None) == []


def test_fluence_section_states_the_levels_and_drops_min_max(report_session):
    _, _, room = report_session
    ctx = _ctx(room)
    assert ctx.fluence.levels == report_iso_levels_for(ctx.fluence.stats.mean)
    html = render.render_html(ctx)
    section = html.split("Pathogen reduction in air", 1)[1].split("Appendix", 1)[0]
    assert "half, once and twice the room average" in section
    assert "<th>Maximum</th>" not in section and "<th>Minimum</th>" not in section


def report_iso_levels_for(mean):
    from api.report.context import report_iso_levels
    return report_iso_levels(mean)
