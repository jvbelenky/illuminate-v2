from pydantic import BaseModel, Field, conint
from typing import Optional, Tuple, Dict, Literal
from uuid import UUID
import datetime


class RoomInput(BaseModel):
    x: float
    y: float
    z: float
    units: Literal["meters", "feet"] = "meters"
    precision: Optional[int] = 1

class LampInput(BaseModel):
    wavelength: Optional[float] = 254
    guv_type: Optional[str] = "Low-pressure mercury (254 nm)"
    x: float
    y: float
    z: float
    aimx: Optional[float] = None
    aimy: Optional[float] = None
    aimz: Optional[float] = None
    scaling_factor: Optional[float] = None
    preset_id: Optional[str] = None  # e.g., "ushio_b1", "aerolamp", etc.
    enabled: bool = True  # Whether this lamp is included in calculations

class ZoneInput(BaseModel):
    """Zone definition for simulation request"""
    zone_id: Optional[str] = None
    name: Optional[str] = None
    zone_type: Literal["plane", "volume"] = "plane"
    enabled: bool = True

    # Value display settings
    dose: bool = False  # If True, calculate dose (mJ/cm²) instead of irradiance
    hours: float = 8.0  # Exposure time for dose calculation

    # For planes - dimensions
    height: Optional[float] = None
    x1: Optional[float] = None  # Plane X min (defaults to 0)
    x2: Optional[float] = None  # Plane X max (defaults to room.x)
    y1: Optional[float] = None  # Plane Y min (defaults to 0)
    y2: Optional[float] = None  # Plane Y max (defaults to room.y)

    # Plane-specific calculation options
    calc_type: Optional[Literal["planar_normal", "planar_max", "fluence_rate", "vertical_dir", "vertical"]] = None
    ref_surface: Literal["xy", "xz", "yz"] = "xy"
    direction: Optional[int] = None  # Normal direction: 1, -1, or 0 for omnidirectional
    horiz: bool = False  # Include horizontal component
    vert: bool = False   # Include vertical component
    fov_vert: float = 80   # Vertical field of view (degrees)
    fov_horiz: float = 360  # Horizontal field of view (degrees)

    # For volumes - dimensions
    x_min: Optional[float] = None
    x_max: Optional[float] = None
    y_min: Optional[float] = None
    y_max: Optional[float] = None
    z_min: Optional[float] = None
    z_max: Optional[float] = None

    # Resolution (both plane and volume)
    num_x: Optional[int] = None
    num_y: Optional[int] = None
    num_z: Optional[int] = None
    x_spacing: Optional[float] = None
    y_spacing: Optional[float] = None
    z_spacing: Optional[float] = None

    # Grid offset option
    offset: bool = True  # If True, points offset from boundary

    # Display options
    show_values: bool = True

class SimulationRequest(BaseModel):
    room: RoomInput
    lamps: list[LampInput] = []  # Support multiple lamps, empty = zeros everywhere
    zones: Optional[list[ZoneInput]] = None  # If None, uses standard zones
    include_zone_values: bool = True  # Whether to return full value arrays


class SimulationZoneResult(BaseModel):
    """Zone result with optional values for visualization"""
    zone_id: str
    zone_name: Optional[str]
    zone_type: str
    statistics: dict  # min, max, mean, std
    num_points: Optional[list[int]] = None  # [num_x, num_y] or [num_x, num_y, num_z]
    values: Optional[list] = None  # 2D or 3D array of values


class SimulationResponse(BaseModel):
    success: bool
    mean_fluence: Optional[float] = None
    units: str
    zones: Optional[dict[str, SimulationZoneResult]] = None


