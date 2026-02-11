from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional
import logging

# Initialize logger
logger = logging.getLogger(__name__)

# === Simulation Router Initialization ===
router = APIRouter()

# Cap standard zone grid to 200 points per dimension (200×200 = 40K pts per plane zone)
MAX_STANDARD_ZONE_POINTS_PER_DIM = 200


def _standard_zone_spacing(room_dim: float, base_spacing: float = 0.1) -> float:
    """Scale spacing for small/large rooms to keep grid points reasonable."""
    if room_dim <= 0:
        return base_spacing
    if room_dim < base_spacing:
        return room_dim / 10
    points_at_base = room_dim / base_spacing + 1
    if points_at_base <= MAX_STANDARD_ZONE_POINTS_PER_DIM:
        return base_spacing
    return room_dim / (MAX_STANDARD_ZONE_POINTS_PER_DIM - 1)

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
        from guv_calcs.safety import PhotStandard

        # Parse the standard
        standard = PhotStandard.from_any(request.standard)
        flags = standard.flags(request.units)

        # Build zone definitions matching scene.add_standard_zones()
        zones = [
            StandardZoneDefinition(
                zone_id="WholeRoomFluence",
                name="Whole Room Fluence",
                zone_type="volume",
                x_min=0,
                x_max=request.x,
                y_min=0,
                y_max=request.y,
                z_min=0,
                z_max=request.z,
                num_x=25,
                num_y=25,
                num_z=25,
                dose=False,
                show_values=False,
            ),
            StandardZoneDefinition(
                zone_id="EyeLimits",
                name="Eye Dose (8 Hours)",
                zone_type="plane",
                x_min=0,
                x_max=request.x,
                y_min=0,
                y_max=request.y,
                height=flags["height"],
                x_spacing=_standard_zone_spacing(request.x),
                y_spacing=_standard_zone_spacing(request.y),
                dose=True,
                hours=8,
                use_normal=False,
                vert=flags["eye_vert"],
                fov_vert=flags["fov_vert"],
                show_values=True,
            ),
            StandardZoneDefinition(
                zone_id="SkinLimits",
                name="Skin Dose (8 Hours)",
                zone_type="plane",
                x_min=0,
                x_max=request.x,
                y_min=0,
                y_max=request.y,
                height=flags["height"],
                x_spacing=_standard_zone_spacing(request.x),
                y_spacing=_standard_zone_spacing(request.y),
                dose=True,
                hours=8,
                use_normal=False,
                horiz=flags["skin_horiz"],
                show_values=True,
            ),
        ]

        return StandardZonesResponse(zones=zones)

    except Exception as e:
        logger.error(f"Failed to get standard zones: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to get standard zones: {str(e)}")
