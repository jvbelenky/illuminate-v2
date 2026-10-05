"""Pydantic schemas for the session router endpoints."""

from pydantic import BaseModel, Field, field_validator, model_validator
from typing import Optional, Dict, Literal, Any, List, Tuple

from .schemas import SurfaceReflectances, SimulationZoneResult
from .defaults import OZONE_DECAY_CONSTANT as _OZONE_DECAY_CONSTANT
from .units import LengthUnit, DEFAULT_UNITS, check_room_extents


# ============================================================
# Request/Response Schemas
# ============================================================

PolygonVertices = List[Tuple[float, float]]


def _validate_polygon_vertices(vertices):
    """Shape-level checks for a floor-plan polygon.

    Geometric validity (self-intersection, zero area, coincident vertices) is
    left to guv_calcs Polygon2D, whose ValueError messages reach the client.
    Upper bounds depend on the room's units and are checked with
    ``units.check_room_extents`` where the units are known.
    """
    if vertices is None:
        return vertices
    if len(vertices) < 3:
        raise ValueError("Polygon must have at least 3 vertices")
    for x, y in vertices:
        if x < 0 or y < 0:
            raise ValueError("Polygon vertex coordinates must be >= 0")
    return vertices


class SessionRoomConfig(BaseModel):
    """Room configuration for session initialization.

    Lengths are in ``units``; the size limits (1000 m extents, 100 m height)
    are converted into those units before being checked.
    """
    x: float = Field(..., gt=0, description="Room width (must be positive)")
    y: float = Field(..., gt=0, description="Room depth (must be positive)")
    z: float = Field(..., gt=0, description="Room height (must be positive)")
    polygon: Optional[PolygonVertices] = Field(
        default=None,
        description="Floor-plan vertices [[x, y], ...] (CCW or CW, >= 3). When set, "
                    "the room is a polygon room and x/y are ignored.",
    )
    units: LengthUnit = DEFAULT_UNITS

    @field_validator("polygon")
    @classmethod
    def _check_polygon(cls, v):
        return _validate_polygon_vertices(v)

    @model_validator(mode="after")
    def _check_extents(self):
        check_room_extents(self.units, x=self.x, y=self.y, z=self.z, polygon=self.polygon)
        return self
    precision: int = Field(default=3, ge=0, le=10)
    standard: Literal["ANSI IES RP 27.1-22 (ACGIH Limits)", "UL8802 (ACGIH Limits)", "IEC 62471-6:2022 (ICNIRP Limits)"] = "ANSI IES RP 27.1-22 (ACGIH Limits)"
    enable_reflectance: bool = False
    reflectances: Optional[SurfaceReflectances] = None
    reflectance_x_spacings: Optional[Dict[str, float]] = None
    reflectance_y_spacings: Optional[Dict[str, float]] = None
    reflectance_x_num_points: Optional[Dict[str, int]] = None
    reflectance_y_num_points: Optional[Dict[str, int]] = None
    reflectance_max_num_passes: Optional[int] = Field(default=None, ge=1)
    reflectance_threshold: Optional[float] = Field(default=None, ge=0, le=1)
    air_changes: float = Field(default=1.0, ge=0)
    ozone_decay_constant: float = Field(default=_OZONE_DECAY_CONSTANT, ge=0)
    colormap: str = Field(default="plasma", description="Matplotlib/Plotly colormap name")


class SessionLampInput(BaseModel):
    """Lamp definition for session"""
    id: Optional[str] = None  # Optional: if omitted, guv_calcs Registry assigns ID
    name: Optional[str] = None
    lamp_type: Literal["krcl_222", "lp_254", "other"] = "krcl_222"
    preset_id: Optional[str] = None
    wavelength: Optional[float] = None  # Required for "other" lamp type
    x: float
    y: float
    z: float
    aimx: float = 0.0
    aimy: float = 0.0
    aimz: float = -1.0
    angle: float = 0.0
    scaling_factor: float = 1.0
    enabled: bool = True


