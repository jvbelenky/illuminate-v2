"""
Project save/load endpoints (.guv files).

A .guv file is a JSON-based project format containing:
- Room configuration
- All lamps with positions, settings, and optionally embedded file data
- All calculation zones
- Metadata (version, timestamps)
"""

from __future__ import annotations

from typing import Dict, Any, Optional, List
from datetime import datetime
import json
import base64
from io import BytesIO

from fastapi import APIRouter, HTTPException, Query, UploadFile, File, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from guv_calcs.calc_zone import CalcPlane, CalcVol  # type: ignore
from guv_calcs.lamp import Lamp  # type: ignore

from .room_routers import room_store, ExtendedRoom, save_rooms
from .calc_zone_routers import _zone_to_response, _create_calc_plane, _create_calc_vol
from .schemas import (
    CalcPlaneFromBounds,
    CalcPlaneFromFace,
    CalcPlaneFromPoints,
    CalcVolFromBounds,
    CalcVolFromDims,
)

import logging
logger = logging.getLogger(__name__)

project_router = APIRouter()

# Current .guv format version
GUV_FORMAT_VERSION = "1.0"


# === Schemas ===

class ProjectMetadata(BaseModel):
    format_version: str = GUV_FORMAT_VERSION
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    exported_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    application: str = "Illuminate API"
    notes: Optional[str] = None


class ProjectExportOptions(BaseModel):
    include_ies_files: bool = Field(True, description="Embed IES files in export")
    include_spectrum_files: bool = Field(True, description="Embed spectrum files in export")
    include_results: bool = Field(False, description="Include calculation results if available")


# === Helper functions ===

def _serialize_lamp(lamp: Lamp, include_files: bool = True) -> Dict[str, Any]:
    """Serialize a Lamp object to a dictionary."""
    data = {
        "lamp_id": getattr(lamp, 'lamp_id', None),
        "name": getattr(lamp, 'name', None),
        "x": lamp.x,
        "y": lamp.y,
        "z": lamp.z,
        "aimx": lamp.aimx,
        "aimy": lamp.aimy,
        "aimz": lamp.aimz,
        "wavelength": getattr(lamp, 'wavelength', None),
        "guv_type": getattr(lamp, 'guv_type', None),
        "scaling_factor": getattr(lamp, 'scaling_factor', 1.0),
        "enabled": getattr(lamp, 'enabled', True),
    }

    # Include embedded files if requested
    if include_files:
        if hasattr(lamp, 'ies_file') and lamp.ies_file:
            data["ies_file"] = lamp.ies_file
            data["ies_filename"] = getattr(lamp, 'ies_filename', None)
        if hasattr(lamp, 'spectrum') and lamp.spectrum:
            data["spectrum"] = lamp.spectrum
            if hasattr(lamp, 'spectrum_file'):
                data["spectrum_file"] = lamp.spectrum_file
                data["spectrum_filename"] = getattr(lamp, 'spectrum_filename', None)

    return data


def _deserialize_lamp(data: Dict[str, Any]) -> Lamp:
    """Create a Lamp object from serialized data."""
    lamp = Lamp(
        x=data["x"],
        y=data["y"],
        z=data["z"],
        aimx=data.get("aimx", 0),
        aimy=data.get("aimy", 0),
        aimz=data.get("aimz", -1),
        wavelength=data.get("wavelength"),
        guv_type=data.get("guv_type"),
        scaling_factor=data.get("scaling_factor", 1.0),
    )

    # Restore optional attributes
    if data.get("lamp_id"):
        lamp.lamp_id = data["lamp_id"]
    if data.get("name"):
        lamp.name = data["name"]
    if data.get("enabled") is not None:
        lamp.enabled = data["enabled"]

    # Restore embedded files
    if data.get("ies_file"):
        lamp.ies_file = data["ies_file"]
        lamp.ies_filename = data.get("ies_filename")
    if data.get("spectrum"):
        lamp.spectrum = data["spectrum"]
    if data.get("spectrum_file"):
        lamp.spectrum_file = data["spectrum_file"]
        lamp.spectrum_filename = data.get("spectrum_filename")

    return lamp


