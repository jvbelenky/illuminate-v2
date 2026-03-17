"""
Calculation Routers - Calculate, report, export, save/load, and safety check endpoints.
"""

import io
import base64
import re
import traceback
import logging
import asyncio
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Optional, Dict, List

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from guv_calcs import WHOLE_ROOM_FLUENCE, EYE_LIMITS, SKIN_LIMITS
from guv_calcs.project import Project
from guv_calcs.calc_zone import CalcPlane, CalcVol, CalcPoint

from .schemas import SimulationZoneResult
from .session_helpers import (
    SessionDep,
    InitializedSessionDep,
    SessionCreateDep,
    TARGET_SPECIES,
    _log_and_raise,
    _get_zone_or_404,
    _get_state_hashes,
    _sanitize_filename,
    _standard_to_label,
    _lamp_to_loaded,
    _zone_to_loaded,
)
from .session_manager import get_session_manager
from .session_schemas import (
    SuccessResponse,
    StateHashesResponse,
    CalculateResponse,
    CalculationEstimateResponse,
    DisinfectionRow,
    DisinfectionTableResponse,
    LoadedRoom,
    LoadSessionResponse,
    LampComplianceResultResponse,
    SafetyWarningResponse,
    CheckLampsResponse,
)
from .resource_limits import (
    estimate_session_cost,
    check_budget,
    log_calculation_start,
    log_calculation_complete,
    MAX_CONCURRENT_CALCULATIONS,
    MAX_PEAK_MEMORY_MB,
    MAX_CALC_TIME_SECONDS,
    QUEUE_TIMEOUT_SECONDS,
    CALCULATION_TIMEOUT_SECONDS,
)

logger = logging.getLogger(__name__)

router = APIRouter()

# Thread pool for async calculations.
# Use 2x MAX_CONCURRENT_CALCULATIONS so zombie threads from timed-out
# calculations don't exhaust the pool for legitimate new calculations.
_calc_executor = ThreadPoolExecutor(max_workers=MAX_CONCURRENT_CALCULATIONS * 2)

# Semaphore to limit concurrent calculations
_calc_semaphore: asyncio.Semaphore | None = None


def _get_calc_semaphore() -> asyncio.Semaphore:
    """Get or create the calculation semaphore (must be called from async context)."""
    global _calc_semaphore
    if _calc_semaphore is None:
        _calc_semaphore = asyncio.Semaphore(MAX_CONCURRENT_CALCULATIONS)
    return _calc_semaphore


# ============================================================
# Calculation
# ============================================================

