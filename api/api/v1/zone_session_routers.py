"""
Zone Session Routers - Zone CRUD, zone plots, and zone export endpoints.
"""

import io
import base64
import logging
from math import prod

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from guv_calcs import WHOLE_ROOM_FLUENCE, EYE_LIMITS, SKIN_LIMITS
from guv_calcs.calc_zone import CalcPlane, CalcVol, CalcPoint

from .utils import get_theme_colors, apply_theme

from .session_helpers import (
    InitializedSessionDep,
    _log_and_raise,
    _get_zone_or_404,
    _get_state_hashes,
    _sanitize_filename,
    _create_zone_from_input,
    _decompose_time,
)
from .session_schemas import (
    SessionZoneInput,
    SessionZoneUpdate,
    SessionZoneUpdateResponse,
    SessionZoneState,
    GetZonesResponse,
    AddZoneResponse,
    SuccessResponse,
)
from guv_calcs.performance import BYTES_PER_ZONE_POINT

from .resource_limits import check_budget

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/zones", response_model=AddZoneResponse)
def add_session_zone(zone: SessionZoneInput, session: InitializedSessionDep):
    """Add a new calculation zone to the session Room.

    Requires X-Session-ID header.
    """
    try:
        # Create zone first (cheap), then check budget before adding
        guv_zone = _create_zone_from_input(zone, session.room)
        new_zone_memory_mb = prod(guv_zone.num_points) * BYTES_PER_ZONE_POINT / 1_000_000
        check_budget(session, additional_memory_mb=new_zone_memory_mb)
        # Standard zones are already added by room.add_standard_zones()
        # inside _create_zone_from_input; only add non-standard zones here
        if zone.isStandard and guv_zone.id in session.room.calc_zones:
            pass  # already added by _create_zone_from_input
        else:
            session.room.add_calc_zone(guv_zone)
        # Read ID *after* add_calc_zone, since registry may have incremented it
        assigned_id = guv_zone.id
        session.zone_id_map[assigned_id] = guv_zone

        logger.debug(f"Added zone {assigned_id}")
        return AddZoneResponse(success=True, zone_id=assigned_id, state_hashes=_get_state_hashes(session))

    except Exception as e:
        _log_and_raise("Failed to add zone", e)


