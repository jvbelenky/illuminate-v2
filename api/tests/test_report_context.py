import pytest
from api.v1.session_schemas import ReportRequest
from api.report.context import build_report_context, Versions

API = "/api/v1"


def _ctx(room, **over):
    pathogens = over.pop("pathogens", ["Human coronavirus", "Influenza virus"])
    req = ReportRequest(meta={"title": "Lab 3", "client": "Acme", "prepared_by": "V. B."},
                        pathogens=pathogens, **over)
    return build_report_context(room, req, images={}, versions=Versions(app="0.5.0-test", guv_calcs="0.7.3"))


def test_header_and_units(report_session):
    _, _, room = report_session
    ctx = _ctx(room)
    assert ctx.meta.title == "Lab 3"
    assert ctx.page_size == "A4"
    assert ctx.units.length == "m" and ctx.units.area == "m²" and ctx.units.volume == "m³"
    assert ctx.room.x == pytest.approx(4.0) and ctx.room.volume == pytest.approx(4 * 6 * 2.7)
    assert ctx.room.shape == "rectangle" and ctx.room.air_changes == 2.0


def test_summary_pathogens_come_from_guv_calcs(report_session):
    _, _, room = report_session
    ctx = _ctx(room)
    rows = {r.species: r for r in ctx.pathogens}
    assert set(rows) == {"Human coronavirus", "Influenza virus"}
    hc = rows["Human coronavirus"]
    expected_each = room.average_value(function="each_uv", species="Human coronavirus")
    assert hc.each_uv == pytest.approx(expected_each, rel=1e-6)
    assert hc.t99 > hc.t90 > 0 and hc.t999 > hc.t99
    assert hc.cadr_cfm == pytest.approx(hc.cadr_lps * 2.11888, rel=1e-3)
    assert ctx.summary.each_uv == pytest.approx(expected_each, rel=1e-6)  # first selected species leads
    assert ctx.summary.avg_fluence == pytest.approx(float(room.zone("WholeRoomFluence").get_values().mean()), rel=1e-6)
    assert ctx.fluence.wavelengths_used == [222]


def test_occupancy_uses_weighted_hours(report_session):
    _, _, room = report_session
    ctx = _ctx(room)
    s = ctx.safety
    assert s.standard_label.startswith("ANSI IES RP 27.1-22")
    assert s.hours["ACGIH"].skin > 0 and s.hours["ICNIRP"].eye > 0
    assert s.occupancy.headline_hours == min(s.hours["ACGIH"].skin, s.hours["ACGIH"].eye)
    assert s.occupancy.unlimited == (s.occupancy.headline_hours >= 8)
    assert len(s.lamps) == 1 and s.lamps[0].name == "Lamp A"
    assert "does not comply" not in s.occupancy.statement.lower()


def test_custom_zones_in_their_own_units(report_session):
    _, _, room = report_session
    ctx = _ctx(room)
    plane = next(p for p in ctx.custom_planes if p.name == "Desk")
    assert plane.units == "mJ/cm²" and plane.exposure == "2 h dose"
    vol = next(v for v in ctx.custom_volumes if v.name == "Breathing zone")
    assert vol.units == "µW/cm²" and vol.image_key == "volume:breath"
    pt = next(p for p in ctx.custom_points if p.name == "Door sensor")
    assert pt.position == pytest.approx((0.5, 0.5, 1.5)) and pt.value > 0