# === Base model for creating a Room ===
class RoomCreateRequest(BaseModel):
    x: float = Field(..., description="Room length")
    y: float = Field(..., description="Room width")
    z: float = Field(..., description="Room height")
    units: Literal["meters", "feet"] = Field("meters", description="Measurement units")
    standard: Optional[str] = Field("ACGIH", description="Photobiological safety standard")
    enable_reflectance: Optional[bool] = Field(False, description="Enable wall reflectance")
    reflectances: Optional[Dict[str, float]] = Field(None, description="Wall reflectance values")
    reflectance_x_spacings: Optional[Dict[str, float]] = None
    reflectance_y_spacings: Optional[Dict[str, float]] = None
    reflectance_max_num_passes: Optional[int] = 100
    reflectance_threshold: Optional[float] = 0.02
    air_changes: Optional[float] = 6.0
    ozone_decay_constant: Optional[float] = 0.15
    colormap: Optional[str] = Field("plasma", description="Matplotlib colormap name")
    precision: Optional[conint(ge=1, le=9)] = Field(1, description="Calculation precision (1–9)") # type: ignore
    room_name: Optional[str] = Field(None, description="Optional room name provided by user")
    created_by_user_id: Optional[str] = Field(None, description="ID of the user creating the room")


# === Response schema for Room summary ===
class RoomSummaryResponse(BaseModel):
    room_name: str
    room_id: str
    room_uuid: UUID
    dimensions: Tuple[float, float, float]
    units: str
    standard: str
    enable_reflectance: bool
    air_changes: float
    ozone_decay_constant: float
    colormap: str
    number_of_lamps: int
    number_of_calc_zones: int
    created_at: str
    updated_at: str
    created_by_user_id: Optional[str]

# === Request schema for updating a Room ===
class RoomUpdateRequest(BaseModel):
    room_name: Optional[str] = None
    x: Optional[float]
    y: Optional[float]
    z: Optional[float]
    units: Optional[Literal["meters", "feet"]] = None
    precision: Optional[conint(ge=1, le=9)] = None # type: ignore
    standard: Optional[Literal["ACGIH", "ACGIH-UL8802", "ICNIRP"]]
    enable_reflectance: Optional[bool]
    air_changes: Optional[float]
    ozone_decay_constant: Optional[float]
    colormap: Optional[str]


# === Calculation Zone Schemas ===

# Common parameters for all zones
class CalcZoneCommon(BaseModel):
    """Common parameters shared by all calculation zone types"""
    zone_id: Optional[str] = Field(None, description="Unique identifier (auto-generated if not provided)")
    name: Optional[str] = Field(None, description="Display name for the zone")
    enabled: bool = Field(True, description="Whether this zone is included in calculations")
    show_values: bool = Field(True, description="Show values in visualization")
    colormap: Optional[str] = Field(None, description="Matplotlib colormap name")
    dose: bool = Field(False, description="Calculate dose (mJ/cm²) instead of fluence rate (µW/cm²)")
    hours: float = Field(8.0, description="Hours for dose calculation (only used if dose=True)")


# === Grid Resolution Options ===
# Users can specify EITHER spacing OR num_points, not both
class GridResolutionBySpacing(BaseModel):
    """Define grid resolution by point spacing"""
    x_spacing: float = Field(..., gt=0, description="Spacing between points in X dimension")
    y_spacing: Optional[float] = Field(None, gt=0, description="Spacing in Y (defaults to x_spacing)")
    z_spacing: Optional[float] = Field(None, gt=0, description="Spacing in Z for volumes (defaults to x_spacing)")

class GridResolutionByCount(BaseModel):
    """Define grid resolution by number of points"""
    num_x: int = Field(..., ge=1, description="Number of points in X dimension")
    num_y: Optional[int] = Field(None, ge=1, description="Number of points in Y (defaults to num_x)")
    num_z: Optional[int] = Field(None, ge=1, description="Number of points in Z for volumes (defaults to num_x)")

class GridResolutionSingle(BaseModel):
    """Define grid resolution with a single value for all dimensions"""
    spacing: Optional[float] = Field(None, gt=0, description="Uniform spacing for all dimensions")
    num_points: Optional[int] = Field(None, ge=1, description="Uniform point count for all dimensions")


# === CalcPlane Initialization Methods ===