def _serialize_zone(zone) -> Dict[str, Any]:
    """Serialize a CalcPlane or CalcVol to a dictionary."""
    is_plane = isinstance(zone, CalcPlane)
    zone_type = "plane" if is_plane else "volume"

    data = {
        "zone_id": zone.zone_id,
        "zone_type": zone_type,
        "name": getattr(zone, 'name', None),
        "enabled": getattr(zone, 'enabled', True),
        "show_values": getattr(zone, 'show_values', True),
        "colormap": getattr(zone, 'colormap', None),
        "dose": getattr(zone, 'dose', False),
        "hours": getattr(zone, 'hours', 8.0),
        "init_method": getattr(zone, '_init_method', 'bounds'),
    }

    # Get geometry bounds
    if hasattr(zone, 'geometry') and zone.geometry is not None:
        geom = zone.geometry
        if is_plane:
            data["bounds"] = {
                "x1": float(geom.origin[0]),
                "x2": float(geom.origin[0] + geom.spans[0]),
                "y1": float(geom.origin[1]),
                "y2": float(geom.origin[1] + geom.spans[1]),
                "height": float(geom.origin[2]) if len(geom.origin) > 2 else 0.0,
            }
            data["resolution"] = {
                "num_x": geom.num_points[0] if hasattr(geom, 'num_points') else None,
                "num_y": geom.num_points[1] if hasattr(geom, 'num_points') else None,
            }
        else:
            data["bounds"] = {
                "x1": float(geom.origin[0]),
                "x2": float(geom.origin[0] + geom.spans[0]),
                "y1": float(geom.origin[1]),
                "y2": float(geom.origin[1] + geom.spans[1]),
                "z1": float(geom.origin[2]),
                "z2": float(geom.origin[2] + geom.spans[2]),
            }
            data["resolution"] = {
                "num_x": geom.num_points[0] if hasattr(geom, 'num_points') else None,
                "num_y": geom.num_points[1] if hasattr(geom, 'num_points') else None,
                "num_z": geom.num_points[2] if hasattr(geom, 'num_points') else None,
            }

    # Plane-specific options
    if is_plane:
        data["plane_config"] = {
            "fov_vert": getattr(zone, 'fov_vert', 180),
            "fov_horiz": getattr(zone, 'fov_horiz', 360),
            "vert": getattr(zone, 'vert', False),
            "horiz": getattr(zone, 'horiz', False),
            "use_normal": getattr(zone, 'use_normal', True),
        }

    return data


