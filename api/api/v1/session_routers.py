"""
Session Router - Single persistent Room with real-time sync.

This module manages a global session Room that serves as the single source of truth.
Frontend changes sync to this Room in real-time, and calculations use the existing
Room instance instead of recreating it each time.
"""

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import Response
from pydantic import BaseModel, Field
from typing import Optional, Dict, Literal, Any, List
from datetime import datetime
import logging
import numpy as np

from guv_calcs.room import Room
from guv_calcs.lamp import Lamp
from guv_calcs.calc_zone import CalcPlane, CalcVol
from guv_calcs.trigonometry import to_polar
from guv_calcs.safety import PhotStandard, ComplianceStatus, WarningLevel

import io
import base64
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt


def _fig_to_base64(fig, dpi: int = 100, facecolor: str = 'white') -> str:
    """Convert matplotlib figure to base64-encoded PNG."""
    buf = io.BytesIO()
    fig.savefig(buf, format='png', dpi=dpi, bbox_inches='tight', facecolor=facecolor)
    plt.close(fig)
    buf.seek(0)
    return base64.b64encode(buf.read()).decode('utf-8')

try:
    from scipy.spatial import Delaunay
except ImportError:
    Delaunay = None

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
    ref_surface: Optional[Literal["xy", "xz", "yz"]] = "xy"
    direction: Optional[int] = None
    horiz: Optional[bool] = None
    vert: Optional[bool] = None
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
    height: Optional[float] = None  # For plane zones
    # Grid resolution - send only one mode (num_points OR spacing)
    num_x: Optional[int] = None
    num_y: Optional[int] = None
    num_z: Optional[int] = None
    x_spacing: Optional[float] = None
    y_spacing: Optional[float] = None
    z_spacing: Optional[float] = None


class SessionZoneUpdateResponse(BaseModel):
    """Response after updating a zone - includes computed grid values"""
    success: bool
    message: str = "Zone updated"
    # Computed grid values from backend (authoritative)
    num_x: Optional[int] = None
    num_y: Optional[int] = None
    num_z: Optional[int] = None
    x_spacing: Optional[float] = None
    y_spacing: Optional[float] = None
    z_spacing: Optional[float] = None


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

def _standard_to_short_name(standard) -> str:
    """Convert guv_calcs PhotStandard to frontend short name."""
    # Get the enum name (ACGIH, UL8802, ICNIRP)
    name = getattr(standard, 'name', str(standard))
    # Map UL8802 -> ACGIH-UL8802 for frontend compatibility
    if name == 'UL8802':
        return 'ACGIH-UL8802'
    return name


def _create_lamp_from_input(lamp_input: SessionLampInput) -> Lamp:
    """Create a guv_calcs Lamp from session input"""
    wavelength = 222 if lamp_input.lamp_type == "krcl_222" else 254
    # Use KRCL/LPHG instead of LED/LP to ensure wavelength is properly set
    # (GUVType.LED and GUVType.OTHER have no default_wavelength, which causes
    # lamp.wavelength to return None even when wavelength is explicitly passed)
    guv_type = "KRCL" if lamp_input.lamp_type == "krcl_222" else "LPHG"

    logger.info(f"Creating lamp: id={lamp_input.id}, preset_id={lamp_input.preset_id!r}, lamp_type={lamp_input.lamp_type}")

    if lamp_input.preset_id and lamp_input.preset_id != "custom" and lamp_input.preset_id != "":
        logger.info(f"Using Lamp.from_keyword with preset: {lamp_input.preset_id}")
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
        # Store preset_id for tracking
        lamp._preset_id = lamp_input.preset_id
        logger.info(f"Created preset lamp: has_ies={lamp.ies is not None}")
    else:
        logger.info(f"Using plain Lamp() constructor (no preset)")
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
        logger.info(f"Created custom lamp: has_ies={lamp.ies is not None}")

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
            direction=zone_input.direction if zone_input.direction is not None else 0,
            horiz=zone_input.horiz or False,
            vert=zone_input.vert or False,
            fov_vert=zone_input.fov_vert if zone_input.fov_vert is not None else 180,
            fov_horiz=zone_input.fov_horiz if zone_input.fov_horiz is not None else 360,
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

    print(f"PATCH lamp {lamp_id}: {updates}")

    if _session_room is None:
        raise HTTPException(status_code=400, detail="No active session. Call POST /session/init first.")

    lamp = _lamp_id_map.get(lamp_id)
    print(f"Found lamp in map: {lamp is not None}, lamp_id_map keys: {list(_lamp_id_map.keys())}")
    if lamp is None:
        raise HTTPException(status_code=404, detail=f"Lamp {lamp_id} not found")

    try:
        # Update position using lamp.move()
        if updates.x is not None or updates.y is not None or updates.z is not None:
            lamp.move(
                x=updates.x if updates.x is not None else lamp.x,
                y=updates.y if updates.y is not None else lamp.y,
                z=updates.z if updates.z is not None else lamp.z,
            )

        # Update aim point using lamp.aim()
        if updates.aimx is not None or updates.aimy is not None or updates.aimz is not None:
            lamp.aim(
                x=updates.aimx if updates.aimx is not None else lamp.aimx,
                y=updates.aimy if updates.aimy is not None else lamp.aimy,
                z=updates.aimz if updates.aimz is not None else lamp.aimz,
            )

        if updates.scaling_factor is not None:
            lamp.scale(updates.scaling_factor)
        if updates.enabled is not None:
            lamp.enabled = updates.enabled

        # Handle preset change - need to recreate lamp with IES data from preset
        if updates.preset_id is not None and updates.preset_id != "custom":
            # Check if lamp already has IES data from this preset (avoid unnecessary recreation)
            current_has_ies = lamp.ies is not None
            if not current_has_ies or updates.preset_id != getattr(lamp, '_preset_id', None):
                # Create new lamp from preset keyword
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
                # Store preset_id for future comparisons
                new_lamp._preset_id = updates.preset_id

                # Replace in scene registry: pop old, assign ID, add new
                old_lamp_id = lamp.lamp_id
                _session_room.scene.lamps.pop(old_lamp_id)
                new_lamp._assign_id(old_lamp_id)
                _session_room.scene.lamps.add(new_lamp)
                _lamp_id_map[lamp_id] = new_lamp
                logger.debug(f"Replaced lamp {lamp_id} with preset {updates.preset_id}")

        logger.debug(f"Updated lamp {lamp_id}")
        return {"success": True, "message": "Lamp updated"}

    except Exception as e:
        import traceback
        logger.error(f"Failed to update lamp: {e}")
        logger.error(traceback.format_exc())
        print(f"LAMP UPDATE ERROR: {e}")
        print(traceback.format_exc())
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


