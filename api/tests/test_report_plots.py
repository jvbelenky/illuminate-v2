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