class SessionZoneInput(BaseModel):
    """Zone definition for session"""
    id: Optional[str] = None  # Optional: if omitted, guv_calcs Registry assigns ID
    name: Optional[str] = None
    type: Literal["plane", "volume", "point"] = "plane"
    enabled: bool = True
    isStandard: bool = False
    dose: bool = False
    hours: float = 8
    minutes: float = 0
    seconds: float = 0

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

    # Point-specific (position and aim point)
    x: Optional[float] = None
    y: Optional[float] = None
    z: Optional[float] = None
    aim_x: Optional[float] = None
    aim_y: Optional[float] = None
    aim_z: Optional[float] = None

    # Resolution
    # Note: num_x/num_y/num_z have no maximum - budget system handles resource limits
    num_x: Optional[int] = Field(default=None, ge=1)
    num_y: Optional[int] = Field(default=None, ge=1)
    num_z: Optional[int] = Field(default=None, ge=1)
    # The 5 mm minimum spacing is checked in the room's units by the handler
    x_spacing: Optional[float] = Field(default=None, gt=0)
    y_spacing: Optional[float] = Field(default=None, gt=0)
    z_spacing: Optional[float] = Field(default=None, gt=0)
    offset: bool = True

    # Plane calculation options
    calc_mode: Optional[str] = None
    ref_surface: Optional[Literal["xy", "xz", "yz"]] = "xy"
    direction: Optional[int] = None
    horiz: Optional[bool] = None
    vert: Optional[bool] = None
    use_normal: Optional[bool] = None
    fov_vert: Optional[float] = None
    fov_horiz: Optional[float] = None
    view_direction: Optional[list[float]] = Field(default=None, min_length=3, max_length=3)
    view_target: Optional[list[float]] = Field(default=None, min_length=3, max_length=3)

    # Display
    display_mode: Optional[str] = "heatmap"


class SurfaceGridSize(BaseModel):
    """Per-surface x/y value pair (spacing or point count)."""
    x: float
    y: float


class FaceOptics(BaseModel):
    """Reflectance/transmittance pair for one object face (R + T <= 1)."""
    R: float = Field(ge=0, le=1)
    T: float = Field(ge=0, le=1)


# Per-face grid resolution, keyed by face id ("top", "bottom", "wall_N").
FaceSpacings = Dict[str, float]
FaceNumPoints = Dict[str, int]


class SessionObjectInput(BaseModel):
    """Object (obstacle) definition for session.

    ``position`` in guv_calcs is the centre of the footprint at the object's
    base, so (x, y, z) here is where the bottom face is centred. A box footprint
    is centred on it; an extrusion's polygon is translated so its centroid sits
    on it. All lengths are in the room's current units. Rotation angles are
    degrees, applied as yaw about Z, then pitch about Y, then roll about X.
    """
    id: Optional[str] = None  # Optional: if omitted, guv_calcs Registry assigns ID
    name: Optional[str] = None
    shape: Literal["box", "extrusion"] = "box"
    width: float = Field(default=1.0, gt=0)
    length: float = Field(default=1.0, gt=0)
    height: float = Field(default=1.0, gt=0)
    # Extrusion only: footprint polygon in local coordinates (>= 3 vertices)
    vertices: Optional[PolygonVertices] = Field(default=None, min_length=3)
    x: float = Field(default=0.0, allow_inf_nan=False)
    y: float = Field(default=0.0, allow_inf_nan=False)
    z: float = Field(default=0.0, allow_inf_nan=False)
    yaw: float = Field(default=0.0, allow_inf_nan=False)
    pitch: float = Field(default=0.0, allow_inf_nan=False)
    roll: float = Field(default=0.0, allow_inf_nan=False)
    reflectance: float = Field(default=0.0, ge=0, le=1)
    transmittance: float = Field(default=0.0, ge=0, le=1)
    # Sparse per-face overrides of the object-level pair, applied after it.
    face_properties: Optional[Dict[str, FaceOptics]] = None
    face_x_spacings: Optional[FaceSpacings] = None
    face_y_spacings: Optional[FaceSpacings] = None
    face_x_num_points: Optional[FaceNumPoints] = None
    face_y_num_points: Optional[FaceNumPoints] = None
    enabled: bool = True