class IESUploadResponse(BaseModel):
    """Response from IES file upload."""
    success: bool
    message: str
    has_ies_file: bool
    filename: Optional[str] = None


@router.post("/lamps/{lamp_id}/ies", response_model=IESUploadResponse)
async def upload_session_lamp_ies(lamp_id: str, file: UploadFile = File(...)):
    """Upload an IES file to a session lamp.

    This replaces the lamp's photometric data with data from the uploaded IES file.
    The lamp's position, orientation, and other settings are preserved.
    """
    global _session_room, _lamp_id_map

    if _session_room is None:
        raise HTTPException(status_code=400, detail="No active session. Call POST /session/init first.")

    if lamp_id not in _lamp_id_map:
        raise HTTPException(status_code=404, detail=f"Lamp {lamp_id} not found")

    try:
        # Read the uploaded file
        ies_bytes = await file.read()

        # Get filename without extension for display
        filename = file.filename
        display_name = filename.rsplit('.', 1)[0] if filename else None

        # Load IES data into the existing lamp (preserves wavelength, guv_type, position, etc.)
        lamp = _lamp_id_map[lamp_id]
        lamp.load_ies(ies_bytes)

        logger.debug(f"Uploaded IES file for lamp {lamp_id}: {filename}")
        return IESUploadResponse(
            success=True,
            message=f"IES file uploaded for lamp {lamp_id}",
            has_ies_file=True,
            filename=display_name
        )

    except Exception as e:
        logger.error(f"Failed to upload IES file for lamp {lamp_id}: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to upload IES file: {str(e)}")


class TlvLimits(BaseModel):
    """TLV limits for a single standard."""
    skin: float  # mJ/cm²
    eye: float   # mJ/cm²


class SessionLampInfoResponse(BaseModel):
    """Lamp information for popup display (session lamp version)."""
    lamp_id: str
    name: str
    total_power_mw: float
    tlv_acgih: TlvLimits
    tlv_icnirp: TlvLimits
    photometric_plot_base64: str  # PNG as base64
    spectrum_plot_base64: Optional[str] = None
    has_spectrum: bool