@router.patch("/zones/{zone_id}", response_model=SessionZoneUpdateResponse)
def update_session_zone(zone_id: str, updates: SessionZoneUpdate, session: InitializedSessionDep):
    """Update an existing zone's properties.

    If grid parameters are provided (num_x/num_y/num_z or x_spacing/y_spacing/z_spacing),
    the backend computes the complementary values and returns them in the response.
    This ensures the frontend displays authoritative values that match what calculation will use.

    Requires X-Session-ID header.
    """
    zone = _get_zone_or_404(session, zone_id)

    try:
        # Basic property updates
        if updates.name is not None:
            zone.name = updates.name
        if updates.enabled is not None:
            zone.enabled = updates.enabled
        if updates.dose is not None:
            zone.dose = updates.dose
        if updates.hours is not None or updates.minutes is not None or updates.seconds is not None:
            td = zone.exposure_time
            total = int(td.total_seconds())
            cur_h, cur_m, cur_s = total // 3600, (total % 3600) // 60, total % 60
            zone.set_dose_time(
                hours=updates.hours if updates.hours is not None else cur_h,
                minutes=updates.minutes if updates.minutes is not None else cur_m,
                seconds=updates.seconds if updates.seconds is not None else cur_s,
            )
        if updates.offset is not None:
            zone.set_offset(updates.offset)
        if updates.display_mode is not None:
            zone.display_mode = updates.display_mode

        # Calc mode update — delegates to guv_calcs PlaneCalcMode via
        # set_calc_mode(), which sets horiz/vert/use_normal/fov_vert/fov_horiz.
        # Direction is geometry (handled separately below).
        if updates.calc_mode is not None and isinstance(zone, CalcPlane):
            if updates.calc_mode != "custom":
                zone.set_calc_mode(updates.calc_mode)
            # Clear view params that don't apply to the new mode —
            # guv_calcs changes calculation behavior when these are non-None.
            if updates.calc_mode != "eye_directional":
                zone.view_direction = None
            if updates.calc_mode != "eye_target":
                zone.view_target = None

        # Plane-specific flag overrides (applied after calc_mode so they win)
        if updates.fov_vert is not None and hasattr(zone, 'fov_vert'):
            zone.fov_vert = updates.fov_vert
        if updates.fov_horiz is not None and hasattr(zone, 'fov_horiz'):
            zone.fov_horiz = updates.fov_horiz
        if updates.horiz is not None and hasattr(zone, 'horiz'):
            zone.horiz = updates.horiz
        if updates.vert is not None and hasattr(zone, 'vert'):
            zone.vert = updates.vert
        if updates.use_normal is not None and hasattr(zone, 'use_normal'):
            zone.use_normal = updates.use_normal

        # View params — mutually exclusive: setting one clears the other
        if updates.view_direction is not None and isinstance(zone, CalcPlane):
            zone.view_direction = updates.view_direction
            zone.view_target = None
        if updates.view_target is not None and isinstance(zone, CalcPlane):
            zone.view_target = updates.view_target
            zone.view_direction = None

        # Geometry dimension updates — use proper geometry methods instead of
        # direct attribute assignment, which would shadow read-only properties.
        # Frontend uses different field names for planes (x1/x2/y1/y2) vs
        # volumes (x_min/x_max/y_min/y_max/z_min/z_max), but guv_calcs uses
        # x1/x2/y1/y2/z1/z2 for both.
        if isinstance(zone, CalcPlane) and zone.geometry is not None:
            # Use guv_calcs set_* methods instead of manually rebuilding
            # PlaneGrid. This preserves correct direction vectors and avoids
            # the Y-coordinate flip bug caused by PlaneGrid.from_legacy().
            if any(v is not None for v in [updates.x1, updates.x2, updates.y1, updates.y2]):
                x1_val = updates.x1 if updates.x1 is not None else zone.x1
                x2_val = updates.x2 if updates.x2 is not None else zone.x2
                y1_val = updates.y1 if updates.y1 is not None else zone.y1
                y2_val = updates.y2 if updates.y2 is not None else zone.y2
                x1_val, x2_val = min(x1_val, x2_val), max(x1_val, x2_val)
                y1_val, y2_val = min(y1_val, y2_val), max(y1_val, y2_val)
                zone.set_dimensions(x1=x1_val, x2=x2_val, y1=y1_val, y2=y2_val)
            if updates.height is not None:
                zone.set_height(updates.height)
            if updates.ref_surface is not None:
                zone.set_ref_surface(updates.ref_surface)
            if updates.direction is not None:
                zone.set_direction(updates.direction)

        elif isinstance(zone, CalcVol) and zone.geometry is not None:
            # Frontend sends x_min/x_max etc., map to guv_calcs x1/x2 etc.
            has_vol_change = any(
                v is not None for v in [
                    updates.x_min, updates.x_max,
                    updates.y_min, updates.y_max,
                    updates.z_min, updates.z_max,
                ]
            )
            if has_vol_change:
                x1_val = updates.x_min if updates.x_min is not None else zone.x1
                x2_val = updates.x_max if updates.x_max is not None else zone.x2
                y1_val = updates.y_min if updates.y_min is not None else zone.y1
                y2_val = updates.y_max if updates.y_max is not None else zone.y2
                z1_val = updates.z_min if updates.z_min is not None else zone.z1
                z2_val = updates.z_max if updates.z_max is not None else zone.z2
                x1_val, x2_val = min(x1_val, x2_val), max(x1_val, x2_val)
                y1_val, y2_val = min(y1_val, y2_val), max(y1_val, y2_val)
                z1_val, z2_val = min(z1_val, z2_val), max(z1_val, z2_val)
                zone.set_dimensions(x1=x1_val, x2=x2_val, y1=y1_val, y2=y2_val, z1=z1_val, z2=z2_val)

        elif isinstance(zone, CalcPoint) and zone.geometry is not None:
            position_changed = any(v is not None for v in [updates.x, updates.y, updates.z])
            aim_changed = any(v is not None for v in [updates.aim_x, updates.aim_y, updates.aim_z])
            if position_changed:
                zone.move(x=updates.x, y=updates.y, z=updates.z, preserve_aim=True)
            if aim_changed:
                zone.aim(x=updates.aim_x, y=updates.aim_y, z=updates.aim_z)

        # Grid resolution updates — guv_calcs set_num_points/set_spacing now
        # handle mutual exclusion of spacing_init/num_points_init internally.
        # CalcPoint has no grid, so skip resolution updates for it.
        if not isinstance(zone, CalcPoint):
            if updates.num_x is not None or updates.num_y is not None or updates.num_z is not None:
                zone.set_num_points(
                    num_x=updates.num_x,
                    num_y=updates.num_y,
                    num_z=updates.num_z if hasattr(zone, 'num_z') else None
                )
            elif updates.x_spacing is not None or updates.y_spacing is not None or updates.z_spacing is not None:
                zone.set_spacing(
                    x_spacing=updates.x_spacing,
                    y_spacing=updates.y_spacing,
                    z_spacing=updates.z_spacing if hasattr(zone, 'z_spacing') else None
                )

        logger.debug(f"Updated zone {zone_id}")

        # Return computed values from the zone (authoritative)
        return SessionZoneUpdateResponse(
            success=True,
            message="Zone updated",
            num_x=getattr(zone, 'num_x', None),
            num_y=getattr(zone, 'num_y', None),
            num_z=getattr(zone, 'num_z', None),
            x_spacing=getattr(zone, 'x_spacing', None),
            y_spacing=getattr(zone, 'y_spacing', None),
            z_spacing=getattr(zone, 'z_spacing', None),
            state_hashes=_get_state_hashes(session),
        )

    except Exception as e:
        _log_and_raise("Failed to update zone", e)


