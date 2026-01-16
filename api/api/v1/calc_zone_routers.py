"""
Calculation Zone CRUD endpoints for rooms.

Supports multiple initialization methods:
- CalcPlane: from_bounds, from_face, from_points
- CalcVol: from_bounds, from_dims
"""

from fastapi import APIRouter, HTTPException
from typing import List, Union
import uuid

from guv_calcs.calc_zone import CalcPlane, CalcVol  # type: ignore

from .schemas import (
    CalcZoneCreate,
    CalcPlaneFromBounds,
    CalcPlaneFromFace,
    CalcPlaneFromPoints,
    CalcVolFromBounds,
    CalcVolFromDims,
    CalcZoneResponse,
    CalcZoneUpdate,
)
from .room_routers import room_store, save_rooms

import logging
logger = logging.getLogger(__name__)

calc_zone_router = APIRouter()


def _zone_to_response(zone) -> CalcZoneResponse:
    """Convert a CalcPlane or CalcVol to a response schema"""
    is_plane = isinstance(zone, CalcPlane)
    zone_type = "plane" if is_plane else "volume"

    # Get bounds from geometry
    if hasattr(zone, 'geometry') and zone.geometry is not None:
        geom = zone.geometry
        if is_plane:
            bounds = {
                "x1": float(geom.origin[0]),
                "x2": float(geom.origin[0] + geom.spans[0]),
                "y1": float(geom.origin[1]),
                "y2": float(geom.origin[1] + geom.spans[1]),
                "height": float(geom.origin[2]) if len(geom.origin) > 2 else 0.0,
            }
            resolution = {
                "num_x": geom.num_points[0] if hasattr(geom, 'num_points') else None,
                "num_y": geom.num_points[1] if hasattr(geom, 'num_points') else None,
                "x_spacing": geom.spacing[0] if hasattr(geom, 'spacing') else None,
                "y_spacing": geom.spacing[1] if hasattr(geom, 'spacing') else None,
            }
        else:
            bounds = {
                "x1": float(geom.origin[0]),
                "x2": float(geom.origin[0] + geom.spans[0]),
                "y1": float(geom.origin[1]),
                "y2": float(geom.origin[1] + geom.spans[1]),
                "z1": float(geom.origin[2]),
                "z2": float(geom.origin[2] + geom.spans[2]),
            }
            resolution = {
                "num_x": geom.num_points[0] if hasattr(geom, 'num_points') else None,
                "num_y": geom.num_points[1] if hasattr(geom, 'num_points') else None,
                "num_z": geom.num_points[2] if hasattr(geom, 'num_points') else None,
                "x_spacing": geom.spacing[0] if hasattr(geom, 'spacing') else None,
                "y_spacing": geom.spacing[1] if hasattr(geom, 'spacing') else None,
                "z_spacing": geom.spacing[2] if hasattr(geom, 'spacing') else None,
            }
    else:
        bounds = {}
        resolution = {}

    # Plane-specific config
    plane_config = None
    if is_plane:
        plane_config = {
            "fov_vert": getattr(zone, 'fov_vert', 180),
            "fov_horiz": getattr(zone, 'fov_horiz', 360),
            "vert": getattr(zone, 'vert', False),
            "horiz": getattr(zone, 'horiz', False),
            "use_normal": getattr(zone, 'use_normal', True),
        }

    return CalcZoneResponse(
        zone_id=zone.zone_id,
        name=getattr(zone, 'name', None),
        zone_type=zone_type,
        init_method=getattr(zone, '_init_method', 'unknown'),
        enabled=getattr(zone, 'enabled', True),
        dose=getattr(zone, 'dose', False),
        hours=getattr(zone, 'hours', 8.0),
        bounds=bounds,
        resolution=resolution,
        plane_config=plane_config,
    )