class SessionObjectUpdate(BaseModel):
    """Partial object update.

    ``shape`` and ``vertices`` reshape the object: it is rebuilt under the same
    id with its name, position, rotation, optics and enabled flag carried over.
    An extrusion needs ``vertices`` (>= 3, local frame, room units); a box
    takes its width/length from the request or the current bounding size.
    """
    shape: Optional[Literal["box", "extrusion"]] = None
    vertices: Optional[PolygonVertices] = Field(default=None, min_length=3)
    name: Optional[str] = None
    enabled: Optional[bool] = None
    width: Optional[float] = Field(default=None, gt=0)
    length: Optional[float] = Field(default=None, gt=0)
    height: Optional[float] = Field(default=None, gt=0)
    x: Optional[float] = Field(default=None, allow_inf_nan=False)
    y: Optional[float] = Field(default=None, allow_inf_nan=False)
    z: Optional[float] = Field(default=None, allow_inf_nan=False)
    yaw: Optional[float] = Field(default=None, allow_inf_nan=False)
    pitch: Optional[float] = Field(default=None, allow_inf_nan=False)
    roll: Optional[float] = Field(default=None, allow_inf_nan=False)
    reflectance: Optional[float] = Field(default=None, ge=0, le=1)
    transmittance: Optional[float] = Field(default=None, ge=0, le=1)
    # Per-face overrides, applied after the object-level pair in the same
    # request. An object-level pair sent alone resets every face to it.
    face_properties: Optional[Dict[str, FaceOptics]] = None
    face_x_spacings: Optional[FaceSpacings] = None
    face_y_spacings: Optional[FaceSpacings] = None
    face_x_num_points: Optional[FaceNumPoints] = None
    face_y_num_points: Optional[FaceNumPoints] = None


class SessionObjectState(BaseModel):
    """Current state of an object from the session (also returned on load)."""
    id: str
    name: Optional[str] = None
    shape: Literal["box", "extrusion"]
    width: float
    length: float
    height: float
    vertices: Optional[PolygonVertices] = None
    x: float
    y: float
    z: float
    yaw: float = 0.0
    pitch: float = 0.0
    roll: float = 0.0
    reflectance: float = 0.0
    transmittance: float = 0.0
    # Faces whose R/T differ from the object-level pair (guv_calcs' sparse form).
    face_properties: Dict[str, FaceOptics] = Field(default_factory=dict)
    # Every face's current grid, keyed by face id.
    face_spacings: Dict[str, SurfaceGridSize] = Field(default_factory=dict)
    face_num_points: Dict[str, SurfaceGridSize] = Field(default_factory=dict)
    enabled: bool = True


LoadedObject = SessionObjectState


class AddObjectResponse(BaseModel):
    """Response after adding or copying an object"""
    success: bool
    object_id: str
    state: SessionObjectState
    state_hashes: Optional[Dict[str, Any]] = None


class SessionObjectUpdateResponse(BaseModel):
    """Response after updating an object - echoes the authoritative state"""
    success: bool
    message: str = "Object updated"
    object_id: str
    state: SessionObjectState
    state_hashes: Optional[Dict[str, Any]] = None


class GetObjectsResponse(BaseModel):
    """Response from GET /session/objects"""
    objects: List[SessionObjectState]


class SessionInitRequest(BaseModel):
    """Request to initialize a session with full project state"""
    room: SessionRoomConfig
    lamps: list[SessionLampInput] = []
    zones: list[SessionZoneInput] = []
    objects: list[SessionObjectInput] = []


class SessionInitResponse(BaseModel):
    """Response after session initialization"""
    success: bool
    message: str
    lamp_count: int
    zone_count: int
    object_count: int = 0


class SessionRoomUpdate(BaseModel):
    """Partial room update.

    Floor plan: send ``polygon`` to set a polygon outline, or ``x``/``y`` to
    set (or convert back to) an axis-aligned rectangle. Not both.
    """
    x: Optional[float] = Field(default=None, gt=0)
    y: Optional[float] = Field(default=None, gt=0)
    z: Optional[float] = Field(default=None, gt=0)
    polygon: Optional[PolygonVertices] = Field(
        default=None, description="Floor-plan vertices [[x, y], ...] (>= 3)",
    )
    units: Optional[LengthUnit] = None  # Use PATCH /session/units instead

    @field_validator("polygon")
    @classmethod
    def _check_polygon(cls, v):
        return _validate_polygon_vertices(v)

    @model_validator(mode="after")
    def _polygon_xor_xy(self):
        if self.polygon is not None and (self.x is not None or self.y is not None):
            raise ValueError("Specify either polygon or x/y, not both")
        return self
    precision: Optional[int] = Field(default=None, ge=0, le=10)
    colormap: Optional[str] = Field(default=None, description="Matplotlib/Plotly colormap name")
    standard: Optional[Literal["ANSI IES RP 27.1-22 (ACGIH Limits)", "UL8802 (ACGIH Limits)", "IEC 62471-6:2022 (ICNIRP Limits)"]] = None
    enable_reflectance: Optional[bool] = None
    reflectances: Optional[SurfaceReflectances] = None
    reflectance_x_spacings: Optional[Dict[str, float]] = None
    reflectance_y_spacings: Optional[Dict[str, float]] = None
    reflectance_x_num_points: Optional[Dict[str, int]] = None
    reflectance_y_num_points: Optional[Dict[str, int]] = None
    reflectance_max_num_passes: Optional[int] = Field(default=None, ge=1)
    reflectance_threshold: Optional[float] = Field(default=None, ge=0, le=1)
    air_changes: Optional[float] = Field(default=None, ge=0)
    ozone_decay_constant: Optional[float] = Field(default=None, ge=0)


