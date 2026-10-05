import re
import pytest
from api.v1.session_schemas import ReportRequest
from api.report.context import build_report_context, Versions
from api.report.plots import attach_plots, fig_to_svg


def _ctx(room):
    req = ReportRequest(meta={"title": "T"}, pathogens=["Human coronavirus"])
    return build_report_context(room, req, images={}, versions=Versions("t", "t"))


def test_attach_plots_fills_svgs(report_session):
    _, _, room = report_session
    ctx = _ctx(room)
    attach_plots(ctx, room)
    for svg in (ctx.skin_svg, ctx.eye_svg, ctx.survival_svg):
        assert svg.lstrip().startswith("<svg") and "</svg>" in svg
        assert "<?xml" not in svg                    # inline-safe
    assert ctx.custom_planes and all(p.svg.lstrip().startswith("<svg") for p in ctx.custom_planes)
    assert set(ctx.lamp_plots) == {lt.fixture for lt in ctx.lamp_types}
    polar, spectrum = next(iter(ctx.lamp_plots.values()))
    assert polar.startswith("<svg")


def test_appendix_toggle_skips_lamp_plots(report_session):
    _, _, room = report_session
    ctx = _ctx(room)
    ctx.options = ctx.options.model_copy(update={"include_lamp_appendix": False})  # ReportOptions is a Pydantic model
    attach_plots(ctx, room)
    assert ctx.lamp_plots == {}


def test_shared_scale_for_skin_and_eye(report_session):
    _, _, room = report_session
    ctx = _ctx(room)
    attach_plots(ctx, room)
    # both heatmaps carry the same colourbar tick labels (shared vmin/vmax)
    ticks = lambda s: re.findall(r">([\d.]+)</text>", s)
    assert ticks(ctx.skin_svg) and ticks(ctx.skin_svg) == ticks(ctx.eye_svg)


def test_fig_to_svg_strips_declaration_and_fixed_size():
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots()
    ax.plot([0, 1], [0, 1])
    svg = fig_to_svg(fig)
    root = svg.split(">", 1)[0]
    assert svg.startswith("<svg") and 'width="100%"' in root and 'height="' not in root


def test_survival_plot_reuses_the_context_dataset(report_session, monkeypatch):
    _, _, room = report_session
    ctx = _ctx(room)
    monkeypatch.setattr(type(room), "get_efficacy_data", lambda *a, **kw: pytest.fail("attach_plots rebuilt the inactivation data"))
    monkeypatch.setattr(type(room), "survival_plot", lambda *a, **kw: pytest.fail("room.survival_plot rebuilds the inactivation data"))
    attach_plots(ctx, room)
    assert ctx.survival_svg.lstrip().startswith("<svg")


L_SHAPE = [[0, 0], [6, 0], [6, 2], [3, 2], [3, 4], [0, 4]]


def _l_shaped_room(client, session_headers):
    from api.v1.session_manager import get_session_manager
    init = client.post("/api/v1/session/init", headers=session_headers, json={
        "room": {"x": 6.0, "y": 4.0, "z": 2.7, "units": "meters",
                 "standard": "ANSI IES RP 27.1-22 (ACGIH Limits)", "polygon": L_SHAPE},
        "lamps": [{"id": "lampA", "name": "Lamp A", "preset_id": "ushio_b1", "lamp_type": "krcl_222",
                   "x": 1.5, "y": 1.0, "z": 2.7, "aimx": 1.5, "aimy": 1.0, "aimz": 0.0}],
        "zones": [{"id": "WholeRoomFluence", "type": "volume", "isStandard": True},
                  {"id": "EyeLimits", "type": "plane", "isStandard": True, "height": 1.8},
                  {"id": "SkinLimits", "type": "plane", "isStandard": True, "height": 1.8}],
    })
    assert init.status_code == 200, init.text
    assert client.post("/api/v1/session/calculate", headers=session_headers).status_code == 200
    return get_session_manager().get_session(session_headers["X-Session-ID"]).room