@router.get("/lamps/{lamp_id}/info", response_model=SessionLampInfoResponse)
def get_session_lamp_info(
    lamp_id: str,
    spectrum_scale: str = "linear",
    theme: str = "dark",
    dpi: int = 100
):
    """Get lamp information for a session lamp (custom IES)."""
    global _session_room, _lamp_id_map

    if _session_room is None:
        raise HTTPException(status_code=400, detail="No active session")

    lamp = _lamp_id_map.get(lamp_id)
    if lamp is None:
        raise HTTPException(status_code=404, detail=f"Lamp {lamp_id} not found")

    if lamp.ies is None:
        raise HTTPException(status_code=400, detail=f"Lamp {lamp_id} has no IES data")

    try:
        # Get total optical power
        total_power = lamp.get_total_power()

        # Get TLVs for both standards
        acgih_skin, acgih_eye = lamp.get_tlvs(PhotStandard.ACGIH)
        icnirp_skin, icnirp_eye = lamp.get_tlvs(PhotStandard.ICNIRP)

        tlv_acgih = TlvLimits(
            skin=float(acgih_skin) if acgih_skin is not None else 0.0,
            eye=float(acgih_eye) if acgih_eye is not None else 0.0,
        )
        tlv_icnirp = TlvLimits(
            skin=float(icnirp_skin) if icnirp_skin is not None else 0.0,
            eye=float(icnirp_eye) if icnirp_eye is not None else 0.0,
        )

        # Theme colors
        if theme == 'light':
            bg_color = '#ffffff'
            text_color = '#1f2328'
            grid_color = '#c0c0c0'
        else:
            bg_color = '#16213e'
            text_color = '#eaeaea'
            grid_color = '#4a5568'

        # Generate photometric polar plot
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
            photometric_plot_base64 = _fig_to_base64(fig, dpi=dpi, facecolor=bg_color)
        except Exception as e:
            logger.warning(f"Failed to generate photometric plot: {e}")
            photometric_plot_base64 = ""

        # Generate spectrum plot if available
        spectrum_plot_base64 = None
        has_spectrum = lamp.spectra is not None

        if has_spectrum:
            try:
                result = lamp.spectra.plot(weights=True, label=True)
                fig = result[0] if isinstance(result, tuple) else result
                fig.patch.set_facecolor(bg_color)
                for ax in fig.axes:
                    ax.set_yscale(spectrum_scale)
                    ax.set_facecolor(bg_color)
                    ax.tick_params(colors=text_color, labelcolor=text_color)
                    ax.xaxis.label.set_color(text_color)
                    ax.yaxis.label.set_color(text_color)
                    if hasattr(ax, 'title') and ax.title:
                        ax.title.set_color(text_color)
                    for spine in ax.spines.values():
                        spine.set_color(grid_color)
                    ax.grid(color=grid_color, alpha=0.5)
                spectrum_plot_base64 = _fig_to_base64(fig, dpi=dpi, facecolor=bg_color)
            except Exception as e:
                logger.warning(f"Failed to generate spectrum plot: {e}")

        return SessionLampInfoResponse(
            lamp_id=lamp_id,
            name=getattr(lamp, 'name', lamp_id),
            total_power_mw=float(total_power),
            tlv_acgih=tlv_acgih,
            tlv_icnirp=tlv_icnirp,
            photometric_plot_base64=photometric_plot_base64,
            spectrum_plot_base64=spectrum_plot_base64,
            has_spectrum=has_spectrum,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get lamp info for {lamp_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get lamp info: {str(e)}")


class SessionPhotometricWebResponse(BaseModel):
    """Photometric web mesh data for 3D visualization."""
    vertices: list  # [[x, y, z], ...]
    triangles: list  # [[i, j, k], ...]
    aim_line: list  # [[start_x, start_y, start_z], [end_x, end_y, end_z]]
    surface_points: list  # [[x, y, z], ...]
    color: str


@router.get("/lamps/{lamp_id}/photometric-web", response_model=SessionPhotometricWebResponse)
def get_session_lamp_photometric_web(lamp_id: str):
    """Get photometric web mesh data for a lamp in the current session.

    This endpoint generates photometric web data from the lamp's embedded IES data,
    allowing custom/loaded lamps to display their photometric distribution.
    """
    global _session_room, _lamp_id_map

    if Delaunay is None:
        raise HTTPException(
            status_code=500,
            detail="scipy is required for photometric web visualization"
        )

    if _session_room is None:
        raise HTTPException(status_code=400, detail="No active session. Call POST /session/init first.")

    lamp = _lamp_id_map.get(lamp_id)
    if lamp is None:
        raise HTTPException(status_code=404, detail=f"Lamp {lamp_id} not found")

    if lamp.ies is None:
        raise HTTPException(status_code=400, detail=f"Lamp {lamp_id} has no IES data")

    try:
        # Follow the same algorithm as room_plotter._plot_lamp and lamp_routers.get_preset_photometric_web:
        # 1. transform_to_world with scale=max_value normalizes the coords
        # 2. Subtract position to center at origin
        # 3. Multiply by total_power/100 (100mW = 1m)

        init_scale = lamp.values.max()  # Max intensity value
        coords = lamp.transform_to_world(lamp.photometric_coords, scale=init_scale)
        # coords is (3, N) from transform_to_world

        # Center at origin and scale by power
        power_scale = lamp.get_total_power() / 100.0  # 100mW = 1m
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

        return SessionPhotometricWebResponse(
            vertices=vertices,
            triangles=triangles,
            aim_line=aim_line,
            surface_points=surface_points,
            color="#cc61ff",  # purple for 222nm lamps
        )

    except Exception as e:
        logger.error(f"Failed to compute photometric web for session lamp {lamp_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to compute photometric web: {str(e)}"
        )


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


@router.patch("/zones/{zone_id}", response_model=SessionZoneUpdateResponse)
def update_session_zone(zone_id: str, updates: SessionZoneUpdate):
    """Update an existing zone's properties.

    If grid parameters are provided (num_x/num_y/num_z or x_spacing/y_spacing/z_spacing),
    the backend computes the complementary values and returns them in the response.
    This ensures the frontend displays authoritative values that match what calculation will use.
    """
    global _session_room, _zone_id_map

    if _session_room is None:
        raise HTTPException(status_code=400, detail="No active session. Call POST /session/init first.")

    zone = _zone_id_map.get(zone_id)
    if zone is None:
        raise HTTPException(status_code=404, detail=f"Zone {zone_id} not found")

    try:
        # Basic property updates
        if updates.name is not None:
            zone.name = updates.name
        if updates.enabled is not None:
            zone.enabled = updates.enabled
        if updates.dose is not None:
            zone.dose = updates.dose
        if updates.hours is not None:
            zone.hours = updates.hours
        if updates.height is not None and hasattr(zone, 'height'):
            zone.height = updates.height

        # Grid resolution updates - use set_* methods which auto-compute complementary values
        # Priority: num_points mode takes precedence if provided
        if updates.num_x is not None or updates.num_y is not None or updates.num_z is not None:
            # User is in num_points mode
            zone.set_num_points(
                num_x=updates.num_x,
                num_y=updates.num_y,
                num_z=updates.num_z if hasattr(zone, 'num_z') else None
            )
        elif updates.x_spacing is not None or updates.y_spacing is not None or updates.z_spacing is not None:
            # User is in spacing mode
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
            num_x=zone.num_x,
            num_y=zone.num_y,
            num_z=getattr(zone, 'num_z', None),
            x_spacing=zone.x_spacing,
            y_spacing=zone.y_spacing,
            z_spacing=getattr(zone, 'z_spacing', None),
        )

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


@router.get("/zones/{zone_id}/export")
def export_session_zone(zone_id: str):
    """
    Export a single zone's data as CSV.

    Uses zone.export() which produces properly formatted CSV with
    coordinates and metadata (not just raw values).
    """
    global _session_room, _zone_id_map

    if _session_room is None:
        raise HTTPException(status_code=400, detail="No active session. Call POST /session/init first.")

    zone = _zone_id_map.get(zone_id)
    if zone is None:
        raise HTTPException(status_code=404, detail=f"Zone {zone_id} not found")

    # Check if zone has been calculated
    if zone.values is None:
        raise HTTPException(status_code=400, detail=f"Zone {zone_id} has not been calculated yet.")

    try:
        logger.info(f"Exporting zone {zone_id} as CSV...")
        csv_bytes = zone.export()

        zone_name = getattr(zone, 'name', None) or zone_id
        filename = f"{zone_name}.csv"

        return Response(
            content=csv_bytes,
            media_type="text/csv",
            headers={
                "Content-Disposition": f"attachment; filename={filename}"
            }
        )

    except Exception as e:
        logger.error(f"Zone export failed: {e}")
        raise HTTPException(status_code=400, detail=f"Zone export failed: {str(e)}")


@router.get("/export")
def export_session_all(include_plots: bool = False):
    """
    Export all results as a ZIP file.

    Uses room.export_zip() which includes:
    - room.guv (project file)
    - {zone_name}.csv for each calculated zone
    - {zone_name}.png (optional, if include_plots=True)
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
        logger.info(f"Exporting all results as ZIP (include_plots={include_plots})...")
        zip_bytes = _session_room.export_zip(include_plots=include_plots)

        return Response(
            content=zip_bytes,
            media_type="application/zip",
            headers={
                "Content-Disposition": "attachment; filename=illuminate.zip"
            }
        )

    except Exception as e:
        logger.error(f"Export failed: {e}")
        raise HTTPException(status_code=400, detail=f"Export failed: {str(e)}")


# Target species for disinfection table
TARGET_SPECIES = ["Human coronavirus", "Influenza virus", "Staphylococcus aureus"]


class DisinfectionRow(BaseModel):
    """Single row of disinfection data for a species."""
    species: str
    seconds_to_90: Optional[float] = None
    seconds_to_99: Optional[float] = None
    seconds_to_99_9: Optional[float] = None


class DisinfectionTableResponse(BaseModel):
    """Response containing disinfection time data."""
    rows: list[DisinfectionRow]
    air_changes: float
    fluence: float


@router.get("/disinfection-table", response_model=DisinfectionTableResponse)
def get_disinfection_table(zone_id: str = "WholeRoomFluence"):
    """
    Get disinfection time data for key pathogens.

    Returns time to 90%, 99%, and 99.9% inactivation for:
    - Human coronavirus
    - Influenza virus
    - Staphylococcus aureus

    Uses room.average_value() to get inactivation times directly.
    """
    global _session_room

    if _session_room is None:
        raise HTTPException(status_code=400, detail="No active session. Call POST /session/init first.")

    zone = _session_room.calc_zones.get(zone_id)
    if zone is None:
        raise HTTPException(status_code=404, detail=f"Zone {zone_id} not found")

    if zone.values is None:
        raise HTTPException(status_code=400, detail="Zone has not been calculated yet.")

    try:
        # Get mean fluence for this zone (µW/cm²)
        fluence = float(zone.values.mean()) if zone.values is not None else 0.0

        # Batch by species - one call per log level (3 calls instead of 9)
        log_results = {
            func: _session_room.average_value(zone_id=zone_id, function=func, species=TARGET_SPECIES)
            for func in ('log1', 'log2', 'log3')
        }

        def _get_time(func, species):
            results = log_results.get(func)
            if not results:
                return None
            val = results.get(species)
            # Return None for NaN, infinity, or None values (can't serialize inf to JSON)
            if val is None or np.isnan(val) or np.isinf(val):
                return None
            return float(val)

        # Build rows from results
        rows = [
            DisinfectionRow(
                species=species,
                seconds_to_90=_get_time('log1', species),
                seconds_to_99=_get_time('log2', species),
                seconds_to_99_9=_get_time('log3', species),
            )
            for species in TARGET_SPECIES
        ]

        return DisinfectionTableResponse(
            rows=rows,
            air_changes=_session_room.air_changes,
            fluence=fluence,
        )

    except Exception as e:
        logger.error(f"Failed to get disinfection table: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to get disinfection table: {str(e)}")


@router.get("/zones/{zone_id}/plot")
def get_zone_plot(
    zone_id: str,
    theme: str = "dark",
    dpi: int = 100
):
    """
    Get a zone's calculation plot as PNG image.

    Uses zone.plot() to generate a visualization of the calculated values.
    Handles both Plane zones (Matplotlib) and Volume zones (Plotly).
    """
    global _session_room, _zone_id_map

    if _session_room is None:
        raise HTTPException(status_code=400, detail="No active session. Call POST /session/init first.")

    zone = _zone_id_map.get(zone_id)
    if zone is None:
        raise HTTPException(status_code=404, detail=f"Zone {zone_id} not found")

    if zone.values is None:
        raise HTTPException(status_code=400, detail="Zone has not been calculated yet.")

    try:
        import io
        import base64
        from guv_calcs import CalcVol

        # Set theme colors
        if theme == 'light':
            bg_color = '#ffffff'
            text_color = '#1f2937'
        else:
            bg_color = '#1a1a2e'
            text_color = '#e5e5e5'

        # Volume zones don't support static plot export
        if isinstance(zone, CalcVol):
            raise HTTPException(status_code=400, detail="Volume zones do not support plot export")

        # Plane zones use Matplotlib
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt

        if theme == 'light':
            plt.style.use('default')
        else:
            plt.style.use('dark_background')
            # Plane zones return a Matplotlib figure
            import matplotlib
            matplotlib.use('Agg')
            import matplotlib.pyplot as plt

            if theme == 'light':
                plt.style.use('default')
            else:
                plt.style.use('dark_background')

            # Generate the zone plot (returns tuple of fig, ax)
            fig, ax = zone.plot()

            # Set figure size
            fig.set_size_inches(10, 8)

            # Apply theme
            fig.patch.set_facecolor(bg_color)
            for ax in fig.get_axes():
                ax.set_facecolor(bg_color)
                ax.tick_params(colors=text_color, labelsize=12)
                ax.xaxis.label.set_color(text_color)
                ax.xaxis.label.set_fontsize(14)
                ax.yaxis.label.set_color(text_color)
                ax.yaxis.label.set_fontsize(14)
                for spine in ax.spines.values():
                    spine.set_edgecolor(text_color)
                title = ax.get_title()
                if title:
                    ax.set_title(title, color=text_color, fontsize=16)

            # Convert to base64
            buf = io.BytesIO()
            fig.savefig(buf, format='png', dpi=dpi, bbox_inches='tight',
                        facecolor=bg_color, edgecolor='none')
            buf.seek(0)
            plt.close(fig)

            image_base64 = base64.b64encode(buf.read()).decode('utf-8')

        return {
            "image_base64": image_base64,
            "content_type": "image/png"
        }

    except Exception as e:
        logger.error(f"Failed to generate zone plot: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to generate zone plot: {str(e)}")


@router.get("/survival-plot")
def get_survival_plot(
    zone_id: str = "WholeRoomFluence",
    theme: str = "dark",
    dpi: int = 100
):
    """
    Get survival plot as PNG image.

    Shows survival fraction over time for key pathogens.
    """
    global _session_room

    if _session_room is None:
        raise HTTPException(status_code=400, detail="No active session. Call POST /session/init first.")

    zone = _session_room.calc_zones.get(zone_id)
    if zone is None:
        raise HTTPException(status_code=404, detail=f"Zone {zone_id} not found")

    if zone.values is None:
        raise HTTPException(status_code=400, detail="Zone has not been calculated yet.")

    try:
        import io
        import base64
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt

        # Set theme colors
        if theme == 'light':
            bg_color = '#ffffff'
            text_color = '#1f2937'
            plt.style.use('default')
        else:
            bg_color = '#1a1a2e'
            text_color = '#e5e5e5'
            plt.style.use('dark_background')

        # Generate survival plot for target species (larger size)
        fig = _session_room.survival_plot(zone_id=zone_id, species=TARGET_SPECIES, figsize=(10, 6))

        # Apply theme and increase font sizes
        fig.patch.set_facecolor(bg_color)
        for ax in fig.get_axes():
            ax.set_facecolor(bg_color)
            ax.tick_params(colors=text_color, labelsize=16)
            ax.xaxis.label.set_color(text_color)
            ax.xaxis.label.set_fontsize(18)
            ax.yaxis.label.set_color(text_color)
            ax.yaxis.label.set_fontsize(18)
            for spine in ax.spines.values():
                spine.set_edgecolor(text_color)
            # Move legend inside the plot with larger font
            legend = ax.get_legend()
            if legend:
                legend.set_bbox_to_anchor(None)
                ax.legend(loc='upper right', fontsize=16)
            # Wrap title before "at"
            title = ax.get_title()
            if title and ' at ' in title:
                wrapped_title = title.replace(' at ', '\nat ', 1)
                ax.set_title(wrapped_title, color=text_color, fontsize=20)
            elif title:
                ax.set_title(title, color=text_color, fontsize=20)

        # Convert to base64
        buf = io.BytesIO()
        fig.savefig(buf, format='png', dpi=dpi, bbox_inches='tight',
                    facecolor=bg_color, edgecolor='none')
        buf.seek(0)
        plt.close(fig)

        image_base64 = base64.b64encode(buf.read()).decode('utf-8')

        return {
            "image_base64": image_base64,
            "content_type": "image/png"
        }

    except Exception as e:
        logger.error(f"Failed to generate survival plot: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to generate survival plot: {str(e)}")


# ============================================================
# Project Save/Load Endpoints
# ============================================================

@router.get("/save")
def save_session():
    """
    Save the session Room to a .guv file format.

    Uses Room.save() which produces a JSON file with:
    - guv-calcs_version: version of guv_calcs used
    - timestamp: when the file was saved
    - data: room configuration, lamps, zones, and surfaces

    Returns the .guv file content as JSON.
    """
    global _session_room

    if _session_room is None:
        raise HTTPException(status_code=400, detail="No active session. Call POST /session/init first.")

    try:
        logger.info("Saving session Room to .guv format...")
        # Room.save() with no filename returns JSON string
        guv_content = _session_room.save()

        return Response(
            content=guv_content,
            media_type="application/json",
            headers={
                "Content-Disposition": "attachment; filename=project.guv"
            }
        )

    except Exception as e:
        logger.error(f"Save failed: {e}")
        raise HTTPException(status_code=400, detail=f"Save failed: {str(e)}")


class LoadedLamp(BaseModel):
    """Lamp data returned after loading a project"""
    id: str
    lamp_type: str
    preset_id: Optional[str] = None
    name: Optional[str] = None
    x: float
    y: float
    z: float
    aimx: float
    aimy: float
    aimz: float
    scaling_factor: float
    enabled: bool


class LoadedZone(BaseModel):
    """Zone data returned after loading a project"""
    id: str
    name: Optional[str] = None
    type: str  # 'plane' or 'volume'
    enabled: bool
    # Grid resolution
    num_x: Optional[int] = None
    num_y: Optional[int] = None
    num_z: Optional[int] = None
    x_spacing: Optional[float] = None
    y_spacing: Optional[float] = None
    z_spacing: Optional[float] = None
    offset: Optional[bool] = None
    # Plane-specific
    height: Optional[float] = None
    x1: Optional[float] = None
    x2: Optional[float] = None
    y1: Optional[float] = None
    y2: Optional[float] = None
    ref_surface: Optional[str] = None
    direction: Optional[int] = None
    horiz: Optional[bool] = None
    vert: Optional[bool] = None
    fov_vert: Optional[float] = None
    fov_horiz: Optional[float] = None
    dose: Optional[bool] = None
    hours: Optional[float] = None
    # Volume-specific
    x_min: Optional[float] = None
    x_max: Optional[float] = None
    y_min: Optional[float] = None
    y_max: Optional[float] = None
    z_min: Optional[float] = None
    z_max: Optional[float] = None


class LoadedRoom(BaseModel):
    """Room configuration returned after loading a project"""
    x: float
    y: float
    z: float
    units: str
    standard: str
    precision: int
    enable_reflectance: bool
    reflectances: Optional[Dict[str, float]] = None
    air_changes: float
    ozone_decay_constant: float
    colormap: Optional[str] = None


class LoadSessionResponse(BaseModel):
    """Response after loading a session from file"""
    success: bool
    message: str
    room: LoadedRoom
    lamps: list[LoadedLamp]
    zones: list[LoadedZone]


# Mapping from IES LUMCAT values to preset keywords
_LUMCAT_TO_PRESET = {
    "Aerolamp V1.0 Dev Kit": "aerolamp",
    "Beacon": "beacon",
    "Lumenizer Zone": "lumenizer_zone",
    "Nukit Lantern": "nukit_lantern",
    "Nukit Torch": "nukit_torch",
    "GermBuster Sabre": "sterilray",
    "USHIO B1": "ushio_b1",
    "USHIO B1.5": "ushio_b1.5",
    "UVPro B1": "uvpro222_b1",
    "UVPro B2": "uvpro222_b2",
    "Visium": "visium",
}

# Mapping from display names (used in older save files) to preset keywords
_DISPLAY_NAME_TO_PRESET = {
    "Aerolamp DevKit": "aerolamp",
    "Beacon": "beacon",
    "Lumenizer Zone": "lumenizer_zone",
    "NuKit Lantern": "nukit_lantern",
    "NuKit Torch": "nukit_torch",
    "Sterilray": "sterilray",
    "Ushio B1": "ushio_b1",
    "Ushio B1.5": "ushio_b1.5",
    "UVPro222 B1": "uvpro222_b1",
    "UVPro222 B2": "uvpro222_b2",
    "Visium": "visium",
}


def _get_preset_from_lamp(lamp, raw_lamp_data: dict = None) -> Optional[str]:
    """Try to identify the preset from a loaded lamp's IES header or raw data."""
    # Try IES header first (most reliable)
    if lamp.ies is not None and lamp.ies.header is not None:
        keywords = getattr(lamp.ies.header, 'keywords', {})
        if keywords:
            # Try LUMCAT first
            lumcat = keywords.get('LUMCAT')
            if lumcat and lumcat in _LUMCAT_TO_PRESET:
                return _LUMCAT_TO_PRESET[lumcat]

            # Try LUMINAIRE as fallback
            luminaire = keywords.get('LUMINAIRE')
            if luminaire and luminaire in _LUMCAT_TO_PRESET:
                return _LUMCAT_TO_PRESET[luminaire]

    # Fallback: check raw lamp data for 'filename' field (older save files)
    if raw_lamp_data:
        filename = raw_lamp_data.get('filename')
        if filename:
            # Check if filename matches a display name
            if filename in _DISPLAY_NAME_TO_PRESET:
                return _DISPLAY_NAME_TO_PRESET[filename]
            # Also try lowercase matching
            filename_lower = filename.lower()
            for display_name, preset in _DISPLAY_NAME_TO_PRESET.items():
                if display_name.lower() == filename_lower:
                    return preset

    return None


def _lamp_to_loaded(lamp, lamp_id: str, raw_lamp_data: dict = None) -> LoadedLamp:
    """Convert a guv_calcs Lamp to LoadedLamp response"""
    # Determine lamp_type from wavelength
    lamp_type = "krcl_222" if getattr(lamp, 'wavelength', 222) == 222 else "lp_254"

    # Try to identify preset from IES header or raw data
    preset_id = _get_preset_from_lamp(lamp, raw_lamp_data)

    return LoadedLamp(
        id=lamp_id,
        lamp_type=lamp_type,
        preset_id=preset_id,
        name=getattr(lamp, 'name', None),
        x=lamp.x,
        y=lamp.y,
        z=lamp.z,
        aimx=lamp.aimx,
        aimy=lamp.aimy,
        aimz=lamp.aimz,
        scaling_factor=lamp.scaling_factor,
        enabled=getattr(lamp, 'enabled', True),
    )


def _zone_to_loaded(zone, zone_id: str) -> LoadedZone:
    """Convert a guv_calcs CalcPlane/CalcVol to LoadedZone response"""
    zone_type = "plane" if isinstance(zone, CalcPlane) else "volume"

    loaded = LoadedZone(
        id=zone_id,
        name=getattr(zone, 'name', None),
        type=zone_type,
        enabled=getattr(zone, 'enabled', True),
        num_x=getattr(zone, 'num_x', None),
        num_y=getattr(zone, 'num_y', None),
        x_spacing=getattr(zone, 'x_spacing', None),
        y_spacing=getattr(zone, 'y_spacing', None),
        offset=getattr(zone, 'offset', None),
        dose=getattr(zone, 'dose', None),
        hours=getattr(zone, 'hours', None),
    )

    if zone_type == "plane":
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


@router.post("/load", response_model=LoadSessionResponse)
def load_session(request: dict):
    """
    Load a session Room from .guv file data.

    Uses Room.load() to parse the file and create a Room instance.
    The loaded Room replaces the current session.

    Returns the full room state so the frontend can update its store.
    """
    global _session_room, _lamp_id_map, _zone_id_map

    try:
        logger.info("Loading session Room from .guv file...")

        # Room.load() accepts the raw file content (dict or JSON string)
        _session_room = Room.load(request)
        logger.info(f"Room.load() succeeded: {_session_room.x}x{_session_room.y}x{_session_room.z}")

        # Rebuild ID maps from the loaded room
        _lamp_id_map = {}
        _zone_id_map = {}

        # Get raw lamp data for fallback preset matching
        raw_data = request.get('data', request)  # Handle both wrapped and unwrapped formats
        raw_lamps = raw_data.get('lamps', {})

        # Build lamp list with IDs (use .items() since lamps is a dict-like Registry)
        loaded_lamps = []
        for lamp_id, lamp in _session_room.scene.lamps.items():
            _lamp_id_map[lamp_id] = lamp
            # Pass raw lamp data for fallback preset matching
            raw_lamp_data = raw_lamps.get(lamp_id, {})
            loaded_lamps.append(_lamp_to_loaded(lamp, lamp_id, raw_lamp_data))

        # Build zone list with IDs
        loaded_zones = []
        for zone_id, zone in _session_room.calc_zones.items():
            _zone_id_map[zone_id] = zone
            loaded_zones.append(_zone_to_loaded(zone, zone_id))

        # Build room config
        # Get reflectances from ref_manager (not room.reflectances which doesn't exist)
        reflectances = None
        if hasattr(_session_room, 'ref_manager') and _session_room.ref_manager.reflectances:
            reflectances = _session_room.ref_manager.reflectances

        logger.debug("Building LoadedRoom response...")
        loaded_room = LoadedRoom(
            x=_session_room.x,
            y=_session_room.y,
            z=_session_room.z,
            # Convert enums to strings for Pydantic
            units=str(_session_room.units),
            standard=_standard_to_short_name(_session_room.standard),
            precision=_session_room.precision,
            # Use ref_manager.enabled (room.enable_reflectance is a method, not property)
            enable_reflectance=_session_room.ref_manager.enabled if hasattr(_session_room, 'ref_manager') else False,
            reflectances=reflectances,
            air_changes=getattr(_session_room, 'air_changes', 1.0),
            ozone_decay_constant=getattr(_session_room, 'ozone_decay_constant', 2.5),
            colormap=getattr(_session_room.scene, 'colormap', None),
        )

        logger.info(f"Session loaded: {len(loaded_lamps)} lamps, {len(loaded_zones)} zones")

        return LoadSessionResponse(
            success=True,
            message="Session loaded from file",
            room=loaded_room,
            lamps=loaded_lamps,
            zones=loaded_zones,
        )

    except Exception as e:
        import traceback
        logger.error(f"Load failed: {e}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=400, detail=f"Load failed: {str(e)}")


# ============================================================
# Safety Compliance Check (check_lamps)
# ============================================================

class LampComplianceResultResponse(BaseModel):
    """Compliance result for a single lamp."""
    lamp_id: str  # Frontend lamp ID
    lamp_name: str
    skin_dose_max: float
    eye_dose_max: float
    skin_tlv: float
    eye_tlv: float
    skin_dimming_required: float  # 1.0 = no dimming needed, <1 = dimming required
    eye_dimming_required: float
    is_skin_compliant: bool
    is_eye_compliant: bool
    missing_spectrum: bool


class SafetyWarningResponse(BaseModel):
    """A warning or error message from safety checking."""
    level: Literal["info", "warning", "error"]
    message: str
    lamp_id: Optional[str] = None  # Frontend lamp ID if applicable


class CheckLampsResponse(BaseModel):
    """Response from check_lamps safety analysis."""
    status: Literal["compliant", "non_compliant", "compliant_with_dimming", "non_compliant_even_with_dimming"]
    lamp_results: Dict[str, LampComplianceResultResponse]  # Keyed by frontend lamp ID
    warnings: List[SafetyWarningResponse]
    max_skin_dose: float
    max_eye_dose: float
    skin_dimming_for_compliance: Optional[float] = None
    eye_dimming_for_compliance: Optional[float] = None


@router.post("/check-lamps", response_model=CheckLampsResponse)
def check_lamps_session():
    """
    Run safety compliance check on all lamps in the session.

    Uses room.check_lamps() which performs:
    1. Individual lamp compliance - checks if each lamp exceeds skin/eye TLVs
    2. Combined dose compliance - checks if all lamps together exceed limits
    3. Dimmed installation compliance - checks if applying dimming achieves compliance
    4. Missing spectrum warnings - warns if non-LPHG lamps lack spectral data

    Returns comprehensive compliance status, per-lamp results, and warnings.
    """
    global _session_room, _lamp_id_map

    if _session_room is None:
        raise HTTPException(status_code=400, detail="No active session. Call POST /session/init first.")

    try:
        logger.info("Running check_lamps on session Room...")
        result = _session_room.check_lamps()

        # Build reverse mapping: guv_calcs lamp_id -> frontend lamp_id
        guv_to_frontend: Dict[str, str] = {}
        for frontend_id, lamp in _lamp_id_map.items():
            guv_to_frontend[lamp.lamp_id] = frontend_id

        # Convert lamp results to response format with frontend IDs
        lamp_results_response: Dict[str, LampComplianceResultResponse] = {}
        for guv_lamp_id, lamp_result in result.lamp_results.items():
            frontend_id = guv_to_frontend.get(guv_lamp_id, guv_lamp_id)
            lamp_results_response[frontend_id] = LampComplianceResultResponse(
                lamp_id=frontend_id,
                lamp_name=lamp_result.lamp_name,
                skin_dose_max=lamp_result.skin_dose_max,
                eye_dose_max=lamp_result.eye_dose_max,
                skin_tlv=lamp_result.skin_tlv,
                eye_tlv=lamp_result.eye_tlv,
                skin_dimming_required=lamp_result.skin_dimming_required,
                eye_dimming_required=lamp_result.eye_dimming_required,
                is_skin_compliant=lamp_result.is_skin_compliant,
                is_eye_compliant=lamp_result.is_eye_compliant,
                missing_spectrum=lamp_result.missing_spectrum,
            )

        # Convert warnings to response format with frontend IDs
        warnings_response: List[SafetyWarningResponse] = []
        for warning in result.warnings:
            frontend_lamp_id = None
            if warning.lamp_id:
                frontend_lamp_id = guv_to_frontend.get(warning.lamp_id, warning.lamp_id)
            warnings_response.append(SafetyWarningResponse(
                level=str(warning.level),
                message=warning.message,
                lamp_id=frontend_lamp_id,
            ))

        logger.info(f"check_lamps completed: status={result.status}")

        return CheckLampsResponse(
            status=str(result.status),
            lamp_results=lamp_results_response,
            warnings=warnings_response,
            max_skin_dose=result.max_skin_dose,
            max_eye_dose=result.max_eye_dose,
            skin_dimming_for_compliance=result.skin_dimming_for_compliance,
            eye_dimming_for_compliance=result.eye_dimming_for_compliance,
        )

    except Exception as e:
        logger.error(f"check_lamps failed: {e}")
        raise HTTPException(status_code=400, detail=f"check_lamps failed: {str(e)}")
