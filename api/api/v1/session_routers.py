"""
Session Router - Multi-user session management with real-time sync.

This module manages per-session Room instances that serve as the source of truth
for each user/tab. Frontend changes sync to the session's Room in real-time,
and calculations use the existing Room instance instead of recreating it each time.

Sessions are identified by X-Session-ID header and authenticated with Bearer tokens.
In DEV_MODE, token validation is skipped for easier testing.
"""

import os
import uuid as uuid_module
import asyncio
import time
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, HTTPException, UploadFile, File, Header, Depends
from fastapi.responses import Response
from pydantic import BaseModel, Field
from typing import Optional, Dict, Literal, Any, List, Annotated
from datetime import datetime
import logging
import numpy as np

from guv_calcs.room import Room
from guv_calcs.project import Project
from guv_calcs.lamp import Lamp
from guv_calcs.calc_zone import CalcPlane, CalcVol
from guv_calcs import to_polar
from guv_calcs.safety import PhotStandard, ComplianceStatus, WarningLevel
from guv_calcs.lamp.lamp_placement import (
    LampPlacer,
    get_corners,
    get_edge_centers,
    _rank_corners_by_visibility,
    _get_corner_inward_direction,
    _offset_inward,
    _calculate_corner_aim,
    _calculate_edge_perpendicular_aim,
    _best_position_on_edge,
    _calculate_sightline_distance,
)
from guv_calcs.lamp.lamp_configs import resolve_keyword

from .session_manager import Session, get_session_manager
from .utils import fig_to_base64
from .resource_limits import (
    estimate_zone_grid_points,
    estimate_session_cost,
    check_budget,
    log_calculation_start,
    log_calculation_complete,
    COST_PER_GRID_POINT,
    COST_PER_REFLECTANCE_POINT,
    MAX_CONCURRENT_CALCULATIONS,
    QUEUE_TIMEOUT_SECONDS,
    CALCULATION_TIMEOUT_SECONDS,
)

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

# Allow skipping auth in development for easier testing
DEV_MODE = os.getenv("DEV_MODE", "false").lower() == "true"

# Thread pool for async calculations (matches MAX_CONCURRENT_CALCULATIONS)
_calc_executor = ThreadPoolExecutor(max_workers=MAX_CONCURRENT_CALCULATIONS)

# Semaphore to limit concurrent calculations
_calc_semaphore: asyncio.Semaphore | None = None


def _get_calc_semaphore() -> asyncio.Semaphore:
    """Get or create the calculation semaphore (must be called from async context)."""
    global _calc_semaphore
    if _calc_semaphore is None:
        _calc_semaphore = asyncio.Semaphore(MAX_CONCURRENT_CALCULATIONS)
    return _calc_semaphore


# Session ID header name
SESSION_HEADER = "X-Session-ID"


def get_session_id(
    x_session_id: Annotated[Optional[str], Header(alias="X-Session-ID")] = None
) -> str:
    """
    Extract session ID from header.

    Raises HTTPException if no session ID provided.
    """
    if not x_session_id:
        raise HTTPException(
            status_code=400,
            detail="Missing X-Session-ID header. Initialize a session first."
        )
    return x_session_id


# Type alias for session ID dependency
SessionIdDep = Annotated[str, Depends(get_session_id)]


def get_session(
    session_id: SessionIdDep,
    authorization: Annotated[Optional[str], Header()] = None
) -> Session:
    """
    Get the session for the current request with token validation.

    Returns existing session or raises 404 if not found.
    In DEV_MODE, token validation is skipped for easier testing.
    """
    manager = get_session_manager()
    session = manager.get_session(session_id, auto_create=False)
    if session is None:
        raise HTTPException(
            status_code=404,
            detail="Session not found. Initialize a session first with POST /session/init"
        )

    # Skip token validation in dev mode for easier testing
    if DEV_MODE:
        logger.debug(f"DEV_MODE: Skipping token validation for session {session_id[:8]}...")
        return session

    # Legacy session without token_hash - allow in dev-like scenarios
    # (session was created before auth was added)
    if not session.token_hash:
        logger.warning(f"Session {session_id[:8]}... has no token_hash (legacy session)")
        raise HTTPException(
            status_code=401,
            detail="Session requires re-authentication. Please refresh the page."
        )

    # Validate token in production
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authorization token required")

    token = authorization.replace("Bearer ", "")
    if not session.verify_token(token):
        raise HTTPException(status_code=401, detail="Invalid session token")

    return session


def get_or_create_session(
    session_id: SessionIdDep,
    authorization: Annotated[Optional[str], Header()] = None
) -> Session:
    """
    Get or create a session for the current request.

    Only used by /session/init endpoint which should auto-create sessions.
    Token validation is applied if session already exists.
    """
    manager = get_session_manager()
    session = manager.get_session(session_id, auto_create=False)

    if session is None:
        # New session - no token validation needed
        return manager.get_or_create(session_id)

    # Existing session - validate token (unless DEV_MODE)
    if DEV_MODE:
        logger.debug(f"DEV_MODE: Skipping token validation for existing session {session_id[:8]}...")
        return session

    # Legacy session without token_hash
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

    return session


def require_initialized_session(session: Session = Depends(get_session)) -> Session:
    """
    Require that the session has an initialized Project.

    Raises HTTPException if session has no Project.
    """
    if session.project is None:
        raise HTTPException(
            status_code=400,
            detail="No active session. Call POST /session/init first."
        )
    return session


# Type aliases for dependency injection
SessionDep = Annotated[Session, Depends(get_session)]
InitializedSessionDep = Annotated[Session, Depends(require_initialized_session)]
# For /session/init only - auto-creates session if not found
SessionCreateDep = Annotated[Session, Depends(get_or_create_session)]


# ============================================================
# Request/Response Schemas
# ============================================================

class SessionRoomConfig(BaseModel):
    """Room configuration for session initialization"""
    x: float = Field(..., gt=0, le=1000, description="Room width (must be positive)")
    y: float = Field(..., gt=0, le=1000, description="Room depth (must be positive)")
    z: float = Field(..., gt=0, le=100, description="Room height (must be positive)")
    units: Literal["meters", "feet"] = "meters"
    precision: int = Field(default=3, ge=0, le=10)
    standard: Literal["ACGIH", "ACGIH-UL8802", "ICNIRP"] = "ACGIH"
    enable_reflectance: bool = False
    reflectances: Optional[SurfaceReflectances] = None
    reflectance_x_spacings: Optional[Dict[str, float]] = None
    reflectance_y_spacings: Optional[Dict[str, float]] = None
    reflectance_x_num_points: Optional[Dict[str, int]] = None
    reflectance_y_num_points: Optional[Dict[str, int]] = None
    reflectance_max_num_passes: Optional[int] = Field(default=None, ge=1, le=100)
    reflectance_threshold: Optional[float] = Field(default=None, ge=0, le=1)
    air_changes: float = Field(default=1.0, ge=0, le=100)
    ozone_decay_constant: float = Field(default=2.5, ge=0, le=100)


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
    # Note: num_x/num_y/num_z have no maximum - budget system handles resource limits
    num_x: Optional[int] = Field(default=None, ge=1)
    num_y: Optional[int] = Field(default=None, ge=1)
    num_z: Optional[int] = Field(default=None, ge=1)
    # Minimum spacing of 5mm prevents accidental massive grids
    x_spacing: Optional[float] = Field(default=None, gt=0.005)
    y_spacing: Optional[float] = Field(default=None, gt=0.005)
    z_spacing: Optional[float] = Field(default=None, gt=0.005)
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
    x: Optional[float] = Field(default=None, gt=0, le=1000)
    y: Optional[float] = Field(default=None, gt=0, le=1000)
    z: Optional[float] = Field(default=None, gt=0, le=100)
    units: Optional[Literal["meters", "feet"]] = None
    precision: Optional[int] = Field(default=None, ge=0, le=10)
    standard: Optional[Literal["ACGIH", "ACGIH-UL8802", "ICNIRP"]] = None
    enable_reflectance: Optional[bool] = None
    reflectances: Optional[SurfaceReflectances] = None
    reflectance_x_spacings: Optional[Dict[str, float]] = None
    reflectance_y_spacings: Optional[Dict[str, float]] = None
    reflectance_x_num_points: Optional[Dict[str, int]] = None
    reflectance_y_num_points: Optional[Dict[str, int]] = None
    reflectance_max_num_passes: Optional[int] = Field(default=None, ge=1, le=100)
    reflectance_threshold: Optional[float] = Field(default=None, ge=0, le=1)
    air_changes: Optional[float] = Field(default=None, ge=0, le=100)
    ozone_decay_constant: Optional[float] = Field(default=None, ge=0, le=100)