def test_polygon_room_planes_plot_with_holes(client, session_headers):
    """guv_calcs only computes plane points inside a polygon outline (a flat
    array), which its own imshow-based plot cannot draw."""
    room = _l_shaped_room(client, session_headers)
    assert room.calc_zones["SkinLimits"].get_values().ndim == 1
    ctx = _ctx(room)
    attach_plots(ctx, room)
    assert ctx.skin_svg.lstrip().startswith("<svg") and ctx.eye_svg.lstrip().startswith("<svg")


def test_masked_grid_restores_the_bounding_box_with_nan_outside(client, session_headers):
    import numpy as np
    from api.v1.session_helpers import masked_grid
    room = _l_shaped_room(client, session_headers)
    zone = room.calc_zones["SkinLimits"]
    flat = zone.get_values()
    grid = masked_grid(zone, flat)
    assert grid.ndim == 2
    assert np.count_nonzero(~np.isnan(grid)) == flat.size
    assert np.isnan(grid).any()                     # the L's missing corner


def test_plan_is_drawn_from_the_geometry(report_session):
    _, _, room = report_session
    ctx = _ctx(room)
    attach_plots(ctx, room)
    svg = ctx.plan_svg
    assert svg.lstrip().startswith("<svg") and "<?xml" not in svg
    assert "Lamp A" in svg                       # lamps are labelled
    assert "Door sensor" in svg                  # calculation points are labelled
    assert "x (m)" in svg and "y (m)" in svg     # axes in the room's units


def test_plan_draws_a_polygon_outline(client, session_headers):
    room = _l_shaped_room(client, session_headers)
    ctx = _ctx(room)
    assert len(ctx.room.vertices) == 6
    attach_plots(ctx, room)
    assert ctx.plan_svg.lstrip().startswith("<svg")


def test_object_footprint_follows_its_yaw():
    from guv_calcs.object import Object
    from api.report.context import _footprint
    box = Object.box(2, 1, 1, position=(3, 3, 0), yaw=90)
    xs = sorted({round(x, 6) for x, _ in _footprint(box)})
    ys = sorted({round(y, 6) for _, y in _footprint(box)})
    assert xs == [2.5, 3.5] and ys == [2.0, 4.0]   # 2 m wide box turned a quarter


def test_serialized_plotting_waits_for_the_plot_lock():
    """Matplotlib's mathtext parser is shared and not thread-safe; the preset-lamp
    cache warms in a background thread and endpoints plot on a thread pool, so a
    report plotting alongside them failed with a pyparsing ParseException."""
    import threading
    from api.v1.utils import PLOT_LOCK, serialized_plotting
    ran = threading.Event()
    wrapped = serialized_plotting(ran.set)
    with PLOT_LOCK:
        worker = threading.Thread(target=wrapped)
        worker.start()
        assert not ran.wait(0.3)          # held off while another thread plots
    worker.join(5)
    assert ran.is_set()
    serialized_plotting(lambda: serialized_plotting(ran.clear)())()   # re-entrant: no self-deadlock


def test_every_plotting_entry_point_holds_the_plot_lock():
    from api.report import plots
    from api.v1 import zone_session_routers, calculation_routers, lamp_routers, lamp_session_routers
    for fn in (plots.attach_plots, lamp_routers._generate_photometric_plot, lamp_routers._generate_spectrum_plot,
               zone_session_routers.get_zone_plot, calculation_routers.get_survival_plot,
               calculation_routers.export_session_all, lamp_session_routers.get_session_lamp_plots,
               lamp_session_routers.get_session_lamp_surface_plot,
               lamp_session_routers.get_session_lamp_grid_points_plot,
               lamp_session_routers.get_session_lamp_intensity_map_plot):
        assert getattr(fn, "__wrapped__", None) is not None, f"{fn.__name__} is not @serialized_plotting"
