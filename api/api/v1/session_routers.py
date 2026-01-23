"""
Session Router - Single persistent Room with real-time sync.

This module manages a global session Room that serves as the single source of truth.
Frontend changes sync to this Room in real-time, and calculations use the existing
Room instance instead of recreating it each time.
"""

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from typing import Optional, Dict, Literal, Any
from datetime import datetime
import logging
import numpy as np

from guv_calcs.room import Room
from guv_calcs.lamp import Lamp
from guv_calcs.calc_zone import CalcPlane, CalcVol

from .schemas import (
    SurfaceReflectances,
    SimulationZoneResult,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/session", tags=["Session"])

# Global session Room - single source of truth
_session_room: Optional[Room] = None
_lamp_id_map: Dict[str, Lamp] = {}  # Frontend lamp ID -> guv_calcs Lamp object
_zone_id_map: Dict[str, Any] = {}  # Frontend zone ID -> guv_calcs zone object


# ============================================================
# Request/Response Schemas
# ============================================================

class SessionRoomConfig(BaseModel):
    """Room configuration for session initialization"""
    x: float
    y: float
    z: float
    units: Literal["meters", "feet"] = "meters"
    precision: int = 3
    standard: Literal["ACGIH", "ACGIH-UL8802", "ICNIRP"] = "ACGIH"
    enable_reflectance: bool = False
    reflectances: Optional[SurfaceReflectances] = None
    reflectance_x_spacings: Optional[Dict[str, float]] = None
    reflectance_y_spacings: Optional[Dict[str, float]] = None
    reflectance_x_num_points: Optional[Dict[str, int]] = None
    reflectance_y_num_points: Optional[Dict[str, int]] = None
    reflectance_max_num_passes: Optional[int] = None
    reflectance_threshold: Optional[float] = None
    air_changes: float = 1.0
    ozone_decay_constant: float = 2.5


class SessionLampInput(BaseModel):
    """Lamp definition for session"""
    id: str  # Frontend-assigned ID
    lamp_type: Literal["krcl_222", "lp_254"] = "krcl_222"
    preset_id: Optional[str] = None
    x: float
    y: float
    z: float
    aimx: float = 0.0
    aimy: float = 0.0
    aimz: float = -1.0
    scaling_factor: float = 1.0
    enabled: bool = True


class SessionZoneInput(BaseModel):
    """Zone definition for session"""
    id: str  # Frontend-assigned ID
    name: Optional[str] = None
    type: Literal["plane", "volume"] = "plane"
    enabled: bool = True
    isStandard: bool = False
    dose: bool = False
    hours: float = 8.0

    # Plane-specific
    height: Optional[float] = None
    x1: Optional[float] = None
    x2: Optional[float] = None
    y1: Optional[float] = None
    y2: Optional[float] = None

    # Volume-specific
    x_min: Optional[float] = None
    x_max: Optional[float] = None
    y_min: Optional[float] = None
    y_max: Optional[float] = None
    z_min: Optional[float] = None
    z_max: Optional[float] = None

    # Resolution
    num_x: Optional[int] = None
    num_y: Optional[int] = None
    num_z: Optional[int] = None
    x_spacing: Optional[float] = None
    y_spacing: Optional[float] = None
    z_spacing: Optional[float] = None
    offset: bool = True

    # Plane calculation options
    ref_surface: Literal["xy", "xz", "yz"] = "xy"
    direction: Optional[int] = None
    horiz: bool = False
    vert: bool = False
    fov_vert: Optional[float] = None
    fov_horiz: Optional[float] = None


class SessionInitRequest(BaseModel):
    """Request to initialize a session with full project state"""
    room: SessionRoomConfig
    lamps: list[SessionLampInput] = []
    zones: list[SessionZoneInput] = []


class SessionInitResponse(BaseModel):
    """Response after session initialization"""
    success: bool
    message: str
    lamp_count: int
    zone_count: int


class SessionRoomUpdate(BaseModel):
    """Partial room update"""
    x: Optional[float] = None
    y: Optional[float] = None
    z: Optional[float] = None
    units: Optional[Literal["meters", "feet"]] = None
    precision: Optional[int] = None
    standard: Optional[Literal["ACGIH", "ACGIH-UL8802", "ICNIRP"]] = None
    enable_reflectance: Optional[bool] = None
    reflectances: Optional[SurfaceReflectances] = None
    air_changes: Optional[float] = None
    ozone_decay_constant: Optional[float] = None


class SessionLampUpdate(BaseModel):
    """Partial lamp update"""
    x: Optional[float] = None
    y: Optional[float] = None
    z: Optional[float] = None
    aimx: Optional[float] = None
    aimy: Optional[float] = None
    aimz: Optional[float] = None
    scaling_factor: Optional[float] = None
    enabled: Optional[bool] = None
    preset_id: Optional[str] = None


class SessionZoneUpdate(BaseModel):
    """Partial zone update"""
    name: Optional[str] = None
    enabled: Optional[bool] = None
    dose: Optional[bool] = None
    hours: Optional[float] = None


class AddLampResponse(BaseModel):
    """Response after adding a lamp"""
    success: bool
    lamp_id: str


class AddZoneResponse(BaseModel):
    """Response after adding a zone"""
    success: bool
    zone_id: str


class CalculateResponse(BaseModel):
    """Response from calculation"""
    success: bool
    calculated_at: str
    mean_fluence: Optional[float] = None
    zones: Dict[str, SimulationZoneResult]


# ============================================================
# Helper Functions
# ============================================================

def _create_lamp_from_input(lamp_input: SessionLampInput) -> Lamp:
    """Create a guv_calcs Lamp from session input"""
    wavelength = 222 if lamp_input.lamp_type == "krcl_222" else 254
    guv_type = "LED" if lamp_input.lamp_type == "krcl_222" else "LP"

    if lamp_input.preset_id and lamp_input.preset_id != "custom":
        lamp = Lamp.from_keyword(
            lamp_input.preset_id,
            x=lamp_input.x,
            y=lamp_input.y,
            z=lamp_input.z,
            aimx=lamp_input.aimx,
            aimy=lamp_input.aimy,
            aimz=lamp_input.aimz,
            scaling_factor=lamp_input.scaling_factor,
        )
    else:
        lamp = Lamp(
            x=lamp_input.x,
            y=lamp_input.y,
            z=lamp_input.z,
            wavelength=wavelength,
            guv_type=guv_type,
            aimx=lamp_input.aimx,
            aimy=lamp_input.aimy,
            aimz=lamp_input.aimz,
            scaling_factor=lamp_input.scaling_factor,
        )

    lamp.enabled = lamp_input.enabled
    return lamp


def _create_zone_from_input(zone_input: SessionZoneInput, room: Room):
    """Create a guv_calcs CalcPlane or CalcVol from session input"""
    if zone_input.type == "plane":
        zone = CalcPlane(
            zone_id=zone_input.id,
            name=zone_input.name,
            x1=zone_input.x1 if zone_input.x1 is not None else 0,
            x2=zone_input.x2 if zone_input.x2 is not None else room.x,
            y1=zone_input.y1 if zone_input.y1 is not None else 0,
            y2=zone_input.y2 if zone_input.y2 is not None else room.y,
            height=zone_input.height or 1.0,
            num_x=zone_input.num_x,
            num_y=zone_input.num_y,
            x_spacing=zone_input.x_spacing,
            y_spacing=zone_input.y_spacing,
            offset=zone_input.offset,
            ref_surface=zone_input.ref_surface,
            direction=zone_input.direction,
            horiz=zone_input.horiz,
            vert=zone_input.vert,
            fov_vert=zone_input.fov_vert,
            fov_horiz=zone_input.fov_horiz,
            dose=zone_input.dose,
            hours=zone_input.hours,
        )
    else:
        zone = CalcVol(
            zone_id=zone_input.id,
            name=zone_input.name,
            x1=zone_input.x_min if zone_input.x_min is not None else 0,
            x2=zone_input.x_max if zone_input.x_max is not None else room.x,
            y1=zone_input.y_min if zone_input.y_min is not None else 0,
            y2=zone_input.y_max if zone_input.y_max is not None else room.y,
            z1=zone_input.z_min if zone_input.z_min is not None else 0,
            z2=zone_input.z_max if zone_input.z_max is not None else room.z,
            num_x=zone_input.num_x,
            num_y=zone_input.num_y,
            num_z=zone_input.num_z,
            x_spacing=zone_input.x_spacing,
            y_spacing=zone_input.y_spacing,
            z_spacing=zone_input.z_spacing,
            offset=zone_input.offset,
            dose=zone_input.dose,
            hours=zone_input.hours,
        )

    zone.enabled = zone_input.enabled
    return zone


# ============================================================
# Session Endpoints
# ============================================================

@router.post("/init", response_model=SessionInitResponse)
def init_session(request: SessionInitRequest):
    """
    Initialize a new session Room from frontend state.

    This creates the single source of truth Room that will be mutated
    by subsequent PATCH/POST/DELETE calls. Any existing session is replaced.
    """
    global _session_room, _lamp_id_map, _zone_id_map

    try:
        logger.info(f"Initializing session: room={request.room.x}x{request.room.y}x{request.room.z}, "
                    f"lamps={len(request.lamps)}, zones={len(request.zones)}")

        # Create new Room
        _session_room = Room(
            x=request.room.x,
            y=request.room.y,
            z=request.room.z,
            units=request.room.units,
            precision=request.room.precision,
            standard=request.room.standard,
            enable_reflectance=request.room.enable_reflectance,
            air_changes=request.room.air_changes,
            ozone_decay_constant=request.room.ozone_decay_constant,
        )

        # Apply reflectance settings if enabled
        if request.room.enable_reflectance and request.room.reflectances:
            _session_room.reflectances = request.room.reflectances.model_dump()

        # Clear ID maps
        _lamp_id_map = {}
        _zone_id_map = {}

        # Add lamps
        for lamp_input in request.lamps:
            lamp = _create_lamp_from_input(lamp_input)
            _session_room.add_lamp(lamp)
            _lamp_id_map[lamp_input.id] = lamp
            logger.debug(f"Added lamp {lamp_input.id} (preset={lamp_input.preset_id})")

        # Add zones
        for zone_input in request.zones:
            zone = _create_zone_from_input(zone_input, _session_room)
            _session_room.add_calc_zone(zone)
            _zone_id_map[zone_input.id] = zone
            logger.debug(f"Added zone {zone_input.id} (type={zone_input.type})")

        logger.info("Session initialized successfully")

        return SessionInitResponse(
            success=True,
            message="Session initialized",
            lamp_count=len(_lamp_id_map),
            zone_count=len(_zone_id_map),
        )

    except Exception as e:
        logger.error(f"Failed to initialize session: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to initialize session: {str(e)}")


@router.patch("/room")
def update_session_room(updates: SessionRoomUpdate):
    """
    Update room configuration properties.

    Only provided fields are updated. Room dimensions, units, and other
    settings can be changed without recreating the entire Room.
    """
    global _session_room

    if _session_room is None:
        raise HTTPException(status_code=400, detail="No active session. Call POST /session/init first.")

    try:
        if updates.x is not None:
            _session_room.x = updates.x
        if updates.y is not None:
            _session_room.y = updates.y
        if updates.z is not None:
            _session_room.z = updates.z
        if updates.units is not None:
            _session_room.units = updates.units
        if updates.precision is not None:
            _session_room.precision = updates.precision
        if updates.standard is not None:
            _session_room.standard = updates.standard
        if updates.enable_reflectance is not None:
            _session_room.enable_reflectance = updates.enable_reflectance
        if updates.reflectances is not None:
            _session_room.reflectances = updates.reflectances.model_dump()
        if updates.air_changes is not None:
            _session_room.air_changes = updates.air_changes
        if updates.ozone_decay_constant is not None:
            _session_room.ozone_decay_constant = updates.ozone_decay_constant

        logger.debug(f"Updated room: {updates.model_dump(exclude_none=True)}")
        return {"success": True, "message": "Room updated"}

    except Exception as e:
        logger.error(f"Failed to update room: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to update room: {str(e)}")


@router.post("/lamps", response_model=AddLampResponse)
def add_session_lamp(lamp: SessionLampInput):
    """Add a new lamp to the session Room."""
    global _session_room, _lamp_id_map

    if _session_room is None:
        raise HTTPException(status_code=400, detail="No active session. Call POST /session/init first.")

    try:
        guv_lamp = _create_lamp_from_input(lamp)
        _session_room.add_lamp(guv_lamp)
        _lamp_id_map[lamp.id] = guv_lamp

        logger.debug(f"Added lamp {lamp.id}")
        return AddLampResponse(success=True, lamp_id=lamp.id)

    except Exception as e:
        logger.error(f"Failed to add lamp: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to add lamp: {str(e)}")


@router.patch("/lamps/{lamp_id}")
def update_session_lamp(lamp_id: str, updates: SessionLampUpdate):
    """Update an existing lamp's properties."""
    global _session_room, _lamp_id_map

    if _session_room is None:
        raise HTTPException(status_code=400, detail="No active session. Call POST /session/init first.")

    lamp = _lamp_id_map.get(lamp_id)
    if lamp is None:
        raise HTTPException(status_code=404, detail=f"Lamp {lamp_id} not found")

    try:
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

        # Handle preset change - need to recreate lamp
        if updates.preset_id is not None and updates.preset_id != getattr(lamp, 'preset_id', None):
            # Remove old lamp and add new one with preset
            # Find the old lamp in the scene and replace it
            old_lamp = lamp
            new_lamp = Lamp.from_keyword(
                updates.preset_id,
                x=lamp.x,
                y=lamp.y,
                z=lamp.z,
                aimx=lamp.aimx,
                aimy=lamp.aimy,
                aimz=lamp.aimz,
                scaling_factor=lamp.scaling_factor,
            )
            new_lamp.enabled = lamp.enabled

            # Replace in scene
            _session_room.scene.lamps = [
                new_lamp if l is old_lamp else l
                for l in _session_room.scene.lamps
            ]
            _lamp_id_map[lamp_id] = new_lamp

        logger.debug(f"Updated lamp {lamp_id}")
        return {"success": True, "message": "Lamp updated"}

    except Exception as e:
        logger.error(f"Failed to update lamp: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to update lamp: {str(e)}")


@router.delete("/lamps/{lamp_id}")
def delete_session_lamp(lamp_id: str):
    """Remove a lamp from the session Room."""
    global _session_room, _lamp_id_map

    if _session_room is None:
        raise HTTPException(status_code=400, detail="No active session. Call POST /session/init first.")

    lamp = _lamp_id_map.get(lamp_id)
    if lamp is None:
        raise HTTPException(status_code=404, detail=f"Lamp {lamp_id} not found")

    try:
        _session_room.scene.lamps = [l for l in _session_room.scene.lamps if l is not lamp]
        del _lamp_id_map[lamp_id]

        logger.debug(f"Deleted lamp {lamp_id}")
        return {"success": True, "message": "Lamp deleted"}

    except Exception as e:
        logger.error(f"Failed to delete lamp: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to delete lamp: {str(e)}")


@router.post("/zones", response_model=AddZoneResponse)
def add_session_zone(zone: SessionZoneInput):
    """Add a new calculation zone to the session Room."""
    global _session_room, _zone_id_map

    if _session_room is None:
        raise HTTPException(status_code=400, detail="No active session. Call POST /session/init first.")

    try:
        guv_zone = _create_zone_from_input(zone, _session_room)
        _session_room.add_calc_zone(guv_zone)
        _zone_id_map[zone.id] = guv_zone

        logger.debug(f"Added zone {zone.id}")
        return AddZoneResponse(success=True, zone_id=zone.id)

    except Exception as e:
        logger.error(f"Failed to add zone: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to add zone: {str(e)}")


@router.patch("/zones/{zone_id}")
def update_session_zone(zone_id: str, updates: SessionZoneUpdate):
    """Update an existing zone's properties."""
    global _session_room, _zone_id_map

    if _session_room is None:
        raise HTTPException(status_code=400, detail="No active session. Call POST /session/init first.")

    zone = _zone_id_map.get(zone_id)
    if zone is None:
        raise HTTPException(status_code=404, detail=f"Zone {zone_id} not found")

    try:
        if updates.name is not None:
            zone.name = updates.name
        if updates.enabled is not None:
            zone.enabled = updates.enabled
        if updates.dose is not None:
            zone.dose = updates.dose
        if updates.hours is not None:
            zone.hours = updates.hours

        logger.debug(f"Updated zone {zone_id}")
        return {"success": True, "message": "Zone updated"}

    except Exception as e:
        logger.error(f"Failed to update zone: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to update zone: {str(e)}")


@router.delete("/zones/{zone_id}")
def delete_session_zone(zone_id: str):
    """Remove a calculation zone from the session Room."""
    global _session_room, _zone_id_map

    if _session_room is None:
        raise HTTPException(status_code=400, detail="No active session. Call POST /session/init first.")

    zone = _zone_id_map.get(zone_id)
    if zone is None:
        raise HTTPException(status_code=404, detail=f"Zone {zone_id} not found")

    try:
        # Remove from room's calc_zones dict
        if zone_id in _session_room.calc_zones:
            del _session_room.calc_zones[zone_id]
        del _zone_id_map[zone_id]

        logger.debug(f"Deleted zone {zone_id}")
        return {"success": True, "message": "Zone deleted"}

    except Exception as e:
        logger.error(f"Failed to delete zone: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to delete zone: {str(e)}")


@router.post("/calculate", response_model=CalculateResponse)
def calculate_session():
    """
    Run calculation on the session Room.

    Uses the existing Room instance with all its lamps and zones.
    No new Room object is created.
    """
    global _session_room

    if _session_room is None:
        raise HTTPException(status_code=400, detail="No active session. Call POST /session/init first.")

    try:
        logger.info("Running calculation on session Room...")
        _session_room.calculate()

        # Collect results
        zone_results = {}
        mean_fluence = None

        for zone_id, zone in _session_room.calc_zones.items():
            values = zone.get_values()
            zone_type = "plane" if isinstance(zone, CalcPlane) else "volume"

            if values is not None:
                flat_values = values.flatten() if hasattr(values, 'flatten') else np.array(values).flatten()
                valid_values = flat_values[~np.isnan(flat_values)]

                statistics = {
                    "min": float(np.min(valid_values)) if len(valid_values) > 0 else None,
                    "max": float(np.max(valid_values)) if len(valid_values) > 0 else None,
                    "mean": float(np.mean(valid_values)) if len(valid_values) > 0 else None,
                    "std": float(np.std(valid_values)) if len(valid_values) > 0 else None,
                }

                # Track WholeRoomFluence mean (raw fluence rate)
                if zone_id == "WholeRoomFluence":
                    raw_values = zone.values
                    if raw_values is not None:
                        raw_flat = raw_values.flatten() if hasattr(raw_values, 'flatten') else np.array(raw_values).flatten()
                        raw_valid = raw_flat[~np.isnan(raw_flat)]
                        mean_fluence = float(np.mean(raw_valid)) if len(raw_valid) > 0 else None

                # Reshape values for frontend
                reshaped_values = None
                if hasattr(zone, 'num_points'):
                    try:
                        num_points = zone.num_points
                        if zone_type == "plane" and len(num_points) == 2:
                            reshaped_values = values.reshape(num_points).tolist()
                        elif zone_type == "volume" and len(num_points) == 3:
                            reshaped_values = values.reshape(num_points).tolist()
                        else:
                            reshaped_values = values.tolist()
                    except Exception as e:
                        logger.warning(f"Failed to reshape values for zone {zone_id}: {e}")
                        reshaped_values = values.tolist() if hasattr(values, 'tolist') else None

                zone_results[zone_id] = SimulationZoneResult(
                    zone_id=zone_id,
                    zone_name=getattr(zone, 'name', None),
                    zone_type=zone_type,
                    statistics=statistics,
                    num_points=list(zone.num_points) if hasattr(zone, 'num_points') else None,
                    values=reshaped_values,
                )
            else:
                zone_results[zone_id] = SimulationZoneResult(
                    zone_id=zone_id,
                    zone_name=getattr(zone, 'name', None),
                    zone_type=zone_type,
                    statistics={"min": None, "max": None, "mean": None, "std": None},
                )

        logger.info("Calculation completed successfully")

        return CalculateResponse(
            success=True,
            calculated_at=datetime.utcnow().isoformat(),
            mean_fluence=mean_fluence,
            zones=zone_results,
        )

    except Exception as e:
        logger.error(f"Calculation failed: {e}")
        raise HTTPException(status_code=400, detail=f"Calculation failed: {str(e)}")


@router.get("/report")
def get_session_report():
    """
    Generate a CSV report from the session Room.

    Uses room.generate_report() on the existing Room instance.
    Room must have been calculated first.
    """
    global _session_room

    if _session_room is None:
        raise HTTPException(status_code=400, detail="No active session. Call POST /session/init first.")

    # Check if room has been calculated
    has_results = any(
        zone.values is not None
        for zone in _session_room.calc_zones.values()
    )

    if not has_results:
        raise HTTPException(status_code=400, detail="Room has not been calculated yet. Call POST /session/calculate first.")

    try:
        logger.info("Generating report from session Room...")
        csv_bytes = _session_room.generate_report()

        return Response(
            content=csv_bytes,
            media_type="text/csv",
            headers={
                "Content-Disposition": "attachment; filename=guv_report.csv"
            }
        )

    except Exception as e:
        logger.error(f"Report generation failed: {e}")
        raise HTTPException(status_code=400, detail=f"Report generation failed: {str(e)}")


@router.get("/status")
def get_session_status():
    """Get current session status for debugging."""
    global _session_room, _lamp_id_map, _zone_id_map

    if _session_room is None:
        return {
            "active": False,
            "message": "No active session"
        }

    return {
        "active": True,
        "room": {
            "dimensions": [_session_room.x, _session_room.y, _session_room.z],
            "units": _session_room.units,
            "standard": _session_room.standard,
        },
        "lamp_count": len(_lamp_id_map),
        "zone_count": len(_zone_id_map),
        "lamp_ids": list(_lamp_id_map.keys()),
        "zone_ids": list(_zone_id_map.keys()),
    }
