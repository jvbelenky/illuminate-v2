"""
Centralized default values for room configuration and safety calculations.
Import these instead of hardcoding values.
"""
from typing import Dict

# Room dimensions
ROOM_X = 4.0
ROOM_Y = 6.0
ROOM_Z = 2.7

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

# ==== Field of View Defaults (per ANSI/IES RP 27.1-22) ====
FOV_VERT_EYE = 80  # Vertical FOV for eye dose calculations (degrees)
FOV_VERT_SKIN = 180  # Vertical FOV for skin dose calculations (degrees)
FOV_HORIZ = 360  # Horizontal FOV (degrees)

# ==== TLV Limits by Standard (mJ/cm² over 8 hours) ====
TLV_LIMITS: Dict[str, Dict[str, float]] = {
    "ACGIH": {"skin": 479.0, "eye": 161.0},
    "ACGIH-UL8802": {"skin": 479.0, "eye": 161.0},
    "ICNIRP": {"skin": 23.0, "eye": 23.0},
}

# ==== Pathogen/Efficacy Constants ====
# DEPRECATED: Use guv_calcs.efficacy.Data for pathogen susceptibility data.
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
