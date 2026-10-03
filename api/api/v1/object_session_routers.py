"""
Object Session Routers - CRUD for physical objects (obstacles) in the room.

Objects are guv_calcs ``Object`` instances held in ``room.objects``. Their
faces occlude and reflect light during calculation. IDs are client-authoritative
(409 on collision), matching lamps and zones.
"""

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException

from .session_helpers import (
    InitializedSessionDep,
    locked_session,
    _log_and_raise,
    _get_object_or_404,
    _get_state_hashes,
    _create_object_from_input,
    _object_to_state,
)
from .session_schemas import (
    SessionObjectInput,
    SessionObjectUpdate,
    SessionObjectUpdateResponse,
    AddObjectResponse,
    GetObjectsResponse,
    CopyEntityRequest,
    SuccessResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/objects", response_model=AddObjectResponse)
def add_session_object(obj: SessionObjectInput, session: InitializedSessionDep):
    """Add an object to the session Room.

    Requires X-Session-ID header.
    """
    with locked_session(session):
        try:
            guv_obj = _create_object_from_input(obj)
            # Client-supplied id is authoritative: collisions are 409s.
            # No id → registry assigns/increments.
            on_collision = "error" if obj.id is not None else None
            try:
                session.room.add_object(guv_obj, on_collision=on_collision)
            except KeyError:
                raise HTTPException(
                    status_code=409,
                    detail=f"Object id {obj.id!r} already exists",
                )
            assigned_id = guv_obj.id

            logger.debug(f"Added object {assigned_id}")
            return AddObjectResponse(
                success=True,
                object_id=assigned_id,
                state=_object_to_state(guv_obj),
                state_hashes=_get_state_hashes(session),
            )

        except Exception as e:
            _log_and_raise("Failed to add object", e)


@router.patch("/objects/{object_id}", response_model=SessionObjectUpdateResponse)
def update_session_object(object_id: str, updates: SessionObjectUpdate, session: InitializedSessionDep):
    """Update an object's name, position, rotation, size, optical properties or enabled flag.

    Reflectance and transmittance are applied together so guv_calcs validates
    the pair (R + T <= 1) before either value changes.

    Requires X-Session-ID header.
    """
    with locked_session(session):
        try:
            obj = _get_object_or_404(session, object_id)

            # Validate the optical pair first so a rejected update leaves the
            # object untouched.
            if updates.reflectance is not None or updates.transmittance is not None:
                new_r = updates.reflectance if updates.reflectance is not None else obj.R
                new_t = updates.transmittance if updates.transmittance is not None else obj.T
                if new_r + new_t > 1:
                    raise ValueError("R + T must be <= 1")
            else:
                new_r = new_t = None

            if updates.name is not None:
                obj.name = updates.name
            if updates.enabled is not None:
                obj.enabled = updates.enabled
            if any(v is not None for v in (updates.x, updates.y, updates.z)):
                obj.move(x=updates.x, y=updates.y, z=updates.z)
            if any(v is not None for v in (updates.yaw, updates.pitch, updates.roll)):
                obj.rotate(yaw=updates.yaw, pitch=updates.pitch, roll=updates.roll)
            if any(v is not None for v in (updates.width, updates.length, updates.height)):
                obj.set_dimensions(width=updates.width, length=updates.length, height=updates.height)
            if new_r is not None:
                obj.set_face_properties(new_r, new_t)

            logger.debug(f"Updated object {object_id}")
            return SessionObjectUpdateResponse(
                success=True,
                object_id=obj.id,
                state=_object_to_state(obj),
                state_hashes=_get_state_hashes(session),
            )

        except Exception as e:
            _log_and_raise("Failed to update object", e)


@router.delete("/objects/{object_id}", response_model=SuccessResponse)
def delete_session_object(object_id: str, session: InitializedSessionDep):
    """Remove an object from the session Room.

    Requires X-Session-ID header.
    """
    with locked_session(session):
        try:
            obj = _get_object_or_404(session, object_id)
            session.room.remove_object(obj.id)

            logger.debug(f"Deleted object {object_id}")
            return SuccessResponse(success=True, message="Object deleted", state_hashes=_get_state_hashes(session))

        except Exception as e:
            _log_and_raise("Failed to delete object", e)


@router.post("/objects/{object_id}/copy", response_model=AddObjectResponse)
def copy_session_object(
    object_id: str,
    session: InitializedSessionDep,
    body: Optional[CopyEntityRequest] = None,
):
    """Copy an object, preserving shape, rotation and per-face optical properties.

    Requires X-Session-ID header.
    """
    with locked_session(session):
        try:
            obj = _get_object_or_404(session, object_id)
            new_id = body.new_id if body is not None else None
            copy = obj.copy(object_id=new_id) if new_id is not None else obj.copy()
            on_collision = "error" if new_id is not None else None
            try:
                session.room.add_object(copy, on_collision=on_collision)
            except KeyError:
                raise HTTPException(
                    status_code=409,
                    detail=f"Object id {new_id!r} already exists",
                )
            assigned_id = copy.id

            logger.debug(f"Copied object {object_id} -> {assigned_id}")
            return AddObjectResponse(
                success=True,
                object_id=assigned_id,
                state=_object_to_state(copy),
                state_hashes=_get_state_hashes(session),
            )

        except Exception as e:
            _log_and_raise("Failed to copy object", e)


@router.get("/objects", response_model=GetObjectsResponse)
def get_session_objects(session: InitializedSessionDep):
    """List all objects in the session Room.

    Requires X-Session-ID header.
    """
    try:
        return GetObjectsResponse(
            objects=[_object_to_state(obj) for _, obj in list(session.room.objects.items())]
        )
    except Exception as e:
        _log_and_raise("Failed to get objects", e)