def _deserialize_zone(data: Dict[str, Any], room) -> Any:
    """Create a CalcPlane or CalcVol from serialized data."""
    zone_type = data.get("zone_type", "plane")
    init_method = data.get("init_method", "bounds")
    bounds = data.get("bounds", {})
    resolution = data.get("resolution", {})

    common_kwargs = {
        "zone_id": data.get("zone_id"),
        "name": data.get("name"),
        "enabled": data.get("enabled", True),
        "show_values": data.get("show_values", True),
        "colormap": data.get("colormap"),
        "dose": data.get("dose", False),
        "hours": data.get("hours", 8.0),
    }

    if zone_type == "plane":
        plane_config = data.get("plane_config", {})

        if init_method == "bounds":
            zone = CalcPlane(
                **common_kwargs,
                x1=bounds.get("x1", 0),
                x2=bounds.get("x2", room.x),
                y1=bounds.get("y1", 0),
                y2=bounds.get("y2", room.y),
                height=bounds.get("height", 0),
                num_x=resolution.get("num_x"),
                num_y=resolution.get("num_y"),
                fov_vert=plane_config.get("fov_vert", 180),
                fov_horiz=plane_config.get("fov_horiz", 360),
                vert=plane_config.get("vert", False),
                horiz=plane_config.get("horiz", False),
                use_normal=plane_config.get("use_normal", True),
            )
        else:
            # Fallback to bounds method for other init types
            zone = CalcPlane(
                **common_kwargs,
                x1=bounds.get("x1", 0),
                x2=bounds.get("x2", room.x),
                y1=bounds.get("y1", 0),
                y2=bounds.get("y2", room.y),
                height=bounds.get("height", 0),
                num_x=resolution.get("num_x"),
                num_y=resolution.get("num_y"),
            )

        zone._init_method = init_method

    else:  # volume
        if init_method == "bounds":
            zone = CalcVol(
                **common_kwargs,
                x1=bounds.get("x1", 0),
                x2=bounds.get("x2", room.x),
                y1=bounds.get("y1", 0),
                y2=bounds.get("y2", room.y),
                z1=bounds.get("z1", 0),
                z2=bounds.get("z2", room.z),
                num_x=resolution.get("num_x"),
                num_y=resolution.get("num_y"),
                num_z=resolution.get("num_z"),
            )
        elif init_method == "dims":
            zone = CalcVol.from_dims(
                dims=room.dimensions,
                num_points=resolution.get("num_x"),
                **common_kwargs,
            )
        else:
            zone = CalcVol(
                **common_kwargs,
                x1=bounds.get("x1", 0),
                x2=bounds.get("x2", room.x),
                y1=bounds.get("y1", 0),
                y2=bounds.get("y2", room.y),
                z1=bounds.get("z1", 0),
                z2=bounds.get("z2", room.z),
            )

        zone._init_method = init_method

    return zone


def _export_room_to_guv(room: ExtendedRoom, options: ProjectExportOptions) -> Dict[str, Any]:
    """Export a room to .guv format."""
    project = {
        "metadata": {
            "format_version": GUV_FORMAT_VERSION,
            "created_at": room.created_at,
            "exported_at": datetime.utcnow().isoformat(),
            "application": "Illuminate API",
        },
        "room": {
            "room_id": room.room_id,
            "room_name": room.room_name,
            "room_uuid": str(room.room_uuid),
            "dimensions": {
                "x": room.x,
                "y": room.y,
                "z": room.z,
            },
            "units": room.units,
            "standard": room.standard,
            "precision": room.precision,
            "enable_reflectance": room.enable_reflectance,
            "reflectances": getattr(room, 'reflectances', None),
            "air_changes": room.air_changes,
            "ozone_decay_constant": room.ozone_decay_constant,
            "colormap": room.colormap,
            "created_by_user_id": room.created_by_user_id,
        },
        "lamps": [],
        "zones": [],
    }

    # Serialize lamps
    for lamp_id, lamp in room.lamps.items():
        lamp_data = _serialize_lamp(lamp, include_files=options.include_ies_files)
        lamp_data["lamp_id"] = lamp_id  # Ensure ID is preserved
        project["lamps"].append(lamp_data)

    # Serialize zones
    for zone_id, zone in room.calc_zones.items():
        zone_data = _serialize_zone(zone)
        project["zones"].append(zone_data)

    # Optionally include results
    if options.include_results:
        project["results"] = {}
        for zone_id, zone in room.calc_zones.items():
            if hasattr(zone, 'values') and zone.values is not None:
                import numpy as np
                values = zone.values
                if hasattr(values, 'tolist'):
                    project["results"][zone_id] = {
                        "values": values.tolist(),
                        "shape": list(values.shape),
                    }

    return project


