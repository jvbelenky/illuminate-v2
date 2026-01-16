from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime
from fastapi.responses import JSONResponse
from guv_calcs.room import Room # type: ignore
from guv_calcs.lamp import Lamp # type: ignore
from guv_calcs.calc_zone import CalcPlane, CalcVol # type: ignore
from guv_calcs.scene import Scene # type: ignore
from .schemas import (
    SimulationRequest,
    SimulationResponse,
    SimulationZoneResult,
    FullSimulationRequest,
    FullSimulationResponse,
    ZoneResultResponse,
    SafetyResultResponse,
    EfficacyResultResponse,
    OzoneResultResponse,
)
from .room_routers import room_store, save_rooms
import logging
import numpy as np
from app.logging_config import *  # This triggers setup once at startup

# Initialize logger
logger = logging.getLogger(__name__)

# === Simulation Router Initialization ===
router = APIRouter()

class LampInput(BaseModel):
    x: float
    y: float
    z: float
    power: float
    spectrum: str

class RoomInput(BaseModel):
    x: float
    y: float
    z: float
    units: str = "meters"
    lamps: List[LampInput]
    calc_plane_z: float = Field(..., description="Height of the calculation plane")
    resolution: float = Field(0.25, description="Grid resolution for calc plane")


# V1 for Simulation
# @router.post("/simulate")
# def run_simulation(request: SimulationRequest):
#     try:
#         # Create Room
#         room = Room(
#             x=request.room.x,
#             y=request.room.y,
#             z=request.room.z,
#             units=request.room.units,
#             precision=request.room.precision
#         )

#         # Create Lamp
#         # lamp = Lamp(
#         #     wavelength=request.lamp.wavelength,
#         #     wattage=request.lamp.wattage,
#         #     x=request.lamp.x,
#         #     y=request.lamp.y,
#         #     z=request.lamp.z
#         # )
#         lamp = Lamp(
#     x=request.lamp.x,
#     y=request.lamp.y,
#     z=request.lamp.z,
#     wavelength=request.lamp.wavelength,
#     guv_type=request.lamp.guv_type,
#     aimx=request.lamp.aimx,
#     aimy=request.lamp.aimy,
#     aimz=request.lamp.aimz,
#     scaling_factor=request.lamp.scaling_factor,)

#         # Add to room
#         room.add_lamp(lamp)
#         room.add_calc_zone(WholeRoomFluence())

#         # Calculate
#         room.calculate()

#         # Extract results
#         fluence_dict, df, _ = room.get_disinfection_data(zone_id="WholeRoomFluence")
#         mean_fluence = fluence_dict.get("mean", None)

#         return {
#             "success": True,
#             "mean_fluence": mean_fluence,
#             "units": room.units
#         }

#     except Exception as e:
#         raise HTTPException(status_code=400, detail=f"Simulation failed: {str(e)}")


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
                x_spacing=0.1,
                y_spacing=0.1,
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
                x_spacing=0.1,
                y_spacing=0.1,
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


