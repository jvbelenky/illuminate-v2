from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional
import logging

from guv_calcs import get_standard_zone_definitions
from guv_calcs.safety import PhotStandard

# Initialize logger
logger = logging.getLogger(__name__)

# === Simulation Router Initialization ===
router = APIRouter()

# === Standard Zones Endpoint ===
class StandardZonesRequest(BaseModel):
    x: float = Field(..., description="Room X dimension")
    y: float = Field(..., description="Room Y dimension")
    z: float = Field(..., description="Room Z dimension")
    units: str = Field("meters", description="Room units (meters or feet)")
    standard: str = Field("ACGIH", description="Photobiological safety standard")


class StandardZoneDefinition(BaseModel):
    zone_id: str
    name: str
    zone_type: str  # "plane" or "volume"
    # Common fields
    x_min: Optional[float] = None
    x_max: Optional[float] = None
    y_min: Optional[float] = None
    y_max: Optional[float] = None
    z_min: Optional[float] = None
    z_max: Optional[float] = None
    height: Optional[float] = None
    num_x: Optional[int] = None
    num_y: Optional[int] = None
    num_z: Optional[int] = None
    x_spacing: Optional[float] = None
    y_spacing: Optional[float] = None
    z_spacing: Optional[float] = None
    # Plane-specific
    dose: bool = False
    hours: float = 8.0
    use_normal: Optional[bool] = None
    vert: Optional[bool] = None
    horiz: Optional[bool] = None
    fov_vert: Optional[float] = None
    show_values: bool = True


class StandardZonesResponse(BaseModel):
    zones: List[StandardZoneDefinition]


@router.post("/standard-zones", response_model=StandardZonesResponse, tags=["Simulation"])
def get_standard_zones(request: StandardZonesRequest):
    """
    Get the standard zone definitions (WholeRoomFluence, EyeLimits, SkinLimits)
    based on room dimensions and safety standard.

    These match exactly what guv-calcs creates when room.add_standard_zones() is called.
    """
    try:
        standard = PhotStandard.from_any(request.standard)
        zone_dicts = get_standard_zone_definitions(
            standard, x=request.x, y=request.y, z=request.z, units=request.units,
        )
        zones = [StandardZoneDefinition(**d) for d in zone_dicts]
        return StandardZonesResponse(zones=zones)

    except Exception as e:
        logger.error(f"Failed to get standard zones: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to get standard zones: {str(e)}")
