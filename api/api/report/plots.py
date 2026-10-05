"""Matplotlib → SVG for the report: plane heatmaps, survival curve, lamp photometrics."""
from __future__ import annotations

import io
import re
from contextlib import contextmanager
from dataclasses import replace

from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
import numpy as np
from guv_calcs import WHOLE_ROOM_FLUENCE, EYE_LIMITS, SKIN_LIMITS

from api.v1.utils import apply_theme
from .context import ReportContext

_XML_DECL = re.compile(r"^\s*<\?xml[^>]*>\s*(<!DOCTYPE[^>]*>\s*)?", re.S)
_ROOT_SIZE = re.compile(r'(<svg\b[^>]*?)\s(?:width|height)="[^"]*"')

# Plot text uses the same bundled face as the document; the template declares the
# family under this name too, so WeasyPrint resolves the SVG's font-family.
FONTS_DIR = Path(__file__).parent / "templates" / "fonts"
PLOT_FONT_FAMILY = "IBM Plex Sans"
for _ttf in FONTS_DIR.glob("IBMPlexSans-*.ttf"):
    font_manager.fontManager.addfont(str(_ttf))
_RC = {"svg.fonttype": "none", "font.family": PLOT_FONT_FAMILY}


@contextmanager
def _print_style():
    """Light default style with the bundled font active while the figure is built
    (text picks up font.family at creation, not at save time)."""
    with plt.style.context("default"):
        with plt.rc_context(_RC):
            yield


def fig_to_svg(fig) -> str:
    """Serialise a figure as an inline-safe SVG string: no XML declaration, and no
    fixed width/height on the root so CSS can size it."""
    buf = io.StringIO()
    try:
        # Keep text as <text> (not glyph outlines): smaller files and selectable labels in the PDF
        with plt.rc_context(_RC):
            fig.savefig(buf, format="svg", bbox_inches="tight", facecolor="white", edgecolor="none")
    finally:
        plt.close(fig)
    svg = _XML_DECL.sub("", buf.getvalue())
    svg = _ROOT_SIZE.sub(r"\1", svg)
    svg = _ROOT_SIZE.sub(r"\1", svg)
    # Fill the container's width; the viewBox keeps the aspect ratio
    svg = svg.replace("<svg", '<svg width="100%"', 1)
    return svg.strip()


def _style(fig, title: str | None = None):
    apply_theme(fig, "light")
    for ax in fig.get_axes():
        ax.tick_params(labelsize=9)
        ax.xaxis.label.set_fontsize(10)
        ax.yaxis.label.set_fontsize(10)
    if title is not None and fig.get_axes():
        fig.get_axes()[0].set_title(title, fontsize=11)


def plane_svg(zone, vmin=None, vmax=None, title=None) -> str:
    with _print_style():
        kwargs = {}
        if vmin is not None:
            kwargs["vmin"] = vmin
        if vmax is not None:
            kwargs["vmax"] = vmax
        fig, ax = zone.plot(**kwargs)
        fig.set_size_inches(5.2, 4.2)
        _style(fig, title)
        return fig_to_svg(fig)


def survival_svg(data, species: list[str], fluence_by_wavelength: dict[int, float]) -> str:
    """Survival curves from an InactivationData (the context's, built once).
    guv_calcs titles the figure with the raw fluence dict (numpy reprs for
    several wavelengths), so the title is written here."""
    parts = [f"{v:.2f} µW/cm² at {int(w)} nm" for w, v in sorted(fluence_by_wavelength.items())]
    title = "Survival of airborne pathogens at the room's average fluence"
    if parts:
        title += f"\n({', '.join(parts)}; 95% CI shaded)"
    with _print_style():
        fig = data.plot_survival(species=species, figsize=(7.5, 4.2))
        _style(fig)
        for ax in fig.get_axes():
            ax.set_title(title, fontsize=11)
            if ax.get_legend():
                ax.legend(loc="upper right", fontsize=8)
        return fig_to_svg(fig)


def lamp_polar_svg(lamp) -> str:
    with _print_style():
        result = lamp.plot_ies()
        fig = result[0] if isinstance(result, tuple) else result
        fig.set_size_inches(3.6, 3.6)
        apply_theme(fig, "light", grid=True)
        return fig_to_svg(fig)


def lamp_spectrum_svg(lamp) -> str:
    if lamp.spectrum is None:
        return ""
    with _print_style():
        result = lamp.spectrum.plot(weights=True, yscale="log", figsize=(3.6, 3.0))
        fig = result[0] if isinstance(result, tuple) else result
        apply_theme(fig, "light", grid=True)
        return fig_to_svg(fig)


def attach_plots(ctx: ReportContext, room) -> None:
    """Fill the SVG fields of a ReportContext in place."""
    skin = room.calc_zones.get(SKIN_LIMITS)
    eye = room.calc_zones.get(EYE_LIMITS)
    if skin is not None and eye is not None and skin.get_values() is not None and eye.get_values() is not None:
        vmax = float(max(np.nanmax(skin.get_values()), np.nanmax(eye.get_values())))
        ctx.skin_svg = plane_svg(skin, vmin=0.0, vmax=vmax, title="Skin — 8 h dose (mJ/cm²)")
        ctx.eye_svg = plane_svg(eye, vmin=0.0, vmax=vmax, title="Eye — 8 h dose (mJ/cm²)")
    if ctx.pathogens:
        data = ctx.efficacy_data if ctx.efficacy_data is not None else room.get_efficacy_data(WHOLE_ROOM_FLUENCE)
        ctx.survival_svg = survival_svg(data, [p.species for p in ctx.pathogens], ctx.fluence.by_wavelength)
    ctx.custom_planes = [
        replace(p, svg=plane_svg(room.calc_zones[p.zone_id], title=f"{p.name} ({p.units})"))
        for p in ctx.custom_planes
    ]
    if ctx.options.include_lamp_appendix:
        for lt in ctx.lamp_types:
            lamp = room.lamps[lt.lamp_id]
            ctx.lamp_plots[lt.fixture] = (lamp_polar_svg(lamp), lamp_spectrum_svg(lamp))
