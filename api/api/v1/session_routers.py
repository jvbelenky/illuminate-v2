"""
Session Router - Multi-user session management with real-time sync.

This module aggregates all session-related sub-routers under the /session prefix.
Each sub-module handles a specific domain:
  - session_core: session lifecycle, room config, state/status
  - lamp_session_routers: lamp CRUD, IES/spectrum upload, plotting
  - zone_session_routers: zone CRUD, zone plots, zone export
  - calculation_routers: calculate, report, save/load, check-lamps
"""

from fastapi import APIRouter

from .session_core import router as core_router
from .lamp_session_routers import router as lamp_router
from .zone_session_routers import router as zone_router
from .calculation_routers import router as calc_router

router = APIRouter(prefix="/session", tags=["Session"])
router.include_router(core_router)
router.include_router(lamp_router)
router.include_router(zone_router)
router.include_router(calc_router)