class SessionLampUpdate(BaseModel):
    """Partial lamp update"""
    x: Optional[float] = None
    y: Optional[float] = None
    z: Optional[float] = None
    aimx: Optional[float] = None
    aimy: Optional[float] = None
    aimz: Optional[float] = None
    angle: Optional[float] = None
    scaling_factor: Optional[float] = None
    enabled: Optional[bool] = None
    preset_id: Optional[str] = None

    # Advanced settings - scaling method
    scaling_method: Optional[Literal["factor", "max", "total", "center"]] = None
    scaling_value: Optional[float] = None

    # Advanced settings - intensity units
    intensity_units: Optional[Literal["mW/sr", "uW/cm2"]] = None

    # Advanced settings - source dimensions (near-field)
    source_width: Optional[float] = None
    source_length: Optional[float] = None
    source_depth: Optional[float] = None
    source_density: Optional[int] = None


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


class SessionZoneState(BaseModel):
    """Current state of a zone from the session"""
    id: str
    name: Optional[str] = None
    type: Literal["plane", "volume"]
    enabled: bool = True
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
    horiz: Optional[bool] = None
    vert: Optional[bool] = None
    fov_vert: Optional[float] = None
    dose: Optional[bool] = None
    hours: Optional[float] = None
    # Volume-specific
    x_min: Optional[float] = None
    x_max: Optional[float] = None
    y_min: Optional[float] = None
    y_max: Optional[float] = None
    z_min: Optional[float] = None
    z_max: Optional[float] = None


class GetZonesResponse(BaseModel):
    """Response from GET /session/zones"""
    zones: List[SessionZoneState]


class AddLampResponse(BaseModel):
    """Response after adding a lamp"""
    success: bool
    lamp_id: str


class AddZoneResponse(BaseModel):
    """Response after adding a zone"""
    success: bool
    zone_id: str


class CopyLampRequest(BaseModel):
    """Request to copy a lamp"""
    new_id: str


class CopyZoneRequest(BaseModel):
    """Request to copy a zone"""
    new_id: str


class SuccessResponse(BaseModel):
    """Generic success response for PATCH/DELETE operations."""
    success: bool
    message: str = "Operation completed successfully"


class PlaceLampRequest(BaseModel):
    """Request to compute lamp placement"""
    mode: Optional[Literal["downlight", "corner", "edge", "horizontal"]] = None
    position_index: Optional[int] = None


class PlaceLampResponse(BaseModel):
    """Computed lamp placement result"""
    x: float
    y: float
    z: float
    angle: float = 0.0
    aimx: float
    aimy: float
    aimz: float
    mode: str
    position_index: int = 0
    position_count: int = 1


class CalculateResponse(BaseModel):
    """Response from calculation"""
    success: bool
    calculated_at: str
    mean_fluence: Optional[float] = None
    zones: Dict[str, SimulationZoneResult]


class SessionCreateResponse(BaseModel):
    """Response from session creation with server-generated credentials."""
    session_id: str
    token: str


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
# Helper Functions
# ============================================================

def _log_and_raise(operation: str, e: Exception, status_code: int = 400) -> None:
    """
    Log the full error details server-side and raise a generic HTTPException.

    This prevents information disclosure to clients while maintaining
    detailed server-side logs for debugging.
    """
    logger.error(f"{operation}: {e}")
    raise HTTPException(status_code=status_code, detail=f"{operation}")


def _sanitize_filename(name: str) -> str:
    """
    Sanitize a string for use in Content-Disposition filename.

    Removes or replaces characters that could cause header injection
    or parsing issues: quotes, newlines, carriage returns, semicolons,
    and other special characters.
    """
    import re
    # Remove or replace dangerous characters
    # Allow alphanumeric, spaces, hyphens, underscores, and periods
    sanitized = re.sub(r'[^\w\s\-.]', '_', name)
    # Collapse multiple underscores/spaces
    sanitized = re.sub(r'[_\s]+', '_', sanitized)
    # Remove leading/trailing underscores and spaces
    sanitized = sanitized.strip('_ ')
    # Ensure non-empty result
    return sanitized or 'export'


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
            # Standard safety zones (EyeLimits, SkinLimits) need use_normal=False
            # to match guv_calcs add_standard_zones() behavior.
            # Other planes default to use_normal=True.
            use_normal=zone_input.id not in ('EyeLimits', 'SkinLimits'),
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
            lamp = _create_lamp_from_input(lamp_input)
            session.room.add_lamp(lamp)
            session.lamp_id_map[lamp_input.id] = lamp
            logger.debug(f"Added lamp {lamp_input.id} (preset={lamp_input.preset_id})")

        # Add zones
        for zone_input in request.zones:
            zone = _create_zone_from_input(zone_input, session.room)
            session.room.add_calc_zone(zone)
            session.zone_id_map[zone_input.id] = zone
            logger.debug(f"Added zone {zone_input.id} (type={zone_input.type})")

        logger.info(f"Session {session.id[:8]}... initialized successfully")

        return SessionInitResponse(
            success=True,
            message="Session initialized",
            lamp_count=len(session.lamp_id_map),
            zone_count=len(session.zone_id_map),
        )

    except Exception as e:
        _log_and_raise("Failed to initialize session", e)


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
            estimate = estimate_session_cost(session)
            # Reflectance typically adds 5x cost (default 5 passes)
            reflectance_cost = (
                estimate['total_grid_points'] * 5 * COST_PER_REFLECTANCE_POINT
            )
            check_budget(session, additional_cost=reflectance_cost)

        # Apply units FIRST, before dimensions. This ensures that when
        # set_dimensions triggers _update_standard_zones(), zones are
        # calculated using the correct unit context.
        if updates.units is not None:
            session.room.set_units(updates.units)
        if updates.x is not None or updates.y is not None or updates.z is not None:
            session.room.set_dimensions(
                x=updates.x, y=updates.y, z=updates.z
            )
        if updates.precision is not None:
            session.room.precision = updates.precision
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
        return SuccessResponse(success=True, message="Room updated")

    except Exception as e:
        _log_and_raise("Failed to update room", e)


@router.post("/lamps", response_model=AddLampResponse)
def add_session_lamp(lamp: SessionLampInput, session: InitializedSessionDep):
    """Add a new lamp to the session Room.

    Requires X-Session-ID header.
    """
    try:
        guv_lamp = _create_lamp_from_input(lamp)
        session.room.add_lamp(guv_lamp)
        session.lamp_id_map[lamp.id] = guv_lamp

        logger.debug(f"Added lamp {lamp.id}")
        return AddLampResponse(success=True, lamp_id=lamp.id)

    except Exception as e:
        _log_and_raise("Failed to add lamp", e)


