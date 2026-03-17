"""
Session Core - Session lifecycle and room configuration endpoints.

Handles session creation, initialization, unit conversion, room updates,
state hashes, and status queries.
"""

import uuid as uuid_module
import logging
from math import prod

from fastapi import APIRouter, HTTPException

from guv_calcs import WHOLE_ROOM_FLUENCE, EYE_LIMITS, SKIN_LIMITS
from guv_calcs.project import Project
from guv_calcs.calc_zone import CalcPlane, CalcVol, CalcPoint

from .session_manager import Session, get_session_manager
from .session_helpers import (
    SessionDep,
    InitializedSessionDep,
    SessionCreateDep,
    _log_and_raise,
    _get_state_hashes,
    _create_lamp_from_input,
    _create_zone_from_input,
)
from .session_schemas import (
    SessionInitRequest,
    SessionInitResponse,
    SessionCreateResponse,
    SessionRoomUpdate,
    SetUnitsRequest,
    SetUnitsLampCoords,
    SetUnitsZoneCoords,
    SetUnitsResponse,
    SuccessResponse,
    StateHashesResponse,
    SurfaceInfo,
    ReflectanceSurfacesResponse,
)
from guv_calcs.performance import BYTES_PER_FORM_FACTOR_ENTRY, REFLECTANCE_OVERHEAD

