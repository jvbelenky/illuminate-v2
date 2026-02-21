"""
Centralized default values for room configuration and safety calculations.
Import these instead of hardcoding values.
"""
from typing import Dict

from guv_calcs import DEFAULT_DIMS, get_tlv_table
from guv_calcs.safety import PhotStandard

# Room dimensions — guv_calcs canonical order is (x=6, y=4, z=2.7);
# illuminate uses swapped X/Y orientation so the longer wall faces the user.
_default_dims = DEFAULT_DIMS["meters"]
ROOM_X = _default_dims[1]  # 4.0
ROOM_Y = _default_dims[0]  # 6.0
ROOM_Z = _default_dims[2]  # 2.7

# Units and standards
UNITS = "meters"
STANDARD = "ACGIH"

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

# ==== Field of View Defaults — derived from PhotStandard.flags() ====
_acgih_flags = PhotStandard.ACGIH.flags()
FOV_VERT_EYE = _acgih_flags["fov_vert"]       # 80
FOV_VERT_SKIN = _acgih_flags["fov_vert_skin"]  # 180
FOV_HORIZ = _acgih_flags["fov_horiz"]          # 360

# ==== TLV Limits by Standard (mJ/cm² over 8 hours at 222nm) ====
TLV_LIMITS: Dict[str, Dict[str, float]] = get_tlv_table(222)

# ==== Pathogen/Efficacy Constants ====
# DEPRECATED: Use guv_calcs.efficacy.InactivationData for pathogen susceptibility data.
# This constant is kept for backwards compatibility/fallback only.
# Default pathogen susceptibility (k value) for SARS-CoV-2 in cm²/mJ
DEFAULT_PATHOGEN_K = 0.377

# ==== Ozone Calculation Constants ====
# Ozone generation constant for 222nm lamps (rough estimate)
OZONE_GEN_CONSTANT = 10
# Warning threshold for ozone increase in ppb
OZONE_WARNING_THRESHOLD_PPB = 5

# ==== Lamp Visualization Colors ====
LAMP_COLOR_222NM = "#8B5CF6"  # Purple for 222nm KrCl
LAMP_COLOR_254NM = "#3B82F6"  # Blue for 254nm LP mercury
LAMP_COLOR_DEFAULT = "#6B7280"  # Gray for unknown types