@router.patch("/lamps/{lamp_id}", response_model=SuccessResponse)
def update_session_lamp(lamp_id: str, updates: SessionLampUpdate, session: InitializedSessionDep):
    """Update an existing lamp's properties.

    Requires X-Session-ID header.
    """
    logger.debug(f"PATCH lamp {lamp_id}: {updates}")

    lamp = session.lamp_id_map.get(lamp_id)
    logger.debug(f"Found lamp in map: {lamp is not None}, lamp_count: {len(session.lamp_id_map)}")
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

        # Update rotation using lamp.rotate()
        if updates.angle is not None:
            lamp.rotate(updates.angle)

        # Update aim point using lamp.aim()
        if updates.aimx is not None or updates.aimy is not None or updates.aimz is not None:
            lamp.aim(
                x=updates.aimx if updates.aimx is not None else lamp.aimx,
                y=updates.aimy if updates.aimy is not None else lamp.aimy,
                z=updates.aimz if updates.aimz is not None else lamp.aimz,
            )

        # Apply scaling - use explicit method if provided, otherwise fall back to scaling_factor
        if updates.scaling_method is not None and updates.scaling_value is not None:
            if updates.scaling_method == "factor":
                lamp.scale(updates.scaling_value)
            elif updates.scaling_method == "max":
                lamp.scale_to_max(updates.scaling_value)
            elif updates.scaling_method == "total":
                lamp.scale_to_total(updates.scaling_value)
            elif updates.scaling_method == "center":
                lamp.scale_to_center(updates.scaling_value)
        elif updates.scaling_factor is not None:
            lamp.scale(updates.scaling_factor)

        if updates.enabled is not None:
            lamp.enabled = updates.enabled

        # Apply intensity units
        if updates.intensity_units is not None:
            lamp.intensity_units = updates.intensity_units

        # Apply source dimensions (near-field settings)
        if updates.source_width is not None:
            lamp.set_width(updates.source_width)
        if updates.source_length is not None:
            lamp.set_length(updates.source_length)
        if updates.source_depth is not None:
            lamp.surface.set_height(updates.source_depth)
        if updates.source_density is not None:
            lamp.set_source_density(updates.source_density)

        # Handle preset change - need to recreate lamp with IES data from preset
        if updates.preset_id is not None and updates.preset_id not in ("", "custom"):
            # Check if lamp already has IES data from this preset (avoid unnecessary recreation)
            current_has_ies = lamp.ies is not None
            if not current_has_ies or updates.preset_id != getattr(lamp, '_preset_id', None):
                # Create new lamp from preset keyword
                new_lamp = Lamp.from_keyword(
                    updates.preset_id,
                    x=lamp.x,
                    y=lamp.y,
                    z=lamp.z,
                    angle=lamp.angle,
                    aimx=lamp.aimx,
                    aimy=lamp.aimy,
                    aimz=lamp.aimz,
                    scaling_factor=lamp.scaling_factor,
                )
                new_lamp.enabled = lamp.enabled
                # Store preset_id for future comparisons
                new_lamp._preset_id = updates.preset_id

                # Replace in lamp registry: pop old, assign ID, add new
                old_lamp_id = lamp.lamp_id
                session.room.lamps.pop(old_lamp_id)
                new_lamp._assign_id(old_lamp_id)
                session.room.lamps.add(new_lamp)
                session.lamp_id_map[lamp_id] = new_lamp
                logger.debug(f"Replaced lamp {lamp_id} with preset {updates.preset_id}")

        logger.debug(f"Updated lamp {lamp_id}")
        return SuccessResponse(success=True, message="Lamp updated")

    except Exception as e:
        import traceback
        logger.error(traceback.format_exc())
        _log_and_raise("Failed to update lamp", e)


@router.delete("/lamps/{lamp_id}", response_model=SuccessResponse)
def delete_session_lamp(lamp_id: str, session: InitializedSessionDep):
    """Remove a lamp from the session Room.

    Requires X-Session-ID header.
    """
    lamp = session.lamp_id_map.get(lamp_id)
    if lamp is None:
        raise HTTPException(status_code=404, detail=f"Lamp {lamp_id} not found")

    try:
        session.room.lamps.remove(lamp_id)
        del session.lamp_id_map[lamp_id]

        logger.debug(f"Deleted lamp {lamp_id}")
        return SuccessResponse(success=True, message="Lamp deleted")

    except Exception as e:
        _log_and_raise("Failed to delete lamp", e)


@router.post("/lamps/{lamp_id}/copy", response_model=AddLampResponse)
def copy_session_lamp(lamp_id: str, req: CopyLampRequest, session: InitializedSessionDep):
    """Copy a lamp in the session Room, preserving all backend state (IES, photometry, etc.).

    Requires X-Session-ID header.
    """
    lamp = session.lamp_id_map.get(lamp_id)
    if lamp is None:
        raise HTTPException(status_code=404, detail=f"Lamp {lamp_id} not found")

    try:
        copy = lamp.copy(lamp_id=req.new_id)
        session.room.add_lamp(copy)
        session.lamp_id_map[req.new_id] = copy

        logger.debug(f"Copied lamp {lamp_id} -> {req.new_id}")
        return AddLampResponse(success=True, lamp_id=req.new_id)

    except Exception as e:
        _log_and_raise("Failed to copy lamp", e)


def _resolve_lamp_config(lamp) -> dict:
    """Resolve lamp config, trying _preset_id first then lamp_id.

    SceneRegistry may rename lamp_id on collision (e.g. "sabre" -> "sabre_1"),
    so _preset_id (set during creation) is the reliable keyword.
    """
    for key in [getattr(lamp, '_preset_id', None), lamp.lamp_id]:
        if key is None:
            continue
        try:
            _, config = resolve_keyword(key)
            return config
        except KeyError:
            continue
    return {}


def _compute_ceiling_offset(lamp) -> float:
    """Compute ceiling offset from fixture dimensions (mirrors LampPlacer.place_lamp logic)."""
    fixture = getattr(lamp, "fixture", None)
    if fixture is not None and fixture.housing_height > 0:
        offset = fixture.housing_height + 0.02
        return max(offset, 0.05)
    return 0.1


def _compute_wall_clearance(lamp) -> float:
    """Compute wall clearance from fixture dimensions (mirrors LampPlacer.place_lamp logic)."""
    fixture = getattr(lamp, "fixture", None)
    if fixture is not None and fixture.has_dimensions:
        w, l, h = fixture.housing_width, fixture.housing_length, fixture.housing_height
        diagonal_2d = (w**2 + l**2) ** 0.5
        return max(diagonal_2d / 2 + h / 2, 0.05)
    return 0.05


def _strict_corner_placement(
    lamp, polygon, position_index: int, ceiling_offset: float,
    wall_clearance: float, room_z: float, fixture_angle: float = 0,
) -> PlaceLampResponse:
    """Place lamp strictly in a corner using cycling index."""
    corners = get_corners(polygon)
    ranked_indices = _rank_corners_by_visibility(polygon)
    count = len(ranked_indices)
    idx = position_index % count

    corner = corners[ranked_indices[idx]]

    # Offset away from walls
    inward_dir = _get_corner_inward_direction(corner, polygon)
    position = _offset_inward(corner, inward_dir, wall_clearance)

    # Compute aim point
    aim = _calculate_corner_aim(corner, polygon)

    lamp_z = room_z - ceiling_offset

    # Save original state, apply placement, nudge into bounds
    orig_x, orig_y, orig_z = lamp.x, lamp.y, lamp.z
    orig_angle = lamp.angle
    orig_aimx, orig_aimy, orig_aimz = lamp.aimx, lamp.aimy, lamp.aimz

    lamp.move(position[0], position[1], lamp_z)
    lamp.aim(aim[0], aim[1], 0.0)
    if fixture_angle:
        lamp.rotate(fixture_angle)
    placer = LampPlacer(polygon, z=room_z)
    placer._nudge_into_bounds(lamp)

    result = PlaceLampResponse(
        x=round(lamp.x, 6), y=round(lamp.y, 6), z=round(lamp.z, 6),
        angle=round(lamp.angle, 6),
        aimx=round(lamp.aimx, 6), aimy=round(lamp.aimy, 6), aimz=round(lamp.aimz, 6),
        mode="corner", position_index=idx, position_count=count,
    )

    # Restore original state
    lamp.move(orig_x, orig_y, orig_z)
    lamp.aim(orig_aimx, orig_aimy, orig_aimz)
    lamp.rotate(orig_angle)
    return result


def _strict_edge_placement(
    lamp, polygon, position_index: int, ceiling_offset: float,
    wall_clearance: float, room_z: float, horizontal: bool = False,
    fixture_angle: float = 0,
) -> PlaceLampResponse:
    """Place lamp strictly on an edge using cycling index."""
    edges = get_edge_centers(polygon)
    count = len(edges)

    # Rank edges by sightline distance at midpoint (longest first)
    scored = []
    for mx, my, edge_idx in edges:
        dist = _calculate_sightline_distance((mx, my), edge_idx, polygon)
        scored.append((edge_idx, dist))
    scored.sort(key=lambda x: -x[1])

    idx = position_index % count
    chosen_edge_idx = scored[idx][0]

    # Find best position along the chosen edge
    best_pos, _ = _best_position_on_edge(chosen_edge_idx, polygon)

    # Offset inward from the wall
    outward = polygon.edge_normals[chosen_edge_idx]
    inward_dir = (-outward[0], -outward[1])
    position = _offset_inward(best_pos, inward_dir, wall_clearance)

    # Compute aim point
    aim = _calculate_edge_perpendicular_aim(position, chosen_edge_idx, polygon)

    lamp_z = room_z - ceiling_offset
    aim_z = lamp_z if horizontal else 0.0

    # Save original state, apply placement, nudge into bounds
    orig_x, orig_y, orig_z = lamp.x, lamp.y, lamp.z
    orig_angle = lamp.angle
    orig_aimx, orig_aimy, orig_aimz = lamp.aimx, lamp.aimy, lamp.aimz

    lamp.move(position[0], position[1], lamp_z)
    lamp.aim(aim[0], aim[1], aim_z)
    if fixture_angle:
        lamp.rotate(fixture_angle)
    placer = LampPlacer(polygon, z=room_z)
    placer._nudge_into_bounds(lamp)

    mode = "horizontal" if horizontal else "edge"
    result = PlaceLampResponse(
        x=round(lamp.x, 6), y=round(lamp.y, 6), z=round(lamp.z, 6),
        angle=round(lamp.angle, 6),
        aimx=round(lamp.aimx, 6), aimy=round(lamp.aimy, 6), aimz=round(lamp.aimz, 6),
        mode=mode, position_index=idx, position_count=count,
    )

    # Restore original state
    lamp.move(orig_x, orig_y, orig_z)
    lamp.aim(orig_aimx, orig_aimy, orig_aimz)
    lamp.rotate(orig_angle)
    return result


