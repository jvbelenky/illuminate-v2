"""Length units accepted by the session API, and unit-aware validation limits.

guv_calcs stores room geometry in whatever unit the room was given, so every
limit the API applies to a length has to be expressed in that same unit. The
limits below are declared once in meters and converted on demand.
"""

from typing import Literal, get_args

from guv_calcs.units import LengthUnits, convert_length

LengthUnit = Literal["meters", "centimeters", "millimeters", "feet", "inches"]
SUPPORTED_UNITS: tuple[str, ...] = get_args(LengthUnit)
DEFAULT_UNITS: LengthUnit = "meters"

# Resource guards, in meters
MAX_ROOM_EXTENT_M = 1000.0  # x, y, and polygon vertex coordinates
MAX_ROOM_HEIGHT_M = 100.0
MIN_SPACING_M = 0.005  # 5 mm: prevents accidental massive grids

# Kept local (rather than LengthUnits.abbreviation) so the API runs against
# the pinned PyPI guv-calcs, which predates that property.
UNIT_ABBREVIATIONS: dict[str, str] = {
    "meters": "m",
    "centimeters": "cm",
    "millimeters": "mm",
    "feet": "ft",
    "inches": "in",
}


def is_supported(units) -> bool:
    return str(units) in SUPPORTED_UNITS


def unit_abbreviation(units) -> str:
    return UNIT_ABBREVIATIONS.get(str(LengthUnits.from_any(units)), str(units))


def from_meters(value_m: float, units) -> float:
    """Convert a length in meters into ``units``."""
    return float(convert_length(LengthUnits.METERS, units, value_m))


def to_meters(value: float, units) -> float:
    return float(convert_length(units, LengthUnits.METERS, value))


def _fmt(value: float) -> str:
    return f"{value:g}"


def check_room_extents(units, *, x=None, y=None, z=None, polygon=None) -> None:
    """Raise ValueError when a room dimension exceeds the limits (given in meters)."""
    abbr = unit_abbreviation(units)
    max_xy = from_meters(MAX_ROOM_EXTENT_M, units)
    max_z = from_meters(MAX_ROOM_HEIGHT_M, units)
    for name, value in (("x", x), ("y", y)):
        if value is not None and value > max_xy:
            raise ValueError(f"Room {name} must be <= {_fmt(max_xy)} {abbr}")
    if z is not None and z > max_z:
        raise ValueError(f"Room z must be <= {_fmt(max_z)} {abbr}")
    if polygon is not None:
        for vx, vy in polygon:
            if vx > max_xy or vy > max_xy:
                raise ValueError(
                    f"Polygon vertex coordinates must be <= {_fmt(max_xy)} {abbr}"
                )


def check_spacing(units, **spacings) -> None:
    """Raise ValueError when a grid spacing is below the 5 mm floor."""
    min_spacing = from_meters(MIN_SPACING_M, units)
    abbr = unit_abbreviation(units)
    for name, value in spacings.items():
        if value is not None and value <= min_spacing:
            raise ValueError(f"{name} must be > {_fmt(min_spacing)} {abbr}")
