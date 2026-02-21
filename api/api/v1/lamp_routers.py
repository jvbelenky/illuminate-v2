"""
Lamp management endpoints.

Lamp Types:
- "Krypton chloride (222 nm)" (default): Select from built-in presets or upload custom files
- "Low-pressure mercury (254 nm)": Requires custom .ies file upload (monochromatic, no spectrum needed)
"""

from __future__ import annotations

from typing import List, Optional, Dict, Any, Literal
from enum import Enum
import io
import base64
import threading
from functools import lru_cache
import numpy as np

from fastapi import APIRouter, HTTPException, Query, Response, status
from pydantic import BaseModel, Field

from guv_calcs.lamp import Lamp  # type: ignore
from guv_calcs import to_polar  # type: ignore
from guv_calcs.units import convert_units  # type: ignore
from guv_calcs.safety import PhotStandard  # type: ignore
from guv_calcs.lamp.lamp_configs import resolve_keyword  # type: ignore

from .utils import fig_to_base64

try:
    from scipy.spatial import Delaunay
except ImportError:
    Delaunay = None

from guv_calcs.lamp import get_valid_keys  # type: ignore

VALID_LAMPS = get_valid_keys()

import logging
logger = logging.getLogger(__name__)


# ----------------------------
# Report URL Cache (probed once at startup)
# ----------------------------
REPORT_URLS: Dict[str, str] = {}

def _init_report_urls():
    """Probe report URLs once at import time, store results."""
    import urllib.request
    for lamp_key in VALID_LAMPS:
        url = f"https://reports.osluv.org/static/assay/{lamp_key}.html"
        try:
            req = urllib.request.Request(url, method='HEAD')
            with urllib.request.urlopen(req, timeout=5) as response:
                if response.status == 200:
                    REPORT_URLS[lamp_key] = url
        except Exception:
            pass
    logger.info(f"Report URL probe complete: {len(REPORT_URLS)}/{len(VALID_LAMPS)} reports available")

# Run report URL probe in background thread at module load
threading.Thread(target=_init_report_urls, daemon=True).start()

lamp_router = APIRouter()


# ----------------------------
# Lamp Type Definitions
# ----------------------------

class LampType(str, Enum):
    KRCL_222 = "Krypton chloride (222 nm)"
    LP_254 = "Low-pressure mercury (254 nm)"
    OTHER = "Other (custom wavelength)"


# Human-readable names for the built-in 222nm lamps
LAMP_DISPLAY_NAMES: Dict[str, str] = {
    "aerolamp": "Aerolamp DevKit",
    "beacon": "Beacon",
    "lumenizer_zone": "Lumenizer Zone",
    "nukit_lantern": "NuKit Lantern",
    "nukit_torch": "NuKit Torch",
    "sterilray": "Sterilray",
    "ushio_b1": "Ushio B1",
    "ushio_b1.5": "Ushio B1.5",
    "uvpro222_b1": "UVPro222 B1",
    "uvpro222_b2": "UVPro222 B2",
    "visium": "Visium",
}

# Special option for custom file upload
CUSTOM_LAMP_KEY = "custom"


# ----------------------------
# Schemas
# ----------------------------

class LampTypeInfo(BaseModel):
    """Information about a lamp type"""
    id: str
    name: str
    wavelength: int
    requires_custom_ies: bool = Field(description="Whether custom .ies file upload is required")
    has_presets: bool = Field(description="Whether built-in presets are available")


class LampPresetInfo(BaseModel):
    """Information about a built-in lamp preset"""
    id: str = Field(description="Keyword used with Lamp.from_keyword")
    name: str = Field(description="Human-readable display name")
    lamp_type: str = Field(default="Krypton chloride (222 nm)")
    wavelength: int = Field(default=222)
    has_ies: bool = Field(default=True)
    has_spectrum: bool = Field(default=True)
    default_placement_mode: Optional[str] = Field(default=None, description="Default placement mode from lamp config")


class LampSelectionOptions(BaseModel):
    """Available options for lamp selection"""
    lamp_types: List[LampTypeInfo]
    presets_222nm: List[LampPresetInfo]


