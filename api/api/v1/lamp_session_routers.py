"""
Lamp Session Routers - Lamp CRUD, IES/spectrum upload, and plotting endpoints.
"""

import io
import base64
import os
import pathlib
import tempfile
import traceback
import logging

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

from fastapi import APIRouter, HTTPException, Query, UploadFile, File

from guv_calcs import to_polar
from guv_calcs.io import load_spectrum_file
from guv_calcs.lamp.spectrum import Spectrum
from guv_calcs.lamp import Lamp
from guv_calcs.lamp.lamp_type import LampUnitType
from guv_calcs.lamp.fixture import Fixture
from guv_calcs.safety import PhotStandard
from guv_calcs.lamp.lamp_placement import LampPlacer
from guv_calcs.lamp.lamp_configs import resolve_keyword

try:
    from scipy.spatial import Delaunay
except ImportError:
    Delaunay = None

from .utils import fig_to_base64
from .session_helpers import (
    InitializedSessionDep,
    _log_and_raise,
    _get_lamp_or_404,
    _read_and_validate_upload,
    _get_state_hashes,
    _create_lamp_from_input,
)
from .session_schemas import (
    SessionLampInput,
    SessionLampUpdate,
    AddLampResponse,
    SuccessResponse,
    LampUpdateResponse,
    PlaceLampRequest,
    PlaceLampResponse,
    IESUploadResponse,
    IntensityMapUploadResponse,
    TlvLimits,
    SessionLampInfoResponse,
    LampPlotsResponse,
    AdvancedLampSettingsResponse,
    SurfacePlotResponse,
    SimplePlotResponse,
    SessionPhotometricWebResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================
# Lamp CRUD
# ============================================================

@router.post("/lamps", response_model=AddLampResponse)
def add_session_lamp(lamp: SessionLampInput, session: InitializedSessionDep):
    """Add a new lamp to the session Room.

    Requires X-Session-ID header.
    """
    try:
        guv_lamp = _create_lamp_from_input(lamp, units=session.room.units)
        guv_lamp.set_units(session.room.units)
        session.room.add_lamp(guv_lamp)
        assigned_id = guv_lamp.lamp_id
        session.lamp_id_map[assigned_id] = guv_lamp

        logger.debug(f"Added lamp {assigned_id}")
        return AddLampResponse(success=True, lamp_id=assigned_id, state_hashes=_get_state_hashes(session))

    except Exception as e:
        _log_and_raise("Failed to add lamp", e)


@router.patch("/lamps/{lamp_id}", response_model=LampUpdateResponse)
def update_session_lamp(lamp_id: str, updates: SessionLampUpdate, session: InitializedSessionDep):
    """Update an existing lamp's properties.

    Requires X-Session-ID header.
    """
    logger.debug(f"PATCH lamp {lamp_id}: {updates}")

    lamp = _get_lamp_or_404(session, lamp_id)
    logger.debug(f"Found lamp in map, lamp_count: {len(session.lamp_id_map)}")

    try:
        # Save original aim before move() shifts it
        orig_aimx, orig_aimy, orig_aimz = lamp.aimx, lamp.aimy, lamp.aimz

        position_changed = updates.x is not None or updates.y is not None or updates.z is not None
        aim_changed = updates.aimx is not None or updates.aimy is not None or updates.aimz is not None

        # Update position using lamp.move()
        if position_changed:
            lamp.move(
                x=updates.x if updates.x is not None else lamp.x,
                y=updates.y if updates.y is not None else lamp.y,
                z=updates.z if updates.z is not None else lamp.z,
            )

        # Update rotation using lamp.rotate()
        if updates.angle is not None:
            lamp.rotate(updates.angle)

        # Restore or update aim point — move() shifts aim as a side effect,
        # so we must re-apply whenever position or aim changed
        if position_changed or aim_changed:
            lamp.aim(
                x=updates.aimx if updates.aimx is not None else orig_aimx,
                y=updates.aimy if updates.aimy is not None else orig_aimy,
                z=updates.aimz if updates.aimz is not None else orig_aimz,
            )

        # Update tilt/orientation (runs AFTER aim point — if both sent, tilt/orientation wins)
        if updates.tilt is not None or updates.orientation is not None:
            room_dims = (session.room.x, session.room.y, session.room.z)
            if updates.tilt is not None:
                lamp.set_tilt(updates.tilt, dimensions=room_dims)
            if updates.orientation is not None:
                lamp.set_orientation(updates.orientation, dimensions=room_dims)

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

        if updates.name is not None:
            lamp.name = updates.name

        if updates.enabled is not None:
            lamp.enabled = updates.enabled

        # Apply intensity units (must convert string to enum to preserve correct behavior)
        if updates.intensity_units is not None:
            lamp.intensity_units = LampUnitType.from_any(updates.intensity_units)

        # Apply source dimensions (near-field settings)
        if updates.source_width is not None:
            lamp.set_width(updates.source_width)
        if updates.source_length is not None:
            lamp.set_length(updates.source_length)
        if updates.source_depth is not None:
            lamp.surface.set_height(updates.source_depth)
        if updates.source_density is not None:
            lamp.set_source_density(updates.source_density)

        # Apply housing dimensions (Fixture is frozen, so replace it)
        if updates.housing_width is not None or updates.housing_length is not None or updates.housing_height is not None:
            current = lamp.fixture
            lamp.geometry._fixture = Fixture(
                housing_width=updates.housing_width if updates.housing_width is not None else current.housing_width,
                housing_length=updates.housing_length if updates.housing_length is not None else current.housing_length,
                housing_height=updates.housing_height if updates.housing_height is not None else current.housing_height,
                shape=current.shape,
            )

        # Handle lamp type change - recreate lamp with new wavelength/guv_type
        # This intentionally discards IES/spectrum data since photometric data
        # from one type is not valid for another.
        # Only recreate if the type actually changed to avoid discarding IES data.
        current_lamp_type = getattr(lamp, '_frontend_lamp_type', None)
        if current_lamp_type is None:
            # Fallback: detect from wavelength
            wl = lamp.wavelength
            if wl == 222:
                current_lamp_type = "krcl_222"
            elif wl == 254:
                current_lamp_type = "lp_254"
            else:
                current_lamp_type = "other"
        if updates.lamp_type is not None and updates.lamp_type != current_lamp_type:
            # Save user-uploaded data from old lamp before recreating
            old_base_ies = getattr(lamp, '_base_ies', None)
            old_spectrum = lamp.spectrum
            old_fixture = lamp.geometry._fixture if hasattr(lamp, 'geometry') else None

            if updates.lamp_type == "other":
                new_lamp = Lamp(
                    x=lamp.x, y=lamp.y, z=lamp.z,
                    wavelength=updates.wavelength or lamp.wavelength or 280,
                    aimx=lamp.aimx, aimy=lamp.aimy, aimz=lamp.aimz,
                    scaling_factor=lamp.scaling_factor, angle=lamp.angle,
                )
            else:
                wavelength = 222 if updates.lamp_type == "krcl_222" else 254
                guv_type = "KRCL" if updates.lamp_type == "krcl_222" else "LPHG"
                new_lamp = Lamp(
                    x=lamp.x, y=lamp.y, z=lamp.z,
                    wavelength=wavelength, guv_type=guv_type,
                    aimx=lamp.aimx, aimy=lamp.aimy, aimz=lamp.aimz,
                    scaling_factor=lamp.scaling_factor, angle=lamp.angle,
                )
            new_lamp.enabled = lamp.enabled
            new_lamp.name = lamp.name
            new_lamp._frontend_lamp_type = updates.lamp_type

            # Restore user-uploaded IES data (skip preset-bundled photometry)
            if old_base_ies is not None and getattr(lamp, '_user_uploaded_ies', False):
                new_lamp.load_ies(old_base_ies)
                new_lamp._user_uploaded_ies = True
                # Re-align surface units with room
                room_units = session.room.dim.units
                if new_lamp.surface.units != room_units:
                    new_lamp.set_units(room_units)
                if old_fixture is not None:
                    new_lamp.geometry._fixture = old_fixture

            # Restore user-uploaded spectrum data (skip preset-bundled spectra)
            if old_spectrum is not None and getattr(lamp, '_user_uploaded_spectrum', False):
                new_lamp.lamp_type = new_lamp.lamp_type.update(spectrum=old_spectrum)
                new_lamp._user_uploaded_spectrum = True

            # Replace in registry
            old_lamp_id = lamp.lamp_id
            session.room.lamps.pop(old_lamp_id)
            new_lamp._assign_id(old_lamp_id)
            session.room.lamps.add(new_lamp)
            session.lamp_id_map[lamp_id] = new_lamp
            lamp = new_lamp  # use new lamp for any subsequent updates in this request

        # Handle wavelength update for "other" type lamps (when lamp_type didn't change)
        if updates.wavelength is not None and current_lamp_type == "other" and (updates.lamp_type is None or updates.lamp_type == current_lamp_type):
            lamp.set_wavelength(updates.wavelength)

        # Handle switching from preset to custom upload — clear IES/spectrum
        if updates.preset_id == "custom" and lamp.preset_id is not None:
            if current_lamp_type == "other":
                new_lamp = Lamp(
                    x=lamp.x, y=lamp.y, z=lamp.z,
                    wavelength=updates.wavelength or lamp.wavelength or 280,
                    aimx=lamp.aimx, aimy=lamp.aimy, aimz=lamp.aimz,
                    scaling_factor=lamp.scaling_factor, angle=lamp.angle,
                )
            else:
                wavelength = 222 if current_lamp_type == "krcl_222" else 254
                guv_type = "KRCL" if current_lamp_type == "krcl_222" else "LPHG"
                new_lamp = Lamp(
                    x=lamp.x, y=lamp.y, z=lamp.z,
                    wavelength=wavelength, guv_type=guv_type,
                    aimx=lamp.aimx, aimy=lamp.aimy, aimz=lamp.aimz,
                    scaling_factor=lamp.scaling_factor, angle=lamp.angle,
                )
            new_lamp.enabled = lamp.enabled
            new_lamp.name = lamp.name
            new_lamp._frontend_lamp_type = current_lamp_type
            old_lamp_id = lamp.lamp_id
            session.room.lamps.pop(old_lamp_id)
            new_lamp._assign_id(old_lamp_id)
            session.room.lamps.add(new_lamp)
            session.lamp_id_map[lamp_id] = new_lamp
            lamp = new_lamp
            logger.debug(f"Cleared preset data for lamp {lamp_id} (switched to custom)")

        # Handle preset change - need to recreate lamp with IES data from preset
        if updates.preset_id is not None and updates.preset_id not in ("", "custom"):
            # Check if lamp already has IES data from this preset (avoid unnecessary recreation)
            current_has_ies = lamp.ies is not None
            if not current_has_ies or updates.preset_id != lamp.preset_id:
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
                new_lamp.name = lamp.name
                # Store preset_id for future comparisons
                new_lamp.preset_id = updates.preset_id

                # Replace in lamp registry: pop old, assign ID, add new
                old_lamp_id = lamp.lamp_id
                session.room.lamps.pop(old_lamp_id)
                new_lamp._assign_id(old_lamp_id)
                session.room.lamps.add(new_lamp)
                session.lamp_id_map[lamp_id] = new_lamp
                logger.debug(f"Replaced lamp {lamp_id} with preset {updates.preset_id}")

        logger.debug(f"Updated lamp {lamp_id}")
        # Return current lamp state after all updates (including computed aim point)
        return LampUpdateResponse(
            success=True,
            message="Lamp updated",
            aimx=lamp.aimx,
            aimy=lamp.aimy,
            aimz=lamp.aimz,
            tilt=getattr(lamp, 'bank', 0.0),
            orientation=getattr(lamp, 'heading', 0.0),
            has_ies_file=lamp.ies is not None,
            state_hashes=_get_state_hashes(session),
        )

    except Exception as e:
        logger.error(traceback.format_exc())
        _log_and_raise("Failed to update lamp", e)


@router.delete("/lamps/{lamp_id}", response_model=SuccessResponse)
def delete_session_lamp(lamp_id: str, session: InitializedSessionDep):
    """Remove a lamp from the session Room.

    Requires X-Session-ID header.
    """
    lamp = _get_lamp_or_404(session, lamp_id)

    try:
        session.room.lamps.remove(lamp.id)
        del session.lamp_id_map[lamp_id]

        logger.debug(f"Deleted lamp {lamp_id}")
        return SuccessResponse(success=True, message="Lamp deleted", state_hashes=_get_state_hashes(session))

    except Exception as e:
        _log_and_raise("Failed to delete lamp", e)


@router.post("/lamps/{lamp_id}/copy", response_model=AddLampResponse)
def copy_session_lamp(lamp_id: str, session: InitializedSessionDep):
    """Copy a lamp in the session Room, preserving all backend state (IES, photometry, etc.).

    Requires X-Session-ID header.
    """
    lamp = _get_lamp_or_404(session, lamp_id)

    try:
        copy = lamp.copy()
        session.room.add_lamp(copy)
        assigned_id = copy.lamp_id
        session.lamp_id_map[assigned_id] = copy

        logger.debug(f"Copied lamp {lamp_id} -> {assigned_id}")
        return AddLampResponse(success=True, lamp_id=assigned_id, state_hashes=_get_state_hashes(session))

    except Exception as e:
        _log_and_raise("Failed to copy lamp", e)


# ============================================================
# Lamp Placement
# ============================================================

def _resolve_lamp_config(lamp) -> dict:
    """Resolve lamp config, trying preset_id first then lamp_id.

    SceneRegistry may rename lamp_id on collision (e.g. "sabre" -> "sabre_1"),
    so preset_id (set during creation) is the reliable keyword.
    """
    for key in [lamp.preset_id, lamp.lamp_id]:
        if key is None:
            continue
        try:
            _, config = resolve_keyword(key)
            return config
        except KeyError:
            continue
    return {}



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
    lamp = _get_lamp_or_404(session, lamp_id)

    try:
        room = session.room
        room_z = room.dim.z

        # Resolve lamp config once (using preset_id to handle SceneRegistry renames)
        config = _resolve_lamp_config(lamp)
        placement_config = config.get("placement", {})
        fixture_angle = placement_config.get("angle", 0)

        # Determine mode - use request body or fall back to preset config default
        mode = body.mode
        if mode is None:
            mode = placement_config.get("mode", "downlight")

        ceiling_offset = LampPlacer.ceiling_offset(lamp)
        wall_clearance = LampPlacer.wall_clearance(lamp)
        offsets_fit = (
            ceiling_offset < room_z
            and wall_clearance < room.x
            and wall_clearance < room.y
        )

        # Strict cycling path: position_index provided for corner/edge/horizontal
        if body.position_index is not None and mode in ("corner", "edge", "horizontal"):
            if not offsets_fit:
                ceiling_offset = 0
                wall_clearance = 0

            placer = LampPlacer(room.dim.polygon, z=room_z)
            orig_x, orig_y, orig_z = lamp.x, lamp.y, lamp.z
            orig_angle = lamp.angle
            orig_aimx, orig_aimy, orig_aimz = lamp.aimx, lamp.aimy, lamp.aimz

            result = placer.place_lamp_at_index(
                lamp, mode, body.position_index,
                angle=fixture_angle, offset=ceiling_offset,
                wall_clearance=wall_clearance,
            )

            response = PlaceLampResponse(
                x=round(lamp.x, 6), y=round(lamp.y, 6), z=round(lamp.z, 6),
                angle=round(lamp.angle, 6),
                aimx=round(lamp.aimx, 6), aimy=round(lamp.aimy, 6),
                aimz=round(lamp.aimz, 6),
                tilt=round(getattr(lamp, 'bank', 0.0), 6),
                orientation=round(getattr(lamp, 'heading', 0.0), 6),
                mode=mode, position_index=result.index,
                position_count=result.count,
            )

            lamp.move(orig_x, orig_y, orig_z)
            lamp.aim(orig_aimx, orig_aimy, orig_aimz)
            lamp.rotate(orig_angle)
            return response

        # Auto path: LampPlacer.place_lamp() for downlight or when no index given
        if not offsets_fit:
            return PlaceLampResponse(
                x=round(room.x / 2, 6), y=round(room.y / 2, 6),
                z=round(room_z, 6), angle=0,
                aimx=round(room.x / 2, 6), aimy=round(room.y / 2, 6),
                aimz=0, tilt=0, orientation=0, mode=mode,
            )

        other_positions = []
        for fid, other_lamp in session.lamp_id_map.items():
            if fid != lamp_id and other_lamp.enabled:
                other_positions.append((other_lamp.x, other_lamp.y))

        placer = LampPlacer.for_dims(room.dim, existing=other_positions)

        orig_x, orig_y, orig_z = lamp.x, lamp.y, lamp.z
        orig_angle = lamp.angle
        orig_aimx, orig_aimy, orig_aimz = lamp.aimx, lamp.aimy, lamp.aimz

        placer.place_lamp(lamp, mode=mode, angle=fixture_angle)

        response = PlaceLampResponse(
            x=round(lamp.x, 6), y=round(lamp.y, 6), z=round(lamp.z, 6),
            angle=round(lamp.angle, 6),
            aimx=round(lamp.aimx, 6), aimy=round(lamp.aimy, 6),
            aimz=round(lamp.aimz, 6),
            tilt=round(getattr(lamp, 'bank', 0.0), 6),
            orientation=round(getattr(lamp, 'heading', 0.0), 6),
            mode=mode,
        )

        lamp.move(orig_x, orig_y, orig_z)
        lamp.aim(orig_aimx, orig_aimy, orig_aimz)
        lamp.rotate(orig_angle)
        return response

    except Exception as e:
        _log_and_raise("Failed to compute lamp placement", e)


# ============================================================
# File Uploads (IES, Spectrum, Intensity Map)
# ============================================================

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
    _get_lamp_or_404(session, lamp_id)

    try:
        # Validate file extension
        filename = file.filename or ""
        if not filename.lower().endswith('.ies'):
            raise HTTPException(
                status_code=400,
                detail="Invalid file type. Please upload an IES file (.ies extension)"
            )

        ies_bytes = await _read_and_validate_upload(file, MAX_IES_FILE_SIZE, _validate_ies_content)

        # Get filename without extension for display
        display_name = filename.rsplit('.', 1)[0] if filename else None

        # Load IES data into the existing lamp (preserves wavelength, guv_type, position, etc.)
        # Use override=True so luminous opening always updates from IES file.
        lamp = session.lamp_id_map[lamp_id]
        old_fixture = lamp.fixture
        lamp.load_ies(ies_bytes, override=True)
        lamp._user_uploaded_ies = True

        # Preserve user-set fixture (housing) dimensions; only default to
        # surface dims when the user hasn't explicitly configured the fixture.
        if old_fixture.has_dimensions:
            lamp.geometry._fixture = old_fixture
        else:
            lamp.geometry._fixture = Fixture(
                housing_width=lamp.surface.width,
                housing_length=lamp.surface.length,
            )

        # Re-align lamp surface units with room.
        # load_ies() → set_ies() overwrites surface units from the IES file,
        # but the room may use a different unit system (e.g., feet).
        # LampRegistry._validate() does this on add(), but IES upload happens
        # after the lamp is already in the room, so we must do it explicitly.
        room_units = session.room.dim.units
        if lamp.surface.units != room_units:
            lamp.set_units(room_units)

        # Clear any previously uploaded spectrum — it came from a different
        # source and is no longer valid for this IES file.
        lamp.clear_spectrum()

        logger.debug(f"Uploaded IES file for lamp {lamp_id}: {filename}")
        return IESUploadResponse(
            success=True,
            message=f"IES file uploaded for lamp {lamp_id}",
            has_ies_file=True,
            has_spectrum=False,
            filename=display_name,
            state_hashes=_get_state_hashes(session)
        )

    except Exception as e:
        logger.error(f"Failed to upload IES file for lamp {lamp_id}: {e}")
        _log_and_raise("Failed to upload IES file", e)


# Maximum spectrum file size (500 KB to accommodate Excel files with metadata headers)
MAX_SPECTRUM_FILE_SIZE = 500 * 1024  # 500 KB


@router.post("/lamps/{lamp_id}/spectrum")
async def upload_session_lamp_spectrum(
    lamp_id: str,
    session: InitializedSessionDep,
    file: UploadFile = File(...),
    column_index: int = Query(0, ge=0, description="Column index to use from a multi-column file (0-based, default first data column)"),
):
    """Upload a spectrum file to a session lamp.

    This sets the lamp's spectral data from the uploaded file.
    Supports CSV (.csv) and Excel (.xls, .xlsx) formats.
    The file should contain wavelength (nm) and intensity columns.
    Maximum file size: 500 KB.

    When column_index > 0, the file is parsed as a multi-column spectrum
    file and the specified column is extracted.

    Requires X-Session-ID header.
    """
    _get_lamp_or_404(session, lamp_id)

    try:
        # Validate file extension
        filename = file.filename or ""
        valid_extensions = {'.csv', '.xls', '.xlsx'}
        file_ext = pathlib.Path(filename).suffix.lower()
        if file_ext not in valid_extensions:
            raise HTTPException(
                status_code=400,
                detail="Invalid file type. Please upload a CSV or Excel file (.csv, .xls, .xlsx)"
            )

        spectrum_bytes = await _read_and_validate_upload(file, MAX_SPECTRUM_FILE_SIZE)

        # Write to a temp file so guv_calcs can use the extension to pick
        # the correct parser (bytes mode sniffs format and may misidentify
        # binary Excel files as CSV).
        lamp = session.lamp_id_map[lamp_id]
        with tempfile.NamedTemporaryFile(suffix=file_ext, delete=False) as tmp:
            tmp.write(spectrum_bytes)
            tmp_path = tmp.name
        try:
            if column_index > 0:
                # Multi-column mode: parse all columns and extract the selected one
                result = load_spectrum_file(tmp_path, all_columns=True)
                if column_index >= len(result["series"]):
                    raise HTTPException(
                        status_code=400,
                        detail=f"Column index {column_index} out of range (file has {len(result['series'])} data columns)"
                    )
                series = result["series"][column_index]
                wavelengths = result["wavelengths"]
                # Construct a Spectrum from the selected column and update the lamp
                new_spectrum = Spectrum(tuple(wavelengths), tuple(series["intensities"]))
                lamp.lamp_type = lamp.lamp_type.update(spectrum=new_spectrum)
            else:
                lamp.load_spectrum(tmp_path)
        finally:
            os.unlink(tmp_path)

        # Mark as user-uploaded so lamp type changes preserve it
        lamp._user_uploaded_spectrum = True

        # Extract peak wavelength from spectrum for frontend use
        peak_wavelength = None
        if lamp.spectrum is not None:
            peak_wavelength = float(lamp.spectrum.peak_wavelength)

        logger.debug(f"Uploaded spectrum file for lamp {lamp_id}: {filename}, peak_wavelength={peak_wavelength}")
        return {
            "success": True,
            "message": f"Spectrum file uploaded for lamp {lamp_id}",
            "peak_wavelength": peak_wavelength,
            "state_hashes": _get_state_hashes(session),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to upload spectrum file for lamp {lamp_id}: {e}")
        _log_and_raise("Failed to upload spectrum file", e)


@router.delete("/lamps/{lamp_id}/ies", response_model=SuccessResponse)
def remove_session_lamp_ies(lamp_id: str, session: InitializedSessionDep):
    """Remove IES photometric data from a session lamp.

    Requires X-Session-ID header.
    """
    lamp = _get_lamp_or_404(session, lamp_id)

    try:
        lamp.ies = None
        lamp._base_ies = None

        logger.debug(f"Removed IES data from lamp {lamp_id}")
        return SuccessResponse(success=True, message="IES file removed", state_hashes=_get_state_hashes(session))

    except Exception as e:
        logger.error(f"Failed to remove IES data from lamp {lamp_id}: {e}")
        _log_and_raise("Failed to remove IES data", e)


@router.delete("/lamps/{lamp_id}/spectrum", response_model=SuccessResponse)
def remove_session_lamp_spectrum(lamp_id: str, session: InitializedSessionDep):
    """Remove spectrum data from a session lamp.

    Clears the lamp's spectral data, reverting it to monochromatic behavior
    at the specified wavelength.

    Requires X-Session-ID header.
    """
    lamp = _get_lamp_or_404(session, lamp_id)

    try:
        lamp.clear_spectrum()

        logger.debug(f"Removed spectrum from lamp {lamp_id}")
        return SuccessResponse(success=True, message="Spectrum removed", state_hashes=_get_state_hashes(session))

    except Exception as e:
        logger.error(f"Failed to remove spectrum from lamp {lamp_id}: {e}")
        _log_and_raise("Failed to remove spectrum", e)


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
    lamp = _get_lamp_or_404(session, lamp_id)

    try:
        # Validate file extension
        filename = file.filename or ""
        if not filename.lower().endswith('.csv'):
            raise HTTPException(
                status_code=400,
                detail="Invalid file type. Please upload a CSV file (.csv extension)"
            )

        csv_bytes = await _read_and_validate_upload(file, MAX_INTENSITY_MAP_SIZE, _validate_csv_content)

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
    lamp = _get_lamp_or_404(session, lamp_id)

    try:
        # Clear the intensity map by loading None
        lamp.load_intensity_map(None)
        logger.debug(f"Removed intensity map from lamp {lamp_id}")
        return SuccessResponse(success=True, message="Intensity map removed", state_hashes=_get_state_hashes(session))

    except Exception as e:
        logger.error(f"Failed to remove intensity map from lamp {lamp_id}: {e}")
        _log_and_raise("Failed to remove intensity map", e)


# ============================================================
# Lamp Info & Plots
# ============================================================

@router.get("/lamps/{lamp_id}/info", response_model=SessionLampInfoResponse)
def get_session_lamp_info(
    lamp_id: str,
    session: InitializedSessionDep,
):
    """Get lamp information for a session lamp (custom IES).

    Returns only computed data (TLVs, power, flags). All plot images are
    served by the separate /lamps/{lamp_id}/info/plots endpoint.
    Requires X-Session-ID header.
    """
    lamp = _get_lamp_or_404(session, lamp_id)

    has_ies = lamp.ies is not None
    has_spectrum = lamp.spectrum is not None
    has_wavelength = lamp.wavelength is not None

    if not has_ies and not has_spectrum and not has_wavelength:
        raise HTTPException(status_code=400, detail=f"Lamp {lamp_id} has no photometric or wavelength data")

    try:
        # Get total optical power (requires IES)
        total_power = lamp.get_total_power() if has_ies else 0.0

        # Get TLVs for both standards (works with spectrum or wavelength)
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

        return SessionLampInfoResponse(
            lamp_id=lamp_id,
            name=getattr(lamp, 'name', lamp_id),
            total_power_mw=float(total_power),
            tlv_acgih=tlv_acgih,
            tlv_icnirp=tlv_icnirp,
            has_ies=has_ies,
            has_spectrum=has_spectrum,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get lamp info for {lamp_id}: {e}")
        _log_and_raise("Failed to get lamp info", e, 500)


@router.get("/lamps/{lamp_id}/info/plots", response_model=LampPlotsResponse)
def get_session_lamp_plots(
    lamp_id: str,
    session: InitializedSessionDep,
    spectrum_scale: str = "linear",
    theme: str = "dark",
    dpi: int = 150,
    include_hires: bool = True,
):
    """Get all plot images for a session lamp (photometric + spectrum).

    Separated from /lamps/{lamp_id}/info for progressive loading — the main
    info endpoint returns TLVs + power instantly while this endpoint
    generates the slower matplotlib renders.
    """
    lamp = _get_lamp_or_404(session, lamp_id)

    has_ies = lamp.ies is not None
    has_spectrum = lamp.spectrum is not None

    if not has_ies and not has_spectrum:
        return LampPlotsResponse(lamp_id=lamp_id)

    try:
        # Theme colors
        if theme == 'light':
            bg_color = '#ffffff'
            text_color = '#1f2328'
            grid_color = '#c0c0c0'
        else:
            bg_color = '#16213e'
            text_color = '#eaeaea'
            grid_color = '#4a5568'

        # --- Photometric plot (requires IES) ---
        photometric_plot_base64 = None
        photometric_plot_hires_base64 = None
        if has_ies:
            is_dark = theme != 'light'
            dark_line_remap = {
                'red': '#ff6b6b',
                'blue': '#6ba3ff',
                'purple': '#c880ff',
            }

            def _gen_photometric(target_dpi):
                fig = None
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
                        if is_dark:
                            for line in ax.get_lines():
                                orig = line.get_color()
                                if orig in dark_line_remap:
                                    line.set_color(dark_line_remap[orig])
                        legend = ax.get_legend()
                        if legend:
                            legend.get_frame().set_facecolor(bg_color)
                            legend.get_frame().set_edgecolor(grid_color)
                            for text in legend.get_texts():
                                text.set_color(text_color)
                    return fig_to_base64(
                        fig, dpi=target_dpi, facecolor=bg_color,
                        bbox_inches='tight', pad_inches=0.1)
                except Exception as e:
                    logger.warning(f"Failed to generate photometric plot: {e}")
                    return None
                finally:
                    if fig is not None:
                        plt.close(fig)

            photometric_plot_base64 = _gen_photometric(dpi)
            if include_hires:
                photometric_plot_hires_base64 = _gen_photometric(300)

        # --- Spectrum plots ---
        spectrum_plot_base64 = None
        spectrum_linear_plot_base64 = None
        spectrum_log_plot_base64 = None
        spectrum_plot_hires_base64 = None
        spectrum_linear_plot_hires_base64 = None
        spectrum_log_plot_hires_base64 = None
        if has_spectrum:
            def _gen_spectrum(scale, target_dpi):
                fig = None
                try:
                    result = lamp.spectrum.plot(weights=True, yscale=scale)
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
                    return fig_to_base64(fig, dpi=target_dpi, facecolor=bg_color,
                                        bbox_inches='tight', pad_inches=0.1)
                except Exception as e:
                    logger.warning(f"Failed to generate spectrum plot ({scale}): {e}")
                    return None
                finally:
                    if fig is not None:
                        plt.close(fig)

            spectrum_linear_plot_base64 = _gen_spectrum("linear", dpi)
            spectrum_log_plot_base64 = _gen_spectrum("log", dpi)
            spectrum_plot_base64 = (
                spectrum_linear_plot_base64 if spectrum_scale == "linear"
                else spectrum_log_plot_base64
            )

            if include_hires:
                spectrum_linear_plot_hires_base64 = _gen_spectrum("linear", 300)
                spectrum_log_plot_hires_base64 = _gen_spectrum("log", 300)
                spectrum_plot_hires_base64 = (
                    spectrum_linear_plot_hires_base64 if spectrum_scale == "linear"
                    else spectrum_log_plot_hires_base64
                )

        return LampPlotsResponse(
            lamp_id=lamp_id,
            photometric_plot_base64=photometric_plot_base64,
            photometric_plot_hires_base64=photometric_plot_hires_base64,
            spectrum_plot_base64=spectrum_plot_base64,
            spectrum_linear_plot_base64=spectrum_linear_plot_base64,
            spectrum_log_plot_base64=spectrum_log_plot_base64,
            spectrum_plot_hires_base64=spectrum_plot_hires_base64,
            spectrum_linear_plot_hires_base64=spectrum_linear_plot_hires_base64,
            spectrum_log_plot_hires_base64=spectrum_log_plot_hires_base64,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get lamp plots for {lamp_id}: {e}")
        _log_and_raise("Failed to get lamp plots", e, 500)


@router.get("/lamps/{lamp_id}/advanced-settings", response_model=AdvancedLampSettingsResponse)
def get_session_lamp_advanced_settings(lamp_id: str, session: InitializedSessionDep):
    """Get advanced lamp settings for a session lamp.

    Returns current scaling factor, intensity units, source dimensions,
    and computed values like total power and photometric distance.

    Requires X-Session-ID header.
    """
    lamp = _get_lamp_or_404(session, lamp_id)

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
            housing_width=lamp.fixture.housing_width if lamp.fixture.housing_width > 0 else None,
            housing_length=lamp.fixture.housing_length if lamp.fixture.housing_length > 0 else None,
            housing_height=lamp.fixture.housing_height if lamp.fixture.housing_height > 0 else None,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get advanced settings for lamp {lamp_id}: {e}")
        _log_and_raise("Failed to get advanced settings", e, 500)


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
    lamp = _get_lamp_or_404(session, lamp_id)

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
    lamp = _get_lamp_or_404(session, lamp_id)

    # Need source dimensions for a meaningful plot
    if lamp.width is None or lamp.length is None or lamp.width == 0 or lamp.length == 0:
        raise HTTPException(status_code=400, detail="Lamp has no source dimensions defined")

    try:
        # Theme colors
        if theme == 'light':
            bg_color = '#ffffff'
            text_color = '#1f2328'
        else:
            bg_color = '#16213e'
            text_color = '#eaeaea'

        # Generate grid points plot - same size as intensity map for alignment
        fig, ax = plt.subplots(figsize=(4, 3))
        try:
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

            return SimplePlotResponse(plot_base64=plot_base64)
        finally:
            plt.close(fig)

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
    lamp = _get_lamp_or_404(session, lamp_id)

    # Need an intensity map loaded
    if lamp.surface.intensity_map_orig is None:
        raise HTTPException(status_code=400, detail="Lamp has no intensity map loaded")

    try:
        # Theme colors
        if theme == 'light':
            bg_color = '#ffffff'
            text_color = '#1f2328'
        else:
            bg_color = '#16213e'
            text_color = '#eaeaea'

        # Generate intensity map plot - same size as grid points for alignment
        fig, ax = plt.subplots(figsize=(4, 3))
        try:
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

            return SimplePlotResponse(plot_base64=plot_base64)
        finally:
            plt.close(fig)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to generate intensity map plot for lamp {lamp_id}: {e}")
        _log_and_raise("Failed to generate intensity map plot", e, 500)


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

    lamp = _get_lamp_or_404(session, lamp_id)

    if lamp.ies is None:
        raise HTTPException(status_code=400, detail=f"Lamp {lamp_id} has no IES data")

    try:
        # Return photometric web in CANONICAL orientation (pointing -Z at origin),
        # matching the preset endpoint. The frontend applies the lamp's aim rotation
        # via a quaternion, so we must NOT bake rotation into the vertices here.
        #
        # photometric_coords are in lamp-local space; we just need to scale them.
        # This is equivalent to transform_to_world on a lamp at origin pointing down.

        init_scale = lamp.values.max()  # Max intensity value
        power_scale = lamp.get_total_power() / 100.0  # 100mW = 1m (always meters)
        # Convert web vertices to session units so they match the room scale
        unit_factor = 1.0 / 0.3048 if str(session.room.units) == "feet" else 1.0
        coords = lamp.photometric_coords / init_scale * power_scale * unit_factor  # (N, 3)
        x, y, z = coords.T  # (3, N)

        # Perform Delaunay triangulation in polar space (using original coords)
        Theta, Phi, R = to_polar(*lamp.photometric_coords.T)
        tri = Delaunay(np.column_stack((Theta.flatten(), Phi.flatten())))

        # Build vertex list (centered at origin)
        vertices = [[float(x[i]), float(y[i]), float(z[i])] for i in range(len(x))]

        # Build triangle list from Delaunay simplices
        triangles = [[int(tri.simplices[i, 0]), int(tri.simplices[i, 1]), int(tri.simplices[i, 2])]
                     for i in range(len(tri.simplices))]

        # Aim line: from origin to 1 unit down (will be transformed client-side)
        aim_line = [[0.0, 0.0, 0.0], [0.0, 0.0, -1.0 * unit_factor]]

        # Surface points and fixture bounds are in world coordinates.
        # Transform them back to canonical (lamp-local) space so the frontend
        # can apply its own rotation, matching the preset endpoint behavior.
        rot = lamp.pose.rotation_matrix  # world-to-local rotation

        # Surface points (discrete emission grid)
        try:
            raw_surface_points = lamp.surface.surface_points
            if raw_surface_points is not None and len(raw_surface_points) > 0:
                # World → local: subtract position, then rotate back
                local_points = (rot @ (raw_surface_points - lamp.position).T).T
                if local_points.ndim == 1:
                    surface_points = [local_points.tolist()]
                else:
                    surface_points = [[float(p[0]), float(p[1]), float(p[2])] for p in local_points]
            else:
                surface_points = [[0.0, 0.0, 0.0]]
        except Exception as e:
            logger.warning(f"Failed to get surface points for session lamp {lamp_id}: {e}")
            surface_points = [[0.0, 0.0, 0.0]]

        # Fixture bounding box (wireframe housing)
        fixture_bounds = None
        try:
            if lamp.fixture.has_dimensions:
                corners = lamp.geometry.get_bounding_box_corners()
                # World → local: subtract position, then rotate back
                local_corners = (rot @ (corners - lamp.position).T).T
                fixture_bounds = [[float(c[0]), float(c[1]), float(c[2])] for c in local_corners]
        except Exception as e:
            logger.warning(f"Failed to get fixture bounds for session lamp {lamp_id}: {e}")
            fixture_bounds = None

        # Wavelength-aware color selection
        wl = lamp.wavelength or 222
        if wl <= 230:
            color = "#cc61ff"   # purple (far-UVC)
        elif wl <= 260:
            color = "#4488ff"   # blue (mid-UVC)
        elif wl <= 300:
            color = "#44bbff"   # light blue (UVC/UVB)
        elif wl <= 400:
            color = "#44ddbb"   # teal (UVA)
        else:
            color = "#cc61ff"   # default

        return SessionPhotometricWebResponse(
            vertices=vertices,
            triangles=triangles,
            aim_line=aim_line,
            surface_points=surface_points,
            fixture_bounds=fixture_bounds,
            color=color,
        )

    except Exception as e:
        logger.error(f"Failed to compute photometric web for session lamp {lamp_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to compute photometric web: {str(e)}"
        )
