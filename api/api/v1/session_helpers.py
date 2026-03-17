"""Shared helpers for session router modules.

Contains dependency injection (session/auth), common helper functions,
and shared constants used across session_core, lamp, zone, and
calculation routers.
"""

import os
import re
import logging

from fastapi import HTTPException, UploadFile, Header, Depends
from typing import Optional, Dict, Any, Annotated

from guv_calcs import WHOLE_ROOM_FLUENCE, EYE_LIMITS, SKIN_LIMITS
from guv_calcs.lamp import Lamp
from guv_calcs.room import Room
from guv_calcs import SurfaceGrid, VolumeGrid
from guv_calcs.calc_zone import CalcPlane, CalcVol, CalcPoint
from guv_calcs.geometry import GridPoint

from .session_manager import Session, get_session_manager

logger = logging.getLogger(__name__)

# Allow skipping auth in development for easier testing
DEV_MODE = os.getenv("DEV_MODE", "false").lower() == "true"

# Target species for disinfection table
TARGET_SPECIES = ["Human coronavirus", "Influenza virus", "Staphylococcus aureus"]


# ============================================================
# Dependency Injection
# ============================================================

def get_session_id(
    x_session_id: Annotated[Optional[str], Header(alias="X-Session-ID")] = None
) -> str:
    """Extract session ID from header."""
    if not x_session_id:
        raise HTTPException(
            status_code=400,
            detail="Missing X-Session-ID header. Initialize a session first."
        )
    return x_session_id


SessionIdDep = Annotated[str, Depends(get_session_id)]


def _validate_session_token(session: Session, session_id: str, authorization: Optional[str]) -> None:
    """Validate the Bearer token for an existing session.

    Raises HTTPException on failure.  No-ops in DEV_MODE.
    """
    if DEV_MODE:
        logger.debug(f"DEV_MODE: Skipping token validation for session {session_id[:8]}...")
        return

    if not session.token_hash:
        logger.warning(f"Session {session_id[:8]}... has no token_hash (legacy session)")
        raise HTTPException(
            status_code=401,
            detail="Session requires re-authentication. Please refresh the page."
        )

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authorization token required")

    token = authorization.replace("Bearer ", "")
    if not session.verify_token(token):
        raise HTTPException(status_code=401, detail="Invalid session token")


def get_session(
    session_id: SessionIdDep,
    authorization: Annotated[Optional[str], Header()] = None
) -> Session:
    """Get the session for the current request with token validation."""
    manager = get_session_manager()
    session = manager.get_session(session_id, auto_create=False)
    if session is None:
        raise HTTPException(
            status_code=404,
            detail="Session not found. Initialize a session first with POST /session/init"
        )
    _validate_session_token(session, session_id, authorization)
    return session


def get_or_create_session(
    session_id: SessionIdDep,
    authorization: Annotated[Optional[str], Header()] = None
) -> Session:
    """Get or create a session (used by /session/init)."""
    manager = get_session_manager()
    session = manager.get_session(session_id, auto_create=False)
    if session is None:
        return manager.get_or_create(session_id)
    _validate_session_token(session, session_id, authorization)
    return session


def require_initialized_session(session: Session = Depends(get_session)) -> Session:
    """Require that the session has an initialized Project."""
    if session.project is None:
        raise HTTPException(
            status_code=400,
            detail="No active session. Call POST /session/init first."
        )
    return session


SessionDep = Annotated[Session, Depends(get_session)]
InitializedSessionDep = Annotated[Session, Depends(require_initialized_session)]
SessionCreateDep = Annotated[Session, Depends(get_or_create_session)]


# ============================================================
# Common Helpers
# ============================================================

def _log_and_raise(operation: str, e: Exception, status_code: int = 400) -> None:
    """Log error details server-side and raise a generic HTTPException."""
    logger.error(f"{operation}: {e}")
    raise HTTPException(status_code=status_code, detail=f"{operation}")