class SessionLampUpdate(BaseModel):
    """Partial lamp update"""
    name: Optional[str] = None
    lamp_type: Optional[Literal["krcl_222", "lp_254", "other"]] = None
    wavelength: Optional[float] = None  # For "other" lamp type
    x: Optional[float] = None
    y: Optional[float] = None
    z: Optional[float] = None
    aimx: Optional[float] = None
    aimy: Optional[float] = None
    aimz: Optional[float] = None
    tilt: Optional[float] = None
    orientation: Optional[float] = None
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

    # Advanced settings - housing dimensions
    housing_width: Optional[float] = None
    housing_length: Optional[float] = None
    housing_height: Optional[float] = None


class SessionZoneUpdate(BaseModel):
    """Partial zone update"""
    name: Optional[str] = None
    enabled: Optional[bool] = None
    dose: Optional[bool] = None
    hours: Optional[float] = Field(default=None, ge=0)
    minutes: Optional[float] = Field(default=None, ge=0)
    seconds: Optional[float] = Field(default=None, ge=0)
    height: Optional[float] = None  # For plane zones
    offset: Optional[bool] = None
    # Plane calculation options
    calc_mode: Optional[str] = None
    ref_surface: Optional[str] = None
    direction: Optional[int] = None
    horiz: Optional[bool] = None
    vert: Optional[bool] = None
    use_normal: Optional[bool] = None
    fov_vert: Optional[float] = None
    fov_horiz: Optional[float] = None
    view_direction: Optional[list[float]] = Field(default=None, min_length=3, max_length=3)
    view_target: Optional[list[float]] = Field(default=None, min_length=3, max_length=3)
    # Plane dimensions
    x1: Optional[float] = None
    x2: Optional[float] = None
    y1: Optional[float] = None
    y2: Optional[float] = None
    # Volume dimensions
    x_min: Optional[float] = None
    x_max: Optional[float] = None
    y_min: Optional[float] = None
    y_max: Optional[float] = None
    z_min: Optional[float] = None
    z_max: Optional[float] = None
    # Point-specific (position and aim point)
    x: Optional[float] = None
    y: Optional[float] = None
    z: Optional[float] = None
    aim_x: Optional[float] = None
    aim_y: Optional[float] = None
    aim_z: Optional[float] = None
    # Grid resolution - send only one mode (num_points OR spacing)
    num_x: Optional[int] = Field(default=None, ge=1)
    num_y: Optional[int] = Field(default=None, ge=1)
    num_z: Optional[int] = Field(default=None, ge=1)
    x_spacing: Optional[float] = Field(default=None, gt=0)
    y_spacing: Optional[float] = Field(default=None, gt=0)
    z_spacing: Optional[float] = Field(default=None, gt=0)
    # Display
    display_mode: Optional[str] = None


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
    state_hashes: Optional[Dict[str, Any]] = None


