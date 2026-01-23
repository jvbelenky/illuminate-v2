# Main Imports
import time
from fastapi import FastAPI, APIRouter
from fastapi.middleware.cors import CORSMiddleware
from .logging_config import setup_logging

# Import routers
from api.v1.utility_routers import utility_router
from api.v1.simulation_routers import router as simulate_router
from api.v1.room_routers import room_router, room_store, ExtendedRoom
from api.v1.lamp_routers import lamp_router
from api.v1.room_lamps_routers import room_lamps_router
from api.v1.calc_zone_routers import calc_zone_router
from api.v1.project_routers import project_router
from api.v1.efficacy_routers import router as efficacy_router

# Import Temporary Storage (Rooms, Lamps and Projects)
from .utility.room_storage import restore_rooms


# APP & API Setup - TODO: Move into a config file
API_VERSION = "v1"
API_PREFIX = f"/api/{API_VERSION}"
APP_VERSION = "1.0.0"


# === Logging ===
setup_logging()

# === App Initialization ===
app = FastAPI(
    title="Illuminate API",
    description="API for UV disinfection simulation",
    version=APP_VERSION,
    docs_url=f"{API_PREFIX}/docs",
    openapi_url=f"{API_PREFIX}/openapi.json",
)

# App State Initialization
app.state.start_time = time.time()
app.state.health_ok = True  # flip to False from a watchdog if needed
app.state.room_store_loaded = False  # default until restore completes


# === CORS Middleware ===
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # All but should be adjusted as needed for security
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# === Restore Room State ===
restore_rooms(
    ExtendedRoom, room_store
)  # <-- Restore room_store from JSON on startup , it will be removed in production
app.state.room_store_loaded = True  #  restore completes


# === Versioned router: put EVERYTHING behind /api/versionNumber ===
api = APIRouter(prefix=API_PREFIX)

# === Mount Routers ===
api.include_router(utility_router, tags=["Utility"])
api.include_router(room_router, tags=["Rooms"])
api.include_router(lamp_router, tags=["Lamps"])
api.include_router(room_lamps_router, tags=["Room Lamps"])
api.include_router(calc_zone_router, tags=["Calculation Zones"])
api.include_router(simulate_router, tags=["Simulation"])
api.include_router(project_router, tags=["Projects"])
api.include_router(efficacy_router, tags=["Efficacy"])

# === Mounting API Router ===
app.include_router(api)
