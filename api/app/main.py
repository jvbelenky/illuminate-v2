# Main Imports
import time
from contextlib import asynccontextmanager
from fastapi import FastAPI, APIRouter
from fastapi.middleware.cors import CORSMiddleware
from .logging_config import setup_logging

# Import routers
from api.v1.utility_routers import utility_router
from api.v1.simulation_routers import router as simulate_router
from api.v1.lamp_routers import lamp_router
from api.v1.efficacy_routers import router as efficacy_router
from api.v1.session_routers import router as session_router
from api.v1.session_manager import init_session_manager, get_session_manager


# APP & API Setup - TODO: Move into a config file
API_VERSION = "v1"
API_PREFIX = f"/api/{API_VERSION}"
APP_VERSION = "1.0.0"


# === Logging ===
setup_logging()


# === Lifespan Management ===
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan - startup and shutdown."""
    # Startup
    init_session_manager()
    yield
    # Shutdown
    get_session_manager().stop_cleanup()

# === App Initialization ===
app = FastAPI(
    title="Illuminate API",
    description="API for UV disinfection simulation",
    version=APP_VERSION,
    docs_url=f"{API_PREFIX}/docs",
    openapi_url=f"{API_PREFIX}/openapi.json",
    lifespan=lifespan,
)

# App State Initialization
app.state.start_time = time.time()
app.state.health_ok = True  # flip to False from a watchdog if needed


# === CORS Middleware ===
# Note: allow_credentials=True cannot be combined with allow_origins=["*"]
# For development: allow all origins without credentials
# For production: set CORS_ORIGINS environment variable to restrict origins
import os
cors_origins = os.getenv("CORS_ORIGINS", "").split(",") if os.getenv("CORS_ORIGINS") else ["*"]
cors_origins = [o.strip() for o in cors_origins if o.strip()]
if not cors_origins:
    cors_origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    # Only allow credentials when origins are explicitly configured (not wildcard)
    allow_credentials=cors_origins != ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# === Versioned router: put EVERYTHING behind /api/versionNumber ===
api = APIRouter(prefix=API_PREFIX)

# === Mount Routers ===
api.include_router(utility_router, tags=["Utility"])
api.include_router(lamp_router, tags=["Lamps"])
api.include_router(simulate_router, tags=["Simulation"])
api.include_router(efficacy_router, tags=["Efficacy"])
api.include_router(session_router, tags=["Session"])

# === Mounting API Router ===
app.include_router(api)