@router.post("/lamps/{lamp_id}/place", response_model=PlaceLampResponse)
def place_session_lamp(lamp_id: str, body: PlaceLampRequest, session: InitializedSessionDep):
    """Compute lamp placement with optional strict cycling.

    When position_index is provided, uses strict placement that cycles only
    through positions valid for the requested mode (corners stay in corners,
    edges stay on edges). When position_index is absent, falls back to
    LampPlacer.place_lamp() for optimal auto-layout (used by downlight mode).

    The endpoint computes and returns the placement without mutating the lamp.
    The frontend applies the position via the existing PATCH flow.

    Requires X-Session-ID header.
    """
    lamp = session.lamp_id_map.get(lamp_id)
    if lamp is None:
        raise HTTPException(status_code=404, detail=f"Lamp {lamp_id} not found")

    try:
        room = session.room
        polygon = room.dim.polygon
        room_z = room.dim.z

        # Resolve lamp config once (using _preset_id to handle SceneRegistry renames)
        config = _resolve_lamp_config(lamp)
        placement_config = config.get("placement", {})
        fixture_angle = placement_config.get("angle", 0)

        # Determine mode - use request body or fall back to preset config default
        mode = body.mode
        if mode is None:
            mode = placement_config.get("mode", "downlight")

        # Strict cycling path: position_index provided for corner/edge/horizontal
        if body.position_index is not None and mode in ("corner", "edge", "horizontal"):
            ceiling_offset = _compute_ceiling_offset(lamp)
            wall_clearance = _compute_wall_clearance(lamp)

            if mode == "corner":
                return _strict_corner_placement(
                    lamp, polygon, body.position_index,
                    ceiling_offset, wall_clearance, room_z,
                    fixture_angle=fixture_angle,
                )
            else:
                return _strict_edge_placement(
                    lamp, polygon, body.position_index,
                    ceiling_offset, wall_clearance, room_z,
                    horizontal=(mode == "horizontal"),
                    fixture_angle=fixture_angle,
                )

        # Legacy path: LampPlacer.place_lamp() for downlight or when no index given
        other_positions = []
        for fid, other_lamp in session.lamp_id_map.items():
            if fid != lamp_id and other_lamp.enabled:
                other_positions.append((other_lamp.x, other_lamp.y))

        placer = LampPlacer.for_dims(room.dim, existing=other_positions)

        orig_x, orig_y, orig_z = lamp.x, lamp.y, lamp.z
        orig_angle = lamp.angle
        orig_aimx, orig_aimy, orig_aimz = lamp.aimx, lamp.aimy, lamp.aimz

        placer.place_lamp(lamp, mode=mode, angle=fixture_angle)

        result_x, result_y, result_z = lamp.x, lamp.y, lamp.z
        result_angle = lamp.angle
        result_aimx, result_aimy, result_aimz = lamp.aimx, lamp.aimy, lamp.aimz

        lamp.move(orig_x, orig_y, orig_z)
        lamp.aim(orig_aimx, orig_aimy, orig_aimz)
        lamp.rotate(orig_angle)

        return PlaceLampResponse(
            x=round(result_x, 6),
            y=round(result_y, 6),
            z=round(result_z, 6),
            angle=round(result_angle, 6),
            aimx=round(result_aimx, 6),
            aimy=round(result_aimy, 6),
            aimz=round(result_aimz, 6),
            mode=mode,
        )

    except Exception as e:
        _log_and_raise("Failed to compute lamp placement", e)


# Maximum IES file size (1 MB should be plenty for any IES file)
MAX_IES_FILE_SIZE = 1 * 1024 * 1024  # 1 MB

# Valid IES file markers (case-insensitive check on first line)
IES_MARKERS = [b'IESNA', b'IESNA:LM-63', b'IESNA91', b'IESNA:']


def _validate_ies_content(content: bytes) -> bool:
    """Validate that content looks like an IES file."""
    # IES files are text-based and should start with IESNA marker
    try:
        first_line = content.split(b'\n')[0].strip().upper()
        return any(marker.upper() in first_line for marker in IES_MARKERS)
    except Exception:
        return False


class IESUploadResponse(BaseModel):
    """Response from IES file upload."""
    success: bool
    message: str
    has_ies_file: bool
    filename: Optional[str] = None


@router.post("/lamps/{lamp_id}/ies", response_model=IESUploadResponse)
async def upload_session_lamp_ies(
    lamp_id: str,
    session: InitializedSessionDep,
    file: UploadFile = File(...)
):
    """Upload an IES file to a session lamp.

    This replaces the lamp's photometric data with data from the uploaded IES file.
    The lamp's position, orientation, and other settings are preserved.
    Maximum file size: 1 MB.

    Requires X-Session-ID header.
    """
    if lamp_id not in session.lamp_id_map:
        raise HTTPException(status_code=404, detail=f"Lamp {lamp_id} not found")

    try:
        # Validate file extension
        filename = file.filename or ""
        if not filename.lower().endswith('.ies'):
            raise HTTPException(
                status_code=400,
                detail="Invalid file type. Please upload an IES file (.ies extension)"
            )

        # Check file size before reading (if content-length header is available)
        if file.size and file.size > MAX_IES_FILE_SIZE:
            raise HTTPException(
                status_code=413,
                detail=f"File too large. Maximum size is {MAX_IES_FILE_SIZE // 1024} KB"
            )

        # Read the uploaded file with size limit
        ies_bytes = await file.read(MAX_IES_FILE_SIZE + 1)
        if len(ies_bytes) > MAX_IES_FILE_SIZE:
            raise HTTPException(
                status_code=413,
                detail=f"File too large. Maximum size is {MAX_IES_FILE_SIZE // 1024} KB"
            )

        # Validate IES content format
        if not _validate_ies_content(ies_bytes):
            raise HTTPException(
                status_code=400,
                detail="Invalid IES file format. File must start with IESNA header."
            )

        # Get filename without extension for display
        display_name = filename.rsplit('.', 1)[0] if filename else None

        # Load IES data into the existing lamp (preserves wavelength, guv_type, position, etc.)
        lamp = session.lamp_id_map[lamp_id]
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
        _log_and_raise("Failed to upload IES file", e)


# Maximum intensity map file size (100 KB should be plenty for any CSV intensity map)
MAX_INTENSITY_MAP_SIZE = 100 * 1024  # 100 KB


def _validate_csv_content(content: bytes) -> bool:
    """Validate that content looks like a CSV with numeric data."""
    try:
        # Decode as text and check first few lines
        text = content.decode('utf-8', errors='ignore')
        lines = text.strip().split('\n')[:5]  # Check first 5 lines
        if not lines:
            return False

        for line in lines:
            # Skip empty lines
            if not line.strip():
                continue
            # Split by comma and check if values look numeric
            values = line.strip().split(',')
            for val in values:
                val = val.strip()
                if val:
                    # Try to parse as float
                    try:
                        float(val)
                    except ValueError:
                        return False
        return True
    except Exception:
        return False


class IntensityMapUploadResponse(BaseModel):
    """Response from intensity map file upload."""
    success: bool
    message: str
    has_intensity_map: bool
    dimensions: Optional[tuple[int, int]] = None