# ----------------------------
# Pre-built Presets List (computed once at module level)
# ----------------------------
def _build_presets() -> List[LampPresetInfo]:
    """Build presets list once. Called at module level after schema classes are defined."""
    presets = []
    for lamp_key in VALID_LAMPS:
        display_name = LAMP_DISPLAY_NAMES.get(lamp_key, lamp_key.replace("_", " ").title())
        placement_mode = None
        try:
            _, config = resolve_keyword(lamp_key)
            placement_mode = config.get("placement", {}).get("mode")
        except KeyError:
            pass
        presets.append(LampPresetInfo(
            id=lamp_key,
            name=display_name,
            lamp_type="Krypton chloride (222 nm)",
            wavelength=222,
            has_ies=True,
            has_spectrum=True,
            default_placement_mode=placement_mode,
        ))
    return presets

_PRESETS_222NM = _build_presets()


# ----------------------------
# Endpoints
# ----------------------------

@lamp_router.get(
    "/lamps/types",
    summary="Get available lamp types",
    description="Returns the available lamp types and their requirements.",
    response_model=List[LampTypeInfo],
)
def get_lamp_types():
    """Get the available lamp types."""
    return [
        LampTypeInfo(
            id="krcl_222",
            name="Krypton chloride (222 nm)",
            wavelength=222,
            requires_custom_ies=False,
            has_presets=True,
        ),
        LampTypeInfo(
            id="lp_254",
            name="Low-pressure mercury (254 nm)",
            wavelength=254,
            requires_custom_ies=True,
            has_presets=False,
        ),
        LampTypeInfo(
            id="other",
            name="Other (custom wavelength)",
            wavelength=0,
            requires_custom_ies=True,
            has_presets=False,
        ),
    ]


@lamp_router.get(
    "/lamps/presets",
    summary="Get available 222nm lamp presets",
    description=(
        "Returns the built-in 222nm KrCl lamp presets available for selection. "
        "These can be loaded directly using their ID with Lamp.from_keyword. "
        "The list also includes a 'custom' option for uploading custom files."
    ),
    response_model=List[LampPresetInfo],
)
def get_lamp_presets():
    """Get the available built-in 222nm lamp presets."""
    return [
        *_PRESETS_222NM,
        LampPresetInfo(
            id=CUSTOM_LAMP_KEY,
            name="Select local file...",
            lamp_type="Krypton chloride (222 nm)",
            wavelength=222,
            has_ies=False,
            has_spectrum=False,
        ),
    ]


@lamp_router.get(
    "/lamps/options",
    summary="Get all lamp selection options",
    description=(
        "Returns all available lamp types and presets in a single response. "
        "Use this to populate lamp selection UI components."
    ),
    response_model=LampSelectionOptions,
)
def get_lamp_options():
    """Get all lamp selection options for UI population."""
    return LampSelectionOptions(
        lamp_types=get_lamp_types(),
        presets_222nm=get_lamp_presets(),
    )


@lamp_router.get(
    "/lamps/presets/{preset_id}",
    summary="Get details about a specific preset",
    description="Returns detailed information about a built-in lamp preset.",
)
def get_preset_details(preset_id: str):
    """Get details about a specific lamp preset."""
    if preset_id == CUSTOM_LAMP_KEY:
        return {
            "id": CUSTOM_LAMP_KEY,
            "name": "Custom lamp",
            "description": "Upload your own .ies file and optionally a spectrum .csv file",
            "lamp_type": "Krypton chloride (222 nm)",
            "wavelength": 222,
            "requires_ies_upload": True,
            "requires_spectrum_upload": False,
        }

    if preset_id.lower() not in VALID_LAMPS:
        raise HTTPException(
            status_code=404,
            detail=f"Preset '{preset_id}' not found. Valid presets: {VALID_LAMPS}"
        )

    display_name = LAMP_DISPLAY_NAMES.get(preset_id.lower(), preset_id.replace("_", " ").title())

    return {
        "id": preset_id.lower(),
        "name": display_name,
        "description": f"Built-in 222nm KrCl lamp with pre-loaded IES and spectrum data",
        "lamp_type": "Krypton chloride (222 nm)",
        "wavelength": 222,
        "load_method": "Lamp.from_keyword",
        "requires_ies_upload": False,
        "requires_spectrum_upload": False,
    }


