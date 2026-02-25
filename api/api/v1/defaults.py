"""
Centralized default values for room configuration and safety calculations.
Import these instead of hardcoding values.
"""
from typing import Dict

from guv_calcs import DEFAULT_DIMS
from guv_calcs.safety import PhotStandard, get_tlvs
from guv_calcs.standard_zones import get_zone_config

# Room dimensions — guv_calcs canonical order is (x=6, y=4, z=2.7);
# illuminate uses swapped X/Y orientation so the longer wall faces the user.
_default_dims = DEFAULT_DIMS["meters"]
ROOM_X = _default_dims[1]  # 4.0
ROOM_Y = _default_dims[0]  # 6.0
ROOM_Z = _default_dims[2]  # 2.7

# Units and standards
UNITS = "meters"
STANDARD = "ANSI IES RP 27.1-22 (ACGIH Limits)"

# Reflectance settings
ENABLE_REFLECTANCE = False
REFLECTANCE = 0.078
REFLECTANCE_SPACING = 0.5
REFLECTANCE_NUM_POINTS = 10
REFLECTANCE_MAX_NUM_PASSES = 100
REFLECTANCE_THRESHOLD = 0.02

# Air quality
AIR_CHANGES = 1.0
OZONE_DECAY_CONSTANT = 2.7

# Display
COLORMAP = "plasma"
PRECISION = 1

# ==== Field of View Defaults ====
FOV_VERT_EYE = get_zone_config(PhotStandard.ACGIH).eye_fov_vert  # 80 — varies by standard
FOV_VERT_SKIN = 180  # Skin is omnidirectional vertically
FOV_HORIZ = 360      # All zones use full horizontal FOV

# ==== TLV Limits by Standard (mJ/cm² over 8 hours at 222nm) ====
_TLV_LABEL_MAP = {
    PhotStandard.ACGIH: PhotStandard.ACGIH.label,
    PhotStandard.UL8802: PhotStandard.UL8802.label,
    PhotStandard.ICNIRP: PhotStandard.ICNIRP.label,
}
TLV_LIMITS: Dict[str, Dict[str, float]] = {
    _TLV_LABEL_MAP[std]: dict(zip(("skin", "eye"), (round(v, 1) for v in get_tlvs(222, std))))
    for std in PhotStandard
}

