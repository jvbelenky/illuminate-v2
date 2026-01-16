"""
Room Lamps Router - Manage lamps within rooms.

Lamp Types:
- "krcl_222" (Krypton chloride 222nm): Select from built-in presets or upload custom files
- "lp_254" (Low-pressure mercury 254nm): Requires custom .ies file upload (monochromatic)
"""

from __future__ import annotations

from typing import Dict, Any, Optional, List, Literal
from uuid import uuid4
from threading import RLock
from enum import Enum
import json
import hashlib
import math
import base64
from io import BytesIO
from tempfile import NamedTemporaryFile
import os

from fastapi import APIRouter, HTTPException, Query, Response, Request, status, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
import numpy as np

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

from .room_routers import room_store, save_rooms
from .lamp_routers import LAMP_DISPLAY_NAMES, CUSTOM_LAMP_KEY

import logging
logger = logging.getLogger(__name__)

room_lamps_router = APIRouter()
_LOCK = RLock()


# -------------------------------------------------------------------
# Lamp Type Enum
# -------------------------------------------------------------------
class LampTypeEnum(str, Enum):
    KRCL_222 = "krcl_222"
    LP_254 = "lp_254"


# -------------------------------------------------------------------
# Schemas
# -------------------------------------------------------------------
class RoomLampCreate(BaseModel):
    """Create a lamp in a room"""
    lamp_type: LampTypeEnum = Field(
        LampTypeEnum.KRCL_222,
        description="Lamp type: 'krcl_222' (Krypton chloride 222nm) or 'lp_254' (Low-pressure mercury 254nm)"
    )
    preset_id: Optional[str] = Field(
        None,
        description="For krcl_222: Built-in lamp preset ID (e.g., 'beacon', 'ushio_b1'). Use 'custom' for file upload."
    )
    x: float = Field(..., description="X position in room")
    y: float = Field(..., description="Y position in room")
    z: float = Field(..., description="Z position in room")
    aimx: float = Field(0, description="Aim direction X component")
    aimy: float = Field(0, description="Aim direction Y component")
    aimz: float = Field(-1, description="Aim direction Z component (default: pointing down)")
    scaling_factor: float = Field(1.0, ge=0, description="Intensity scaling factor")
    name: Optional[str] = Field(None, description="Optional display name for the lamp")
    enabled: bool = Field(True, description="Whether lamp is active in calculations")


class RoomLampUpdate(BaseModel):
    """Update a lamp's properties"""
    x: Optional[float] = None
    y: Optional[float] = None
    z: Optional[float] = None
    aimx: Optional[float] = None
    aimy: Optional[float] = None
    aimz: Optional[float] = None
    scaling_factor: Optional[float] = Field(None, ge=0)
    name: Optional[str] = None
    enabled: Optional[bool] = None


class RoomLampResponse(BaseModel):
    """Lamp response with all properties"""
    lamp_id: str
    room_id: str
    lamp_type: str
    preset_id: Optional[str]
    name: Optional[str]
    x: float
    y: float
    z: float
    aimx: float
    aimy: float
    aimz: float
    scaling_factor: float
    wavelength: Optional[float]
    enabled: bool
    has_ies_file: bool = False
    has_spectrum_file: bool = False


# -------------------------------------------------------------------
# Helpers
# -------------------------------------------------------------------
def _lamp_to_response(lamp, lamp_id: str, room_id: str, lamp_meta: dict) -> RoomLampResponse:
    """Convert a Lamp object to a response."""
    return RoomLampResponse(
        lamp_id=lamp_id,
        room_id=room_id,
        lamp_type=lamp_meta.get("lamp_type", "krcl_222"),
        preset_id=lamp_meta.get("preset_id"),
        name=getattr(lamp, 'name', None) or lamp_meta.get("name"),
        x=lamp.x,
        y=lamp.y,
        z=lamp.z,
        aimx=lamp.aimx,
        aimy=lamp.aimy,
        aimz=lamp.aimz,
        scaling_factor=getattr(lamp, 'scaling_factor', 1.0),
        wavelength=getattr(lamp, 'wavelength', None),
        enabled=getattr(lamp, 'enabled', True),
        has_ies_file=lamp_meta.get("has_ies_file", False),
        has_spectrum_file=lamp_meta.get("has_spectrum_file", False),
    )