@lamp_router.get(
    "/lamps/validate-preset/{preset_id}",
    summary="Validate a preset ID",
    description="Check if a preset ID is valid and can be used with Lamp.from_keyword.",
)
def validate_preset(preset_id: str):
    """Validate that a preset ID exists."""
    is_valid = preset_id.lower() in VALID_LAMPS
    return {
        "preset_id": preset_id,
        "valid": is_valid,
        "message": "Valid preset" if is_valid else f"Invalid preset. Valid options: {VALID_LAMPS}",
    }


# ----------------------------
# Photometric Web Data
# ----------------------------

class PhotometricWebRequest(BaseModel):
    """Request parameters for photometric web generation."""
    preset_id: str = Field(..., description="Preset lamp ID (e.g., 'beacon', 'ushio_b1')")
    scaling_factor: float = Field(1.0, ge=0, description="Intensity scaling factor")
    units: str = Field("meters", description="Length units")
    # Optional source settings for surface point visualization
    source_density: Optional[int] = Field(None, description="Source discretization density")
    source_width: Optional[float] = Field(None, description="Source width")
    source_length: Optional[float] = Field(None, description="Source length")


class PhotometricWebResponse(BaseModel):
    """Photometric web mesh data for 3D visualization."""
    vertices: List[List[float]] = Field(description="List of [x, y, z] vertex coordinates")
    triangles: List[List[int]] = Field(description="List of [i, j, k] triangle indices")
    aim_line: List[List[float]] = Field(description="[[start_x, start_y, start_z], [end_x, end_y, end_z]]")
    surface_points: List[List[float]] = Field(description="List of [x, y, z] surface point coordinates")
    fixture_bounds: Optional[List[List[float]]] = Field(None, description="List of 8 [x, y, z] corners defining fixture bounding box, or null if no dimensions")
    color: str = Field(description="Suggested color for the lamp mesh")


@lru_cache(maxsize=64)
def _compute_photometric_web(
    preset_id: str,
    scaling_factor: float,
    source_density: Optional[int],
    source_width: Optional[float],
    source_length: Optional[float],
) -> dict:
    """Compute photometric web data for a preset lamp. Cached by arguments."""
    lamp = Lamp.from_keyword(
        preset_id,
        x=0, y=0, z=0,
        aimx=0, aimy=0, aimz=-1,
        scaling_factor=scaling_factor,
    )

    if source_density is not None:
        lamp.surface.source_density = source_density
    if source_width is not None:
        lamp.surface.width = source_width
    if source_length is not None:
        lamp.surface.length = source_length

    init_scale = lamp.values.max()
    coords = lamp.transform_to_world(lamp.photometric_coords, scale=init_scale)
    power_scale = lamp.get_total_power() / 100.0
    coords = (coords.T - lamp.position) * power_scale
    x, y, z = coords.T

    Theta, Phi, R = to_polar(*lamp.photometric_coords.T)
    tri = Delaunay(np.column_stack((Theta.flatten(), Phi.flatten())))

    vertices = [[float(x[i]), float(y[i]), float(z[i])] for i in range(len(x))]
    triangles = [[int(tri.simplices[i, 0]), int(tri.simplices[i, 1]), int(tri.simplices[i, 2])]
                 for i in range(len(tri.simplices))]
    aim_line = [[0.0, 0.0, 0.0], [0.0, 0.0, -1.0]]

    try:
        raw_surface_points = lamp.surface.surface_points
        if raw_surface_points is not None and len(raw_surface_points) > 0:
            if raw_surface_points.ndim == 1:
                surface_points = [raw_surface_points.tolist()]
            else:
                surface_points = [[float(p[0]), float(p[1]), float(p[2])] for p in raw_surface_points]
        else:
            surface_points = [[0.0, 0.0, 0.0]]
    except Exception as e:
        logger.warning(f"Failed to get surface points for {preset_id}: {e}")
        surface_points = [[0.0, 0.0, 0.0]]

    fixture_bounds = None
    try:
        if lamp.fixture.has_dimensions:
            corners = lamp.geometry.get_bounding_box_corners()
            fixture_bounds = [[float(c[0]), float(c[1]), float(c[2])] for c in corners]
    except Exception as e:
        logger.warning(f"Failed to get fixture bounds for {preset_id}: {e}")

    return {
        "vertices": vertices,
        "triangles": triangles,
        "aim_line": aim_line,
        "surface_points": surface_points,
        "fixture_bounds": fixture_bounds,
        "color": "#cc61ff",
    }