@router.get("/calculate/estimate", response_model=CalculationEstimateResponse)
def get_calculation_estimate(session: InitializedSessionDep):
    """
    Get estimated calculation time and resource usage.

    Call this before /calculate to show a progress indicator.
    """
    estimate = estimate_session_cost(session)
    calc_time = estimate['calc_time_seconds']
    peak_mb = estimate['peak_memory_mb']
    return CalculationEstimateResponse(
        estimated_seconds=calc_time,
        grid_points=estimate['total_grid_points'],
        lamp_count=estimate['lamp_count'],
        reflectance_enabled=estimate['reflectance_enabled'],
        reflectance_passes=estimate['reflectance_passes'],
        memory_percent=round(peak_mb / MAX_PEAK_MEMORY_MB * 100, 1),
        max_seconds=MAX_CALC_TIME_SECONDS,
        time_percent=round(calc_time / MAX_CALC_TIME_SECONDS * 100, 1),
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
        loop = asyncio.get_running_loop()
        try:
            await asyncio.wait_for(
                loop.run_in_executor(_calc_executor, session.room.calculate),
                timeout=CALCULATION_TIMEOUT_SECONDS
            )
        except asyncio.TimeoutError:
            est_time = estimate.get('calc_time_seconds', 0)
            logger.error(
                f"Calculation timed out after {CALCULATION_TIMEOUT_SECONDS}s "
                f"(estimated {est_time:.1f}s). "
                f"Destroying session to prevent zombie thread corruption. "
                f"grid={estimate.get('total_grid_points', '?'):,}, "
                f"lamps={estimate.get('lamp_count', '?')}"
            )
            # Destroy the session so the zombie thread writes to orphaned objects
            # instead of corrupting a live session. The frontend will detect
            # "Session not found" and automatically reinitialize.
            try:
                get_session_manager().delete_session(session.id)
            except Exception:
                pass
            raise HTTPException(
                status_code=408,
                detail=f"Calculation timed out after {CALCULATION_TIMEOUT_SECONDS}s. "
                       f"Try reducing grid resolution or disabling reflectance."
            )

        actual_time = time.perf_counter() - calc_start
        log_calculation_complete(estimate, actual_time)

        # --- Diagnostic logging for WholeRoomFluence ---
        wrf = session.room.calc_zones.get("WholeRoomFluence")
        if wrf is not None:
            wrf_stats = wrf.get_statistics()
            valid = session.room.lamps.valid()
            for lid, l in valid.items():
                phot = l.ies.photometry if l.ies else None
                phot_interp = l.ies.photometry.interpolated() if l.ies else None
                logger.warning(
                    f"[DIAG] Lamp {lid}: "
                    f"ies={l.ies is not None}, "
                    f"units={l.intensity_units}, sf={l.scaling_factor}, "
                    f"phot_max={phot.values.max() if phot else None}, "
                    f"phot_mean={phot.values.mean() if phot else None}, "
                    f"phot_shape={phot.values.shape if phot else None}, "
                    f"interp_max={phot_interp.values.max() if phot_interp else None}, "
                    f"surface_units={l.surface.units}, "
                    f"surface_w={l.surface.width}, surface_l={l.surface.length}, "
                    f"phot_dist={l.surface.photometric_distance}, "
                    f"source_density={l.surface.source_density}, "
                    f"pos={l.surface.position}, "
                    f"wavelength={l.wavelength}, guv_type={l.guv_type}, "
                    f"spectrum={l.spectrum is not None}"
                )
            logger.warning(
                f"[DIAG] WholeRoomFluence: stats={wrf_stats}, "
                f"valid_lamps={len(valid)}"
            )

        # Collect results
        zone_results = {}
        mean_fluence = None

        for zone_id, zone in session.room.calc_zones.items():
            values = zone.get_values()
            if isinstance(zone, CalcPlane):
                zone_type = "plane"
            elif isinstance(zone, CalcPoint):
                zone_type = "point"
            else:
                zone_type = "volume"
            statistics = zone.get_statistics() or {"min": None, "max": None, "mean": None, "std": None}

            if values is not None:
                # Track WholeRoomFluence mean (raw fluence rate)
                if zone_id == WHOLE_ROOM_FLUENCE and statistics.get("mean") is not None:
                    mean_fluence = statistics["mean"]

                # Reshape values for frontend
                reshaped_values = None
                if hasattr(zone, 'num_points'):
                    try:
                        num_points = zone.num_points
                        reshaped_values = values.reshape(num_points).tolist()
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
                    statistics=statistics,
                )

        logger.info("Calculation completed successfully")

        # Include state hashes so frontend can snapshot "last calculated" state
        state_hashes = StateHashesResponse(
            calc_state=session.room.get_calc_state(),
            update_state=session.room.get_update_state(),
        )

        # Compute per-wavelength fluence from WholeRoomFluence zone
        fluence_by_wavelength = None
        try:
            wrf_zone = session.room.calc_zones.get(WHOLE_ROOM_FLUENCE)
            if wrf_zone is not None and wrf_zone.get_values() is not None:
                fdict = {}
                for lamp_id, wv in session.room.lamps.wavelengths.items():
                    if lamp_id in wrf_zone.lamp_cache:
                        fdict[wv] = fdict.get(wv, 0.0) + float(wrf_zone.lamp_cache[lamp_id].values.mean())
                if fdict:
                    fluence_by_wavelength = {int(k): round(v, 6) for k, v in fdict.items()}
        except Exception as e:
            logger.debug(f"Per-wavelength fluence computation failed: {e}")

        # Estimate ozone increase after calculation
        ozone_increase_ppb = None
        try:
            ozone_increase_ppb = session.room.estimate_ozone_increase()
        except Exception as e:
            logger.debug(f"Ozone estimate failed: {e}")

        return CalculateResponse(
            success=True,
            calculated_at=datetime.utcnow().isoformat(),
            mean_fluence=mean_fluence,
            fluence_by_wavelength=fluence_by_wavelength,
            ozone_increase_ppb=ozone_increase_ppb,
            zones=zone_results,
            state_hashes=state_hashes,
        )

    except HTTPException:
        # Re-raise HTTP exceptions (timeout, budget exceeded)
        raise
    except Exception as e:
        _log_and_raise("Calculation failed", e)
    finally:
        calc_semaphore.release()


# ============================================================
# Report & Export
# ============================================================