class CalcPlaneFromBounds(CalcZoneCommon):
    """Create a horizontal plane from explicit bounds (axis-aligned rectangle)"""
    init_method: Literal["bounds"] = "bounds"
    x1: float = Field(0.0, description="Minimum X coordinate")
    x2: float = Field(..., description="Maximum X coordinate")
    y1: float = Field(0.0, description="Minimum Y coordinate")
    y2: float = Field(..., description="Maximum Y coordinate")
    height: float = Field(..., description="Z height of the plane")
    # Resolution - one of these approaches
    x_spacing: Optional[float] = Field(None, gt=0, description="Spacing in X")
    y_spacing: Optional[float] = Field(None, gt=0, description="Spacing in Y")
    num_x: Optional[int] = Field(None, ge=1, description="Number of points in X")
    num_y: Optional[int] = Field(None, ge=1, description="Number of points in Y")
    offset: bool = Field(True, description="Center grid within bounds")
    # Plane-specific calculation options
    ref_surface: Literal["xy", "xz", "yz"] = Field("xy", description="Reference surface orientation")
    direction: Literal[-1, 1] = Field(1, description="Normal direction (+1 or -1)")
    fov_vert: float = Field(180, ge=0, le=180, description="Vertical field of view (degrees)")
    fov_horiz: float = Field(360, ge=0, le=360, description="Horizontal field of view (degrees)")
    vert: bool = Field(False, description="Include vertical component")
    horiz: bool = Field(False, description="Include horizontal component")
    use_normal: bool = Field(True, description="Use surface normal for calculation")

class CalcPlaneFromFace(CalcZoneCommon):
    """Create a plane on a room wall/face (uses room dimensions)"""
    init_method: Literal["face"] = "face"
    wall: Literal["floor", "ceiling", "north", "south", "east", "west"] = Field(..., description="Which wall to place the plane on")
    normal_offset: float = Field(0.0, description="Offset from wall in normal direction (e.g., height above floor)")
    # Resolution - single value for simplicity
    spacing: Optional[float] = Field(None, gt=0, description="Uniform spacing")
    num_points: Optional[int] = Field(None, ge=1, description="Uniform point count")
    offset: bool = Field(True, description="Center grid within bounds")
    # Plane-specific calculation options
    fov_vert: float = Field(180, ge=0, le=180, description="Vertical field of view (degrees)")
    fov_horiz: float = Field(360, ge=0, le=360, description="Horizontal field of view (degrees)")
    vert: bool = Field(False, description="Include vertical component")
    horiz: bool = Field(False, description="Include horizontal component")
    use_normal: bool = Field(True, description="Use surface normal for calculation")

class CalcPlaneFromPoints(CalcZoneCommon):
    """Create an arbitrary plane from three 3D points"""
    init_method: Literal["points"] = "points"
    p0: Tuple[float, float, float] = Field(..., description="Origin point (x, y, z)")
    pU: Tuple[float, float, float] = Field(..., description="U-axis endpoint")
    pV: Tuple[float, float, float] = Field(..., description="V-axis endpoint")
    # Resolution
    spacing: Optional[float] = Field(None, gt=0, description="Uniform spacing")
    num_points: Optional[int] = Field(None, ge=1, description="Uniform point count")
    offset: bool = Field(True, description="Center grid within bounds")
    # Plane-specific calculation options
    fov_vert: float = Field(180, ge=0, le=180, description="Vertical field of view (degrees)")
    fov_horiz: float = Field(360, ge=0, le=360, description="Horizontal field of view (degrees)")
    vert: bool = Field(False, description="Include vertical component")
    horiz: bool = Field(False, description="Include horizontal component")
    use_normal: bool = Field(True, description="Use surface normal for calculation")


# === CalcVol Initialization Methods ===