def _import_guv_to_room(project: Dict[str, Any]) -> ExtendedRoom:
    """Import a .guv file and create a room."""
    metadata = project.get("metadata", {})
    room_data = project.get("room", {})
    lamps_data = project.get("lamps", [])
    zones_data = project.get("zones", [])

    # Validate format version
    version = metadata.get("format_version", "1.0")
    if version.split(".")[0] != GUV_FORMAT_VERSION.split(".")[0]:
        raise ValueError(f"Unsupported .guv format version: {version}")

    # Create room
    dims = room_data.get("dimensions", {})
    room = ExtendedRoom(
        x=dims.get("x", 10),
        y=dims.get("y", 10),
        z=dims.get("z", 3),
        units=room_data.get("units", "meters"),
        standard=room_data.get("standard", "ACGIH"),
        precision=room_data.get("precision", 1),
        enable_reflectance=room_data.get("enable_reflectance", False),
        reflectances=room_data.get("reflectances"),
        air_changes=room_data.get("air_changes", 6.0),
        ozone_decay_constant=room_data.get("ozone_decay_constant", 0.15),
        colormap=room_data.get("colormap", "plasma"),
        room_name=room_data.get("room_name"),
        created_by_user_id=room_data.get("created_by_user_id"),
    )

    # Preserve original room_uuid if provided
    if room_data.get("room_uuid"):
        import uuid
        try:
            room.room_uuid = uuid.UUID(room_data["room_uuid"])
        except (ValueError, TypeError):
            pass  # Keep generated UUID

    # Add lamps
    for lamp_data in lamps_data:
        lamp = _deserialize_lamp(lamp_data)
        room.add_lamp(lamp)

    # Add zones
    for zone_data in zones_data:
        zone = _deserialize_zone(zone_data, room)
        room.add_calc_zone(zone)

    return room


# === Endpoints ===