@router.get("/report")
def get_session_report(session: InitializedSessionDep):
    """
    Generate a CSV report from the session Room.

    Uses room.generate_report() on the existing Room instance.
    Works with or without calculated zones — the report includes
    room parameters and luminaire data regardless.

    Requires X-Session-ID header.
    """
    try:
        logger.info("Generating report from session Room...")
        csv_bytes = session.room.generate_report()

        # guv_calcs may emit latin-1 encoded text (e.g. µW/cm²).
        # Re-encode to UTF-8 to match the charset FastAPI auto-appends.
        if isinstance(csv_bytes, bytes):
            csv_bytes = csv_bytes.decode("latin-1").encode("utf-8")

        return Response(
            content=csv_bytes,
            media_type="text/csv",
            headers={
                "Content-Disposition": "attachment; filename=guv_report.csv"
            }
        )

    except Exception as e:
        _log_and_raise("Report generation failed", e)


@router.get("/export")
def export_session_all(session: InitializedSessionDep, include_plots: bool = False, include_report: bool = False):
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
        logger.info(f"Exporting all results as ZIP (include_plots={include_plots}, include_report={include_report})...")
        # Use explicit light theme to prevent dark_background style leakage
        # from concurrent matplotlib usage (e.g. get_zone_plot)
        with plt.style.context('default'):
            plt.rcParams.update({
                'figure.facecolor': 'white',
                'axes.facecolor': 'white',
                'text.color': 'black',
                'axes.labelcolor': 'black',
                'xtick.color': 'black',
                'ytick.color': 'black',
            })
            zip_bytes = session.room.export_zip(include_plots=include_plots, include_report=include_report)

        return Response(
            content=zip_bytes,
            media_type="application/zip",
            headers={
                "Content-Disposition": "attachment; filename=illuminate.zip"
            }
        )

    except Exception as e:
        _log_and_raise("Export failed", e)


# ============================================================
# Disinfection & Survival
# ============================================================

@router.get("/disinfection-table", response_model=DisinfectionTableResponse)
def get_disinfection_table(session: InitializedSessionDep, zone_id: str = WHOLE_ROOM_FLUENCE, species: str = None):
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

        # Use provided species list or fall back to defaults
        species_list = [s.strip() for s in species.split(",")] if species else TARGET_SPECIES

        # Batch by species - one call per log level (3 calls instead of 9)
        log_results = {
            func: session.room.average_value(zone_id=zone_id, function=func, species=species_list)
            for func in ('log1', 'log2', 'log3')
        }

        def _get_time(func, sp):
            results = log_results.get(func)
            if not results:
                return None
            val = results.get(sp)
            # Return None for NaN, infinity, or None values (can't serialize inf to JSON)
            if val is None or np.isnan(val) or np.isinf(val):
                return None
            return float(val)

        # Build rows from results
        rows = [
            DisinfectionRow(
                species=sp,
                seconds_to_90=_get_time('log1', sp),
                seconds_to_99=_get_time('log2', sp),
                seconds_to_99_9=_get_time('log3', sp),
            )
            for sp in species_list
        ]

        return DisinfectionTableResponse(
            rows=rows,
            air_changes=session.room.air_changes,
            fluence=fluence,
        )

    except Exception as e:
        _log_and_raise("Failed to get disinfection table", e)