def test_feet_room_uses_letter_and_imperial_labels(client, session_headers, minimal_lamp_input):
    resp = client.post(f"{API}/session/init", json={
        "room": {"x": 12.0, "y": 20.0, "z": 9.0, "units": "feet", "standard": "UL8802 (ACGIH Limits)"},
        "lamps": [dict(minimal_lamp_input, x=6.0, y=10.0, z=9.0, aimx=6.0, aimy=10.0, aimz=0.0)],
        "zones": [{"id": "SkinLimits", "type": "plane", "isStandard": True, "height": 6,
                   "x1": 0, "x2": 12, "y1": 0, "y2": 20, "num_x": 4, "num_y": 4},
                  {"id": "EyeLimits", "type": "plane", "isStandard": True, "height": 6,
                   "x1": 0, "x2": 12, "y1": 0, "y2": 20, "num_x": 4, "num_y": 4},
                  {"id": "WholeRoomFluence", "type": "volume", "isStandard": True,
                   "x_min": 0, "x_max": 12, "y_min": 0, "y_max": 20, "z_min": 0, "z_max": 9,
                   "num_x": 3, "num_y": 3, "num_z": 2}]}, headers=session_headers)
    assert resp.status_code == 200, resp.text
    calc = client.post(f"{API}/session/calculate", headers=session_headers)
    assert calc.status_code == 200, calc.text
    from api.v1.session_manager import get_session_manager
    room = get_session_manager().get_session(session_headers["X-Session-ID"]).room
    ctx = _ctx(room, pathogens=["Human coronavirus"])
    assert ctx.page_size == "Letter" and ctx.units.length == "ft"
    assert ctx.options.page_size == "auto"


def _mixed_room():
    """222 nm + 254 nm ushio fixtures; the 254 one drops the preset's spectrum."""
    from guv_calcs import Room, Lamp
    room = Room(x=4.0, y=6.0, z=2.7, units="meters", enable_reflectance=False)
    room.add_lamp(Lamp.from_keyword("ushio_b1", lamp_id="L0", x=1.0, y=3.0, z=2.7, aimx=1.0, aimy=3.0, aimz=0.0))
    room.add_lamp(Lamp.from_keyword("ushio_b1", lamp_id="L1", x=3.0, y=3.0, z=2.7, aimx=3.0, aimy=3.0, aimz=0.0,
                                    wavelength=254, guv_type="LPHG"))
    room.add_standard_zones()
    for zid in ("SkinLimits", "EyeLimits"):
        room.zone(zid).set_num_points(4, 4)
    room.calculate()
    return room


def test_mixed_room_names_a_species_without_data_at_every_wavelength():
    from api.report.context import ReportDataError
    room = _mixed_room()
    with pytest.raises(ReportDataError) as e:
        _ctx(room, pathogens=["Human coronavirus", "Not a pathogen"])
    assert "Not a pathogen" in str(e.value)
    # a species present at only one of the two wavelengths is named the same way
    import pandas as pd
    base = room.get_efficacy_data().base_df
    per_wv = base.groupby("Species")["wavelength [nm]"].apply(set)
    one_wv = next(sp for sp, wvs in per_wv.items() if 222 in wvs and 254 not in wvs)
    with pytest.raises(ReportDataError) as e:
        _ctx(room, pathogens=[one_wv])
    assert one_wv in str(e.value)


def test_mixed_room_reports_both_wavelengths_for_a_species_with_data_at_both():
    room = _mixed_room()
    ctx = _ctx(room, pathogens=["Human coronavirus"])
    assert ctx.fluence.wavelengths_used == [222, 254]
    assert ctx.pathogens[0].each_uv > 0


def test_lamp_rows_use_preset_display_names_and_type_labels(report_session):
    _, _, room = report_session
    ctx = _ctx(room)
    row = ctx.lamps[0]
    assert row.fixture == "USHIO B1"            # preset display name, not the key
    assert row.type_label == "222 nm"
    assert ctx.lamp_types[0].fixture == "USHIO B1"


def test_custom_lamp_fixture_falls_back_to_name_then_file():
    from guv_calcs import Room, Lamp
    from api.report.context import _fixture_name, _type_label
    lamp = Lamp.from_keyword("ushio_b1", lamp_id="L", x=1, y=1, z=2.5, wavelength=254, guv_type="LPHG")
    lamp.preset_id = "custom"
    lamp.name = "Lamp 3"                        # the app's auto name is not a fixture name
    assert _fixture_name(lamp) == "Custom fixture"
    lamp.name = "Hallway KrCl unit"            # a user-given name wins
    assert _fixture_name(lamp) == "Hallway KrCl unit"
    assert _type_label(lamp) == "254 nm"
    other = Lamp.from_keyword("ushio_b1", lamp_id="O", x=1, y=1, z=2.5, wavelength=265, guv_type="other")
    assert _type_label(other) == "Custom wavelength (265 nm)"


