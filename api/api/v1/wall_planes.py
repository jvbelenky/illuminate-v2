"""Report a calc plane's placement on a room wall."""
from typing import List, Optional, Tuple

from guv_calcs.calc_zone import CalcPlane
from guv_calcs.geometry import wall_frame_of
from guv_calcs.geometry.room_dims import WallFace

from .session_schemas import WallPlaneState

_TOL = 1e-6


def wall_state_of(zone, room) -> Optional[Tuple[WallPlaneState, Optional[List[List[float]]]]]:
    """The wall a plane sits on and its outline in wall coordinates.

    Returns None for anything that is not a vertical plane parallel to a wall.
    The outline (along, up) is None when the plane covers the whole wall.
    """
    if not isinstance(zone, CalcPlane) or zone.geometry is None:
        return None
    frame = wall_frame_of(zone.geometry, room.dim)
    if frame is None:
        return None
    state = WallPlaneState(
        wall_id=frame.wall_id,
        normal_offset=float(frame.normal_offset),
        flip=bool(frame.flip),
    )
    face = room.dim.faces[frame.wall_id]
    if isinstance(face, WallFace) and _covers_wall(frame.polygon, face):
        return state, None
    return state, [[float(a), float(b)] for a, b in frame.polygon.vertices]


def _covers_wall(polygon, face) -> bool:
    x_min, y_min, x_max, y_max = polygon.bounding_box
    tol = _TOL * max(face.edge_length, face.z_height)
    full_area = face.edge_length * face.z_height
    return (
        abs(x_min) <= tol and abs(y_min) <= tol
        and abs(x_max - face.edge_length) <= tol and abs(y_max - face.z_height) <= tol
        and abs(polygon.area - full_area) <= tol * max(face.edge_length, face.z_height)
    )


def apply_wall_state(target, zone, room) -> None:
    """Set ``wall`` and wall-coordinate ``vertices`` on a zone response model, if the zone is a wall plane."""
    found = wall_state_of(zone, room)
    if found is not None:
        target.wall, target.vertices = found
