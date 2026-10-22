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
from guv_calcs.safety import PhotStandard, effective_tlvs

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


# Each named limit: its standard, and whose weighting (ICNIRP weighs eyes and skin alike)
LIMITS = {
    "icnirp": (PhotStandard.ICNIRP, "eye"),
    "acgih_eye": (PhotStandard.ACGIH, "eye"),
    "acgih_skin": (PhotStandard.ACGIH, "skin"),
}


@dataclass(frozen=True)
class ZoneLimitTlvs:
    """A limit across a zone, in mJ/cm² per 8 h. `ref` is the dose at the limit
    weighed over the zone's dose; `tlvs` is the limit at each point (shaped like
    the zone's values, unlit points at `ref`), or None where every lamp
    lighting the zone has the same limit, so `ref` is the limit everywhere."""
    ref: float
    tlvs: Optional[np.ndarray]


def zone_limit_tlvs(room, zone) -> dict[str, ZoneLimitTlvs]:
    """Each named limit for the mix of lamps lighting `zone`, by LIMITS key."""
    values = zone.get_values()
    if values is None:
        return {}
    values = np.ma.filled(np.ma.asarray(values, dtype=float), np.nan)
    out = {}
    for key, (standard, target) in LIMITS.items():
        tlvs = effective_tlvs(room, zone, standard, target)
        if tlvs is None:
            continue
        tlvs = np.ma.filled(np.ma.asarray(tlvs, dtype=float), np.nan)
        lit = np.isfinite(tlvs)
        if not lit.any():
            continue
        weigh = lit & np.isfinite(values) & (values > 0)
        # The dose over the zone divided by its fraction of the limit
        ref = float(values[weigh].sum() / (values[weigh] / tlvs[weigh]).sum()) if weigh.any() else float(np.median(tlvs[lit]))
        uniform = np.ptp(tlvs[lit]) <= 1e-9 * ref
        out[key] = ZoneLimitTlvs(ref=ref, tlvs=None if uniform else np.where(lit, tlvs, ref))
    return out


def limit_level_fields(room, zone, level_limits) -> Optional[list]:
    """For plot_plane's level_fields: a level from a limit is traced on the
    zone's values scaled by that limit's ref over its value at each point, so
    its line falls where each point reaches the same fraction of its own limit.
    None where no level needs a field of its own."""
    if not any(level_limits):
        return None
    limits = zone_limit_tlvs(room, zone)
    values = np.ma.filled(np.ma.asarray(zone.get_values(), dtype=float), np.nan)
    fields = []
    for key in level_limits:
        limit = limits.get(key) if key else None
        fields.append(None if limit is None or limit.tlvs is None else values * limit.ref / limit.tlvs)
    return fields if any(f is not None for f in fields) else None


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