@lamp_router.post(
    "/lamps/photometric-web",
    summary="Get photometric web data for a preset lamp",
    description=(
        "Returns mesh data for rendering a lamp's photometric web in 3D. "
        "The mesh is centered at origin pointing down (-Z). Apply position "
        "and rotation transforms client-side for efficiency. "
        "Only re-fetch when preset_id or scaling_factor changes."
    ),
    response_model=PhotometricWebResponse,
)
def get_preset_photometric_web(request: PhotometricWebRequest):
    """Get photometric web mesh data for a preset lamp (centered at origin)."""
    if Delaunay is None:
        raise HTTPException(
            status_code=500,
            detail="scipy is required for photometric web visualization"
        )

    preset_id = request.preset_id.lower()
    if preset_id not in VALID_LAMPS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid preset_id '{preset_id}'. Valid options: {VALID_LAMPS}"
        )

    try:
        data = _compute_photometric_web(
            preset_id,
            request.scaling_factor,
            request.source_density,
            request.source_width,
            request.source_length,
        )
        return PhotometricWebResponse(**data)

    except Exception as e:
        logger.error(f"Failed to compute photometric web for preset {preset_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to compute photometric web: {str(e)}"
        )


# ----------------------------
# Lamp Info Endpoint (for popup)
# ----------------------------

class TlvLimits(BaseModel):
    """TLV limits for a single standard."""
    skin: float  # mJ/cm²
    eye: float   # mJ/cm²

class LampInfoResponse(BaseModel):
    """Complete lamp information for popup display."""
    preset_id: str
    name: str
    total_power_mw: float
    tlv_acgih: TlvLimits
    tlv_icnirp: TlvLimits
    photometric_plot_base64: str  # PNG as base64
    spectrum_plot_base64: Optional[str] = None  # PNG as base64, None if no spectrum
    spectrum_linear_plot_base64: Optional[str] = None
    spectrum_log_plot_base64: Optional[str] = None
    has_spectrum: bool
    report_url: Optional[str] = None  # URL to full report if available
    # Hi-res (300 DPI) versions
    photometric_plot_hires_base64: Optional[str] = None
    spectrum_plot_hires_base64: Optional[str] = None
    spectrum_linear_plot_hires_base64: Optional[str] = None
    spectrum_log_plot_hires_base64: Optional[str] = None


def _generate_photometric_plot(lamp, bg_color, text_color, grid_color, dpi):
    """Generate photometric polar plot for a lamp."""
    import matplotlib.pyplot as plt
    fig = None
    try:
        result = lamp.plot_ies()
        fig = result[0] if isinstance(result, tuple) else result
        fig.patch.set_facecolor(bg_color)
        for ax in fig.axes:
            ax.set_facecolor(bg_color)
            ax.tick_params(colors=text_color, labelcolor=text_color)
            ax.xaxis.label.set_color(text_color)
            ax.yaxis.label.set_color(text_color)
            if hasattr(ax, 'title') and ax.title:
                ax.title.set_color(text_color)
            for spine in ax.spines.values():
                spine.set_color(grid_color)
            ax.grid(color=grid_color, alpha=0.5)
        return fig_to_base64(fig, dpi=dpi, facecolor=bg_color,
                             bbox_inches='tight', pad_inches=0.1)
    except Exception as e:
        logger.warning(f"Failed to generate photometric plot: {e}")
        return ""
    finally:
        if fig is not None:
            plt.close(fig)


