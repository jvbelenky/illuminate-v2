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

from api.v1.session_helpers import masked_grid
from api.v1.utils import apply_theme, serialized_plotting
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


class _GriddedPlane:
    """A plane whose values are already on the full bounding-box grid. guv_calcs
    stores a polygon room's plane as a flat array of the points inside the
    outline, which its imshow-based plot cannot draw; this stand-in hands the
    plot the same zone with NaN holes (drawn blank) outside the outline."""

    def __init__(self, zone, grid: np.ndarray):
        self._zone = zone
        self._grid = grid

    def __getattr__(self, name):
        return getattr(self._zone, name)

    def get_values(self):
        return self._grid

    def plot(self, **kwargs):
        # The zone class's own plot, run on this stand-in
        return type(self._zone).plot(self, **kwargs)


def plane_svg(zone, vmin=None, vmax=None, title=None) -> str:
    values = zone.get_values()
    if values is not None and np.ndim(values) != 2:
        grid = masked_grid(zone, values)
        # guv_calcs takes min/max over the values, which NaN holes would poison
        vmin = float(np.nanmin(grid)) if vmin is None else vmin
        vmax = float(np.nanmax(grid)) if vmax is None else vmax
        zone = _GriddedPlane(zone, grid)
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


# Lamp marker colours by kind; anything else (custom wavelengths) is green
_LAMP_COLORS = {"222 nm": "#7c3aed", "254 nm": "#2563eb"}
_OTHER_LAMP_COLOR = "#059669"


def plan_svg(ctx: ReportContext) -> str:
    """Top-down schematic drawn from the room geometry: the floor outline,
    object footprints, calculation points, and each luminaire's position with
    an arrow for the horizontal direction it aims in. Unlike a 3D capture it is
    exactly to scale and carries no lighting or photometric webs."""
    from matplotlib.patches import Polygon as PolygonPatch
    from matplotlib.lines import Line2D

    outline = np.array(ctx.room.vertices or [(0, 0), (ctx.room.x, 0), (ctx.room.x, ctx.room.y), (0, ctx.room.y)])
    x0, y0 = outline.min(axis=0)
    x1, y1 = outline.max(axis=0)
    span = max(x1 - x0, y1 - y0, 1e-9)
    aspect = (y1 - y0) / max(x1 - x0, 1e-9)
    width_in = 6.5
    height_in = float(np.clip(width_in * aspect, 2.4, 7.5))
    length = ctx.units.length
    with _print_style():
        fig, ax = plt.subplots(figsize=(width_in, height_in))
        ax.add_patch(PolygonPatch(outline, closed=True, facecolor="#f4f5f7", edgecolor="#374151", linewidth=1.6, zorder=1))
        for obj in ctx.objects:
            if not obj.footprint:
                continue
            fp = np.array(obj.footprint)
            ax.add_patch(PolygonPatch(fp, closed=True, facecolor="#d1d5db" if obj.enabled else "none",
                                      edgecolor="#6b7280", linewidth=0.9, hatch="///" if obj.enabled else None, zorder=2))
            cx, cy = fp.mean(axis=0)
            ax.annotate(obj.name, (cx, cy), ha="center", va="center", fontsize=7, color="#374151", zorder=6,
                        bbox=dict(boxstyle="round,pad=0.15", facecolor="white", edgecolor="none", alpha=0.8))
        arrow = 0.07 * span
        for pt in ctx.custom_points:
            if pt.aim is not None:
                adx, ady = pt.aim[0] - pt.position[0], pt.aim[1] - pt.position[1]
                ah = float(np.hypot(adx, ady))
                if ah > 1e-6 * span:   # a sensor facing sideways: show which way
                    ax.annotate("", xy=(pt.position[0] + adx / ah * arrow, pt.position[1] + ady / ah * arrow),
                                xytext=(pt.position[0], pt.position[1]), zorder=3,
                                arrowprops=dict(arrowstyle="-|>", color="#6b7280", lw=1.0, mutation_scale=8, shrinkA=0, shrinkB=0))
            ax.plot(pt.position[0], pt.position[1], marker="x", color="#6b7280", markersize=6, mew=1.4, zorder=3)
            ax.annotate(pt.name, (pt.position[0], pt.position[1]), xytext=(5, -9), textcoords="offset points",
                        fontsize=7, color="#4b5563", zorder=6)
        kinds: dict[str, str] = {}
        for lamp in ctx.lamps:
            color = _LAMP_COLORS.get(lamp.type_label, _OTHER_LAMP_COLOR) if lamp.enabled else "#9ca3af"
            if lamp.enabled:
                kinds.setdefault(lamp.type_label, color)
            px, py = lamp.position[0], lamp.position[1]
            dx, dy = lamp.aim[0] - px, lamp.aim[1] - py
            horiz = float(np.hypot(dx, dy))
            if horiz > 1e-6 * span:
                ax.annotate("", xy=(px + dx / horiz * arrow, py + dy / horiz * arrow), xytext=(px, py), zorder=4,
                            arrowprops=dict(arrowstyle="-|>", color=color, lw=1.4, mutation_scale=10, shrinkA=0, shrinkB=0))
            ax.plot(px, py, marker="o", markersize=8, color=color if lamp.enabled else "white",
                    markeredgecolor=color, markeredgewidth=1.4, zorder=5)
            ax.annotate(lamp.name, (px, py), xytext=(6, 5), textcoords="offset points", fontsize=8,
                        color="#111827", zorder=6,
                        bbox=dict(boxstyle="round,pad=0.15", facecolor="white", edgecolor="none", alpha=0.85))
        pad = 0.06 * span
        ax.set_xlim(x0 - pad, x1 + pad)
        ax.set_ylim(y0 - pad, y1 + pad)
        ax.set_aspect("equal")
        ax.set_xlabel(f"x ({length})", fontsize=9)
        ax.set_ylabel(f"y ({length})", fontsize=9)
        ax.tick_params(labelsize=8)
        ax.grid(True, color="#e5e7eb", linewidth=0.6, zorder=0)
        ax.set_axisbelow(True)
        for spine in ax.spines.values():
            spine.set_color("#d1d5db")
        handles = [Line2D([], [], marker="o", linestyle="none", color=c, markersize=7, label=k) for k, c in kinds.items()]
        if ctx.custom_points:
            handles.append(Line2D([], [], marker="x", linestyle="none", color="#6b7280", markersize=6, mew=1.4, label="Calculation point"))
        if ctx.objects:
            handles.append(PolygonPatch([(0, 0)], closed=True, facecolor="#d1d5db", edgecolor="#6b7280", hatch="///", label="Object"))
        if handles:
            # below the x-axis label, whatever the plan's aspect
            ax.legend(handles=handles, loc="upper center", bbox_to_anchor=(0.5, -0.45 / height_in - 0.06),
                      ncol=min(len(handles), 4), fontsize=8, frameon=False)
        return fig_to_svg(fig)


@serialized_plotting
def attach_plots(ctx: ReportContext, room) -> None:
    """Fill the SVG fields of a ReportContext in place."""
    ctx.plan_svg = plan_svg(ctx)
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