class SessionZoneState(BaseModel):
    """Current state of a zone from the session"""
    id: str
    name: Optional[str] = None
    type: Literal["plane", "volume", "point"]
    enabled: bool = True
    is_standard: bool = False
    # Grid resolution
    num_x: Optional[int] = None
    num_y: Optional[int] = None
    num_z: Optional[int] = None
    x_spacing: Optional[float] = None
    y_spacing: Optional[float] = None
    z_spacing: Optional[float] = None
    offset: Optional[bool] = None
    # Plane-specific
    calc_mode: Optional[str] = None
    height: Optional[float] = None
    x1: Optional[float] = None
    x2: Optional[float] = None
    y1: Optional[float] = None
    y2: Optional[float] = None
    horiz: Optional[bool] = None
    vert: Optional[bool] = None
    use_normal: Optional[bool] = None
    fov_vert: Optional[float] = None
    fov_horiz: Optional[float] = None
    view_direction: Optional[tuple[float, ...]] = None
    view_target: Optional[tuple[float, ...]] = None
    direction: Optional[int] = None
    ref_surface: Optional[str] = None
    v_positive_direction: Optional[bool] = None
    dose: Optional[bool] = None
    hours: Optional[float] = None
    minutes: Optional[float] = None
    seconds: Optional[float] = None
    # Volume-specific
    x_min: Optional[float] = None
    x_max: Optional[float] = None
    y_min: Optional[float] = None
    y_max: Optional[float] = None
    z_min: Optional[float] = None
    z_max: Optional[float] = None
    # Point-specific
    x: Optional[float] = None
    y: Optional[float] = None
    z: Optional[float] = None
    aim_x: Optional[float] = None
    aim_y: Optional[float] = None
    aim_z: Optional[float] = None
    normal_x: Optional[float] = None
    normal_y: Optional[float] = None
    normal_z: Optional[float] = None
    # Display
    display_mode: Optional[str] = None


class GetZonesResponse(BaseModel):
    """Response from GET /session/zones"""
    zones: List[SessionZoneState]


class CopyEntityRequest(BaseModel):
    """Optional client-supplied id for a copied lamp or zone.

    IDs are client-authoritative: when new_id is given the copy is registered
    under exactly that id and a collision is a 409. Omitting it (or omitting the
    body entirely) keeps the legacy behavior where the registry assigns one.
    """
    new_id: Optional[str] = None


class AddLampResponse(BaseModel):
    """Response after adding a lamp"""
    success: bool
    lamp_id: str
    has_ies_file: bool = False
    state_hashes: Optional[Dict[str, Any]] = None


class AddZoneResponse(BaseModel):
    """Response after adding a zone"""
    success: bool
    zone_id: str
    num_x: Optional[int] = None
    num_y: Optional[int] = None
    num_z: Optional[int] = None
    x_spacing: Optional[float] = None
    y_spacing: Optional[float] = None
    z_spacing: Optional[float] = None
    state_hashes: Optional[Dict[str, Any]] = None


class SuccessResponse(BaseModel):
    """Generic success response for PATCH/DELETE operations."""
    success: bool
    message: str = "Operation completed successfully"
    state_hashes: Optional[Dict[str, Any]] = None


class RoomGeometry(BaseModel):
    """Authoritative room geometry + per-surface reflectance state.

    Echoed after any room mutation so the frontend can adopt the wall ids and
    the reflectance values guv_calcs carried over across a shape change.
    ``x``/``y`` are the bounding-box maxima (extents measured from the origin).
    """
    x: float
    y: float
    z: float
    shape: Literal["rectangle", "polygon"]
    vertices: List[List[float]]
    wall_ids: List[str]
    reflectances: Dict[str, float]
    reflectance_spacings: Dict[str, SurfaceGridSize]
    reflectance_num_points: Dict[str, SurfaceGridSize]


class RoomUpdateResponse(SuccessResponse):
    """Response from PATCH /session/room."""
    room: RoomGeometry


class LampUpdateResponse(BaseModel):
    """Response from lamp PATCH with computed aim point and tilt/orientation."""
    success: bool
    message: str = "Lamp updated"
    aimx: Optional[float] = None
    aimy: Optional[float] = None
    aimz: Optional[float] = None
    tilt: Optional[float] = None
    orientation: Optional[float] = None
    has_ies_file: Optional[bool] = None
    state_hashes: Optional[Dict[str, Any]] = None


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
    tilt: float = 0.0
    orientation: float = 0.0
    mode: str
    position_index: int = 0
    position_count: int = 1


class StateHashesResponse(BaseModel):
    """Hashed state from room.get_calc_state() and room.get_update_state()."""
    calc_state: Dict[str, Any]
    update_state: Dict[str, Any]


