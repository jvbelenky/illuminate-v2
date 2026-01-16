from fastapi import APIRouter, HTTPException
from typing import List
from guv_calcs.room import Room as OriginalRoom
from .schemas import RoomCreateRequest, RoomSummaryResponse, RoomUpdateRequest
from datetime import datetime
import uuid

# Persistent store functions
from app.utility.room_storage import save_rooms, restore_rooms


# === Room Extension ===
class ExtendedRoom(OriginalRoom):
    def __init__(
        self,
        *args,
        room_name=None,
        room_id=None,
        room_uuid=None,
        created_by_user_id=None,
        **kwargs,
    ):
        super().__init__(*args, **kwargs)
        self.room_id = room_id or f"Room-{datetime.now().strftime('%Y%m%d%H%M%S')}"
        self.room_name = room_name or self.room_id
        self.room_uuid = room_uuid or uuid.uuid4()
        self.colormap = kwargs.get("colormap", "plasma")
        self.created_at = datetime.utcnow().isoformat()
        self.updated_at = self.created_at
        self.created_by_user_id = created_by_user_id

    def update_timestamp(self):
        self.updated_at = datetime.utcnow().isoformat()

    def summary(self):
        return {
            "room_name": self.room_name,
            "room_id": self.room_id,
            "room_uuid": str(self.room_uuid),
            "dimensions": (self.x, self.y, self.z),
            "units": self.units,
            "standard": self.standard,
            "enable_reflectance": self.enable_reflectance,
            "air_changes": self.air_changes,
            "ozone_decay_constant": self.ozone_decay_constant,
            "colormap": self.colormap,
            "precision": self.precision,
            "number_of_lamps": len(self.lamps),
            "number_of_calc_zones": len(self.calc_zones),
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "created_by_user_id": self.created_by_user_id,
        }


# === In-memory store ===
room_store = {}

# Restore from disk at startup
restore_rooms(ExtendedRoom, room_store)

# === Rooms' Router Initialization ===
room_router = APIRouter()


# === Routes ===
# Get All Rooms
@room_router.get("/rooms", response_model=List[RoomSummaryResponse])
def get_all_rooms():
    return [room.summary() for room in room_store.values()]


# Create a Room or Rooms(Future)
@room_router.post("/rooms", response_model=RoomSummaryResponse)
def create_room(room_data: RoomCreateRequest):
    # Set defaults for reflectance spacings if reflectance is enabled but no spacings provided
    reflectance_x_spacings = room_data.reflectance_x_spacings
    reflectance_y_spacings = room_data.reflectance_y_spacings

    if room_data.enable_reflectance:
        default_spacing = {
            "floor": 0.5,
            "ceiling": 0.5,
            "north": 0.5,
            "south": 0.5,
            "east": 0.5,
            "west": 0.5,
        }
        if not reflectance_x_spacings:
            reflectance_x_spacings = default_spacing
        if not reflectance_y_spacings:
            reflectance_y_spacings = default_spacing

    room = ExtendedRoom(
        x=room_data.x,
        y=room_data.y,
        z=room_data.z,
        units=room_data.units,
        standard=room_data.standard,
        enable_reflectance=room_data.enable_reflectance,
        reflectances=room_data.reflectances,
        reflectance_x_spacings=reflectance_x_spacings,
        reflectance_y_spacings=reflectance_y_spacings,
        reflectance_max_num_passes=room_data.reflectance_max_num_passes,
        reflectance_threshold=room_data.reflectance_threshold,
        air_changes=room_data.air_changes,
        ozone_decay_constant=room_data.ozone_decay_constant,
        colormap=room_data.colormap,
        room_name=room_data.room_name,
        precision=room_data.precision,
        created_by_user_id=room_data.created_by_user_id,
    )
    room_store[room.room_id] = room
    save_rooms(room_store)
    return room.summary()


# Get a Room by ID
@room_router.get("/rooms/{room_id}", response_model=RoomSummaryResponse)
def get_room_by_id(room_id: str):
    room = room_store.get(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found.")
    return room.summary()


# Update a Room by ID
@room_router.put("/rooms/{room_id}", response_model=RoomSummaryResponse)
def update_room(room_id: str, update: RoomUpdateRequest):
    room = room_store.get(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    # Apply updates if provided
    if update.room_name is not None:
        room.room_name = update.room_name
    if update.x is not None:
        room.x = update.x
    if update.y is not None:
        room.y = update.y
    if update.z is not None:
        room.z = update.z
    if update.standard is not None:
        room.standard = update.standard
    if update.enable_reflectance is not None:
        room.enable_reflectance = update.enable_reflectance
    if update.air_changes is not None:
        room.air_changes = update.air_changes
    if update.ozone_decay_constant is not None:
        room.ozone_decay_constant = update.ozone_decay_constant
    if update.colormap is not None:
        room.colormap = update.colormap
    if update.units is not None:
        room.units = update.units
    if update.precision is not None:
        room.precision = update.precision

    room.update_timestamp()
    save_rooms(room_store)
    return RoomSummaryResponse(**room.summary())


# Note: Deletion is not implemented yet, as it requires careful handling of associated data.
# Delete a room by ID - not implemented yet #FIXME #FUTURE
# @room_router.delete("/{room_id}")


# TODO: FUTURE: Add more endpoints for room management, such as deleting rooms, plotly visualizations, etc.
