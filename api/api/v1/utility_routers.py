from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

# === Utility Router Initialization ===
utility_router = APIRouter()

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

# Version Info - basic - TODO: add versioning information
@utility_router.get("/version",summary="Report app & API version",
    description=(
        "Returns the app build version and API version lifecycle.\n\n"
        "Use this to detect deprecations or unsupported versions."
    ),)
async def get_version(request:Request):
    return {"app": request.app.title, "version": request.app.version}



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