@project_router.get(
    "/rooms/{room_id}/export",
    summary="Export a room as a .guv file",
    description="Export the complete room configuration including lamps, zones, and optionally results.",
    responses={
        200: {
            "description": "GUV project file",
            "content": {"application/json": {}},
        },
        404: {"description": "Room not found"},
    },
)
def export_room(
    room_id: str,
    include_ies_files: bool = Query(True, description="Include embedded IES files"),
    include_spectrum_files: bool = Query(True, description="Include embedded spectrum files"),
    include_results: bool = Query(False, description="Include calculation results"),
    download: bool = Query(True, description="Return as downloadable file"),
):
    """Export a room to .guv format."""
    room = room_store.get(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    options = ProjectExportOptions(
        include_ies_files=include_ies_files,
        include_spectrum_files=include_spectrum_files,
        include_results=include_results,
    )

    project = _export_room_to_guv(room, options)

    if download:
        content = json.dumps(project, indent=2).encode("utf-8")
        filename = f"{room.room_name or room.room_id}.guv"
        return StreamingResponse(
            BytesIO(content),
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    return project


@project_router.post(
    "/rooms/import",
    summary="Import a .guv file to create a new room",
    description="Upload a .guv file to create a room with all its lamps and zones.",
    responses={
        201: {"description": "Room created from import"},
        400: {"description": "Invalid .guv file"},
    },
)
async def import_room(
    file: UploadFile = File(..., description=".guv project file"),
    new_room_id: Optional[str] = Query(None, description="Override room ID (generates new if not provided)"),
):
    """Import a .guv file and create a new room."""
    content = await file.read()

    try:
        project = json.loads(content.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON in .guv file: {e}")

    try:
        room = _import_guv_to_room(project)
    except Exception as e:
        logger.error(f"Failed to import .guv file: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to import project: {e}")

    # Override room ID if requested
    if new_room_id:
        room.room_id = new_room_id

    # Check for ID collision
    if room.room_id in room_store:
        # Generate a new unique ID
        from datetime import datetime
        room.room_id = f"{room.room_id}-{datetime.now().strftime('%H%M%S')}"

    # Store the room
    room_store[room.room_id] = room
    save_rooms(room_store)

    logger.info(f"Imported room '{room.room_id}' from .guv file")

    return {
        "message": "Room imported successfully",
        "room_id": room.room_id,
        "room_name": room.room_name,
        "lamps_count": len(room.lamps),
        "zones_count": len(room.calc_zones),
    }


@project_router.post(
    "/rooms/{room_id}/duplicate",
    summary="Duplicate a room",
    description="Create a copy of an existing room with a new ID.",
)
def duplicate_room(
    room_id: str,
    new_name: Optional[str] = Query(None, description="Name for the duplicated room"),
):
    """Duplicate an existing room."""
    room = room_store.get(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    # Export and re-import to create a clean copy
    options = ProjectExportOptions(
        include_ies_files=True,
        include_spectrum_files=True,
        include_results=False,
    )
    project = _export_room_to_guv(room, options)
    new_room = _import_guv_to_room(project)

    # Generate new IDs
    from datetime import datetime
    import uuid
    new_room.room_id = f"Room-{datetime.now().strftime('%Y%m%d%H%M%S')}"
    new_room.room_uuid = uuid.uuid4()
    new_room.room_name = new_name or f"{room.room_name} (Copy)"
    new_room.created_at = datetime.utcnow().isoformat()
    new_room.updated_at = new_room.created_at

    # Store
    room_store[new_room.room_id] = new_room
    save_rooms(room_store)

    logger.info(f"Duplicated room '{room_id}' as '{new_room.room_id}'")

    return new_room.summary()


@project_router.get(
    "/project/schema",
    summary="Get the .guv file schema",
    description="Returns the JSON schema for .guv project files.",
)
def get_guv_schema():
    """Return the .guv file format schema."""
    return {
        "format_version": GUV_FORMAT_VERSION,
        "schema": {
            "metadata": {
                "format_version": "string - Version of the .guv format",
                "created_at": "string - ISO timestamp of original creation",
                "exported_at": "string - ISO timestamp of this export",
                "application": "string - Application that created the file",
                "notes": "string? - Optional user notes",
            },
            "room": {
                "room_id": "string - Unique room identifier",
                "room_name": "string - Display name",
                "room_uuid": "string - UUID for the room",
                "dimensions": {
                    "x": "number - Room length",
                    "y": "number - Room width",
                    "z": "number - Room height",
                },
                "units": "string - 'meters' or 'feet'",
                "standard": "string - Photobiological safety standard",
                "precision": "integer - Calculation precision (1-9)",
                "enable_reflectance": "boolean - Enable wall reflectance",
                "reflectances": "object? - Per-wall reflectance values",
                "air_changes": "number - Room air changes per hour",
                "ozone_decay_constant": "number - Ozone decay rate",
                "colormap": "string - Matplotlib colormap name",
            },
            "lamps": [
                {
                    "lamp_id": "string - Unique lamp identifier",
                    "name": "string? - Display name",
                    "x": "number - X position",
                    "y": "number - Y position",
                    "z": "number - Z position",
                    "aimx": "number - Aim direction X",
                    "aimy": "number - Aim direction Y",
                    "aimz": "number - Aim direction Z",
                    "wavelength": "number? - Peak wavelength (nm)",
                    "guv_type": "string? - LED/LP/MP",
                    "scaling_factor": "number - Intensity scaling",
                    "enabled": "boolean - Whether lamp is active",
                    "ies_file": "string? - Base64-encoded IES data",
                    "spectrum": "string? - Spectrum CSV data",
                }
            ],
            "zones": [
                {
                    "zone_id": "string - Unique zone identifier",
                    "zone_type": "string - 'plane' or 'volume'",
                    "name": "string? - Display name",
                    "enabled": "boolean - Include in calculations",
                    "dose": "boolean - Calculate dose vs fluence rate",
                    "hours": "number - Hours for dose calculation",
                    "bounds": "object - Zone boundaries",
                    "resolution": "object - Grid resolution",
                    "plane_config": "object? - Plane-specific options",
                }
            ],
            "results": {
                "<zone_id>": {
                    "values": "array - Grid values",
                    "shape": "array - Value array dimensions",
                }
            },
        },
    }