class CalculateResponse(BaseModel):
    """Response from calculation"""
    success: bool
    calculated_at: str
    mean_fluence: Optional[float] = None
    fluence_by_wavelength: Optional[Dict[int, float]] = None
    ozone_increase_ppb: Optional[float] = None
    zones: Dict[str, SimulationZoneResult]
    state_hashes: Optional[StateHashesResponse] = None


class SessionCreateResponse(BaseModel):
    """Response from session creation with server-generated credentials."""
    session_id: str
    token: str


# ============================================================
# Unit Conversion Schemas
# ============================================================

class SetUnitsRequest(BaseModel):
    """Request to change the unit system"""
    units: LengthUnit


class SetUnitsLampCoords(BaseModel):
    """Converted lamp coordinates after unit change"""
    x: float
    y: float
    z: float
    aimx: float
    aimy: float
    aimz: float
    source_width: Optional[float] = None
    source_length: Optional[float] = None
    source_depth: Optional[float] = None
    housing_width: Optional[float] = None
    housing_length: Optional[float] = None
    housing_height: Optional[float] = None


class SetUnitsZoneCoords(BaseModel):
    """Converted zone coordinates after unit change"""
    height: Optional[float] = None
    x1: Optional[float] = None
    x2: Optional[float] = None
    y1: Optional[float] = None
    y2: Optional[float] = None
    x_min: Optional[float] = None
    x_max: Optional[float] = None
    y_min: Optional[float] = None
    y_max: Optional[float] = None
    z_min: Optional[float] = None
    z_max: Optional[float] = None
    num_x: Optional[int] = None
    num_y: Optional[int] = None
    num_z: Optional[int] = None
    x_spacing: Optional[float] = None
    y_spacing: Optional[float] = None
    z_spacing: Optional[float] = None
    # Point-specific (position and aim point — both spatial)
    x: Optional[float] = None
    y: Optional[float] = None
    z: Optional[float] = None
    aim_x: Optional[float] = None
    aim_y: Optional[float] = None
    aim_z: Optional[float] = None


class SetUnitsObjectCoords(BaseModel):
    """Converted object position and dimensions after unit change"""
    x: float
    y: float
    z: float
    width: float
    length: float
    height: float
    vertices: Optional[PolygonVertices] = None


class SetUnitsResponse(BaseModel):
    """Response with all converted coordinates after unit change"""
    success: bool
    units: LengthUnit
    room: RoomGeometry
    lamps: Dict[str, SetUnitsLampCoords]  # lamp_id -> coords
    zones: Dict[str, SetUnitsZoneCoords]  # zone_id -> coords
    objects: Dict[str, SetUnitsObjectCoords] = {}  # object_id -> coords
    reflectance_spacings: Optional[Dict[str, Dict[str, float]]] = None  # surface -> {x, y}
    reflectance_num_points: Optional[Dict[str, Dict[str, int]]] = None  # surface -> {x, y}
    state_hashes: Optional[Dict[str, Any]] = None


# ============================================================
# Lamp Info / Plot Schemas
# ============================================================

class IESUploadResponse(BaseModel):
    """Response from IES file upload."""
    success: bool
    message: str
    has_ies_file: bool
    has_spectrum: bool = True
    filename: Optional[str] = None
    state_hashes: Optional[StateHashesResponse] = None


class IntensityMapUploadResponse(BaseModel):
    """Response from intensity map file upload."""
    success: bool
    message: str
    has_intensity_map: bool
    dimensions: Optional[tuple[int, int]] = None


class TlvLimits(BaseModel):
    """TLV limits for a single standard."""
    skin: float  # mJ/cm²
    eye: float   # mJ/cm²


class TlvFraction(BaseModel):
    """Spectrum-weighted exposure as a fraction of the skin and eye TLVs under
    one standard: each lamp's 8-hour dose divided by that lamp's own TLV, summed
    over the lamps at every point of the safety plane, maximum over the plane.
    1.0 means the limit is reached in exactly 8 hours."""
    skin: float
    eye: float


class SessionLampInfoResponse(BaseModel):
    """Lamp information for popup display (session lamp version)."""
    lamp_id: str
    name: str
    total_power_mw: float
    tlv_acgih: TlvLimits
    tlv_icnirp: TlvLimits
    has_ies: bool = True
    has_spectrum: bool


class LampFilesResponse(BaseModel):
    """Canonical embedded files for a session lamp (custom-lamp identity base)."""
    ies_filedata: Optional[str] = None
    ies_filename: Optional[str] = None
    spectrum: Optional[Dict[str, List[str]]] = None
    content_hash: Optional[str] = None