@router.post("/lamps/{lamp_id}/intensity-map", response_model=IntensityMapUploadResponse)
async def upload_session_lamp_intensity_map(
    lamp_id: str,
    session: InitializedSessionDep,
    file: UploadFile = File(...)
):
    """Upload an intensity map CSV file to a session lamp.

    The intensity map defines relative intensity distribution across the lamp surface
    for near-field calculations. The CSV should contain comma-delimited numeric values
    representing a 2D array of relative intensities.

    Maximum file size: 100 KB.

    Requires X-Session-ID header.
    """
    lamp = session.lamp_id_map.get(lamp_id)
    if lamp is None:
        raise HTTPException(status_code=404, detail=f"Lamp {lamp_id} not found")

    try:
        # Validate file extension
        filename = file.filename or ""
        if not filename.lower().endswith('.csv'):
            raise HTTPException(
                status_code=400,
                detail="Invalid file type. Please upload a CSV file (.csv extension)"
            )

        # Check file size before reading
        if file.size and file.size > MAX_INTENSITY_MAP_SIZE:
            raise HTTPException(
                status_code=413,
                detail=f"File too large. Maximum size is {MAX_INTENSITY_MAP_SIZE // 1024} KB"
            )

        # Read the uploaded file with size limit
        csv_bytes = await file.read(MAX_INTENSITY_MAP_SIZE + 1)
        if len(csv_bytes) > MAX_INTENSITY_MAP_SIZE:
            raise HTTPException(
                status_code=413,
                detail=f"File too large. Maximum size is {MAX_INTENSITY_MAP_SIZE // 1024} KB"
            )

        # Validate CSV content format
        if not _validate_csv_content(csv_bytes):
            raise HTTPException(
                status_code=400,
                detail="Invalid CSV format. File must contain comma-separated numeric values."
            )

        # Load intensity map into the lamp (guv_calcs accepts bytes for CSV)
        lamp.load_intensity_map(csv_bytes)

        # Get dimensions of the loaded map
        dimensions = None
        if hasattr(lamp, 'surface') and lamp.surface.intensity_map_orig is not None:
            imap = lamp.surface.intensity_map_orig
            dimensions = (imap.shape[0], imap.shape[1]) if len(imap.shape) >= 2 else (imap.shape[0], 1)

        filename = file.filename or "intensity_map.csv"
        logger.debug(f"Uploaded intensity map for lamp {lamp_id}: {filename}, dimensions={dimensions}")

        return IntensityMapUploadResponse(
            success=True,
            message=f"Intensity map uploaded for lamp {lamp_id}",
            has_intensity_map=True,
            dimensions=dimensions
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to upload intensity map for lamp {lamp_id}: {e}")
        _log_and_raise("Failed to upload intensity map", e)


@router.delete("/lamps/{lamp_id}/intensity-map", response_model=SuccessResponse)
def delete_session_lamp_intensity_map(lamp_id: str, session: InitializedSessionDep):
    """Remove the intensity map from a session lamp.

    Requires X-Session-ID header.
    """
    lamp = session.lamp_id_map.get(lamp_id)
    if lamp is None:
        raise HTTPException(status_code=404, detail=f"Lamp {lamp_id} not found")

    try:
        # Clear the intensity map by loading None
        lamp.load_intensity_map(None)
        logger.debug(f"Removed intensity map from lamp {lamp_id}")
        return SuccessResponse(success=True, message="Intensity map removed")

    except Exception as e:
        logger.error(f"Failed to remove intensity map from lamp {lamp_id}: {e}")
        _log_and_raise("Failed to remove intensity map", e)


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


class AdvancedLampSettingsResponse(BaseModel):
    """Advanced lamp settings with computed values."""
    lamp_id: str
    # Current power/irradiance values (for pre-filling scaling inputs)
    total_power_mw: float
    max_irradiance: float  # uW/cm²
    center_irradiance: float  # uW/cm²
    scaling_factor: float
    # Intensity units
    intensity_units: str  # "mW/sr" or "uW/cm2"
    # Source dimensions
    source_width: Optional[float] = None
    source_length: Optional[float] = None
    source_depth: Optional[float] = None
    source_density: int = 1
    # Computed values
    photometric_distance: Optional[float] = None
    num_points: tuple[int, int] = (1, 1)  # (num_u, num_v) grid points
    has_intensity_map: bool = False


@router.get("/lamps/{lamp_id}/info", response_model=SessionLampInfoResponse)
def get_session_lamp_info(
    lamp_id: str,
    session: InitializedSessionDep,
    spectrum_scale: str = "linear",
    theme: str = "dark",
    dpi: int = 100
):
    """Get lamp information for a session lamp (custom IES).

    Requires X-Session-ID header.
    """
    lamp = session.lamp_id_map.get(lamp_id)
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
            photometric_plot_base64 = fig_to_base64(fig, dpi=dpi, facecolor=bg_color)
        except Exception as e:
            logger.warning(f"Failed to generate photometric plot: {e}")
            photometric_plot_base64 = ""

        # Generate spectrum plot if available
        spectrum_plot_base64 = None
        has_spectrum = lamp.spectrum is not None

        if has_spectrum:
            try:
                result = lamp.spectrum.plot(weights=True, label=True)
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
                spectrum_plot_base64 = fig_to_base64(fig, dpi=dpi, facecolor=bg_color)
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
        _log_and_raise("Failed to get lamp info", e, 500)


@router.get("/lamps/{lamp_id}/advanced-settings", response_model=AdvancedLampSettingsResponse)
def get_session_lamp_advanced_settings(lamp_id: str, session: InitializedSessionDep):
    """Get advanced lamp settings for a session lamp.

    Returns current scaling factor, intensity units, source dimensions,
    and computed values like total power and photometric distance.

    Requires X-Session-ID header.
    """
    lamp = session.lamp_id_map.get(lamp_id)
    if lamp is None:
        raise HTTPException(status_code=404, detail=f"Lamp {lamp_id} not found")

    try:
        # Get current irradiance values (for pre-filling scaling inputs)
        total_power = lamp.get_total_power() if lamp.ies is not None else 0.0
        max_irradiance = lamp.max() if lamp.ies is not None else 0.0
        center_irradiance = lamp.center() if lamp.ies is not None else 0.0

        # Get intensity units label
        intensity_units_label = getattr(lamp.intensity_units, 'label', 'mW/sr')
        # Normalize to expected values
        if 'uW' in intensity_units_label or 'µW' in intensity_units_label:
            intensity_units_label = 'uW/cm2'
        else:
            intensity_units_label = 'mW/sr'

        # Get computed grid info
        num_points = (1, 1)
        has_intensity_map = False
        if hasattr(lamp, 'surface'):
            # Access num_points properties which trigger lazy computation
            try:
                num_u = lamp.surface.num_points_length or 1
                num_v = lamp.surface.num_points_width or 1
                num_points = (num_u, num_v)
            except Exception:
                num_points = (1, 1)
            has_intensity_map = lamp.surface.intensity_map_orig is not None

        return AdvancedLampSettingsResponse(
            lamp_id=lamp_id,
            total_power_mw=float(total_power),
            max_irradiance=float(max_irradiance),
            center_irradiance=float(center_irradiance),
            scaling_factor=lamp.scaling_factor,
            intensity_units=intensity_units_label,
            source_width=lamp.width,
            source_length=lamp.length,
            source_depth=lamp.depth,
            source_density=lamp.surface.source_density if hasattr(lamp, 'surface') else 1,
            photometric_distance=lamp.surface.photometric_distance if hasattr(lamp, 'surface') else None,
            num_points=num_points,
            has_intensity_map=has_intensity_map,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get advanced settings for lamp {lamp_id}: {e}")
        _log_and_raise("Failed to get advanced settings", e, 500)


class SurfacePlotResponse(BaseModel):
    """Surface plot image response."""
    plot_base64: str
    has_intensity_map: bool


class SimplePlotResponse(BaseModel):
    """Response containing a single plot image."""
    plot_base64: str


@router.get("/lamps/{lamp_id}/surface-plot", response_model=SurfacePlotResponse)
def get_session_lamp_surface_plot(
    lamp_id: str,
    session: InitializedSessionDep,
    theme: str = "dark",
    dpi: int = 100
):
    """Get the lamp surface discretization and intensity map plot (combined).

    Shows grid points and intensity distribution for near-field calculations.
    Requires X-Session-ID header.
    """
    lamp = session.lamp_id_map.get(lamp_id)
    if lamp is None:
        raise HTTPException(status_code=404, detail=f"Lamp {lamp_id} not found")

    # Need source dimensions for a meaningful surface plot
    if lamp.width is None or lamp.length is None or lamp.width == 0 or lamp.length == 0:
        raise HTTPException(status_code=400, detail="Lamp has no source dimensions defined")

    try:
        has_intensity_map = lamp.surface.intensity_map_orig is not None

        # Theme colors
        if theme == 'light':
            bg_color = '#ffffff'
            text_color = '#1f2328'
        else:
            bg_color = '#16213e'
            text_color = '#eaeaea'

        # Generate surface plot
        result = lamp.plot_surface(fig_width=6)
        fig = result[0] if isinstance(result, tuple) else result

        # Add more space between the two subplots
        fig.subplots_adjust(wspace=0.4)

        # Apply theme colors
        fig.patch.set_facecolor(bg_color)
        for ax in fig.axes:
            ax.set_facecolor(bg_color)
            ax.tick_params(colors=text_color, labelcolor=text_color)
            ax.xaxis.label.set_color(text_color)
            ax.yaxis.label.set_color(text_color)
            if hasattr(ax, 'title') and ax.title:
                ax.title.set_color(text_color)
            for spine in ax.spines.values():
                spine.set_color(text_color)

        plot_base64 = fig_to_base64(fig, dpi=dpi, facecolor=bg_color)

        return SurfacePlotResponse(
            plot_base64=plot_base64,
            has_intensity_map=has_intensity_map,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to generate surface plot for lamp {lamp_id}: {e}")
        _log_and_raise("Failed to generate surface plot", e, 500)


@router.get("/lamps/{lamp_id}/grid-points-plot", response_model=SimplePlotResponse)
def get_session_lamp_grid_points_plot(
    lamp_id: str,
    session: InitializedSessionDep,
    theme: str = "dark",
    dpi: int = 100
):
    """Get the lamp surface grid points plot.

    Shows the discretization grid for near-field calculations.
    Requires X-Session-ID header.
    """
    lamp = session.lamp_id_map.get(lamp_id)
    if lamp is None:
        raise HTTPException(status_code=404, detail=f"Lamp {lamp_id} not found")

    # Need source dimensions for a meaningful plot
    if lamp.width is None or lamp.length is None or lamp.width == 0 or lamp.length == 0:
        raise HTTPException(status_code=400, detail="Lamp has no source dimensions defined")

    try:
        import matplotlib.pyplot as plt

        # Theme colors
        if theme == 'light':
            bg_color = '#ffffff'
            text_color = '#1f2328'
        else:
            bg_color = '#16213e'
            text_color = '#eaeaea'

        # Generate grid points plot - same size as intensity map for alignment
        fig, ax = plt.subplots(figsize=(4, 3))
        lamp.surface.plot_surface_points(fig=fig, ax=ax, title="")

        # Set axes position to match intensity map plot (leaving space on right for colorbar alignment)
        # Intensity map has: main plot 0.15-0.80, colorbar 0.82-0.85
        # So we position grid points the same, with empty space where colorbar would be
        ax.set_position([0.18, 0.15, 0.60, 0.80])

        # Apply theme colors
        fig.patch.set_facecolor(bg_color)
        ax.set_facecolor(bg_color)
        ax.tick_params(colors=text_color, labelcolor=text_color)
        ax.xaxis.label.set_color(text_color)
        ax.yaxis.label.set_color(text_color)
        if ax.title:
            ax.title.set_color(text_color)
        for spine in ax.spines.values():
            spine.set_color(text_color)

        plot_base64 = fig_to_base64(fig, dpi=dpi, facecolor=bg_color)
        plt.close(fig)

        return SimplePlotResponse(plot_base64=plot_base64)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to generate grid points plot for lamp {lamp_id}: {e}")
        _log_and_raise("Failed to generate grid points plot", e, 500)


@router.get("/lamps/{lamp_id}/intensity-map-plot", response_model=SimplePlotResponse)
def get_session_lamp_intensity_map_plot(
    lamp_id: str,
    session: InitializedSessionDep,
    theme: str = "dark",
    dpi: int = 100
):
    """Get the lamp intensity map plot.

    Shows the relative intensity distribution across the lamp surface.
    Requires X-Session-ID header.
    """
    lamp = session.lamp_id_map.get(lamp_id)
    if lamp is None:
        raise HTTPException(status_code=404, detail=f"Lamp {lamp_id} not found")

    # Need an intensity map loaded
    if lamp.surface.intensity_map_orig is None:
        raise HTTPException(status_code=400, detail="Lamp has no intensity map loaded")

    try:
        import matplotlib.pyplot as plt

        # Theme colors
        if theme == 'light':
            bg_color = '#ffffff'
            text_color = '#1f2328'
        else:
            bg_color = '#16213e'
            text_color = '#eaeaea'

        # Generate intensity map plot - same size as grid points for alignment
        fig, ax = plt.subplots(figsize=(4, 3))
        lamp.surface.plot_intensity_map(fig=fig, ax=ax, title="", show_cbar=True)

        # Set main axes position to match grid points plot exactly
        ax.set_position([0.18, 0.15, 0.60, 0.80])

        # Position colorbar to the right of the main axes
        if len(fig.axes) > 1:
            cbar_ax = fig.axes[1]
            cbar_ax.set_position([0.80, 0.15, 0.03, 0.80])

        # Apply theme colors
        fig.patch.set_facecolor(bg_color)
        ax.set_facecolor(bg_color)
        ax.tick_params(colors=text_color, labelcolor=text_color)
        ax.xaxis.label.set_color(text_color)
        ax.yaxis.label.set_color(text_color)
        if ax.title:
            ax.title.set_color(text_color)
        for spine in ax.spines.values():
            spine.set_color(text_color)
        # Style colorbar if present
        for cbar_ax in fig.axes[1:]:
            cbar_ax.tick_params(colors=text_color, labelcolor=text_color)
            cbar_ax.yaxis.label.set_color(text_color)  # colorbar label
            for spine in cbar_ax.spines.values():
                spine.set_color(text_color)

        plot_base64 = fig_to_base64(fig, dpi=dpi, facecolor=bg_color)
        plt.close(fig)

        return SimplePlotResponse(plot_base64=plot_base64)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to generate intensity map plot for lamp {lamp_id}: {e}")
        _log_and_raise("Failed to generate intensity map plot", e, 500)


class SessionPhotometricWebResponse(BaseModel):
    """Photometric web mesh data for 3D visualization."""
    vertices: list  # [[x, y, z], ...]
    triangles: list  # [[i, j, k], ...]
    aim_line: list  # [[start_x, start_y, start_z], [end_x, end_y, end_z]]
    surface_points: list  # [[x, y, z], ...]
    fixture_bounds: Optional[list] = None  # [[x, y, z], ...] 8 corners or None
    color: str


@router.get("/lamps/{lamp_id}/photometric-web", response_model=SessionPhotometricWebResponse)
def get_session_lamp_photometric_web(lamp_id: str, session: InitializedSessionDep):
    """Get photometric web mesh data for a lamp in the current session.

    This endpoint generates photometric web data from the lamp's embedded IES data,
    allowing custom/loaded lamps to display their photometric distribution.

    Requires X-Session-ID header.
    """
    if Delaunay is None:
        raise HTTPException(
            status_code=500,
            detail="scipy is required for photometric web visualization"
        )

    lamp = session.lamp_id_map.get(lamp_id)
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

        # Surface points (discrete emission grid)
        # lamp.surface.surface_points returns points in world coordinates
        # We need to subtract lamp position to center at origin (like the photometric web)
        try:
            raw_surface_points = lamp.surface.surface_points
            if raw_surface_points is not None and len(raw_surface_points) > 0:
                # Center at origin by subtracting lamp position
                centered_points = raw_surface_points - lamp.position
                if centered_points.ndim == 1:
                    surface_points = [centered_points.tolist()]
                else:
                    surface_points = [[float(p[0]), float(p[1]), float(p[2])] for p in centered_points]
            else:
                surface_points = [[0.0, 0.0, 0.0]]
        except Exception as e:
            logger.warning(f"Failed to get surface points for session lamp {lamp_id}: {e}")
            surface_points = [[0.0, 0.0, 0.0]]

        # Fixture bounding box (wireframe housing)
        # Only include if the lamp has fixture dimensions defined
        fixture_bounds = None
        try:
            if lamp.fixture.has_dimensions:
                corners = lamp.geometry.get_bounding_box_corners()
                # Center at origin by subtracting lamp position
                centered_corners = corners - lamp.position
                fixture_bounds = [[float(c[0]), float(c[1]), float(c[2])] for c in centered_corners]
        except Exception as e:
            logger.warning(f"Failed to get fixture bounds for session lamp {lamp_id}: {e}")
            fixture_bounds = None

        return SessionPhotometricWebResponse(
            vertices=vertices,
            triangles=triangles,
            aim_line=aim_line,
            surface_points=surface_points,
            fixture_bounds=fixture_bounds,
            color="#cc61ff",  # purple for 222nm lamps
        )

    except Exception as e:
        logger.error(f"Failed to compute photometric web for session lamp {lamp_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to compute photometric web: {str(e)}"
        )


@router.post("/zones", response_model=AddZoneResponse)
def add_session_zone(zone: SessionZoneInput, session: InitializedSessionDep):
    """Add a new calculation zone to the session Room.

    Requires X-Session-ID header.
    """
    try:
        # Estimate cost of new zone and check budget before creating
        new_zone_points = estimate_zone_grid_points(zone, session.room)
        new_zone_cost = new_zone_points * COST_PER_GRID_POINT
        check_budget(session, additional_cost=new_zone_cost)

        guv_zone = _create_zone_from_input(zone, session.room)
        session.room.add_calc_zone(guv_zone)
        session.zone_id_map[zone.id] = guv_zone

        logger.debug(f"Added zone {zone.id}")
        return AddZoneResponse(success=True, zone_id=zone.id)

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
    zone = session.zone_id_map.get(zone_id)
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
        _log_and_raise("Failed to update zone", e)


@router.delete("/zones/{zone_id}", response_model=SuccessResponse)
def delete_session_zone(zone_id: str, session: InitializedSessionDep):
    """Remove a calculation zone from the session Room.

    Requires X-Session-ID header.
    """
    zone = session.zone_id_map.get(zone_id)
    if zone is None:
        raise HTTPException(status_code=404, detail=f"Zone {zone_id} not found")

    try:
        # Remove from room's calc_zones dict
        if zone_id in session.room.calc_zones:
            del session.room.calc_zones[zone_id]
        del session.zone_id_map[zone_id]

        logger.debug(f"Deleted zone {zone_id}")
        return SuccessResponse(success=True, message="Zone deleted")

    except Exception as e:
        _log_and_raise("Failed to delete zone", e)


@router.post("/zones/{zone_id}/copy", response_model=AddZoneResponse)
def copy_session_zone(zone_id: str, req: CopyZoneRequest, session: InitializedSessionDep):
    """Copy a calculation zone in the session Room, preserving all backend state.

    Requires X-Session-ID header.
    """
    zone = session.zone_id_map.get(zone_id)
    if zone is None:
        raise HTTPException(status_code=404, detail=f"Zone {zone_id} not found")

    try:
        copy = zone.copy(zone_id=req.new_id)
        session.room.add_calc_zone(copy)
        session.zone_id_map[req.new_id] = copy

        logger.debug(f"Copied zone {zone_id} -> {req.new_id}")
        return AddZoneResponse(success=True, zone_id=req.new_id)

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
        is_plane = isinstance(zone, CalcPlane)
        zone_state = SessionZoneState(
            id=zone_id,
            name=getattr(zone, 'name', None),
            type="plane" if is_plane else "volume",
            enabled=getattr(zone, 'enabled', True),
            num_x=zone.num_x,
            num_y=zone.num_y,
            x_spacing=zone.x_spacing,
            y_spacing=zone.y_spacing,
            offset=getattr(zone, 'offset', True),
            dose=getattr(zone, 'dose', False),
            hours=getattr(zone, 'hours', 8.0),
        )
        if is_plane:
            zone_state.height = zone.height
            zone_state.x1 = zone.x1
            zone_state.x2 = zone.x2
            zone_state.y1 = zone.y1
            zone_state.y2 = zone.y2
            zone_state.horiz = getattr(zone, 'horiz', False)
            zone_state.vert = getattr(zone, 'vert', False)
            zone_state.fov_vert = getattr(zone, 'fov_vert', 180)
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


class CalculationEstimateResponse(BaseModel):
    """Estimated calculation time and resource usage."""
    estimated_seconds: float
    grid_points: int
    lamp_count: int
    reflectance_enabled: bool
    reflectance_passes: int
    budget_percent: float


@router.get("/calculate/estimate", response_model=CalculationEstimateResponse)
def get_calculation_estimate(session: InitializedSessionDep):
    """
    Get estimated calculation time and resource usage.

    Call this before /calculate to show a progress indicator.
    """
    from .resource_limits import estimate_session_cost, MAX_SESSION_BUDGET

    estimate = estimate_session_cost(session)
    return CalculationEstimateResponse(
        estimated_seconds=estimate['calc_time_seconds'],
        grid_points=estimate['total_grid_points'],
        lamp_count=estimate['lamp_count'],
        reflectance_enabled=estimate['reflectance_enabled'],
        reflectance_passes=estimate['reflectance_passes'],
        budget_percent=round(estimate['budget_units'] / MAX_SESSION_BUDGET * 100, 1),
    )


@router.post("/calculate", response_model=CalculateResponse)
async def calculate_session(session: InitializedSessionDep):
    """
    Run calculation on the session Room.

    Uses the existing Room instance with all its lamps and zones.
    No new Room object is created.

    Includes resource protection:
    - Budget check before calculation
    - Queue timeout if server is busy
    - Calculation timeout to prevent runaway computations

    Requires X-Session-ID header.
    """
    # Pre-flight budget check
    check_budget(session)

    # Log calculation start with cost estimate
    estimate = log_calculation_start(session)

    # Get the calculation semaphore
    calc_semaphore = _get_calc_semaphore()

    # Wait for a calculation slot (with queue timeout)
    try:
        async with asyncio.timeout(QUEUE_TIMEOUT_SECONDS):
            await calc_semaphore.acquire()
    except TimeoutError:
        raise HTTPException(
            status_code=503,
            detail=f"Server busy. {MAX_CONCURRENT_CALCULATIONS} calculations running. "
                   f"Please try again in a moment."
        )

    calc_start = time.perf_counter()
    try:
        # Run calculation in thread pool with timeout
        loop = asyncio.get_event_loop()
        try:
            await asyncio.wait_for(
                loop.run_in_executor(_calc_executor, session.room.calculate),
                timeout=CALCULATION_TIMEOUT_SECONDS
            )
        except asyncio.TimeoutError:
            raise HTTPException(
                status_code=408,
                detail=f"Calculation timed out after {CALCULATION_TIMEOUT_SECONDS}s. "
                       f"Try reducing grid resolution or disabling reflectance."
            )

        actual_time = time.perf_counter() - calc_start
        log_calculation_complete(estimate, actual_time)

        # Collect results
        zone_results = {}
        mean_fluence = None

        for zone_id, zone in session.room.calc_zones.items():
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

    except HTTPException:
        # Re-raise HTTP exceptions (timeout, budget exceeded)
        raise
    except Exception as e:
        _log_and_raise("Calculation failed", e)
    finally:
        calc_semaphore.release()


@router.get("/report")
def get_session_report(session: InitializedSessionDep):
    """
    Generate a CSV report from the session Room.

    Uses room.generate_report() on the existing Room instance.
    Room must have been calculated first.

    Requires X-Session-ID header.
    """
    # Check if room has been calculated
    has_results = any(
        zone.values is not None
        for zone in session.room.calc_zones.values()
    )

    if not has_results:
        raise HTTPException(status_code=400, detail="Room has not been calculated yet. Call POST /session/calculate first.")

    try:
        logger.info("Generating report from session Room...")
        csv_bytes = session.room.generate_report()

        return Response(
            content=csv_bytes,
            media_type="text/csv",
            headers={
                "Content-Disposition": "attachment; filename=guv_report.csv"
            }
        )

    except Exception as e:
        _log_and_raise("Report generation failed", e)


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


@router.get("/zones/{zone_id}/export")
def export_session_zone(zone_id: str, session: InitializedSessionDep):
    """
    Export a single zone's data as CSV.

    Uses zone.export() which produces properly formatted CSV with
    coordinates and metadata (not just raw values).

    Requires X-Session-ID header.
    """
    zone = session.zone_id_map.get(zone_id)
    if zone is None:
        raise HTTPException(status_code=404, detail=f"Zone {zone_id} not found")

    # Check if zone has been calculated
    if zone.values is None:
        raise HTTPException(status_code=400, detail=f"Zone {zone_id} has not been calculated yet.")

    try:
        logger.info(f"Exporting zone {zone_id} as CSV...")
        csv_bytes = zone.export()

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


@router.get("/export")
def export_session_all(session: InitializedSessionDep, include_plots: bool = False):
    """
    Export all results as a ZIP file.

    Uses room.export_zip() which includes:
    - room.guv (project file)
    - {zone_name}.csv for each calculated zone
    - {zone_name}.png (optional, if include_plots=True)

    Requires X-Session-ID header.
    """
    # Check if room has been calculated
    has_results = any(
        zone.values is not None
        for zone in session.room.calc_zones.values()
    )

    if not has_results:
        raise HTTPException(status_code=400, detail="Room has not been calculated yet. Call POST /session/calculate first.")

    try:
        logger.info(f"Exporting all results as ZIP (include_plots={include_plots})...")
        zip_bytes = session.room.export_zip(include_plots=include_plots)

        return Response(
            content=zip_bytes,
            media_type="application/zip",
            headers={
                "Content-Disposition": "attachment; filename=illuminate.zip"
            }
        )

    except Exception as e:
        _log_and_raise("Export failed", e)


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
def get_disinfection_table(session: InitializedSessionDep, zone_id: str = "WholeRoomFluence"):
    """
    Get disinfection time data for key pathogens.

    Returns time to 90%, 99%, and 99.9% inactivation for:
    - Human coronavirus
    - Influenza virus
    - Staphylococcus aureus

    Uses room.average_value() to get inactivation times directly.

    Requires X-Session-ID header.
    """
    zone = session.room.calc_zones.get(zone_id)
    if zone is None:
        raise HTTPException(status_code=404, detail=f"Zone {zone_id} not found")

    if zone.values is None:
        raise HTTPException(status_code=400, detail="Zone has not been calculated yet.")

    try:
        # Get mean fluence for this zone (µW/cm²)
        fluence = float(zone.values.mean()) if zone.values is not None else 0.0

        # Batch by species - one call per log level (3 calls instead of 9)
        log_results = {
            func: session.room.average_value(zone_id=zone_id, function=func, species=TARGET_SPECIES)
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
            air_changes=session.room.air_changes,
            fluence=fluence,
        )

    except Exception as e:
        _log_and_raise("Failed to get disinfection table", e)


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
    zone = session.zone_id_map.get(zone_id)
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
        _log_and_raise("Failed to generate zone plot", e)


@router.get("/survival-plot")
def get_survival_plot(
    session: InitializedSessionDep,
    zone_id: str = "WholeRoomFluence",
    theme: str = "dark",
    dpi: int = 100
):
    """
    Get survival plot as PNG image.

    Shows survival fraction over time for key pathogens.

    Requires X-Session-ID header.
    """
    zone = session.room.calc_zones.get(zone_id)
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
        fig = session.room.survival_plot(zone_id=zone_id, species=TARGET_SPECIES, figsize=(10, 6))

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
        _log_and_raise("Failed to generate survival plot", e)


# ============================================================
# Project Save/Load Endpoints
# ============================================================

@router.get("/save")
def save_session(session: InitializedSessionDep):
    """
    Save the session Project to a .guv file format.

    Uses Project.save() which produces a JSON file with:
    - guv-calcs_version: version of guv_calcs used
    - timestamp: when the file was saved
    - format: "project"
    - data: project configuration including rooms, lamps, zones, and surfaces

    Returns the .guv file content as JSON.

    Requires X-Session-ID header.
    """
    try:
        logger.info("Saving session Project to .guv format...")
        # Project.save() with no filename returns JSON string
        guv_content = session.project.save()

        return Response(
            content=guv_content,
            media_type="application/json",
            headers={
                "Content-Disposition": "attachment; filename=project.guv"
            }
        )

    except Exception as e:
        _log_and_raise("Save failed", e)


class LoadedLamp(BaseModel):
    """Lamp data returned after loading a project"""
    id: str
    lamp_type: str
    preset_id: Optional[str] = None
    name: Optional[str] = None
    x: float
    y: float
    z: float
    angle: float = 0.0
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
    v_positive_direction: Optional[bool] = None  # True if v_hat points in positive direction of its dominant axis
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
        angle=getattr(lamp, 'angle', 0.0),
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
        # Compute v_positive_direction from geometry's v_hat
        v_hat = getattr(zone.geometry, 'v_hat', None)
        if v_hat is not None:
            abs_v = np.abs(v_hat)
            v_idx = int(np.argmax(abs_v))
            loaded.v_positive_direction = bool(v_hat[v_idx] > 0)
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
def load_session(request: dict, session: SessionCreateDep):
    """
    Load a session Project from .guv file data.

    Uses Project.load() to parse the file and create a Project instance.
    Handles both new project format and legacy single-room format files.
    The loaded Project replaces the current session (auto-creates session if needed).

    Returns the full room state so the frontend can update its store.

    Requires X-Session-ID header.
    """
    try:
        logger.info(f"Loading session {session.id[:8]}... Project from .guv file...")

        # Project.load() accepts the raw file content (dict or JSON string)
        # and handles both project-format and legacy room-format files
        session.project = Project.load(request)
        logger.info(f"Project.load() succeeded: {session.room.x}x{session.room.y}x{session.room.z}")

        # Rebuild ID maps from the loaded room
        session.lamp_id_map = {}
        session.zone_id_map = {}

        # Get raw lamp data for fallback preset matching
        raw_data = request.get('data', request)  # Handle both wrapped and unwrapped formats
        if raw_data.get('rooms'):
            # Project format: lamps are nested under rooms
            first_room_data = next(iter(raw_data['rooms'].values()), {})
            raw_lamps = first_room_data.get('lamps', {})
        else:
            # Legacy room format: lamps at top level of data
            raw_lamps = raw_data.get('lamps', {})

        # Build lamp list with IDs (use .items() since lamps is a dict-like Registry)
        loaded_lamps = []
        for lamp_id, lamp in session.room.lamps.items():
            session.lamp_id_map[lamp_id] = lamp
            # Pass raw lamp data for fallback preset matching
            raw_lamp_data = raw_lamps.get(lamp_id, {})
            loaded_lamps.append(_lamp_to_loaded(lamp, lamp_id, raw_lamp_data))

        # Build zone list with IDs
        loaded_zones = []
        for zone_id, zone in session.room.calc_zones.items():
            session.zone_id_map[zone_id] = zone
            loaded_zones.append(_zone_to_loaded(zone, zone_id))

        # Build room config
        # Get reflectances from ref_manager (not room.reflectances which doesn't exist)
        reflectances = None
        if hasattr(session.room, 'ref_manager') and session.room.ref_manager.reflectances:
            reflectances = session.room.ref_manager.reflectances

        logger.debug("Building LoadedRoom response...")
        loaded_room = LoadedRoom(
            x=session.room.x,
            y=session.room.y,
            z=session.room.z,
            # Convert enums to strings for Pydantic
            units=str(session.room.units),
            standard=_standard_to_short_name(session.room.standard),
            precision=session.room.precision,
            # Use ref_manager.enabled (room.enable_reflectance is a method, not property)
            enable_reflectance=session.room.ref_manager.enabled if hasattr(session.room, 'ref_manager') else False,
            reflectances=reflectances,
            air_changes=getattr(session.room, 'air_changes', 1.0),
            ozone_decay_constant=getattr(session.room, 'ozone_decay_constant', 2.5),
            colormap=getattr(session.room, 'colormap', None),
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
        logger.error(f"Traceback: {traceback.format_exc()}")
        _log_and_raise("Load failed", e)


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
def check_lamps_session(session: InitializedSessionDep):
    """
    Run safety compliance check on all lamps in the session.

    Uses room.check_lamps() which performs:
    1. Individual lamp compliance - checks if each lamp exceeds skin/eye TLVs
    2. Combined dose compliance - checks if all lamps together exceed limits
    3. Dimmed installation compliance - checks if applying dimming achieves compliance
    4. Missing spectrum warnings - warns if non-LPHG lamps lack spectral data

    Returns comprehensive compliance status, per-lamp results, and warnings.

    Requires X-Session-ID header.
    """
    try:
        logger.info(f"Running check_lamps on session {session.id[:8]}... Room...")
        result = session.room.check_lamps()

        # Build reverse mapping: guv_calcs lamp_id -> frontend lamp_id
        guv_to_frontend: Dict[str, str] = {}
        for frontend_id, lamp in session.lamp_id_map.items():
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

        # Check fixture bounding boxes against room bounds.
        # guv_calcs checks this during add_lamp() via warnings.warn() which is
        # not captured in the response. Re-check here so the frontend can display it.
        room = session.room
        for frontend_id, lamp in session.lamp_id_map.items():
            try:
                corners = lamp.geometry.get_bounding_box_corners()
                outside = False
                for x, y, z in corners:
                    if x < 0 or x > room.x or y < 0 or y > room.y or z < 0 or z > room.z:
                        outside = True
                        break
                if outside:
                    display_name = getattr(lamp, 'name', None) or frontend_id
                    warnings_response.append(SafetyWarningResponse(
                        level="warning",
                        message=f"{display_name} fixture exceeds room boundaries.",
                        lamp_id=frontend_id,
                    ))
            except Exception:
                pass  # Skip if geometry not available

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
        _log_and_raise("check_lamps failed", e)