# V2 for Simulation
@router.post("/simulate", response_model=SimulationResponse, tags=["Simulation"])
def run_simulation(request: SimulationRequest):
    try:
        # Create Room
        logger.info("Creating room...")
        room = Room(
            x=request.room.x,
            y=request.room.y,
            z=request.room.z,
            units=request.room.units,
            precision=request.room.precision or 1
        )

        # Create and add all lamps
        logger.info(f"Adding {len(request.lamps)} lamp(s)...")
        for i, lamp_input in enumerate(request.lamps):
            if lamp_input.preset_id:
                logger.info(f"Creating lamp {i+1} from preset: {lamp_input.preset_id}")
                lamp = Lamp.from_keyword(
                    lamp_input.preset_id,
                    x=lamp_input.x,
                    y=lamp_input.y,
                    z=lamp_input.z,
                    aimx=lamp_input.aimx,
                    aimy=lamp_input.aimy,
                    aimz=lamp_input.aimz,
                    scaling_factor=lamp_input.scaling_factor or 1.0,
                )
            else:
                logger.warning(f"Lamp {i+1} has no preset_id - will have no photometric data")
                lamp = Lamp(
                    x=lamp_input.x,
                    y=lamp_input.y,
                    z=lamp_input.z,
                    wavelength=lamp_input.wavelength,
                    guv_type=lamp_input.guv_type,
                    aimx=lamp_input.aimx,
                    aimy=lamp_input.aimy,
                    aimz=lamp_input.aimz,
                    scaling_factor=lamp_input.scaling_factor or 1.0,
                )
            # Set enabled status from request
            lamp.enabled = lamp_input.enabled
            room.add_lamp(lamp)

        # Add zones - either from request or standard zones
        if request.zones and len(request.zones) > 0:
            logger.info(f"Adding {len(request.zones)} user-defined zones...")
            for i, zone_input in enumerate(request.zones):
                zone_id = zone_input.zone_id or f"zone_{i}"

                if zone_input.zone_type == "plane":
                    # Create CalcPlane with all parameters
                    zone = CalcPlane(
                        zone_id=zone_id,
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
                        # Plane-specific calculation options
                        ref_surface=zone_input.ref_surface,
                        direction=zone_input.direction,
                        horiz=zone_input.horiz,
                        vert=zone_input.vert,
                        fov_vert=zone_input.fov_vert,
                        fov_horiz=zone_input.fov_horiz,
                        # Value display settings
                        dose=zone_input.dose,
                        hours=zone_input.hours,
                    )
                    zone.enabled = zone_input.enabled
                else:
                    # Create CalcVol with all parameters
                    zone = CalcVol(
                        zone_id=zone_id,
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
                        # Value display settings
                        dose=zone_input.dose,
                        hours=zone_input.hours,
                    )
                    zone.enabled = zone_input.enabled
                room.add_calc_zone(zone)
        else:
            logger.info("Adding standard zones...")
            room.add_standard_zones()

        # Perform simulation
        logger.info("Running calculation...")
        room.calculate()

        # Collect results for all zones
        zone_results = {}
        mean_fluence = None

        for zone_id, zone in room.calc_zones.items():
            # Use get_values() to get dose-adjusted values when zone.dose=True
            # This applies the conversion: dose = irradiance * 3.6 * hours
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

                # Track WholeRoomFluence mean for backward compatibility (always raw fluence rate)
                if zone_id == "WholeRoomFluence":
                    # Use raw values for WholeRoomFluence mean (fluence rate, not dose)
                    raw_values = zone.values
                    if raw_values is not None:
                        raw_flat = raw_values.flatten() if hasattr(raw_values, 'flatten') else np.array(raw_values).flatten()
                        raw_valid = raw_flat[~np.isnan(raw_flat)]
                        mean_fluence = float(np.mean(raw_valid)) if len(raw_valid) > 0 else None

                # Reshape values to 2D/3D array for frontend visualization
                reshaped_values = None
                if request.include_zone_values and hasattr(zone, 'num_points'):
                    try:
                        num_points = zone.num_points
                        if zone_type == "plane" and len(num_points) == 2:
                            # Reshape to (num_x, num_y) for plane
                            reshaped_values = values.reshape(num_points).tolist()
                        elif zone_type == "volume" and len(num_points) == 3:
                            # Reshape to (num_x, num_y, num_z) for volume
                            reshaped_values = values.reshape(num_points).tolist()
                        else:
                            reshaped_values = values.tolist()
                    except Exception as e:
                        logger.warning(f"Failed to reshape values for zone {zone_id}: {e}")
                        reshaped_values = values.tolist() if hasattr(values, 'tolist') else None

                # Build result
                result = SimulationZoneResult(
                    zone_id=zone_id,
                    zone_name=getattr(zone, 'name', None),
                    zone_type=zone_type,
                    statistics=statistics,
                    num_points=list(zone.num_points) if hasattr(zone, 'num_points') else None,
                    values=reshaped_values,
                )
                zone_results[zone_id] = result
            else:
                zone_results[zone_id] = SimulationZoneResult(
                    zone_id=zone_id,
                    zone_name=getattr(zone, 'name', None),
                    zone_type=zone_type,
                    statistics={"min": None, "max": None, "mean": None, "std": None},
                )

        return SimulationResponse(
            success=True,
            mean_fluence=mean_fluence,
            units=str(room.units),
            zones=zone_results,
        )

    except Exception as e:
        logger.error(f"Simulation failed: {e}")
        raise HTTPException(status_code=400, detail=f"Simulation failed: {str(e)}")


# === Full Room Simulation ===