def _create_calc_plane(data: Union[CalcPlaneFromBounds, CalcPlaneFromFace, CalcPlaneFromPoints], room) -> CalcPlane:
    """Create a CalcPlane from the appropriate schema"""
    zone_id = data.zone_id or f"plane-{uuid.uuid4().hex[:8]}"

    common_kwargs = {
        "zone_id": zone_id,
        "name": data.name,
        "enabled": data.enabled,
        "show_values": data.show_values,
        "colormap": data.colormap,
        "dose": data.dose,
        "hours": data.hours,
        "fov_vert": data.fov_vert,
        "fov_horiz": data.fov_horiz,
        "vert": data.vert,
        "horiz": data.horiz,
        "use_normal": data.use_normal,
    }

    if isinstance(data, CalcPlaneFromBounds):
        plane = CalcPlane(
            **common_kwargs,
            x1=data.x1,
            x2=data.x2,
            y1=data.y1,
            y2=data.y2,
            height=data.height,
            x_spacing=data.x_spacing,
            y_spacing=data.y_spacing,
            num_x=data.num_x,
            num_y=data.num_y,
            offset=data.offset,
            ref_surface=data.ref_surface,
            direction=data.direction,
        )
        plane._init_method = "bounds"

    elif isinstance(data, CalcPlaneFromFace):
        plane = CalcPlane.from_face(
            wall=data.wall,
            dims=room.dimensions,
            normal_offset=data.normal_offset,
            spacing=data.spacing,
            num_points=data.num_points,
            offset=data.offset,
            **common_kwargs,
        )
        plane._init_method = "face"

    elif isinstance(data, CalcPlaneFromPoints):
        plane = CalcPlane.from_points(
            p0=data.p0,
            pU=data.pU,
            pV=data.pV,
            spacing=data.spacing,
            num_points=data.num_points,
            offset=data.offset,
            **common_kwargs,
        )
        plane._init_method = "points"
    else:
        raise ValueError(f"Unknown CalcPlane init method: {type(data)}")

    return plane


def _create_calc_vol(data: Union[CalcVolFromBounds, CalcVolFromDims], room) -> CalcVol:
    """Create a CalcVol from the appropriate schema"""
    zone_id = data.zone_id or f"vol-{uuid.uuid4().hex[:8]}"

    common_kwargs = {
        "zone_id": zone_id,
        "name": data.name,
        "enabled": data.enabled,
        "show_values": data.show_values,
        "colormap": data.colormap,
        "dose": data.dose,
        "hours": data.hours,
    }

    if isinstance(data, CalcVolFromBounds):
        vol = CalcVol(
            **common_kwargs,
            x1=data.x1,
            x2=data.x2,
            y1=data.y1,
            y2=data.y2,
            z1=data.z1,
            z2=data.z2,
            x_spacing=data.x_spacing,
            y_spacing=data.y_spacing,
            z_spacing=data.z_spacing,
            num_x=data.num_x,
            num_y=data.num_y,
            num_z=data.num_z,
            offset=data.offset,
        )
        vol._init_method = "bounds"

    elif isinstance(data, CalcVolFromDims):
        vol = CalcVol.from_dims(
            dims=room.dimensions,
            spacing=data.spacing,
            num_points=data.num_points,
            offset=data.offset,
            **common_kwargs,
        )
        vol._init_method = "dims"
    else:
        raise ValueError(f"Unknown CalcVol init method: {type(data)}")

    return vol


# === Routes ===