def _validate_aim(aimx: float, aimy: float, aimz: float) -> None:
    """Validate aim vector is non-zero."""
    mag = math.sqrt(aimx * aimx + aimy * aimy + aimz * aimz)
    if not math.isfinite(mag) or mag == 0:
        raise HTTPException(
            status_code=422, detail="Aim vector must be finite and non-zero"
        )


def _validate_position(room, x: float, y: float, z: float) -> None:
    """Validate lamp position is within room bounds."""
    if not (0 <= x <= room.x and 0 <= y <= room.y and 0 <= z <= room.z):
        raise HTTPException(
            status_code=422,
            detail=f"Lamp position ({x}, {y}, {z}) is outside room bounds ({room.x}, {room.y}, {room.z})"
        )


# Store for lamp metadata (not stored in guv_calcs Lamp objects)
_LAMP_METADATA: Dict[str, Dict[str, Dict[str, Any]]] = {}


def _get_lamp_meta(room_id: str, lamp_id: str) -> Dict[str, Any]:
    """Get lamp metadata."""
    return _LAMP_METADATA.get(room_id, {}).get(lamp_id, {})


def _set_lamp_meta(room_id: str, lamp_id: str, meta: Dict[str, Any]) -> None:
    """Set lamp metadata."""
    if room_id not in _LAMP_METADATA:
        _LAMP_METADATA[room_id] = {}
    _LAMP_METADATA[room_id][lamp_id] = meta


def _delete_lamp_meta(room_id: str, lamp_id: str) -> None:
    """Delete lamp metadata."""
    if room_id in _LAMP_METADATA and lamp_id in _LAMP_METADATA[room_id]:
        del _LAMP_METADATA[room_id][lamp_id]


# -------------------------------------------------------------------
# Endpoints — Room Lamps CRUD
# -------------------------------------------------------------------