@router.post("/rooms/{room_id}/calculate", response_model=FullSimulationResponse, tags=["Simulation"])
def calculate_room(room_id: str, options: FullSimulationRequest = FullSimulationRequest()):
    """
    Run a full calculation for a room with all its lamps and zones.

    Returns comprehensive results including:
    - Per-zone statistics (min, max, mean, std)
    - Optional safety analysis (skin/eye dose compliance)
    - Optional efficacy data (eACH-UV)
    - Optional ozone estimation
    """
    room = room_store.get(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    if len(room.lamps) == 0:
        raise HTTPException(status_code=400, detail="Room has no lamps")

    # Add standard zones if none exist
    if len(room.calc_zones) == 0:
        logger.info(f"No zones in room {room_id}, adding standard zones")
        room.add_standard_zones()

    try:
        logger.info(f"Running calculation for room {room_id}")
        room.calculate()

        # Collect zone results
        zone_results = {}
        for zone_id, zone in room.calc_zones.items():
            try:
                # Use get_values() to get dose-adjusted values when zone.dose=True
                values = zone.get_values()
                if values is not None:
                    if hasattr(values, 'flatten'):
                        flat_values = values.flatten()
                    else:
                        flat_values = np.array(values).flatten()

                    # Filter out NaN values for statistics
                    valid_values = flat_values[~np.isnan(flat_values)]

                    statistics = {
                        "min": float(np.min(valid_values)) if len(valid_values) > 0 else None,
                        "max": float(np.max(valid_values)) if len(valid_values) > 0 else None,
                        "mean": float(np.mean(valid_values)) if len(valid_values) > 0 else None,
                        "std": float(np.std(valid_values)) if len(valid_values) > 0 else None,
                    }
                else:
                    statistics = {"min": None, "max": None, "mean": None, "std": None}

                zone_results[zone_id] = ZoneResultResponse(
                    zone_id=zone_id,
                    zone_name=getattr(zone, 'name', None),
                    zone_type="plane" if isinstance(zone, CalcPlane) else "volume",
                    statistics=statistics,
                    values=None,  # Don't include raw values by default (too large)
                    heatmap_data=None,  # TODO: Generate heatmap data for planes
                )
            except Exception as e:
                logger.warning(f"Failed to extract results for zone {zone_id}: {e}")
                zone_results[zone_id] = ZoneResultResponse(
                    zone_id=zone_id,
                    zone_name=getattr(zone, 'name', None),
                    zone_type="plane" if isinstance(zone, CalcPlane) else "volume",
                    statistics={"error": str(e)},
                )

        # Safety analysis
        safety_result = None
        if options.include_safety:
            try:
                safety_result = _get_safety_results(room)
            except Exception as e:
                logger.warning(f"Failed to get safety results: {e}")

        # Efficacy analysis
        efficacy_result = None
        if options.include_efficacy:
            try:
                efficacy_result = _get_efficacy_results(room)
            except Exception as e:
                logger.warning(f"Failed to get efficacy results: {e}")

        # Ozone estimation
        ozone_result = None
        if options.include_ozone:
            try:
                ozone_result = _get_ozone_results(room)
            except Exception as e:
                logger.warning(f"Failed to get ozone results: {e}")

        room.update_timestamp()
        save_rooms(room_store)

        return FullSimulationResponse(
            success=True,
            room_id=room_id,
            calculated_at=datetime.utcnow().isoformat(),
            zones=zone_results,
            safety=safety_result,
            efficacy=efficacy_result,
            ozone=ozone_result,
        )

    except Exception as e:
        logger.error(f"Calculation failed for room {room_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Calculation failed: {str(e)}")


def _get_safety_results(room) -> Optional[SafetyResultResponse]:
    """Extract photobiological safety results from a calculated room"""
    try:
        # Get skin dose from SkinLimits zone if it exists
        skin_zone = room.calc_zones.get("SkinLimits")
        eye_zone = room.calc_zones.get("EyeLimits")

        skin_dose = {}
        eye_dose = {}

        # Use get_values() to get dose-adjusted values (these zones have dose=true)
        if skin_zone and skin_zone.get_values() is not None:
            values = np.array(skin_zone.get_values()).flatten()
            valid = values[~np.isnan(values)]
            if len(valid) > 0:
                max_dose = float(np.max(valid))
                # TLV for 222nm is typically 22 mJ/cm² for 8 hours
                tlv = 22.0  # mJ/cm² - this should come from the standard
                skin_dose = {
                    "max_dose": max_dose,
                    "tlv": tlv,
                    "hours_to_limit": tlv / max_dose * 8 if max_dose > 0 else float('inf'),
                    "compliant": max_dose <= tlv,
                }

        if eye_zone and eye_zone.get_values() is not None:
            values = np.array(eye_zone.get_values()).flatten()
            valid = values[~np.isnan(values)]
            if len(valid) > 0:
                max_dose = float(np.max(valid))
                # TLV for eye exposure is typically lower
                tlv = 3.0  # mJ/cm² - this should come from the standard
                eye_dose = {
                    "max_dose": max_dose,
                    "tlv": tlv,
                    "hours_to_limit": tlv / max_dose * 8 if max_dose > 0 else float('inf'),
                    "compliant": max_dose <= tlv,
                }

        overall_compliant = skin_dose.get("compliant", True) and eye_dose.get("compliant", True)

        return SafetyResultResponse(
            standard=room.standard,
            skin_dose=skin_dose,
            eye_dose=eye_dose,
            overall_compliant=overall_compliant,
            dimming_recommendation=None,  # TODO: Calculate dimming if non-compliant
        )
    except Exception as e:
        logger.warning(f"Error getting safety results: {e}")
        return None


def _get_efficacy_results(room) -> Optional[EfficacyResultResponse]:
    """Extract disinfection efficacy results from a calculated room"""
    try:
        # Get average fluence from WholeRoomFluence zone
        # Use raw values (not dose-adjusted) for fluence rate calculations
        fluence_zone = room.calc_zones.get("WholeRoomFluence")

        if fluence_zone and fluence_zone.values is not None:
            # Use raw values for efficacy since we need fluence rate, not dose
            values = np.array(fluence_zone.values).flatten()
            valid = values[~np.isnan(values)]
            if len(valid) > 0:
                avg_fluence = float(np.mean(valid))

                # Calculate eACH-UV (equivalent air changes from UV)
                # This is a simplified calculation - the full version needs k-values
                # eACH = fluence_rate * k / (ln(2) * 1000) for 50% reduction
                # Using a typical k-value for respiratory viruses (~0.1 cm²/mJ)
                k_typical = 0.1  # cm²/mJ for typical respiratory virus
                each_uv = avg_fluence * k_typical / 0.693  # ln(2) ≈ 0.693

                return EfficacyResultResponse(
                    average_fluence=avg_fluence,
                    each_uv=each_uv,
                    fluence_units="µW/cm²" if not fluence_zone.dose else "mJ/cm²",
                )

        return None
    except Exception as e:
        logger.warning(f"Error getting efficacy results: {e}")
        return None


def _get_ozone_results(room) -> Optional[OzoneResultResponse]:
    """Estimate ozone generation from UV lamps"""
    try:
        # Get average fluence
        fluence_zone = room.calc_zones.get("WholeRoomFluence")

        if fluence_zone and fluence_zone.values is not None:
            values = np.array(fluence_zone.values).flatten()
            valid = values[~np.isnan(values)]
            if len(valid) > 0:
                avg_fluence = float(np.mean(valid))

                # Simplified ozone calculation
                # For 222nm lamps, ozone generation is typically very low
                # Using a conservative estimate
                ozone_constant = 10  # ppb per µW/cm² (very rough estimate)
                air_changes = room.air_changes
                decay_constant = room.ozone_decay_constant

                # Steady-state ozone estimate
                generation = avg_fluence * ozone_constant / 1000  # ppb
                decay_factor = 1 / (air_changes + decay_constant) if (air_changes + decay_constant) > 0 else 1
                estimated_ppb = generation * decay_factor

                warning = None
                if estimated_ppb > 5:
                    warning = "Estimated ozone increase exceeds 5 ppb"

                return OzoneResultResponse(
                    estimated_increase_ppb=estimated_ppb,
                    air_changes=air_changes,
                    decay_constant=decay_constant,
                    warning=warning,
                )

        return None
    except Exception as e:
        logger.warning(f"Error getting ozone results: {e}")
        return None


@router.get("/rooms/{room_id}/results/zones/{zone_id}", tags=["Simulation"])
def get_zone_results(room_id: str, zone_id: str, include_values: bool = False):
    """
    Get detailed results for a specific calculation zone.

    Optionally include the raw grid values (can be large).
    """
    room = room_store.get(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    zone = room.calc_zones.get(zone_id)
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")

    # Use get_values() to get dose-adjusted values when zone.dose=True
    values = zone.get_values()
    if values is None:
        raise HTTPException(status_code=400, detail="Zone has not been calculated yet")

    if hasattr(values, 'flatten'):
        flat_values = values.flatten()
    else:
        flat_values = np.array(values).flatten()

    valid_values = flat_values[~np.isnan(flat_values)]

    result = {
        "zone_id": zone_id,
        "zone_name": getattr(zone, 'name', None),
        "zone_type": "plane" if isinstance(zone, CalcPlane) else "volume",
        "statistics": {
            "min": float(np.min(valid_values)) if len(valid_values) > 0 else None,
            "max": float(np.max(valid_values)) if len(valid_values) > 0 else None,
            "mean": float(np.mean(valid_values)) if len(valid_values) > 0 else None,
            "std": float(np.std(valid_values)) if len(valid_values) > 0 else None,
            "count": len(valid_values),
        },
        "dose_mode": getattr(zone, 'dose', False),
        "units": "mJ/cm²" if getattr(zone, 'dose', False) else "µW/cm²",
    }

    if include_values:
        result["values"] = values.tolist() if hasattr(values, 'tolist') else list(values)

        # For planes, include heatmap-ready data
        if isinstance(zone, CalcPlane) and hasattr(zone, 'geometry'):
            geom = zone.geometry
            if hasattr(geom, 'x_coords') and hasattr(geom, 'y_coords'):
                result["heatmap_data"] = {
                    "x": geom.x_coords.tolist() if hasattr(geom.x_coords, 'tolist') else list(geom.x_coords),
                    "y": geom.y_coords.tolist() if hasattr(geom.y_coords, 'tolist') else list(geom.y_coords),
                    "values": values.tolist() if hasattr(values, 'tolist') else list(values),
                }

    return result