def _generate_spectrum_plot(lamp, scale, bg_color, text_color, grid_color, dpi):
    """Generate spectrum plot for a lamp at given scale."""
    import matplotlib.pyplot as plt
    fig = None
    try:
        result = lamp.spectrum.plot(weights=True)
        fig = result[0] if isinstance(result, tuple) else result
        fig.patch.set_facecolor(bg_color)
        for ax in fig.axes:
            ax.set_yscale(scale)
            ax.set_facecolor(bg_color)
            ax.tick_params(colors=text_color, labelcolor=text_color)
            ax.xaxis.label.set_color(text_color)
            ax.yaxis.label.set_color(text_color)
            if hasattr(ax, 'title') and ax.title:
                ax.title.set_color(text_color)
            for spine in ax.spines.values():
                spine.set_color(grid_color)
            ax.grid(color=grid_color, alpha=0.5)
            legend = ax.get_legend()
            if legend:
                legend.get_frame().set_facecolor(bg_color)
                legend.get_frame().set_edgecolor(grid_color)
                for text in legend.get_texts():
                    text.set_color(text_color)
        return fig_to_base64(fig, dpi=dpi, facecolor=bg_color,
                             bbox_inches='tight', pad_inches=0.1)
    except Exception as e:
        logger.warning(f"Failed to generate spectrum plot ({scale}): {e}")
        return None
    finally:
        if fig is not None:
            plt.close(fig)


@lru_cache(maxsize=128)
def _generate_preset_lamp_info(preset_id: str, theme: str, include_hires: bool) -> dict:
    """Generate and cache preset lamp info. Returns a dict matching LampInfoResponse fields.

    Keyed by (preset_id, theme, include_hires). Both spectrum scales are always
    generated so toggling is instant on the client.
    """
    lamp = Lamp.from_keyword(preset_id)
    display_name = LAMP_DISPLAY_NAMES.get(preset_id, preset_id.replace("_", " ").title())

    total_power = lamp.get_total_power()

    acgih_skin, acgih_eye = lamp.get_tlvs(PhotStandard.ACGIH)
    icnirp_skin, icnirp_eye = lamp.get_tlvs(PhotStandard.ICNIRP)

    # Theme colors
    if theme == 'light':
        bg_color = '#ffffff'
        text_color = '#1f2328'
        grid_color = '#c0c0c0'
    else:
        bg_color = '#16213e'
        text_color = '#eaeaea'
        grid_color = '#4a5568'

    # Generate photometric plot at 150 DPI
    photometric_plot = _generate_photometric_plot(lamp, bg_color, text_color, grid_color, 150)

    # Generate both spectrum scales at 150 DPI
    has_spectrum = lamp.spectrum is not None
    spectrum_linear = None
    spectrum_log = None
    if has_spectrum:
        spectrum_linear = _generate_spectrum_plot(lamp, 'linear', bg_color, text_color, grid_color, 150)
        spectrum_log = _generate_spectrum_plot(lamp, 'log', bg_color, text_color, grid_color, 150)

    # Hi-res (300 DPI) versions
    photometric_hires = None
    spectrum_linear_hires = None
    spectrum_log_hires = None
    if include_hires:
        photometric_hires = _generate_photometric_plot(lamp, bg_color, text_color, grid_color, 300)
        if has_spectrum:
            spectrum_linear_hires = _generate_spectrum_plot(lamp, 'linear', bg_color, text_color, grid_color, 300)
            spectrum_log_hires = _generate_spectrum_plot(lamp, 'log', bg_color, text_color, grid_color, 300)

    report_url = REPORT_URLS.get(preset_id)

    return {
        "preset_id": preset_id,
        "name": display_name,
        "total_power_mw": float(total_power),
        "tlv_acgih": {
            "skin": float(acgih_skin) if acgih_skin is not None else 0.0,
            "eye": float(acgih_eye) if acgih_eye is not None else 0.0,
        },
        "tlv_icnirp": {
            "skin": float(icnirp_skin) if icnirp_skin is not None else 0.0,
            "eye": float(icnirp_eye) if icnirp_eye is not None else 0.0,
        },
        "photometric_plot_base64": photometric_plot,
        "spectrum_plot_base64": spectrum_log,  # default to log scale
        "spectrum_linear_plot_base64": spectrum_linear,
        "spectrum_log_plot_base64": spectrum_log,
        "has_spectrum": has_spectrum,
        "report_url": report_url,
        "photometric_plot_hires_base64": photometric_hires,
        "spectrum_plot_hires_base64": spectrum_log_hires,
        "spectrum_linear_plot_hires_base64": spectrum_linear_hires,
        "spectrum_log_plot_hires_base64": spectrum_log_hires,
    }