def test_survival_title_is_ours_not_a_numpy_repr():
    from api.report.plots import survival_svg
    room = _mixed_room()
    svg = survival_svg(room.get_efficacy_data(), ["Human coronavirus"], {222: 0.64, 254: 0.2})
    assert "np.float" not in svg
    assert "0.64 µW/cm² at 222 nm" in svg and "0.20 µW/cm² at 254 nm" in svg


def test_context_builds_the_inactivation_data_once(report_session, monkeypatch):
    """Every InactivationData costs ~0.7 s of kinetics over the whole dataset; the
    six per-quantity values must come from one shared object, not a fresh one each."""
    _, _, room = report_session
    builds = []
    original = type(room).get_efficacy_data

    def counting(self, *a, **kw):
        builds.append(a)
        return original(self, *a, **kw)
    monkeypatch.setattr(type(room), "get_efficacy_data", counting)
    monkeypatch.setattr(type(room), "average_value", lambda *a, **kw: pytest.fail("room.average_value builds a new dataset per call"))
    ctx = _ctx(room)
    assert len(builds) == 1
    assert ctx.efficacy_data is not None
    assert [p.species for p in ctx.pathogens] == ["Human coronavirus", "Influenza virus"]
    assert all(p.each_uv > 0 for p in ctx.pathogens)


def _custom_lamp(**kw):
    from guv_calcs import Lamp
    lamp = Lamp.from_keyword("ushio_b1", lamp_id="L", x=1, y=1, z=2.5, wavelength=254, guv_type="LPHG")
    lamp.preset_id = "custom"
    lamp.name = "Lamp 1"
    for k, v in kw.items():
        setattr(lamp, k, v)
    return lamp


def test_browser_supplied_model_name_beats_every_fallback():
    from api.report.context import _fixture_name
    lamp = _custom_lamp(name="Hallway unit")
    assert _fixture_name(lamp, "UR-Fixture-2024.ies") == "UR-Fixture-2024.ies"
    assert _fixture_name(lamp, "   ") == "Hallway unit"          # blank hint is ignored
    preset = _preset_lamp()
    assert _fixture_name(preset, "something.ies") != "something.ies"  # presets keep their display name


def _preset_lamp():
    from guv_calcs import Lamp
    return Lamp.from_keyword("ushio_b1", lamp_id="P", x=1, y=1, z=2.5)


def test_custom_lamp_falls_back_to_the_ies_luminaire_keyword():
    from api.report.context import _fixture_name
    lamp = _custom_lamp()
    keywords = lamp.ies.header.keywords
    keywords["LUMINAIRE"] = " Upper-Room GUV Fixture "
    assert _fixture_name(lamp) == "Upper-Room GUV Fixture"
    for placeholder in ("", "Unknown", "N/A"):
        keywords["LUMINAIRE"] = placeholder
        assert _fixture_name(lamp) == "Custom fixture"


def test_request_fixture_names_reach_the_lamp_table_and_appendix(report_session):
    _, _, room = report_session
    lid = next(iter(room.lamps))
    room.lamps[lid].preset_id = "custom"
    try:
        req = ReportRequest(meta={"title": "T"}, pathogens=["Human coronavirus"], fixture_names={lid: "UR-Fixture-2024.ies"})
        ctx = build_report_context(room, req, images={}, versions=Versions("t", "t"))
    finally:
        room.lamps[lid].preset_id = "ushio_b1"
    assert [l.fixture for l in ctx.lamps] == ["UR-Fixture-2024.ies"]
    assert [t.fixture for t in ctx.lamp_types] == ["UR-Fixture-2024.ies"]


def test_fixture_names_are_bounded():
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        ReportRequest(meta={"title": "T"}, pathogens=["a"], fixture_names={"L": "x" * 121})