def _get_lamp_or_404(session: Session, lamp_id: str) -> Lamp:
    """Get a lamp from the session's lamp_id_map or raise 404."""
    lamp = session.lamp_id_map.get(lamp_id)
    if lamp is None:
        raise HTTPException(status_code=404, detail=f"Lamp {lamp_id} not found")
    return lamp


def _get_zone_or_404(session: Session, zone_id: str):
    """Get a zone from the session's zone_id_map or raise 404."""
    zone = session.zone_id_map.get(zone_id)
    if zone is None:
        raise HTTPException(status_code=404, detail=f"Zone {zone_id} not found")
    return zone


async def _read_and_validate_upload(
    file: UploadFile, max_size: int, validator_fn=None
) -> bytes:
    """Read an uploaded file with size validation and optional content validation."""
    if file.size and file.size > max_size:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum size is {max_size // 1024} KB"
        )
    data = await file.read(max_size + 1)
    if len(data) > max_size:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum size is {max_size // 1024} KB"
        )
    if validator_fn is not None and not validator_fn(data):
        raise HTTPException(
            status_code=400,
            detail="Invalid file format"
        )
    return data


def _get_state_hashes(session: Session) -> Dict[str, Any]:
    """Compute current state hashes from a session's room."""
    room = session.room
    return {
        "calc_state": room.get_calc_state(),
        "update_state": room.get_update_state(),
    }


def _sanitize_filename(name: str) -> str:
    """Sanitize a string for use in Content-Disposition filename."""
    sanitized = re.sub(r'[^\w\s\-.]', '_', name)
    sanitized = re.sub(r'[_\s]+', '_', sanitized)
    sanitized = sanitized.strip('_ ')
    return sanitized or 'export'


def _standard_to_label(standard) -> str:
    """Convert guv_calcs PhotStandard to its canonical label."""
    return getattr(standard, 'label', str(standard))