@router.delete("/zones/{zone_id}", response_model=SuccessResponse)
def delete_session_zone(zone_id: str, session: InitializedSessionDep):
    """Remove a calculation zone from the session Room.

    Requires X-Session-ID header.
    """
    zone = _get_zone_or_404(session, zone_id)

    try:
        # Remove from room's calc_zones registry using the guv_calcs zone's internal ID
        if zone.id in session.room.calc_zones:
            del session.room.calc_zones[zone.id]
        del session.zone_id_map[zone_id]

        logger.debug(f"Deleted zone {zone_id}")
        return SuccessResponse(success=True, message="Zone deleted", state_hashes=_get_state_hashes(session))

    except Exception as e:
        _log_and_raise("Failed to delete zone", e)


@router.post("/zones/{zone_id}/copy", response_model=AddZoneResponse)
def copy_session_zone(zone_id: str, session: InitializedSessionDep):
    """Copy a calculation zone in the session Room, preserving all backend state.

    Requires X-Session-ID header.
    """
    zone = _get_zone_or_404(session, zone_id)

    try:
        copy = zone.copy()
        session.room.add_calc_zone(copy)
        assigned_id = copy.id
        session.zone_id_map[assigned_id] = copy

        logger.debug(f"Copied zone {zone_id} -> {assigned_id}")
        return AddZoneResponse(success=True, zone_id=assigned_id, state_hashes=_get_state_hashes(session))

    except Exception as e:
        _log_and_raise("Failed to copy zone", e)


@router.get("/zones", response_model=GetZonesResponse)
def get_session_zones(session: InitializedSessionDep):
    """Get current zone state from session.room.calc_zones.

    Returns the authoritative zone state from guv_calcs, which is useful after
    room property changes that trigger automatic zone updates (dimensions, units, standard).

    Requires X-Session-ID header.
    """
    zones = []
    for zone_id, zone in session.room.calc_zones.items():
        zone_type = zone.calctype.lower()
        is_plane = zone_type == "plane"
        is_point = zone_type == "point"
        h, m, s = _decompose_time(zone)
        zone_state = SessionZoneState(
            id=zone_id,
            name=getattr(zone, 'name', None),
            type=zone_type,
            enabled=getattr(zone, 'enabled', True),
            is_standard=zone_id in (EYE_LIMITS, SKIN_LIMITS, WHOLE_ROOM_FLUENCE),
            num_x=getattr(zone, 'num_x', None),
            num_y=getattr(zone, 'num_y', None),
            x_spacing=getattr(zone, 'x_spacing', None),
            y_spacing=getattr(zone, 'y_spacing', None),
            offset=getattr(zone, 'offset', True),
            dose=getattr(zone, 'dose', False),
            hours=h,
            minutes=m,
            seconds=s,
            display_mode=getattr(zone, 'display_mode', 'heatmap'),
        )
        if is_plane:
            zone_state.calc_mode = zone.calc_mode
            zone_state.height = zone.height
            zone_state.x1 = zone.x1
            zone_state.x2 = zone.x2
            zone_state.y1 = zone.y1
            zone_state.y2 = zone.y2
            zone_state.horiz = getattr(zone, 'horiz', False)
            zone_state.vert = getattr(zone, 'vert', False)
            zone_state.use_normal = getattr(zone, 'use_normal', False)
            zone_state.fov_vert = getattr(zone, 'fov_vert', 180)
            zone_state.fov_horiz = getattr(zone, 'fov_horiz', 360)
            zone_state.view_direction = getattr(zone, 'view_direction', None)
            zone_state.view_target = getattr(zone, 'view_target', None)
            zone_state.direction = getattr(zone, 'direction', 1)
        elif is_point:
            zone_state.x = zone.position[0]
            zone_state.y = zone.position[1]
            zone_state.z = zone.position[2]
            zone_state.aim_x = zone.aim_point[0]
            zone_state.aim_y = zone.aim_point[1]
            zone_state.aim_z = zone.aim_point[2]
            zone_state.horiz = getattr(zone, 'horiz', True)
            zone_state.vert = getattr(zone, 'vert', False)
            zone_state.use_normal = getattr(zone, 'use_normal', True)
            zone_state.fov_vert = getattr(zone, 'fov_vert', 180)
            zone_state.fov_horiz = getattr(zone, 'fov_horiz', 360)
            zone_state.calc_mode = getattr(zone, 'calc_mode', None)
        else:
            zone_state.num_z = getattr(zone, 'num_z', None)
            zone_state.z_spacing = getattr(zone, 'z_spacing', None)
            zone_state.x_min = zone.x1
            zone_state.x_max = zone.x2
            zone_state.y_min = zone.y1
            zone_state.y_max = zone.y2
            zone_state.z_min = zone.z1
            zone_state.z_max = zone.z2
        zones.append(zone_state)
    return GetZonesResponse(zones=zones)