@router.get("/survival-plot")
def get_survival_plot(
    session: InitializedSessionDep,
    zone_id: str = WHOLE_ROOM_FLUENCE,
    theme: str = "dark",
    dpi: int = 100,
    species: str = None
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
        # Set theme colors
        if theme == 'light':
            bg_color = '#ffffff'
            text_color = '#1f2937'
        else:
            bg_color = '#1a1a2e'
            text_color = '#e5e5e5'

        style = 'default' if theme == 'light' else 'dark_background'
        fig = None
        try:
            with plt.style.context(style):
                # Use provided species list or fall back to defaults
                species_list = [s.strip() for s in species.split(",")] if species else TARGET_SPECIES
                # Generate survival plot for target species (larger size)
                fig = session.room.survival_plot(zone_id=zone_id, species=species_list, figsize=(10, 6))

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
                    # Round fluence in title to 2 decimal places and wrap before "at"
                    title = ax.get_title()
                    if title:
                        title = re.sub(
                            r'(\d+\.\d{3,})(\s*µW/cm²)',
                            lambda m: f'{float(m.group(1)):.2f}{m.group(2)}',
                            title
                        )
                        if ' at ' in title:
                            title = title.replace(' at ', '\nat ', 1)
                        ax.set_title(title, color=text_color, fontsize=20)

                # Convert to base64
                buf = io.BytesIO()
                fig.savefig(buf, format='png', dpi=dpi, bbox_inches='tight',
                            facecolor=bg_color, edgecolor='none')
                buf.seek(0)

            image_base64 = base64.b64encode(buf.read()).decode('utf-8')

            return {
                "image_base64": image_base64,
                "content_type": "image/png"
            }
        finally:
            if fig is not None:
                plt.close(fig)

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

    Room is saved in whatever units the session is currently using.

    Returns the .guv file content as JSON.

    Requires X-Session-ID header.
    """
    try:
        logger.info("Saving session Project to .guv format...")
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
        loaded_units = str(session.room.units)
        logger.info(f"Project.load() succeeded: {session.room.x}x{session.room.y}x{session.room.z} ({loaded_units})")

        # Rebuild ID maps from the loaded room
        session.lamp_id_map = {}
        session.zone_id_map = {}

        # Build lamp list with IDs (use .items() since lamps is a dict-like Registry)
        loaded_lamps = []
        for lamp_id, lamp in session.room.lamps.items():
            session.lamp_id_map[lamp_id] = lamp
            loaded_lamps.append(_lamp_to_loaded(lamp, lamp_id))

        # Build zone list with IDs
        loaded_zones = []
        for zone_id, zone in session.room.calc_zones.items():
            session.zone_id_map[zone_id] = zone
            loaded_zones.append(_zone_to_loaded(zone, zone_id))

        # Build room config
        # Get reflectances from room surfaces (each Surface has an .R value)
        reflectances = None
        if hasattr(session.room, 'surfaces') and session.room.surfaces:
            reflectances = {name: surf.R for name, surf in session.room.surfaces.items()}

        ref_manager = session.room.ref_manager if hasattr(session.room, 'ref_manager') else None

        loaded_room = LoadedRoom(
            x=session.room.x,
            y=session.room.y,
            z=session.room.z,
            units=loaded_units,
            standard=_standard_to_label(session.room.standard),
            precision=session.room.precision,
            # Use ref_manager.enabled (room.enable_reflectance is a method, not property)
            enable_reflectance=ref_manager.enabled if ref_manager else False,
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
        logger.error(f"Traceback: {traceback.format_exc()}")
        _log_and_raise("Load failed", e)


# ============================================================
# Safety Compliance Check (check_lamps)
# ============================================================

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
    room = session.room
    skin = room.calc_zones.get(SKIN_LIMITS)
    eye = room.calc_zones.get(EYE_LIMITS)
    if not skin or not eye or skin.get_values() is None or eye.get_values() is None:
        raise HTTPException(status_code=409, detail="Safety zones not yet calculated")

    try:
        logger.info(f"Running check_lamps on session {session.id[:8]}... Room...")
        result = room.check_lamps()

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
                skin_near_limit=getattr(lamp_result, 'skin_near_limit', False),
                eye_near_limit=getattr(lamp_result, 'eye_near_limit', False),
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

        # Check lamp positions against room bounds using guv_calcs, which
        # checks each bounding-box corner against the room polygon (XY) and
        # Z bounds.  This is the same logic used in guv_calcs scripting mode,
        # ensuring consistent results.
        position_warnings = room.lamps.get_position_warnings()
        for guv_lamp_id, msg in position_warnings.items():
            if msg is not None:
                frontend_id = guv_to_frontend.get(guv_lamp_id, guv_lamp_id)
                display_name = getattr(
                    session.lamp_id_map.get(frontend_id), 'name', None
                ) or frontend_id
                warnings_response.append(SafetyWarningResponse(
                    level="warning",
                    message=f"{display_name} fixture exceeds room boundaries.",
                    lamp_id=frontend_id,
                ))

        bounds_warnings = [w for w in warnings_response if 'exceeds room boundaries' in w.message]
        logger.info(f"check_lamps completed: status={result.status}, "
                     f"lamps_checked={len(room.lamps)}, "
                     f"bounds_warnings={len(bounds_warnings)}")

        return CheckLampsResponse(
            status=str(result.status),
            lamp_results=lamp_results_response,
            warnings=warnings_response,
            max_skin_dose=result.max_skin_dose,
            max_eye_dose=result.max_eye_dose,
            is_skin_compliant=getattr(result, 'is_skin_compliant', True),
            is_eye_compliant=getattr(result, 'is_eye_compliant', True),
            skin_near_limit=getattr(result, 'skin_near_limit', False),
            eye_near_limit=getattr(result, 'eye_near_limit', False),
            skin_dimming_for_compliance=result.skin_dimming_for_compliance,
            eye_dimming_for_compliance=result.eye_dimming_for_compliance,
        )

    except Exception as e:
        _log_and_raise("check_lamps failed", e)