def _decompose_time(zone):
    """Decompose zone exposure_time timedelta into h/m/s."""
    total = zone.exposure_time.total_seconds()
    h = int(total // 3600)
    remaining = total - h * 3600
    m = int(remaining // 60)
    s = remaining - m * 60
    s = round(s, 6)
    return h, m, s


def _create_lamp_from_input(lamp_input, units=None) -> Lamp:
    """Create a guv_calcs Lamp from session input"""
    from guv_calcs.lamp.lamp_type import GUVType as _GUVType

    id_kwarg = {"lamp_id": lamp_input.id} if lamp_input.id is not None else {}
    units_kwarg = {"units": units} if units is not None else {}

    logger.info(f"Creating lamp: id={lamp_input.id}, preset_id={lamp_input.preset_id!r}, lamp_type={lamp_input.lamp_type}")

    if lamp_input.preset_id and lamp_input.preset_id != "custom" and lamp_input.preset_id != "":
        logger.info(f"Using Lamp.from_keyword with preset: {lamp_input.preset_id}")
        lamp = Lamp.from_keyword(
            lamp_input.preset_id,
            **id_kwarg,
            **units_kwarg,
            x=lamp_input.x,
            y=lamp_input.y,
            z=lamp_input.z,
            angle=lamp_input.angle,
            aimx=lamp_input.aimx,
            aimy=lamp_input.aimy,
            aimz=lamp_input.aimz,
            scaling_factor=lamp_input.scaling_factor,
        )
        lamp.preset_id = lamp_input.preset_id
        logger.info(f"Created preset lamp: has_ies={lamp.ies is not None}")
    elif lamp_input.lamp_type == "other":
        wavelength = lamp_input.wavelength
        if wavelength is None:
            raise HTTPException(
                status_code=400,
                detail="wavelength is required for 'other' lamp type"
            )
        logger.info(f"Using plain Lamp() constructor for 'other' type (wavelength={wavelength})")
        lamp = Lamp(
            **id_kwarg,
            **units_kwarg,
            x=lamp_input.x,
            y=lamp_input.y,
            z=lamp_input.z,
            wavelength=wavelength,
            angle=lamp_input.angle,
            aimx=lamp_input.aimx,
            aimy=lamp_input.aimy,
            aimz=lamp_input.aimz,
            scaling_factor=lamp_input.scaling_factor,
        )
        logger.info(f"Created 'other' lamp: wavelength={wavelength}, has_ies={lamp.ies is not None}")
    else:
        wavelength = 222 if lamp_input.lamp_type == "krcl_222" else 254
        guv_type = "KRCL" if lamp_input.lamp_type == "krcl_222" else "LPHG"
        logger.info(f"Using plain Lamp() constructor (no preset)")
        lamp = Lamp(
            **id_kwarg,
            **units_kwarg,
            x=lamp_input.x,
            y=lamp_input.y,
            z=lamp_input.z,
            wavelength=wavelength,
            guv_type=guv_type,
            angle=lamp_input.angle,
            aimx=lamp_input.aimx,
            aimy=lamp_input.aimy,
            aimz=lamp_input.aimz,
            scaling_factor=lamp_input.scaling_factor,
        )
        logger.info(f"Created custom lamp: has_ies={lamp.ies is not None}")

    lamp.enabled = lamp_input.enabled
    if lamp_input.name is not None:
        lamp.name = lamp_input.name
    lamp._frontend_lamp_type = lamp_input.lamp_type
    return lamp


def _create_zone_from_input(zone_input, room: Room):
    """Create a guv_calcs CalcPlane or CalcVol from session input."""
    if zone_input.id in (EYE_LIMITS, SKIN_LIMITS, WHOLE_ROOM_FLUENCE):
        room.add_standard_zones(on_collision="overwrite")
        zone = room.calc_zones.get(zone_input.id)
        if zone is not None:
            zone.enabled = zone_input.enabled
            if hasattr(zone_input, 'display_mode') and zone_input.display_mode is not None:
                zone.display_mode = zone_input.display_mode
            return zone
        logger.warning(f"add_standard_zones() did not create {zone_input.id}, falling back to manual creation")

    if zone_input.type == "plane":
        x1_val = zone_input.x1 if zone_input.x1 is not None else 0
        x2_val = zone_input.x2 if zone_input.x2 is not None else room.x
        x1_val, x2_val = min(x1_val, x2_val), max(x1_val, x2_val)
        y1_val = zone_input.y1 if zone_input.y1 is not None else 0
        y2_val = zone_input.y2 if zone_input.y2 is not None else room.y
        y1_val, y2_val = min(y1_val, y2_val), max(y1_val, y2_val)

        grid_kwargs = {}
        if zone_input.num_x is not None and zone_input.num_y is not None:
            grid_kwargs["num_points_init"] = (zone_input.num_x, zone_input.num_y)
        elif zone_input.x_spacing is not None and zone_input.y_spacing is not None:
            grid_kwargs["spacing_init"] = (zone_input.x_spacing, zone_input.y_spacing)
        if zone_input.offset is not None:
            grid_kwargs["offset"] = zone_input.offset

        geometry = SurfaceGrid.from_legacy(
            mins=(x1_val, y1_val),
            maxs=(x2_val, y2_val),
            height=zone_input.height if zone_input.height is not None else 1.0,
            ref_surface=zone_input.ref_surface if zone_input.ref_surface is not None else "xy",
            direction=zone_input.direction if zone_input.direction not in (None, 0) else 1,
            **grid_kwargs,
        )
        zone = CalcPlane(
            zone_id=zone_input.id,
            name=zone_input.name,
            geometry=geometry,
            calc_mode=zone_input.calc_mode,
            horiz=zone_input.horiz,
            vert=zone_input.vert,
            fov_vert=zone_input.fov_vert,
            fov_horiz=zone_input.fov_horiz,
            use_normal=zone_input.direction != 0 if zone_input.direction is not None else None,
            view_direction=zone_input.view_direction,
            view_target=zone_input.view_target,
            dose=zone_input.dose,
            hours=zone_input.hours, minutes=zone_input.minutes, seconds=zone_input.seconds,
        )
    elif zone_input.type == "point":
        position = (
            zone_input.x if zone_input.x is not None else room.x / 2,
            zone_input.y if zone_input.y is not None else room.y / 2,
            zone_input.z if zone_input.z is not None else 1.0,
        )
        aim_point = (
            zone_input.aim_x if zone_input.aim_x is not None else position[0],
            zone_input.aim_y if zone_input.aim_y is not None else position[1],
            zone_input.aim_z if zone_input.aim_z is not None else position[2] + 1.0,
        )
        zone = CalcPoint.at(
            position=position,
            aim_point=aim_point,
            zone_id=zone_input.id,
            name=zone_input.name,
            horiz=zone_input.horiz if zone_input.horiz is not None else True,
            vert=zone_input.vert if zone_input.vert is not None else False,
            use_normal=True,
            fov_vert=zone_input.fov_vert if zone_input.fov_vert is not None else 180,
            fov_horiz=zone_input.fov_horiz if zone_input.fov_horiz is not None else 360,
            dose=zone_input.dose,
            hours=zone_input.hours, minutes=zone_input.minutes, seconds=zone_input.seconds,
        )
    elif zone_input.type == "volume":
        x1_val = zone_input.x_min if zone_input.x_min is not None else 0
        x2_val = zone_input.x_max if zone_input.x_max is not None else room.x
        x1_val, x2_val = min(x1_val, x2_val), max(x1_val, x2_val)
        y1_val = zone_input.y_min if zone_input.y_min is not None else 0
        y2_val = zone_input.y_max if zone_input.y_max is not None else room.y
        y1_val, y2_val = min(y1_val, y2_val), max(y1_val, y2_val)
        z1_val = zone_input.z_min if zone_input.z_min is not None else 0
        z2_val = zone_input.z_max if zone_input.z_max is not None else room.z
        z1_val, z2_val = min(z1_val, z2_val), max(z1_val, z2_val)

        grid_kwargs = {}
        if zone_input.num_x is not None and zone_input.num_y is not None and zone_input.num_z is not None:
            grid_kwargs["num_points_init"] = (zone_input.num_x, zone_input.num_y, zone_input.num_z)
        elif zone_input.x_spacing is not None and zone_input.y_spacing is not None and zone_input.z_spacing is not None:
            grid_kwargs["spacing_init"] = (zone_input.x_spacing, zone_input.y_spacing, zone_input.z_spacing)
        if zone_input.offset is not None:
            grid_kwargs["offset"] = zone_input.offset

        geometry = VolumeGrid.from_legacy(
            mins=(x1_val, y1_val, z1_val),
            maxs=(x2_val, y2_val, z2_val),
            **grid_kwargs,
        )
        zone = CalcVol(
            zone_id=zone_input.id, name=zone_input.name,
            geometry=geometry,
            dose=zone_input.dose,
            hours=zone_input.hours, minutes=zone_input.minutes, seconds=zone_input.seconds,
        )
    else:
        raise HTTPException(status_code=400, detail=f"Unknown zone type: {zone_input.type}")

    zone.enabled = zone_input.enabled
    if hasattr(zone_input, 'display_mode') and zone_input.display_mode is not None:
        zone.display_mode = zone_input.display_mode
    return zone


def _lamp_to_loaded(lamp, lamp_id: str):
    """Convert a guv_calcs Lamp to LoadedLamp response"""
    import numpy as np
    from .session_schemas import LoadedLamp

    lamp_type = "krcl_222" if getattr(lamp, 'wavelength', 222) == 222 else "lp_254"

    return LoadedLamp(
        id=lamp_id,
        lamp_type=lamp_type,
        preset_id=getattr(lamp, 'preset_id', None),
        name=getattr(lamp, 'name', None),
        x=lamp.x, y=lamp.y, z=lamp.z,
        angle=getattr(lamp, 'angle', 0.0),
        aimx=lamp.aimx, aimy=lamp.aimy, aimz=lamp.aimz,
        tilt=getattr(lamp, 'bank', 0.0),
        orientation=getattr(lamp, 'heading', 0.0),
        scaling_factor=lamp.scaling_factor,
        enabled=getattr(lamp, 'enabled', True),
    )


def _zone_to_loaded(zone, zone_id: str):
    """Convert a guv_calcs CalcPlane/CalcVol to LoadedZone response"""
    import numpy as np
    from .session_schemas import LoadedZone

    if isinstance(zone, CalcPlane):
        zone_type = "plane"
    elif isinstance(zone, CalcPoint):
        zone_type = "point"
    else:
        zone_type = "volume"

    h, m, s = _decompose_time(zone)
    loaded = LoadedZone(
        id=zone_id,
        name=getattr(zone, 'name', None),
        type=zone_type,
        enabled=getattr(zone, 'enabled', True),
        is_standard=zone_id in (EYE_LIMITS, SKIN_LIMITS, WHOLE_ROOM_FLUENCE),
        num_x=getattr(zone, 'num_x', None),
        num_y=getattr(zone, 'num_y', None),
        x_spacing=getattr(zone, 'x_spacing', None),
        y_spacing=getattr(zone, 'y_spacing', None),
        offset=getattr(zone, 'offset', None),
        dose=getattr(zone, 'dose', None),
        hours=h, minutes=m, seconds=s,
        display_mode=getattr(zone, 'display_mode', 'heatmap'),
    )

    if zone_type == "plane":
        loaded.calc_mode = zone.calc_mode
        loaded.height = getattr(zone, 'height', None)
        loaded.x1 = getattr(zone, 'x1', None)
        loaded.x2 = getattr(zone, 'x2', None)
        loaded.y1 = getattr(zone, 'y1', None)
        loaded.y2 = getattr(zone, 'y2', None)
        loaded.ref_surface = getattr(zone, 'ref_surface', None)
        loaded.direction = getattr(zone, 'direction', None)
        loaded.horiz = getattr(zone, 'horiz', None)
        loaded.vert = getattr(zone, 'vert', None)
        loaded.fov_vert = getattr(zone, 'fov_vert', None)
        loaded.fov_horiz = getattr(zone, 'fov_horiz', None)
        loaded.view_direction = getattr(zone, 'view_direction', None)
        loaded.view_target = getattr(zone, 'view_target', None)
        v_hat = getattr(zone.geometry, 'v_hat', None)
        if v_hat is not None:
            abs_v = np.abs(v_hat)
            v_idx = int(np.argmax(abs_v))
            loaded.v_positive_direction = bool(v_hat[v_idx] > 0)
    elif zone_type == "point":
        loaded.x = zone.geometry.position[0]
        loaded.y = zone.geometry.position[1]
        loaded.z = zone.geometry.position[2]
        loaded.aim_x = zone.geometry.aim_point[0]
        loaded.aim_y = zone.geometry.aim_point[1]
        loaded.aim_z = zone.geometry.aim_point[2]
        loaded.horiz = getattr(zone, 'horiz', None)
        loaded.vert = getattr(zone, 'vert', None)
        loaded.fov_vert = getattr(zone, 'fov_vert', None)
        loaded.fov_horiz = getattr(zone, 'fov_horiz', None)
        loaded.calc_mode = getattr(zone, 'calc_mode', None)
    else:
        loaded.num_z = getattr(zone, 'num_z', None)
        loaded.z_spacing = getattr(zone, 'z_spacing', None)
        loaded.x_min = getattr(zone, 'x1', None)
        loaded.x_max = getattr(zone, 'x2', None)
        loaded.y_min = getattr(zone, 'y1', None)
        loaded.y_max = getattr(zone, 'y2', None)
        loaded.z_min = getattr(zone, 'z1', None)
        loaded.z_max = getattr(zone, 'z2', None)

    return loaded