@router.get("/zones/{zone_id}/export")
def export_session_zone(zone_id: str, session: InitializedSessionDep):
    """
    Export a single zone's data as CSV.

    Uses zone.export() which produces properly formatted CSV with
    coordinates and metadata (not just raw values).

    Requires X-Session-ID header.
    """
    zone = session.room.calc_zones.get(zone_id)
    if zone is None:
        raise HTTPException(status_code=404, detail=f"Zone {zone_id} not found")

    if isinstance(zone, CalcPoint):
        raise HTTPException(status_code=400, detail="Point zones do not support CSV export")

    try:
        logger.info(f"Exporting zone {zone_id} as CSV...")
        csv_bytes = zone.export()

        # guv_calcs may emit latin-1 encoded text (e.g. µW/cm²).
        # FastAPI auto-appends charset=utf-8 to text/* media types,
        # so we must re-encode to valid UTF-8 to avoid browser decode errors.
        if isinstance(csv_bytes, bytes):
            csv_bytes = csv_bytes.decode("latin-1").encode("utf-8")

        zone_name = getattr(zone, 'name', None) or zone_id
        safe_name = _sanitize_filename(zone_name)
        filename = f"{safe_name}.csv"

        return Response(
            content=csv_bytes,
            media_type="text/csv",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"'
            }
        )

    except Exception as e:
        _log_and_raise("Zone export failed", e)


@router.get("/zones/{zone_id}/plot")
def get_zone_plot(
    zone_id: str,
    session: InitializedSessionDep,
    theme: str = "dark",
    dpi: int = 100
):
    """
    Get a zone's calculation plot as PNG image.

    Uses zone.plot() to generate a visualization of the calculated values.
    Handles both Plane zones (Matplotlib) and Volume zones (Plotly).

    Requires X-Session-ID header.
    """
    zone = _get_zone_or_404(session, zone_id)

    if isinstance(zone, CalcPoint):
        raise HTTPException(status_code=400, detail="Point zones do not support plot export")

    if zone.values is None:
        raise HTTPException(status_code=400, detail="Zone has not been calculated yet.")

    try:
        colors = get_theme_colors(theme)
        bg_color = colors['bg_color']

        # Volume zones don't support static plot export
        if isinstance(zone, CalcVol):
            raise HTTPException(status_code=400, detail="Volume zones do not support plot export")

        # Plane zones use Matplotlib
        style = 'default' if theme == 'light' else 'dark_background'
        fig = None
        try:
            with plt.style.context(style):
                # Generate the zone plot (returns tuple of fig, ax)
                fig, ax = zone.plot()

                # Set figure size
                fig.set_size_inches(10, 8)

                # Apply theme
                apply_theme(fig, theme)
                for ax in fig.get_axes():
                    ax.tick_params(labelsize=12)
                    ax.xaxis.label.set_fontsize(14)
                    ax.yaxis.label.set_fontsize(14)
                    title = ax.get_title()
                    if title:
                        ax.set_title(title, fontsize=16)

                # Convert to base64
                buf = io.BytesIO()
                fig.savefig(buf, format='png', dpi=dpi, bbox_inches='tight',
                            facecolor=bg_color, edgecolor='none')
                buf.seek(0)

            image_base64 = base64.b64encode(buf.read()).decode('utf-8')

            return {
                "image_base64": image_base64,
                "content_type": "image/png"
            }
        finally:
            if fig is not None:
                plt.close(fig)

    except Exception as e:
        _log_and_raise("Failed to generate zone plot", e)
