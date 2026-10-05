"""Weighted hours-to-limit: 8 h × 3 mJ/cm² / max(Σ_lamp dose_lamp × 3 / TLV_lamp)."""
import numpy as np
import pytest
from guv_calcs import Room, Lamp
from guv_calcs.safety import PhotStandard

from api.v1.safety_helpers import HoursToLimit, weighted_hours_to_limit, hours_to_limit_by_standard


def _room(*wavelengths):
    """One ushio_b1 fixture per wavelength; a non-222 entry reuses the photometry but
    drops the spectrum so its TLVs come from that monochromatic wavelength."""
    room = Room(x=4.0, y=6.0, z=2.7, units="meters", enable_reflectance=False)
    for i, wv in enumerate(wavelengths):
        # Passing a wavelength that conflicts with the preset's spectrum makes
        # from_keyword skip the spectrum, so TLVs come from the monochromatic value.
        extra = {} if wv == 222 else {"wavelength": wv, "guv_type": "LPHG"}
        room.add_lamp(Lamp.from_keyword("ushio_b1", lamp_id=f"L{i}", x=1.0 + i, y=3.0, z=2.7,
                                        aimx=1.0 + i, aimy=3.0, aimz=0.0, **extra))
    room.add_standard_zones()
    for zid in ("SkinLimits", "EyeLimits"):
        room.zone(zid).set_num_points(5, 5)
    room.calculate()
    return room


def test_single_wavelength_matches_tlv_over_dose():
    room = _room(222)
    got = weighted_hours_to_limit(room, PhotStandard.ACGIH)
    lamp = next(iter(room.lamps.values()))
    skin_tlv, eye_tlv = lamp.get_tlvs(PhotStandard.ACGIH)
    skin_max = float(room.zone("SkinLimits").get_values().max())
    eye_max = float(room.zone("EyeLimits").get_values().max())
    assert got.skin == pytest.approx(8 * skin_tlv / skin_max, rel=1e-6)
    assert got.eye == pytest.approx(8 * eye_tlv / eye_max, rel=1e-6)


def test_mixed_wavelengths_weight_each_lamp_by_its_own_tlv():
    room = _room(222, 254)
    got = weighted_hours_to_limit(room, PhotStandard.ACGIH)
    skin = room.zone("SkinLimits")
    secs = skin.exposure_time.total_seconds()
    weighted = np.zeros(skin.get_values().shape)
    for lid, lamp in room.lamps.items():
        tlv_skin, _ = lamp.get_tlvs(PhotStandard.ACGIH)
        dose = skin.lamp_cache[lid].values * secs / 1e3
        weighted += dose * 3 / tlv_skin
    assert got.skin == pytest.approx(8 * 3 / weighted.max(), rel=1e-6)
    # The panel's old shortcut (strictest TLV over summed dose) is not what we return
    tlvs = [lamp.get_tlvs(PhotStandard.ACGIH)[0] for lamp in room.lamps.values()]
    shortcut = 8 * min(tlvs) / float(skin.get_values().max())
    assert got.skin != pytest.approx(shortcut, rel=1e-3)


def test_both_standards_returned():
    room = _room(222)
    got = hours_to_limit_by_standard(room)
    assert set(got) == {"ACGIH", "ICNIRP"}
    assert got["ICNIRP"].eye < got["ACGIH"].eye  # ICNIRP is stricter at 222 nm


def test_no_contributing_lamp_gives_none():
    room = Room(x=4.0, y=6.0, z=2.7, units="meters", enable_reflectance=False)
    room.add_standard_zones()
    for zid in ("SkinLimits", "EyeLimits"):
        room.zone(zid).set_num_points(3, 3)
    room.calculate()
    assert weighted_hours_to_limit(room, PhotStandard.ACGIH) == HoursToLimit(skin=None, eye=None)
