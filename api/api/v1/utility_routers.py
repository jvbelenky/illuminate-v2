import os
import pathlib
import tempfile
from typing import Optional

import pandas as pd
from fastapi import APIRouter, HTTPException, Request, UploadFile, File
from fastapi.responses import JSONResponse

from guv_calcs import Spectrum, PhotStandard, get_tlvs
from guv_calcs.io import load_spectrum_file

# === Utility Router Initialization ===
utility_router = APIRouter()

# Maximum spectrum file size (500 KB to accommodate Excel files with metadata headers)
_MAX_SPECTRUM_FILE_SIZE = 500 * 1024

# Health Check - basic - TODO: add more detailed health checks
@utility_router.get("/health",summary="Liveness probe",
    description=(
        "Quick check that the service process is up and able to respond. "
        "Use this for container/ingress health checks."
    ),
    responses={
        200: {"description": "Service is healthy"},
        503: {"description": "Service is not healthy"},
    },)
async def get_health(request:Request):
    ok = getattr(request.app.state, "health_ok", True)  # set elsewhere if you detect a problem
    return JSONResponse(
        {"status": "ok" if ok else "fail"},
        status_code=200 if ok else 503,
    )

# Version Info
@utility_router.get("/version",summary="Report app & API version",
    description=(
        "Returns the app build version and API version lifecycle.\n\n"
        "Use this to detect deprecations or unsupported versions."
    ),)
async def get_version(request:Request):
    try:
        from guv_calcs import __version__ as guv_calcs_version
    except ImportError:
        guv_calcs_version = "unknown"
    return {
        "app": request.app.title,
        "version": request.app.version,
        "guv_calcs_version": guv_calcs_version
    }



@utility_router.get(
    "/ready",
    summary="Readiness probe",
    description=(
        "Returns 200 when critical dependencies are available. "
        "Use to gate production traffic during deploys and restarts."
    ),
    responses={200: {"description": "Ready"}, 503: {"description": "Not ready"}},
)
async def ready(request: Request):
    checks = {}
    ok = True

    # 1) Example: required module import
    try:
        import guv_calcs  # noqa: F401
        checks["guv_calcs_import"] = True
    except Exception:
        checks["guv_calcs_import"] = False
        ok = False

    # 2) Example: in-memory room store restored (you can set this flag in main.py)
    checks["room_store_loaded"] = bool(getattr(request.app.state, "room_store_loaded", True))
    if not checks["room_store_loaded"]:
        ok = False

    # 3) TODO: Add any external deps here (DB, cache, storage, etc.)
    # checks["object_storage"] = await ping_s3(...)

    return JSONResponse({"status": "ready" if ok else "degraded", "checks": checks},
                        status_code=200 if ok else 503)

# Debugging
# TODO: Implement /Echo endpoint (for debugging - not in production) with rate limiting
# TODO: Implement /Headers endpoint (for debugging - not in production) with rate limiting

### Ideas
# TODO: Implement rate limiting
# TODO: Implement request logging
# TODO: Implement response formatting
# TODO: Implement error handling
# TODO: Implement request validation
# TODO: Implement response caching
# TODO: Implement request throttling (if needed)
# TODO: Implement user authentication and authorization
# TODO: Implement API versioning validation (check if the requested version is supported and alert the user)


def _extract_comment_labels(filepath: str, file_ext: str) -> list[Optional[str]]:
    """Extract labels from a 'comment' row in a spectrum file.

    Some spectrum files (e.g. spectrometer output) have a row whose first cell
    is 'comment', with descriptive names in the remaining columns.
    """
    try:
        if file_ext == ".csv":
            df = pd.read_csv(filepath, header=None, dtype=str)
        else:
            df = pd.read_excel(filepath, header=None, dtype=str)
    except Exception:
        return []

    for _, row in df.iterrows():
        cell0 = str(row.iloc[0]).strip().lower() if pd.notna(row.iloc[0]) else ""
        if cell0 == "comment":
            labels: list[Optional[str]] = []
            for val in row.iloc[1:]:
                if pd.notna(val) and str(val).strip():
                    labels.append(str(val).strip())
                else:
                    labels.append(None)
            return labels
    return []


@utility_router.post(
    "/spectrum/parse",
    summary="Parse a spectrum file and return all columns",
    description=(
        "Stateless endpoint that parses a CSV or Excel spectrum file and returns "
        "all numeric columns as separate series with auto-detected labels. "
        "Useful for previewing multi-column spectrum files before assigning "
        "a specific column to a lamp."
    ),
)
async def parse_spectrum_file(file: UploadFile = File(...)):
    """Parse a spectrum file and return all series."""
    filename = file.filename or ""
    valid_extensions = {'.csv', '.xls', '.xlsx'}
    file_ext = pathlib.Path(filename).suffix.lower()
    if file_ext not in valid_extensions:
        raise HTTPException(
            status_code=400,
            detail="Invalid file type. Please upload a CSV or Excel file (.csv, .xls, .xlsx)"
        )

    if file.size and file.size > _MAX_SPECTRUM_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum size is {_MAX_SPECTRUM_FILE_SIZE // 1024} KB"
        )

    spectrum_bytes = await file.read(_MAX_SPECTRUM_FILE_SIZE + 1)
    if len(spectrum_bytes) > _MAX_SPECTRUM_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum size is {_MAX_SPECTRUM_FILE_SIZE // 1024} KB"
        )

    try:
        with tempfile.NamedTemporaryFile(suffix=file_ext, delete=False) as tmp:
            tmp.write(spectrum_bytes)
            tmp_path = tmp.name
        try:
            result = load_spectrum_file(tmp_path, all_columns=True)
            comment_labels = _extract_comment_labels(tmp_path, file_ext)
        finally:
            os.unlink(tmp_path)
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=400, detail=str(e))

    wavelengths = result["wavelengths"]
    series = []
    for i, s in enumerate(result["series"]):
        entry = {
            "index": i,
            "label": s["label"],
            "intensities": s["intensities"],
            "peak_wavelength": s["peak_wavelength"],
            "acgih_skin": None,
            "acgih_eye": None,
            "icnirp": None,
        }
        try:
            spec = Spectrum(wavelengths, s["intensities"])
            acgih_skin, acgih_eye = get_tlvs(spec, PhotStandard.ACGIH)
            icnirp_skin, _ = get_tlvs(spec, PhotStandard.ICNIRP)
            cap = 10000
            entry["acgih_skin"] = round(acgih_skin, 1) if acgih_skin is not None and acgih_skin < cap else None
            entry["acgih_eye"] = round(acgih_eye, 1) if acgih_eye is not None and acgih_eye < cap else None
            entry["icnirp"] = round(icnirp_skin, 1) if icnirp_skin is not None and icnirp_skin < cap else None
        except Exception:
            pass
        series.append(entry)

    if comment_labels:
        for i, entry in enumerate(series):
            if i < len(comment_labels) and comment_labels[i] is not None:
                entry["label"] = comment_labels[i]

    return {
        "wavelengths": wavelengths,
        "series": series,
        "num_series": len(series),
        "wavelength_range": [min(wavelengths), max(wavelengths)] if wavelengths else [],
    }