class CalcVolFromBounds(CalcZoneCommon):
    """Create a volume from explicit bounds"""
    init_method: Literal["bounds"] = "bounds"
    x1: float = Field(0.0, description="Minimum X coordinate")
    x2: float = Field(..., description="Maximum X coordinate")
    y1: float = Field(0.0, description="Minimum Y coordinate")
    y2: float = Field(..., description="Maximum Y coordinate")
    z1: float = Field(0.0, description="Minimum Z coordinate")
    z2: float = Field(..., description="Maximum Z coordinate")
    # Resolution - one of these approaches
    x_spacing: Optional[float] = Field(None, gt=0)
    y_spacing: Optional[float] = Field(None, gt=0)
    z_spacing: Optional[float] = Field(None, gt=0)
    num_x: Optional[int] = Field(None, ge=1)
    num_y: Optional[int] = Field(None, ge=1)
    num_z: Optional[int] = Field(None, ge=1)
    offset: bool = Field(True, description="Center grid within bounds")

class CalcVolFromDims(CalcZoneCommon):
    """Create a volume matching room dimensions"""
    init_method: Literal["dims"] = "dims"
    # Resolution - single value for all dimensions
    spacing: Optional[float] = Field(None, gt=0, description="Uniform spacing")
    num_points: Optional[int] = Field(None, ge=1, description="Uniform point count")
    offset: bool = Field(True, description="Center grid within bounds")


# === Union Types for API Endpoints ===
from typing import Union

CalcPlaneCreate = Union[CalcPlaneFromBounds, CalcPlaneFromFace, CalcPlaneFromPoints]
CalcVolCreate = Union[CalcVolFromBounds, CalcVolFromDims]
CalcZoneCreate = Union[CalcPlaneFromBounds, CalcPlaneFromFace, CalcPlaneFromPoints, CalcVolFromBounds, CalcVolFromDims]


# === Response Schemas ===
class CalcZoneResponse(BaseModel):
    zone_id: str
    name: Optional[str]
    zone_type: Literal["plane", "volume"]
    init_method: str
    enabled: bool
    dose: bool
    hours: float
    bounds: dict  # {x1, x2, y1, y2, z1?, z2?}
    resolution: dict  # {num_x, num_y, num_z?, x_spacing, y_spacing, z_spacing?}
    # Plane-specific (null for volumes)
    plane_config: Optional[dict] = None  # {fov_vert, fov_horiz, vert, horiz, use_normal, ref_surface, direction}


class CalcZoneUpdate(BaseModel):
    """Update an existing zone - only provided fields are updated"""
    name: Optional[str] = None
    enabled: Optional[bool] = None
    dose: Optional[bool] = None
    hours: Optional[float] = None
    show_values: Optional[bool] = None
    colormap: Optional[str] = None
    # Plane-specific
    fov_vert: Optional[float] = None
    fov_horiz: Optional[float] = None
    vert: Optional[bool] = None
    horiz: Optional[bool] = None
    use_normal: Optional[bool] = None


# === Comprehensive Simulation Schemas ===
class FullSimulationRequest(BaseModel):
    """Request for a full room simulation with all lamps and zones"""
    include_safety: bool = True
    include_efficacy: bool = True
    include_ozone: bool = True

class ZoneResultResponse(BaseModel):
    zone_id: str
    zone_name: Optional[str]
    zone_type: str
    statistics: dict  # min, max, mean, std
    values: Optional[list] = None  # Full grid values if requested
    heatmap_data: Optional[dict] = None  # x, y, values for plotting

class SafetyResultResponse(BaseModel):
    standard: str
    skin_dose: dict  # raw, weighted, tlv, hours_to_limit, compliant
    eye_dose: dict
    overall_compliant: bool
    dimming_recommendation: Optional[float] = None

class EfficacyResultResponse(BaseModel):
    average_fluence: float
    each_uv: float  # equivalent air changes from UV
    fluence_units: str

class OzoneResultResponse(BaseModel):
    estimated_increase_ppb: float
    air_changes: float
    decay_constant: float
    warning: Optional[str] = None

class FullSimulationResponse(BaseModel):
    success: bool
    room_id: str
    calculated_at: str
    zones: Dict[str, ZoneResultResponse]
    safety: Optional[SafetyResultResponse] = None
    efficacy: Optional[EfficacyResultResponse] = None
    ozone: Optional[OzoneResultResponse] = None
    errors: Optional[list] = None