def _prewarm_cache():
    """Pre-generate all preset lamp info combinations in background."""
    for preset_id in VALID_LAMPS:
        for t in ('dark', 'light'):
            try:
                _generate_preset_lamp_info(preset_id, t, True)
            except Exception as e:
                logger.warning(f"Cache pre-warm failed for {preset_id}/{t}: {e}")
    logger.info("Preset lamp info cache pre-warm complete")

# Pre-warm cache in background thread at module load
threading.Thread(target=_prewarm_cache, daemon=True).start()


@lamp_router.get(
    "/lamps/info/{preset_id}",
    summary="Get complete lamp information for popup display",
    description=(
        "Returns comprehensive lamp information including photometric plot, "
        "spectrum plot, total power, and safety dose limits. "
        "Both spectrum scales and hi-res images are included by default."
    ),
    response_model=LampInfoResponse,
)
def get_lamp_info(
    preset_id: str,
    spectrum_scale: str = Query("log", description="Y-axis scale for spectrum plot: 'linear' or 'log' (sets spectrum_plot_base64)"),
    theme: str = Query("dark", description="Color theme for plots: 'light' or 'dark'"),
    dpi: int = Query(150, description="Ignored (kept for backward compat). Both 150 and 300 DPI are always returned."),
    include_hires: bool = Query(True, description="Include 300 DPI hi-res versions"),
) -> LampInfoResponse:
    """Get complete lamp information including plots."""
    preset_id_lower = preset_id.lower()
    if preset_id_lower not in VALID_LAMPS:
        raise HTTPException(
            status_code=404,
            detail=f"Preset '{preset_id}' not found. Valid presets: {VALID_LAMPS}"
        )

    try:
        data = _generate_preset_lamp_info(preset_id_lower, theme, include_hires)
        # Set spectrum_plot_base64 based on requested scale for backward compat
        result = dict(data)
        if spectrum_scale == 'linear' and result.get('spectrum_linear_plot_base64'):
            result['spectrum_plot_base64'] = result['spectrum_linear_plot_base64']
            result['spectrum_plot_hires_base64'] = result.get('spectrum_linear_plot_hires_base64')
        return LampInfoResponse(**result)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get lamp info for {preset_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get lamp info: {str(e)}"
        )


@lamp_router.get(
    "/lamps/download/ies/{preset_id}",
    summary="Download IES file for a preset lamp",
    description="Returns the IES photometric data file for the specified lamp preset.",
)
def download_lamp_ies(preset_id: str) -> Response:
    """Download IES file for a preset lamp."""
    preset_id_lower = preset_id.lower()
    if preset_id_lower not in VALID_LAMPS:
        raise HTTPException(
            status_code=404,
            detail=f"Preset '{preset_id}' not found. Valid presets: {VALID_LAMPS}"
        )

    try:
        lamp = Lamp.from_keyword(preset_id_lower)
        ies_bytes = lamp.save_ies(original=True)

        return Response(
            content=ies_bytes,
            media_type="application/octet-stream",
            headers={"Content-Disposition": f"attachment; filename={preset_id_lower}.ies"}
        )
    except Exception as e:
        logger.error(f"Failed to download IES for {preset_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to download IES file: {str(e)}"
        )


@lamp_router.get(
    "/lamps/download/spectrum/{preset_id}",
    summary="Download spectrum CSV for a preset lamp",
    description="Returns the spectral data as a CSV file for the specified lamp preset.",
)
def download_lamp_spectrum(preset_id: str) -> Response:
    """Download spectrum CSV for a preset lamp."""
    preset_id_lower = preset_id.lower()
    if preset_id_lower not in VALID_LAMPS:
        raise HTTPException(
            status_code=404,
            detail=f"Preset '{preset_id}' not found. Valid presets: {VALID_LAMPS}"
        )

    try:
        lamp = Lamp.from_keyword(preset_id_lower)

        if lamp.spectrum is None:
            raise HTTPException(
                status_code=404,
                detail=f"No spectrum data available for lamp '{preset_id}'"
            )

        csv_bytes = lamp.spectrum.to_csv()

        return Response(
            content=csv_bytes,
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={preset_id_lower}_spectrum.csv"}
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to download spectrum for {preset_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to download spectrum file: {str(e)}"
        )
