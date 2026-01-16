"""
Lamp management endpoints.

Lamp Types:
- "Krypton chloride (222 nm)" (default): Select from built-in presets or upload custom files
- "Low-pressure mercury (254 nm)": Requires custom .ies file upload (monochromatic, no spectrum needed)
"""

from __future__ import annotations

from typing import List, Optional, Dict, Any, Literal
from enum import Enum
import numpy as np

from fastapi import APIRouter, HTTPException, Query, Response, status
from pydantic import BaseModel, Field

from guv_calcs.lamp import Lamp  # type: ignore
from guv_calcs.trigonometry import to_polar  # type: ignore
from guv_calcs.units import convert_units  # type: ignore

try:
    from scipy.spatial import Delaunay
except ImportError:
    Delaunay = None

# Try to import VALID_LAMPS, fall back to hardcoded list if not available
try:
    from guv_calcs.lamp import VALID_LAMPS  # type: ignore
except ImportError:
    VALID_LAMPS = [
        "aerolamp",
        "beacon",
        "lumenizer_zone",
        "nukit_lantern",
        "nukit_torch",
        "sterilray",
        "ushio_b1",
        "ushio_b1.5",
        "uvpro222_b1",
        "uvpro222_b2",
        "visium",
    ]

import logging
logger = logging.getLogger(__name__)

lamp_router = APIRouter()


# ----------------------------
# Lamp Type Definitions
# ----------------------------

class LampType(str, Enum):
    KRCL_222 = "Krypton chloride (222 nm)"
    LP_254 = "Low-pressure mercury (254 nm)"


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


class LampSelectionOptions(BaseModel):
    """Available options for lamp selection"""
    lamp_types: List[LampTypeInfo]
    presets_222nm: List[LampPresetInfo]


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
    presets = []

    # Add built-in presets from VALID_LAMPS
    for lamp_key in VALID_LAMPS:
        display_name = LAMP_DISPLAY_NAMES.get(lamp_key, lamp_key.replace("_", " ").title())
        presets.append(LampPresetInfo(
            id=lamp_key,
            name=display_name,
            lamp_type="Krypton chloride (222 nm)",
            wavelength=222,
            has_ies=True,
            has_spectrum=True,
        ))

    # Add custom upload option
    presets.append(LampPresetInfo(
        id=CUSTOM_LAMP_KEY,
        name="Select local file...",
        lamp_type="Krypton chloride (222 nm)",
        wavelength=222,
        has_ies=False,  # User must provide
        has_spectrum=False,  # User may optionally provide
    ))

    return presets


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


class PhotometricWebResponse(BaseModel):
    """Photometric web mesh data for 3D visualization."""
    vertices: List[List[float]] = Field(description="List of [x, y, z] vertex coordinates")
    triangles: List[List[int]] = Field(description="List of [i, j, k] triangle indices")
    aim_line: List[List[float]] = Field(description="[[start_x, start_y, start_z], [end_x, end_y, end_z]]")
    surface_points: List[List[float]] = Field(description="List of [x, y, z] surface point coordinates")
    color: str = Field(description="Suggested color for the lamp mesh")


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
        # Create lamp from preset at origin, pointing down
        lamp = Lamp.from_keyword(
            preset_id,
            x=0,
            y=0,
            z=0,
            aimx=0,
            aimy=0,
            aimz=-1,
            scaling_factor=request.scaling_factor,
        )

        # Follow the same algorithm as room_plotter._plot_lamp:
        # 1. transform_to_world with scale=max_value normalizes the coords
        # 2. Subtract position to center at origin
        # 3. Multiply by total_power/100 (100mW = 1m)

        init_scale = lamp.values.max()  # Max intensity value
        coords = lamp.transform_to_world(lamp.photometric_coords, scale=init_scale)
        # coords is (3, N) from transform_to_world

        # Center at origin and scale by power
        power_scale = lamp.get_total_power() / 1000.0  # 1W = 1m
        coords = (coords.T - lamp.position) * power_scale  # Now (N, 3)
        x, y, z = coords.T  # Transpose to (3, N) then unpack

        # Perform Delaunay triangulation in polar space (using original coords)
        Theta, Phi, R = to_polar(*lamp.photometric_coords.T)
        tri = Delaunay(np.column_stack((Theta.flatten(), Phi.flatten())))

        # Build vertex list (centered at origin)
        vertices = [[float(x[i]), float(y[i]), float(z[i])] for i in range(len(x))]

        # Build triangle list from Delaunay simplices
        triangles = [[int(tri.simplices[i, 0]), int(tri.simplices[i, 1]), int(tri.simplices[i, 2])]
                     for i in range(len(tri.simplices))]

        # Aim line: from origin to 1 unit down (will be transformed client-side)
        aim_line = [[0.0, 0.0, 0.0], [0.0, 0.0, -1.0]]

        # Surface points (at origin for now)
        surface_points = [[0.0, 0.0, 0.0]]

        return PhotometricWebResponse(
            vertices=vertices,
            triangles=triangles,
            aim_line=aim_line,
            surface_points=surface_points,
            color="#cc61ff",  # purple for 222nm lamps
        )

    except Exception as e:
        logger.error(f"Failed to compute photometric web for preset {preset_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to compute photometric web: {str(e)}"
        )