@room_lamps_router.get(
    "/rooms/{room_id}/lamps",
    summary="List all lamps in a room",
    response_model=List[RoomLampResponse],
)
def list_room_lamps(room_id: str):
    """List all lamps in a room."""
    room = room_store.get(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    lamps = []
    for lamp_id, lamp in room.lamps.items():
        meta = _get_lamp_meta(room_id, lamp_id)
        lamps.append(_lamp_to_response(lamp, lamp_id, room_id, meta))

    return lamps


@room_lamps_router.post(
    "/rooms/{room_id}/lamps",
    status_code=status.HTTP_201_CREATED,
    summary="Add a lamp to a room",
    description=(
        "Add a lamp to a room. For 222nm KrCl lamps, you can either:\n"
        "- Use a built-in preset (preset_id like 'beacon', 'ushio_b1')\n"
        "- Use 'custom' as preset_id and upload files separately\n\n"
        "For 254nm LP lamps, you must upload a custom .ies file."
    ),
    response_model=RoomLampResponse,
)
def add_room_lamp(room_id: str, lamp_data: RoomLampCreate, response: Response):
    """Add a lamp to a room."""
    room = room_store.get(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    # Validate
    _validate_aim(lamp_data.aimx, lamp_data.aimy, lamp_data.aimz)
    _validate_position(room, lamp_data.x, lamp_data.y, lamp_data.z)

    lamp_id = str(uuid4())[:8]
    lamp_meta = {
        "lamp_type": lamp_data.lamp_type.value,
        "preset_id": lamp_data.preset_id,
        "name": lamp_data.name,
        "has_ies_file": False,
        "has_spectrum_file": False,
    }

    # Create lamp based on type and preset
    if lamp_data.lamp_type == LampTypeEnum.KRCL_222:
        if lamp_data.preset_id and lamp_data.preset_id.lower() != CUSTOM_LAMP_KEY:
            # Use built-in preset via Lamp.from_keyword
            if lamp_data.preset_id.lower() not in VALID_LAMPS:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid preset_id '{lamp_data.preset_id}'. Valid options: {VALID_LAMPS}"
                )
            try:
                lamp = Lamp.from_keyword(
                    lamp_data.preset_id.lower(),
                    x=lamp_data.x,
                    y=lamp_data.y,
                    z=lamp_data.z,
                    aimx=lamp_data.aimx,
                    aimy=lamp_data.aimy,
                    aimz=lamp_data.aimz,
                    scaling_factor=lamp_data.scaling_factor,
                    lamp_id=lamp_id,
                )
                lamp_meta["has_ies_file"] = True
                lamp_meta["has_spectrum_file"] = True
                lamp_meta["name"] = lamp_data.name or LAMP_DISPLAY_NAMES.get(
                    lamp_data.preset_id.lower(),
                    lamp_data.preset_id
                )
            except Exception as e:
                logger.error(f"Failed to create lamp from preset: {e}")
                raise HTTPException(status_code=500, detail=f"Failed to load lamp preset: {e}")
        else:
            # Custom 222nm lamp - placeholder, files must be uploaded separately
            lamp = Lamp(
                x=lamp_data.x,
                y=lamp_data.y,
                z=lamp_data.z,
                aimx=lamp_data.aimx,
                aimy=lamp_data.aimy,
                aimz=lamp_data.aimz,
                wavelength=222,
                scaling_factor=lamp_data.scaling_factor,
                lamp_id=lamp_id,
            )
            lamp_meta["preset_id"] = CUSTOM_LAMP_KEY

    elif lamp_data.lamp_type == LampTypeEnum.LP_254:
        # 254nm LP lamp - placeholder, .ies file must be uploaded separately
        lamp = Lamp(
            x=lamp_data.x,
            y=lamp_data.y,
            z=lamp_data.z,
            aimx=lamp_data.aimx,
            aimy=lamp_data.aimy,
            aimz=lamp_data.aimz,
            wavelength=254,
            scaling_factor=lamp_data.scaling_factor,
            lamp_id=lamp_id,
        )
        lamp_meta["preset_id"] = CUSTOM_LAMP_KEY

    # Set enabled state
    lamp.enabled = lamp_data.enabled

    # Add to room
    room.add_lamp(lamp)
    _set_lamp_meta(room_id, lamp_id, lamp_meta)

    room.update_timestamp()
    save_rooms(room_store)

    response.headers["Location"] = f"/api/v1/rooms/{room_id}/lamps/{lamp_id}"
    logger.info(f"Added lamp {lamp_id} to room {room_id}")

    return _lamp_to_response(lamp, lamp_id, room_id, lamp_meta)


@room_lamps_router.get(
    "/rooms/{room_id}/lamps/{lamp_id}",
    summary="Get a lamp by ID",
    response_model=RoomLampResponse,
)
def get_room_lamp(room_id: str, lamp_id: str):
    """Get a specific lamp in a room."""
    room = room_store.get(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    lamp = room.lamps.get(lamp_id)
    if not lamp:
        raise HTTPException(status_code=404, detail="Lamp not found")

    meta = _get_lamp_meta(room_id, lamp_id)
    return _lamp_to_response(lamp, lamp_id, room_id, meta)


@room_lamps_router.patch(
    "/rooms/{room_id}/lamps/{lamp_id}",
    summary="Update a lamp's properties",
    response_model=RoomLampResponse,
)
def update_room_lamp(room_id: str, lamp_id: str, updates: RoomLampUpdate):
    """Update a lamp's position, aim, or other properties."""
    room = room_store.get(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    lamp = room.lamps.get(lamp_id)
    if not lamp:
        raise HTTPException(status_code=404, detail="Lamp not found")

    # Apply updates
    if updates.x is not None:
        lamp.x = updates.x
    if updates.y is not None:
        lamp.y = updates.y
    if updates.z is not None:
        lamp.z = updates.z
    if updates.aimx is not None:
        lamp.aimx = updates.aimx
    if updates.aimy is not None:
        lamp.aimy = updates.aimy
    if updates.aimz is not None:
        lamp.aimz = updates.aimz
    if updates.scaling_factor is not None:
        lamp.scaling_factor = updates.scaling_factor
    if updates.enabled is not None:
        lamp.enabled = updates.enabled

    # Update metadata
    meta = _get_lamp_meta(room_id, lamp_id)
    if updates.name is not None:
        meta["name"] = updates.name
        lamp.name = updates.name
    _set_lamp_meta(room_id, lamp_id, meta)

    # Validate new position/aim
    _validate_position(room, lamp.x, lamp.y, lamp.z)
    _validate_aim(lamp.aimx, lamp.aimy, lamp.aimz)

    room.update_timestamp()
    save_rooms(room_store)

    return _lamp_to_response(lamp, lamp_id, room_id, meta)


@room_lamps_router.delete(
    "/rooms/{room_id}/lamps/{lamp_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a lamp from a room",
)
def delete_room_lamp(room_id: str, lamp_id: str):
    """Delete a lamp from a room."""
    room = room_store.get(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    if lamp_id not in room.lamps:
        raise HTTPException(status_code=404, detail="Lamp not found")

    del room.lamps[lamp_id]
    _delete_lamp_meta(room_id, lamp_id)

    room.update_timestamp()
    save_rooms(room_store)

    logger.info(f"Deleted lamp {lamp_id} from room {room_id}")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# -------------------------------------------------------------------
# Endpoints — Lamp File Management
# -------------------------------------------------------------------

@room_lamps_router.post(
    "/rooms/{room_id}/lamps/{lamp_id}/ies",
    summary="Upload an IES file for a lamp",
    description=(
        "Upload a .ies photometric file for a custom lamp. "
        "Required for 254nm LP lamps and optional custom 222nm lamps."
    ),
)
async def upload_lamp_ies(
    room_id: str,
    lamp_id: str,
    file: UploadFile = File(..., description="IES photometric file (.ies)"),
):
    """Upload an IES file for a lamp."""
    room = room_store.get(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    lamp = room.lamps.get(lamp_id)
    if not lamp:
        raise HTTPException(status_code=404, detail="Lamp not found")

    content = await file.read()
    try:
        ies_text = content.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="IES file must be valid UTF-8 text")

    # Basic IES validation
    if not any(marker in ies_text[:500].upper() for marker in ["IESNA", "TILT="]):
        raise HTTPException(status_code=400, detail="Invalid IES file format")

    # Save to temp file and reload lamp with new IES data
    with NamedTemporaryFile(mode='w', suffix='.ies', delete=False) as f:
        f.write(ies_text)
        temp_path = f.name

    try:
        # Update the lamp's filedata
        lamp.filedata = temp_path
        # Trigger reload of photometric data
        if hasattr(lamp, '_load_ies'):
            lamp._load_ies()
    finally:
        # Clean up temp file
        try:
            os.unlink(temp_path)
        except:
            pass

    # Update metadata
    meta = _get_lamp_meta(room_id, lamp_id)
    meta["has_ies_file"] = True
    meta["ies_filename"] = file.filename
    meta["ies_data"] = base64.b64encode(content).decode("ascii")
    _set_lamp_meta(room_id, lamp_id, meta)

    room.update_timestamp()
    save_rooms(room_store)

    return {
        "message": "IES file uploaded successfully",
        "filename": file.filename,
        "size_bytes": len(content),
    }


@room_lamps_router.post(
    "/rooms/{room_id}/lamps/{lamp_id}/spectrum",
    summary="Upload a spectrum file for a lamp",
    description=(
        "Upload a spectrum CSV file for a custom 222nm lamp. "
        "Not applicable for 254nm LP lamps (assumed monochromatic)."
    ),
)
async def upload_lamp_spectrum(
    room_id: str,
    lamp_id: str,
    file: UploadFile = File(..., description="Spectrum CSV file"),
):
    """Upload a spectrum file for a lamp."""
    room = room_store.get(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    lamp = room.lamps.get(lamp_id)
    if not lamp:
        raise HTTPException(status_code=404, detail="Lamp not found")

    meta = _get_lamp_meta(room_id, lamp_id)

    # Check if this is a 254nm lamp (spectrum not applicable)
    if meta.get("lamp_type") == "lp_254":
        raise HTTPException(
            status_code=400,
            detail="Spectrum files are not applicable to 254nm LP lamps (assumed monochromatic)"
        )

    content = await file.read()
    try:
        spectrum_text = content.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="Spectrum file must be valid UTF-8 text")

    # Basic CSV validation
    lines = [l.strip() for l in spectrum_text.strip().split("\n") if l.strip()]
    if len(lines) < 2:
        raise HTTPException(status_code=400, detail="Spectrum file must have at least 2 rows")

    # Save to temp file and update lamp
    with NamedTemporaryFile(mode='w', suffix='.csv', delete=False) as f:
        f.write(spectrum_text)
        temp_path = f.name

    try:
        lamp.spectra_source = temp_path
        if hasattr(lamp, '_load_spectrum'):
            lamp._load_spectrum()
    finally:
        try:
            os.unlink(temp_path)
        except:
            pass

    # Update metadata
    meta["has_spectrum_file"] = True
    meta["spectrum_filename"] = file.filename
    meta["spectrum_data"] = base64.b64encode(content).decode("ascii")
    _set_lamp_meta(room_id, lamp_id, meta)

    room.update_timestamp()
    save_rooms(room_store)

    return {
        "message": "Spectrum file uploaded successfully",
        "filename": file.filename,
        "lines": len(lines),
    }


@room_lamps_router.get(
    "/rooms/{room_id}/lamps/{lamp_id}/ies",
    summary="Download the IES file for a lamp",
)
def download_lamp_ies(room_id: str, lamp_id: str):
    """Download a lamp's IES file."""
    room = room_store.get(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    if lamp_id not in room.lamps:
        raise HTTPException(status_code=404, detail="Lamp not found")

    meta = _get_lamp_meta(room_id, lamp_id)
    if not meta.get("has_ies_file") or "ies_data" not in meta:
        raise HTTPException(status_code=404, detail="No IES file available for this lamp")

    content = base64.b64decode(meta["ies_data"])
    filename = meta.get("ies_filename", f"lamp_{lamp_id}.ies")

    return StreamingResponse(
        BytesIO(content),
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@room_lamps_router.get(
    "/rooms/{room_id}/lamps/{lamp_id}/spectrum",
    summary="Download the spectrum file for a lamp",
)
def download_lamp_spectrum(
    room_id: str,
    lamp_id: str,
    format: str = Query("csv", description="Response format: csv or json"),
):
    """Download a lamp's spectrum file."""
    room = room_store.get(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    if lamp_id not in room.lamps:
        raise HTTPException(status_code=404, detail="Lamp not found")

    meta = _get_lamp_meta(room_id, lamp_id)
    if not meta.get("has_spectrum_file") or "spectrum_data" not in meta:
        raise HTTPException(status_code=404, detail="No spectrum file available for this lamp")

    content = base64.b64decode(meta["spectrum_data"])
    filename = meta.get("spectrum_filename", f"lamp_{lamp_id}_spectrum.csv")

    if format == "json":
        text = content.decode("utf-8")
        lines = [l.strip() for l in text.strip().split("\n") if l.strip()]
        data = []
        for line in lines:
            parts = line.replace(";", ",").split(",")
            if len(parts) >= 2:
                try:
                    data.append({
                        "wavelength": float(parts[0]),
                        "intensity": float(parts[1]),
                    })
                except ValueError:
                    continue
        return {"filename": filename, "data": data}

    return StreamingResponse(
        BytesIO(content),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# -------------------------------------------------------------------
# Endpoints — Photometric Web Data (for 3D visualization)
# -------------------------------------------------------------------

class PhotometricWebResponse(BaseModel):
    """Photometric web mesh data for 3D visualization."""
    vertices: List[List[float]] = Field(description="List of [x, y, z] vertex coordinates")
    triangles: List[List[int]] = Field(description="List of [i, j, k] triangle indices")
    aim_line: List[List[float]] = Field(description="[[start_x, start_y, start_z], [end_x, end_y, end_z]]")
    surface_points: List[List[float]] = Field(description="List of [x, y, z] surface point coordinates")
    color: str = Field(description="Suggested color for the lamp mesh")


@room_lamps_router.get(
    "/rooms/{room_id}/lamps/{lamp_id}/photometric-web",
    summary="Get photometric web data for 3D visualization",
    description=(
        "Returns the mesh data for rendering a lamp's photometric web in 3D. "
        "Includes vertices, triangle indices, aim line, and surface points."
    ),
    response_model=PhotometricWebResponse,
)
def get_photometric_web(room_id: str, lamp_id: str, units: str = Query("meters", description="Output units")):
    """Get photometric web mesh data for 3D visualization."""
    if Delaunay is None:
        raise HTTPException(
            status_code=500,
            detail="scipy is required for photometric web visualization"
        )

    room = room_store.get(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    lamp = room.lamps.get(lamp_id)
    if not lamp:
        raise HTTPException(status_code=404, detail="Lamp not found")

    # Check if lamp has photometric data
    if lamp.ies is None or lamp.photometry is None:
        raise HTTPException(
            status_code=400,
            detail="Lamp has no photometric data. Upload an IES file first."
        )

    try:
        # Get photometric coordinates and transform to world space
        # Following the same logic as room_plotter._plot_lamp
        init_scale = convert_units(room.units, "meters", lamp.values.max())
        coords = lamp.transform_to_world(lamp.photometric_coords, scale=init_scale)

        # Scale based on total power
        scale = lamp.get_total_power() / 100
        coords = (coords.T - lamp.position) * scale + lamp.surface.position
        x, y, z = coords.T

        # Perform Delaunay triangulation in polar space
        Theta, Phi, R = to_polar(*lamp.photometric_coords.T)
        tri = Delaunay(np.column_stack((Theta.flatten(), Phi.flatten())))

        # Build vertex list
        vertices = [[float(x[i]), float(y[i]), float(z[i])] for i in range(len(x))]

        # Build triangle list from Delaunay simplices
        triangles = [[int(tri.simplices[i, 0]), int(tri.simplices[i, 1]), int(tri.simplices[i, 2])]
                     for i in range(len(tri.simplices))]

        # Get aim line
        xi, yi, zi = lamp.surface.position
        xia, yia, zia = lamp.aim_point
        aim_line = [[float(xi), float(yi), float(zi)], [float(xia), float(yia), float(zia)]]

        # Get surface points
        surface_pts = lamp.surface.surface_points.T
        surface_points = [[float(surface_pts[0][i]), float(surface_pts[1][i]), float(surface_pts[2][i])]
                          for i in range(surface_pts.shape[1])]

        # Determine color based on lamp state and wavelength
        meta = _get_lamp_meta(room_id, lamp_id)
        lamp_type = meta.get("lamp_type", "krcl_222")
        if not lamp.enabled:
            color = "#d1d1d1"  # grey for disabled
        elif lamp_type == "lp_254":
            color = "#3b82f6"  # blue for 254nm
        else:
            color = "#cc61ff"  # purple for 222nm (default)

        return PhotometricWebResponse(
            vertices=vertices,
            triangles=triangles,
            aim_line=aim_line,
            surface_points=surface_points,
            color=color,
        )

    except Exception as e:
        logger.error(f"Failed to compute photometric web for lamp {lamp_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to compute photometric web: {str(e)}"
        )
