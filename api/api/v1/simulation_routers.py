from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional
import logging

from guv_calcs import create_standard_zones
from guv_calcs.calc_zone import CalcPlane, CalcVol
from guv_calcs.geometry import RoomDimensions, Polygon2D
from guv_calcs.safety import PhotStandard
from guv_calcs.units import LengthUnits

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


def _zone_to_definition(zone) -> StandardZoneDefinition:
    """Serialize a CalcPlane/CalcVol into a StandardZoneDefinition."""
    is_vol = isinstance(zone, CalcVol)
    d = StandardZoneDefinition(
        zone_id=zone.id,
        name=zone.name,
        zone_type="volume" if is_vol else "plane",
        x_min=zone.x1,
        x_max=zone.x2,
        y_min=zone.y1,
        y_max=zone.y2,
        num_x=zone.num_x,
        num_y=zone.num_y,
        x_spacing=zone.x_spacing,
        y_spacing=zone.y_spacing,
        dose=zone.dose,
        hours=zone.hours,
        show_values=zone.show_values,
    )
    if is_vol:
        d.z_min = zone.z1
        d.z_max = zone.z2
        d.num_z = zone.num_z
        d.z_spacing = zone.z_spacing
    else:
        d.height = getattr(zone, 'height', None)
        d.use_normal = getattr(zone, 'use_normal', None)
        d.vert = getattr(zone, 'vert', None)
        d.horiz = getattr(zone, 'horiz', None)
        d.fov_vert = getattr(zone, 'fov_vert', None)
    return d


@router.post("/standard-zones", response_model=StandardZonesResponse, tags=["Simulation"])
def get_standard_zones(request: StandardZonesRequest):
    """
    Get the standard zone definitions (WholeRoomFluence, EyeLimits, SkinLimits)
    based on room dimensions and safety standard.
    """
    try:
        standard = PhotStandard.from_any(request.standard)
        dims = RoomDimensions(
            polygon=Polygon2D.rectangle(request.x, request.y),
            z=request.z,
            units=LengthUnits(request.units),
        )
        zones = create_standard_zones(standard, dims)
        return StandardZonesResponse(zones=[_zone_to_definition(z) for z in zones])

    except Exception as e:
        logger.error(f"Failed to get standard zones: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to get standard zones: {str(e)}")
