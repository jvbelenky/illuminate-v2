"""Spectrum-weighted exposure on the safety planes, shared by check-lamps and
the PDF report.

Each lamp's 8-hour dose is divided by that lamp's own skin/eye TLV, the
per-lamp fractions are summed point by point, and the maximum over the plane
is reported — the way guv_calcs.safety.check_lamps weighs it for the room's
own standard, evaluated here for any standard. A lamp whose spectrum has a low
TLV therefore counts in proportion to the dose it actually delivers, instead of
its TLV being applied to every lamp's dose. The limit is reached in
8 h × 1 / fraction.
"""
from dataclasses import dataclass
from typing import Optional

import numpy as np
from guv_calcs import EYE_LIMITS, SKIN_LIMITS
from guv_calcs.safety import PhotStandard

from .session_schemas import TlvFraction

DAY_HOURS = 8.0


def _plane_max(values: np.ndarray) -> float:
    """Largest finite value on a safety plane (polygon rooms leave NaN holes)."""
    finite = values[np.isfinite(values)]
    return float(finite.max()) if finite.size else 0.0


def tlv_fraction(room, standard: PhotStandard) -> Optional[TlvFraction]:
    """Weighted exposure as a fraction of the skin and eye TLVs under `standard`
    (1.0 = the limit is reached in exactly 8 hours). None when no lamp with a
    TLV contributed to both planes."""
    skin = room.calc_zones[SKIN_LIMITS]
    eye = room.calc_zones[EYE_LIMITS]
    skin_seconds = skin.exposure_time.total_seconds()
    eye_seconds = eye.exposure_time.total_seconds()
    skin_total = None
    eye_total = None
    for lamp_id, lamp in room.lamps.items():
        if lamp_id not in skin.lamp_cache or lamp_id not in eye.lamp_cache:
            continue
        skin_tlv, eye_tlv = lamp.get_tlvs(standard)
        if skin_tlv is None or eye_tlv is None:
            continue
        # Cached per-lamp values are irradiance (µW/cm²); dose in mJ/cm²
        skin_dose = skin.lamp_cache[lamp_id].values * skin_seconds / 1e3
        eye_dose = eye.lamp_cache[lamp_id].values * eye_seconds / 1e3
        skin_part = skin_dose / float(skin_tlv)
        eye_part = eye_dose / float(eye_tlv)
        skin_total = skin_part if skin_total is None else skin_total + skin_part
        eye_total = eye_part if eye_total is None else eye_total + eye_part
    if skin_total is None or eye_total is None:
        return None
    return TlvFraction(skin=_plane_max(skin_total), eye=_plane_max(eye_total))


@dataclass(frozen=True)
class HoursToLimit:
    skin: Optional[float]
    eye: Optional[float]


def _hours(fraction: Optional[float]) -> Optional[float]:
    if fraction is None or fraction <= 0:
        return None
    return DAY_HOURS / fraction


def weighted_hours_to_limit(room, standard: PhotStandard) -> HoursToLimit:
    """Hours of occupancy before the weighted skin/eye limit is reached (None when
    no lamp contributes, or the planes are missing)."""
    if SKIN_LIMITS not in room.calc_zones or EYE_LIMITS not in room.calc_zones:
        return HoursToLimit(skin=None, eye=None)
    fraction = tlv_fraction(room, standard)
    if fraction is None:
        return HoursToLimit(skin=None, eye=None)
    return HoursToLimit(skin=_hours(fraction.skin), eye=_hours(fraction.eye))


def hours_to_limit_by_standard(room) -> dict[str, HoursToLimit]:
    return {
        "ACGIH": weighted_hours_to_limit(room, PhotStandard.ACGIH),
        "ICNIRP": weighted_hours_to_limit(room, PhotStandard.ICNIRP),
    }