@calc_zone_router.get("/rooms/{room_id}/zones", response_model=List[CalcZoneResponse])
def list_zones(room_id: str):
    """List all calculation zones in a room"""
    room = room_store.get(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    return [_zone_to_response(zone) for zone in room.calc_zones.values()]


@calc_zone_router.post("/rooms/{room_id}/zones", response_model=CalcZoneResponse)
def create_zone(room_id: str, data: CalcZoneCreate):
    """Create a new calculation zone in a room"""
    room = room_store.get(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    try:
        # Determine if plane or volume based on init_method
        if isinstance(data, (CalcPlaneFromBounds, CalcPlaneFromFace, CalcPlaneFromPoints)):
            zone = _create_calc_plane(data, room)
        elif isinstance(data, (CalcVolFromBounds, CalcVolFromDims)):
            zone = _create_calc_vol(data, room)
        else:
            raise HTTPException(status_code=400, detail=f"Unknown zone type: {type(data)}")

        # Add to room
        room.add_calc_zone(zone)
        room.update_timestamp()
        save_rooms(room_store)

        logger.info(f"Created zone {zone.zone_id} in room {room_id}")
        return _zone_to_response(zone)

    except Exception as e:
        logger.error(f"Failed to create zone: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@calc_zone_router.get("/rooms/{room_id}/zones/{zone_id}", response_model=CalcZoneResponse)
def get_zone(room_id: str, zone_id: str):
    """Get a specific calculation zone"""
    room = room_store.get(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    zone = room.calc_zones.get(zone_id)
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")

    return _zone_to_response(zone)


@calc_zone_router.patch("/rooms/{room_id}/zones/{zone_id}", response_model=CalcZoneResponse)
def update_zone(room_id: str, zone_id: str, data: CalcZoneUpdate):
    """Update a calculation zone's properties"""
    room = room_store.get(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    zone = room.calc_zones.get(zone_id)
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")

    # Update only provided fields
    if data.name is not None:
        zone.name = data.name
    if data.enabled is not None:
        zone.enabled = data.enabled
    if data.dose is not None:
        zone.dose = data.dose
    if data.hours is not None:
        zone.hours = data.hours
    if data.show_values is not None:
        zone.show_values = data.show_values
    if data.colormap is not None:
        zone.colormap = data.colormap

    # Plane-specific updates
    if isinstance(zone, CalcPlane):
        if data.fov_vert is not None:
            zone.fov_vert = data.fov_vert
        if data.fov_horiz is not None:
            zone.fov_horiz = data.fov_horiz
        if data.vert is not None:
            zone.vert = data.vert
        if data.horiz is not None:
            zone.horiz = data.horiz
        if data.use_normal is not None:
            zone.use_normal = data.use_normal

    room.update_timestamp()
    save_rooms(room_store)

    return _zone_to_response(zone)


@calc_zone_router.delete("/rooms/{room_id}/zones/{zone_id}")
def delete_zone(room_id: str, zone_id: str):
    """Delete a calculation zone from a room"""
    room = room_store.get(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    if zone_id not in room.calc_zones:
        raise HTTPException(status_code=404, detail="Zone not found")

    del room.calc_zones[zone_id]
    room.update_timestamp()
    save_rooms(room_store)

    logger.info(f"Deleted zone {zone_id} from room {room_id}")
    return {"message": f"Zone {zone_id} deleted"}


@calc_zone_router.post("/rooms/{room_id}/zones/standard")
def add_standard_zones(room_id: str):
    """Add the standard calculation zones (WholeRoomFluence, EyeLimits, SkinLimits)"""
    room = room_store.get(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    try:
        room.add_standard_zones()
        room.update_timestamp()
        save_rooms(room_store)

        return {
            "message": "Standard zones added",
            "zones": [_zone_to_response(zone) for zone in room.calc_zones.values()]
        }
    except Exception as e:
        logger.error(f"Failed to add standard zones: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@calc_zone_router.get("/rooms/{room_id}/zones/{zone_id}/visualization")
def get_zone_visualization(room_id: str, zone_id: str):
    """Get visualization data for a calculation zone.

    Returns coords for dot visualization (when values=None) or
    coords + values for heatmap visualization (when calculated).
    """
    room = room_store.get(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    zone = room.calc_zones.get(zone_id)
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")

    is_plane = isinstance(zone, CalcPlane)

    # Get coords - shape is (N, 3) for planes, (N, 3) for volumes
    coords = zone.coords  # numpy array

    response = {
        "zone_id": zone.zone_id,
        "zone_type": "plane" if is_plane else "volume",
        "has_values": zone.values is not None,
        "coords": coords.tolist(),  # [[x, y, z], ...]
    }

    if zone.values is not None:
        if is_plane:
            # For planes, reshape values to 2D grid for heatmap
            num_points = zone.geometry.num_points  # (num_x, num_y)
            values_2d = zone.values.reshape(num_points)
            response["values"] = values_2d.tolist()
            response["num_points"] = list(num_points)
            # Also provide the x, y, z grids for surface plotting
            x, y, z = coords.T.reshape(3, *num_points)
            response["x_grid"] = x.tolist()
            response["y_grid"] = y.tolist()
            response["z_grid"] = z.tolist()
        else:
            # For volumes, just return flat values
            response["values"] = zone.values.tolist()

    return response
