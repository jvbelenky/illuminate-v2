"""Pydantic schemas for the session router endpoints."""

from pydantic import BaseModel, Field
from typing import Optional, Dict, Literal, Any, List

from .schemas import SurfaceReflectances, SimulationZoneResult


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
    ozone_decay_constant: float = Field(default=2.5, ge=0)


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
    type: Literal["plane", "volume"] = "plane"
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
    units: Optional[Literal["meters", "feet"]] = None  # Use PATCH /session/units instead
    precision: Optional[int] = Field(default=None, ge=0, le=10)
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
    calc_type: Optional[str] = None
    ref_surface: Optional[str] = None
    direction: Optional[int] = None
    fov_vert: Optional[float] = None
    fov_horiz: Optional[float] = None
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
    # Grid resolution - send only one mode (num_points OR spacing)
    num_x: Optional[int] = Field(default=None, ge=1)
    num_y: Optional[int] = Field(default=None, ge=1)
    num_z: Optional[int] = Field(default=None, ge=1)
    x_spacing: Optional[float] = Field(default=None, gt=0.005)
    y_spacing: Optional[float] = Field(default=None, gt=0.005)
    z_spacing: Optional[float] = Field(default=None, gt=0.005)


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
    type: Literal["plane", "volume"]
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
    height: Optional[float] = None
    x1: Optional[float] = None
    x2: Optional[float] = None
    y1: Optional[float] = None
    y2: Optional[float] = None
    horiz: Optional[bool] = None
    vert: Optional[bool] = None
    fov_vert: Optional[float] = None
    fov_horiz: Optional[float] = None
    direction: Optional[int] = None
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


class GetZonesResponse(BaseModel):
    """Response from GET /session/zones"""
    zones: List[SessionZoneState]


class AddLampResponse(BaseModel):
    """Response after adding a lamp"""
    success: bool
    lamp_id: str
    state_hashes: Optional[Dict[str, Any]] = None


class AddZoneResponse(BaseModel):
    """Response after adding a zone"""
    success: bool
    zone_id: str
    state_hashes: Optional[Dict[str, Any]] = None


class SuccessResponse(BaseModel):
    """Generic success response for PATCH/DELETE operations."""
    success: bool
    message: str = "Operation completed successfully"
    state_hashes: Optional[Dict[str, Any]] = None


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
    units: Literal["meters", "feet"]


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
    x_spacing: Optional[float] = None
    y_spacing: Optional[float] = None
    z_spacing: Optional[float] = None


class SetUnitsResponse(BaseModel):
    """Response with all converted coordinates after unit change"""
    success: bool
    units: str
    room: Dict[str, float]  # {x, y, z}
    lamps: Dict[str, SetUnitsLampCoords]  # lamp_id -> coords
    zones: Dict[str, SetUnitsZoneCoords]  # zone_id -> coords
    reflectance_spacings: Optional[Dict[str, Dict[str, float]]] = None  # surface -> {x, y}
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


class SessionLampInfoResponse(BaseModel):
    """Lamp information for popup display (session lamp version)."""
    lamp_id: str
    name: str
    total_power_mw: float
    tlv_acgih: TlvLimits
    tlv_icnirp: TlvLimits
    has_ies: bool = True
    has_spectrum: bool


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
    budget_percent: float
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


class LoadedZone(BaseModel):
    """Zone data returned after loading a project"""
    id: str
    name: Optional[str] = None
    type: str  # 'plane' or 'volume'
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
    minutes: Optional[float] = None
    seconds: Optional[float] = None
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