class LampPlotsResponse(BaseModel):
    """All plot images for a session lamp (photometric + spectrum)."""
    lamp_id: str
    photometric_plot_base64: Optional[str] = None
    photometric_plot_hires_base64: Optional[str] = None
    spectrum_plot_base64: Optional[str] = None
    spectrum_linear_plot_base64: Optional[str] = None
    spectrum_log_plot_base64: Optional[str] = None
    spectrum_plot_hires_base64: Optional[str] = None
    spectrum_linear_plot_hires_base64: Optional[str] = None
    spectrum_log_plot_hires_base64: Optional[str] = None


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
    # Housing dimensions
    housing_width: Optional[float] = None
    housing_length: Optional[float] = None
    housing_height: Optional[float] = None


class SurfacePlotResponse(BaseModel):
    """Surface plot image response."""
    plot_base64: str
    has_intensity_map: bool


class SimplePlotResponse(BaseModel):
    """Response containing a single plot image."""
    plot_base64: str


class SessionPhotometricWebResponse(BaseModel):
    """Photometric web mesh data for 3D visualization."""
    vertices: list  # [[x, y, z], ...]
    triangles: list  # [[i, j, k], ...]
    aim_line: list  # [[start_x, start_y, start_z], [end_x, end_y, end_z]]
    surface_points: list  # [[x, y, z], ...]
    fixture_bounds: Optional[list] = None  # [[x, y, z], ...] 8 corners or None
    color: str


# ============================================================
# Calculation / Estimate Schemas
# ============================================================

class CalculationEstimateResponse(BaseModel):
    """Estimated calculation time and resource usage."""
    estimated_seconds: float
    grid_points: int
    lamp_count: int
    reflectance_enabled: bool
    reflectance_passes: int
    memory_percent: float
    max_seconds: float
    time_percent: float


# ============================================================
# Disinfection Table Schemas
# ============================================================

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


# ============================================================
# Save/Load Schemas
# ============================================================

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
    tilt: float = 0.0
    orientation: float = 0.0
    scaling_factor: float
    enabled: bool
    has_ies_file: bool = False
    has_spectrum_file: bool = False


class LoadedZone(BaseModel):
    """Zone data returned after loading a project"""
    id: str
    name: Optional[str] = None
    type: str  # 'plane', 'volume', or 'point'
    enabled: bool
    is_standard: bool = False
    # Grid resolution
    num_x: Optional[int] = None
    num_y: Optional[int] = None
    num_z: Optional[int] = None
    x_spacing: Optional[float] = None
    y_spacing: Optional[float] = None
    z_spacing: Optional[float] = None
    offset: Optional[bool] = None
    # Plane-specific
    calc_mode: Optional[str] = None
    height: Optional[float] = None
    x1: Optional[float] = None
    x2: Optional[float] = None
    y1: Optional[float] = None
    y2: Optional[float] = None
    ref_surface: Optional[str] = None
    direction: Optional[int] = None
    horiz: Optional[bool] = None
    vert: Optional[bool] = None
    use_normal: Optional[bool] = None
    fov_vert: Optional[float] = None
    fov_horiz: Optional[float] = None
    view_direction: Optional[tuple[float, ...]] = None
    view_target: Optional[tuple[float, ...]] = None
    v_positive_direction: Optional[bool] = None  # True if v_hat points in positive direction of its dominant axis
    dose: Optional[bool] = None
    hours: Optional[float] = None
    minutes: Optional[float] = None
    seconds: Optional[float] = None
    # Volume-specific
    x_min: Optional[float] = None
    x_max: Optional[float] = None
    y_min: Optional[float] = None
    y_max: Optional[float] = None
    z_min: Optional[float] = None
    z_max: Optional[float] = None
    # Point-specific
    x: Optional[float] = None
    y: Optional[float] = None
    z: Optional[float] = None
    aim_x: Optional[float] = None
    aim_y: Optional[float] = None
    aim_z: Optional[float] = None
    normal_x: Optional[float] = None
    normal_y: Optional[float] = None
    normal_z: Optional[float] = None
    # Display
    display_mode: Optional[str] = None


class SurfaceInfo(BaseModel):
    """Per-surface spacing and num_points for reflectance grids."""
    x_spacing: float
    y_spacing: float
    num_x: int
    num_y: int