from .resource_limits import (
    estimate_session_cost,
    check_budget,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================
# Session Creation Endpoint
# ============================================================

@router.post("/create", response_model=SessionCreateResponse)
def create_new_session():
    """
    Create a new session with server-generated credentials.

    This endpoint generates both the session ID and authentication token.
    The token must be included in subsequent requests as a Bearer token
    in the Authorization header.

    Returns:
        session_id: The unique session identifier (for X-Session-ID header)
        token: The authentication token (for Authorization: Bearer header)
    """
    session_id = str(uuid_module.uuid4())
    token = Session.generate_token()
    token_hash = Session.hash_token(token)

    session_manager = get_session_manager()
    session_manager.create_session(session_id, token_hash=token_hash)
    logger.info(f"Created new authenticated session: {session_id[:8]}...")

    return SessionCreateResponse(session_id=session_id, token=token)


# ============================================================
# Session Initialization
# ============================================================

@router.post("/init", response_model=SessionInitResponse)
def init_session(request: SessionInitRequest, session: SessionCreateDep):
    """
    Initialize a new session Room from frontend state.

    This creates the source of truth Room for this session that will be mutated
    by subsequent PATCH/POST/DELETE calls. Any existing Room in this session is replaced.

    Requires X-Session-ID header.
    """
    try:
        logger.info(f"Initializing session {session.id[:8]}...: room={request.room.x}x{request.room.y}x{request.room.z}, "
                    f"lamps={len(request.lamps)}, zones={len(request.zones)}")

        # Create Project with project-level defaults
        project_kwargs = dict(
            units=request.room.units,
            precision=request.room.precision,
            standard=request.room.standard,
            enable_reflectance=request.room.enable_reflectance,
            colormap=request.room.colormap,
        )
        if request.room.reflectance_max_num_passes is not None:
            project_kwargs["reflectance_max_num_passes"] = request.room.reflectance_max_num_passes
        if request.room.reflectance_threshold is not None:
            project_kwargs["reflectance_threshold"] = request.room.reflectance_threshold
        project = Project(**project_kwargs)

        # Create Room via project with room-specific params
        project.create_room(
            x=request.room.x,
            y=request.room.y,
            z=request.room.z,
            air_changes=request.room.air_changes,
            ozone_decay_constant=request.room.ozone_decay_constant,
        )
        session.project = project

        # Always apply reflectance values so they're ready if reflectance is
        # enabled later via PATCH (the enabled flag controls whether the
        # calculation runs, but R values must already be on the surfaces)
        if request.room.reflectances:
            for wall, R_value in request.room.reflectances.model_dump().items():
                session.room.set_reflectance(R_value, wall_id=wall)

        # Apply per-surface reflectance spacings
        if request.room.reflectance_x_spacings or request.room.reflectance_y_spacings:
            x_spacings = request.room.reflectance_x_spacings or {}
            y_spacings = request.room.reflectance_y_spacings or {}
            all_surfaces = set(x_spacings.keys()) | set(y_spacings.keys())
            for surface in all_surfaces:
                session.room.set_reflectance_spacing(
                    x_spacing=x_spacings.get(surface),
                    y_spacing=y_spacings.get(surface),
                    wall_id=surface,
                )

        # Apply per-surface reflectance num_points
        if request.room.reflectance_x_num_points or request.room.reflectance_y_num_points:
            x_num_points = request.room.reflectance_x_num_points or {}
            y_num_points = request.room.reflectance_y_num_points or {}
            all_surfaces = set(x_num_points.keys()) | set(y_num_points.keys())
            for surface in all_surfaces:
                session.room.set_reflectance_num_points(
                    num_x=x_num_points.get(surface),
                    num_y=y_num_points.get(surface),
                    wall_id=surface,
                )

        # Clear ID maps
        session.lamp_id_map = {}
        session.zone_id_map = {}

        # Add lamps
        for lamp_input in request.lamps:
            lamp = _create_lamp_from_input(lamp_input, units=session.room.units)
            lamp.set_units(session.room.units)
            session.room.add_lamp(lamp)
            session.lamp_id_map[lamp.lamp_id] = lamp
            logger.debug(f"Added lamp {lamp.lamp_id} (preset={lamp_input.preset_id})")

        # Add zones
        for zone_input in request.zones:
            zone = _create_zone_from_input(zone_input, session.room)
            # Standard zones are already added by room.add_standard_zones()
            # inside _create_zone_from_input; only add non-standard zones here
            if zone.id not in session.room.calc_zones:
                session.room.add_calc_zone(zone)
            session.zone_id_map[zone.id] = zone
            logger.debug(f"Added zone {zone.id} (type={zone_input.type})")

        # Refresh zone_id_map from room.calc_zones so all references
        # are current (add_standard_zones replaces zone objects).
        for zid, zobj in session.room.calc_zones.items():
            session.zone_id_map[zid] = zobj

        logger.info(f"Session {session.id[:8]}... initialized successfully")

        return SessionInitResponse(
            success=True,
            message="Session initialized",
            lamp_count=len(session.lamp_id_map),
            zone_count=len(session.zone_id_map),
        )

    except Exception as e:
        _log_and_raise("Failed to initialize session", e)


# ============================================================
# Unit Conversion Endpoint
# ============================================================

@router.patch("/units", response_model=SetUnitsResponse)
def set_session_units(request: SetUnitsRequest, session: InitializedSessionDep):
    """
    Change the unit system for the session.

    Calls room.set_units() which permanently converts all dimensions
    (room, lamps, zones) to the new unit system.

    Returns all converted coordinates so the frontend can update its stores.

    Requires X-Session-ID header.
    """
    try:
        current_units = str(session.room.units)
        if current_units == request.units:
            # No conversion needed — just return current values
            pass
        else:
            session.room.set_units(request.units)
            session.project.units = request.units
            logger.info(f"Converted session units from {current_units} to {request.units}")

        # Build response with all converted coordinates
        room_coords = {
            "x": session.room.x,
            "y": session.room.y,
            "z": session.room.z,
        }

        lamp_coords = {}
        for lamp_id, lamp in session.room.lamps.items():
            lamp_coords[lamp_id] = SetUnitsLampCoords(
                x=lamp.position[0],
                y=lamp.position[1],
                z=lamp.position[2],
                aimx=lamp.aim_point[0],
                aimy=lamp.aim_point[1],
                aimz=lamp.aim_point[2],
                source_width=lamp.width,
                source_length=lamp.length,
                source_depth=lamp.surface.height if hasattr(lamp, 'surface') else None,
                housing_width=lamp.fixture.housing_width if lamp.fixture and lamp.fixture.housing_width > 0 else None,
                housing_length=lamp.fixture.housing_length if lamp.fixture and lamp.fixture.housing_length > 0 else None,
                housing_height=lamp.fixture.housing_height if lamp.fixture and lamp.fixture.housing_height > 0 else None,
            )

        zone_coords = {}
        for zone_id, zone in session.room.calc_zones.items():
            if isinstance(zone, CalcPlane):
                zone_coords[zone_id] = SetUnitsZoneCoords(
                    height=zone.height,
                    x1=zone.x1,
                    x2=zone.x2,
                    y1=zone.y1,
                    y2=zone.y2,
                    x_spacing=zone.x_spacing,
                    y_spacing=zone.y_spacing,
                )
            elif isinstance(zone, CalcPoint):
                zone_coords[zone_id] = SetUnitsZoneCoords(
                    x=zone.position[0],
                    y=zone.position[1],
                    z=zone.position[2],
                    aim_x=zone.aim_point[0],
                    aim_y=zone.aim_point[1],
                    aim_z=zone.aim_point[2],
                )
            elif isinstance(zone, CalcVol):
                zone_coords[zone_id] = SetUnitsZoneCoords(
                    x_min=zone.x1,
                    x_max=zone.x2,
                    y_min=zone.y1,
                    y_max=zone.y2,
                    z_min=zone.z1,
                    z_max=zone.z2,
                    x_spacing=zone.x_spacing,
                    y_spacing=zone.y_spacing,
                    z_spacing=zone.z_spacing,
                )

        # Build reflectance spacings if surfaces exist
        reflectance_spacings = None
        if hasattr(session.room, 'surfaces') and session.room.surfaces:
            reflectance_spacings = {
                name: {"x": surf.x_spacing, "y": surf.y_spacing}
                for name, surf in session.room.surfaces.items()
            }

        return SetUnitsResponse(
            success=True,
            units=request.units,
            room=room_coords,
            lamps=lamp_coords,
            zones=zone_coords,
            reflectance_spacings=reflectance_spacings,
            state_hashes=_get_state_hashes(session),
        )

    except Exception as e:
        _log_and_raise("Failed to set units", e)


# ============================================================
# Room Configuration
# ============================================================

@router.patch("/room", response_model=SuccessResponse)
def update_session_room(updates: SessionRoomUpdate, session: InitializedSessionDep):
    """
    Update room configuration properties.

    Only provided fields are updated. Room dimensions, units, and other
    settings can be changed without recreating the entire Room.

    Requires X-Session-ID header.
    """
    try:
        # If enabling reflectance, check budget impact first
        # Note: room.enable_reflectance is a method, ref_manager.enabled is the actual state
        if updates.enable_reflectance and not session.room.ref_manager.enabled:
            # Estimate memory cost of enabling reflectance:
            # form factors scale as refl_points² × 8 bytes
            refl_points = sum(
                prod(s.plane.num_points) for s in session.room.surfaces.values()
            )
            # Estimate additional memory: overhead + form factor cache
            # (simplified: assumes zone_points ≈ refl_points for pre-flight check)
            refl_memory_mb = (
                REFLECTANCE_OVERHEAD
                + refl_points ** 2 * BYTES_PER_FORM_FACTOR_ENTRY
            ) / 1_000_000
            check_budget(session, additional_memory_mb=refl_memory_mb)

        # units changes are handled by PATCH /session/units, not here
        if updates.x is not None or updates.y is not None or updates.z is not None:
            session.room.set_dimensions(x=updates.x, y=updates.y, z=updates.z)
        if updates.precision is not None:
            session.room.precision = updates.precision
        if updates.colormap is not None:
            session.room.set_colormap(updates.colormap)
        if updates.standard is not None:
            session.room.set_standard(updates.standard)
        if updates.enable_reflectance is not None:
            # enable_reflectance is a method, not a property - call it with the value
            session.room.enable_reflectance(updates.enable_reflectance)
        if updates.reflectances is not None:
            for wall, R_value in updates.reflectances.model_dump().items():
                session.room.set_reflectance(R_value, wall_id=wall)
        if updates.reflectance_max_num_passes is not None:
            session.room.set_max_num_passes(updates.reflectance_max_num_passes)
        if updates.reflectance_threshold is not None:
            session.room.set_reflectance_threshold(updates.reflectance_threshold)
        if updates.reflectance_x_spacings or updates.reflectance_y_spacings:
            x_spacings = updates.reflectance_x_spacings or {}
            y_spacings = updates.reflectance_y_spacings or {}
            all_surfaces = set(x_spacings.keys()) | set(y_spacings.keys())
            for surface in all_surfaces:
                session.room.set_reflectance_spacing(
                    x_spacing=x_spacings.get(surface),
                    y_spacing=y_spacings.get(surface),
                    wall_id=surface,
                )
        if updates.reflectance_x_num_points or updates.reflectance_y_num_points:
            x_num_points = updates.reflectance_x_num_points or {}
            y_num_points = updates.reflectance_y_num_points or {}
            all_surfaces = set(x_num_points.keys()) | set(y_num_points.keys())
            for surface in all_surfaces:
                session.room.set_reflectance_num_points(
                    num_x=x_num_points.get(surface),
                    num_y=y_num_points.get(surface),
                    wall_id=surface,
                )
        if updates.air_changes is not None:
            session.room.air_changes = updates.air_changes
        if updates.ozone_decay_constant is not None:
            session.room.ozone_decay_constant = updates.ozone_decay_constant

        logger.debug(f"Updated room: {updates.model_dump(exclude_none=True)}")
        return SuccessResponse(success=True, message="Room updated", state_hashes=_get_state_hashes(session))

    except Exception as e:
        _log_and_raise("Failed to update room", e)


# ============================================================
# State & Status
# ============================================================

@router.get("/state-hashes", response_model=StateHashesResponse)
def get_state_hashes(session: InitializedSessionDep):
    """
    Return current state hashes from room.get_calc_state() and room.get_update_state().

    The frontend uses these to detect when parameters have changed since the last
    calculation, enabling granular staleness detection per-zone.

    Requires X-Session-ID header.
    """
    room = session.room
    return StateHashesResponse(
        calc_state=room.get_calc_state(),
        update_state=room.get_update_state(),
    )


@router.get("/room/surfaces", response_model=ReflectanceSurfacesResponse)
def get_room_surfaces(session: InitializedSessionDep):
    """
    Return per-surface reflectance grid info (spacing and num_points).

    Used by the ReflectanceSettingsModal to show the backend's actual
    surface resolution rather than frontend defaults.

    Requires X-Session-ID header.
    """
    surfaces = {}
    for name, surf in session.room.surfaces.items():
        surfaces[name] = SurfaceInfo(
            x_spacing=surf.x_spacing,
            y_spacing=surf.y_spacing,
            num_x=surf.plane.num_points[0],
            num_y=surf.plane.num_points[1],
        )
    return ReflectanceSurfacesResponse(surfaces=surfaces)


@router.get("/status")
def get_session_status(session: SessionDep):
    """Get current session status for debugging.

    Requires X-Session-ID header.
    """
    if session.room is None:
        return {
            "active": False,
            "session_id": session.id,
            "message": "Session exists but not initialized"
        }

    return {
        "active": True,
        "session_id": session.id,
        "room": {
            "dimensions": [session.room.x, session.room.y, session.room.z],
            "units": session.room.units,
            "standard": session.room.standard,
        },
        "lamp_count": len(session.lamp_id_map),
        "zone_count": len(session.zone_id_map),
        "lamp_ids": list(session.lamp_id_map.keys()),
        "zone_ids": list(session.zone_id_map.keys()),
    }