class ReflectanceSurfacesResponse(BaseModel):
    """Response from GET /session/room/surfaces."""
    surfaces: Dict[str, SurfaceInfo]


class LoadedRoom(BaseModel):
    """Room configuration returned after loading a project"""
    x: float
    y: float
    z: float
    shape: Literal["rectangle", "polygon"] = "rectangle"
    vertices: List[List[float]] = Field(default_factory=list)
    wall_ids: List[str] = Field(default_factory=list)
    units: LengthUnit
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
    objects: list[LoadedObject] = []


# ============================================================
# Safety Check Schemas
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
    skin_near_limit: bool
    eye_near_limit: bool
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
    is_skin_compliant: bool
    is_eye_compliant: bool
    skin_near_limit: bool
    eye_near_limit: bool
    skin_dimming_for_compliance: Optional[float] = None
    eye_dimming_for_compliance: Optional[float] = None
    # Weighted exposure as a fraction of the TLV under each standard, regardless
    # of the room's selected standard. Keys: ACGIH, ICNIRP. Absent when no lamp
    # with a TLV contributed to the safety planes.
    tlv_fraction_by_standard: Dict[str, TlvFraction] = {}


# ============================================================
# Position Check / Nudge Schemas
# ============================================================

class PositionWarningItem(BaseModel):
    """A single position warning for a lamp or zone."""
    id: str
    name: Optional[str] = None
    message: str


class PositionWarningsResponse(BaseModel):
    """Response from check-positions endpoint."""
    warnings: List[PositionWarningItem]


class NudgedLampPosition(BaseModel):
    """New position for a lamp after nudging into bounds."""
    id: str
    x: float
    y: float
    z: float
    aimx: float
    aimy: float
    aimz: float


class NudgedZonePosition(BaseModel):
    """New position for a zone after nudging into bounds."""
    id: str
    type: str
    # Plane fields
    x1: Optional[float] = None
    x2: Optional[float] = None
    y1: Optional[float] = None
    y2: Optional[float] = None
    height: Optional[float] = None
    # Volume fields
    z_min: Optional[float] = None
    z_max: Optional[float] = None
    # Point fields
    x: Optional[float] = None
    y: Optional[float] = None
    z: Optional[float] = None
    aim_x: Optional[float] = None
    aim_y: Optional[float] = None
    aim_z: Optional[float] = None


class NudgedObjectPosition(BaseModel):
    """New base-centre position for an object after nudging into bounds."""
    id: str
    x: float
    y: float
    z: float


class NudgeIntoBoundsResponse(BaseModel):
    """Response from nudge-into-bounds endpoint."""
    lamps: List[NudgedLampPosition]
    zones: List[NudgedZonePosition]
    objects: List[NudgedObjectPosition] = []
    state_hashes: Optional[StateHashesResponse] = None


# ============================================================
# Mass Lamp Operations Schemas
# ============================================================

class MassPlaceRequest(BaseModel):
    """Request to compute placements for multiple lamps at once."""
    lamps_by_mode: Dict[Literal["downlight", "corner", "edge", "horizontal"], List[str]]


class MassPlaceResponse(BaseModel):
    """Response with computed placements keyed by lamp_id."""
    placements: Dict[str, PlaceLampResponse]


class AimRequest(BaseModel):
    """Request to compute aim for lamps."""
    aim_mode: Literal["point", "direction", "down", "centroid", "furthest_edge", "furthest_corner"]
    lamp_ids: Optional[List[str]] = None  # None = all enabled lamps
    target: Optional[List[float]] = None  # [x, y, z] for "point" mode
    direction: Optional[List[float]] = None  # [dx, dy, dz] for "direction" mode


class AimResponseItem(BaseModel):
    """Aim result for a single lamp."""
    lamp_id: str
    aimx: float
    aimy: float
    aimz: float


class AimResponse(BaseModel):
    """Response with computed aims keyed by lamp_id."""
    results: Dict[str, AimResponseItem]


class SetHeightRequest(BaseModel):
    """Request to compute lamp height."""
    z: Optional[float] = None
    ceiling_offset: Optional[float] = None
    lamp_ids: Optional[List[str]] = None


class SetHeightResponse(BaseModel):
    """Response with computed height value."""
    z: float
    lamp_ids: List[str]
