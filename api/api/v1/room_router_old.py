# # from fastapi import APIRouter, HTTPException
# # from uuid import uuid4
# # from typing import List
# # from guv_calcs.room import Room as OriginalRoom
# # from .schemas import RoomCreateRequest, RoomSummaryResponse, RoomUpdateRequest
# # from datetime import datetime
# # import uuid


# # # === Room Extension (if not done globally, you can define a wrapper here) ===
# # class ExtendedRoom(OriginalRoom):
# #     def __init__(self, *args, room_name=None, **kwargs):
# #         super().__init__(*args, **kwargs)
# #         self.room_id = f"Room-{datetime.now().strftime('%Y%m%d%H%M%S')}"
# #         self.room_name = room_name or self.room_id
# #         self.room_uuid = uuid.uuid4()
# #         self.colormap = kwargs.get("colormap", "plasma")

# #     def summary(self):
# #         return {
# #             "room_name": self.room_name,
# #             "room_id": self.room_id,
# #             "room_uuid": self.room_uuid,
# #             "dimensions": (self.x, self.y, self.z),
# #             "units": self.units,
# #             "standard": self.standard,
# #             "enable_reflectance": self.enable_reflectance,
# #             "air_changes": self.air_changes,
# #             "ozone_decay_constant": self.ozone_decay_constant,
# #             "colormap": self.colormap,
# #             "number_of_lamps": len(self.lamps),
# #             "number_of_calc_zones": len(self.calc_zones)
# #         }


# # # === In-memory storage (temporary - replace with DB later) ===
# # room_store = {}

# # # === Router initialization ===
# # room_router = APIRouter(prefix="/rooms", tags=["Room"])


# # @room_router.post("/", response_model=RoomSummaryResponse)
# # def create_room(room_data: RoomCreateRequest):
# #     room = ExtendedRoom(
# #         x=room_data.x,
# #         y=room_data.y,
# #         z=room_data.z,
# #         units=room_data.units,
# #         standard=room_data.standard,
# #         enable_reflectance=room_data.enable_reflectance,
# #         reflectances=room_data.reflectances,
# #         reflectance_x_spacings=room_data.reflectance_x_spacings,
# #         reflectance_y_spacings=room_data.reflectance_y_spacings,
# #         reflectance_max_num_passes=room_data.reflectance_max_num_passes,
# #         reflectance_threshold=room_data.reflectance_threshold,
# #         air_changes=room_data.air_changes,
# #         ozone_decay_constant=room_data.ozone_decay_constant,
# #         colormap=room_data.colormap,
# #         room_name=room_data.room_name
# #     )
# #     room_store[room.room_id] = room
# #     return room.summary()


# # @room_router.get("/", response_model=List[RoomSummaryResponse])
# # def get_all_rooms():
# #     return [room.summary() for room in room_store.values()]


# # @room_router.get("/{room_id}", response_model=RoomSummaryResponse)
# # def get_room_by_id(room_id: str):
# #     room = room_store.get(room_id)
# #     if not room:
# #         raise HTTPException(status_code=404, detail="Room not found.")
# #     return room.summary()




# # @room_router.put("/room/{room_id}", response_model=RoomSummaryResponse)
# # def update_room(room_id: str, update: RoomUpdateRequest):
# #     room = room_registry.get(room_id)
# #     if not room:
# #         raise HTTPException(status_code=404, detail="Room not found")

# #     # Apply updates only if they’re provided
# #     if update.x is not None: room.x = update.x
# #     if update.y is not None: room.y = update.y
# #     if update.z is not None: room.z = update.z
# #     if update.standard is not None: room.standard = update.standard
# #     if update.enable_reflectance is not None: room.enable_reflectance = update.enable_reflectance
# #     if update.air_changes is not None: room.air_changes = update.air_changes
# #     if update.ozone_decay_constant is not None: room.ozone_decay_constant = update.ozone_decay_constant
# #     if update.colormap is not None: room.colormap = update.colormap

# #     return RoomSummaryResponse(**room.summary())
# from fastapi import APIRouter, HTTPException
# from uuid import uuid4
# from typing import List
# from guv_calcs.room import Room as OriginalRoom
# from .schemas import RoomCreateRequest, RoomSummaryResponse, RoomUpdateRequest
# from datetime import datetime
# import uuid


# # === Room Extension (if not done globally, you can define a wrapper here) ===
# class ExtendedRoom(OriginalRoom):
#     def __init__(self, *args, room_name=None, **kwargs):
#         super().__init__(*args, **kwargs)
#         self.room_id = f"Room-{datetime.now().strftime('%Y%m%d%H%M%S')}"
#         self.room_name = room_name or self.room_id
#         self.room_uuid = uuid.uuid4()
#         self.colormap = kwargs.get("colormap", "plasma")

#     def summary(self):
#         return {
#             "room_name": self.room_name,
#             "room_id": self.room_id,
#             "room_uuid": self.room_uuid,
#             "dimensions": (self.x, self.y, self.z),
#             "units": self.units,
#             "standard": self.standard,
#             "enable_reflectance": self.enable_reflectance,
#             "air_changes": self.air_changes,
#             "ozone_decay_constant": self.ozone_decay_constant,
#             "colormap": self.colormap,
#             "number_of_lamps": len(self.lamps),
#             "number_of_calc_zones": len(self.calc_zones)
#         }


# # === In-memory storage (temporary - replace with DB later) ===
# room_store = {}

# # === Router initialization ===
# room_router = APIRouter(prefix="/rooms", tags=["Room"])


# @room_router.post("/", response_model=RoomSummaryResponse)
# def create_room(room_data: RoomCreateRequest):
#     room = ExtendedRoom(
#         x=room_data.x,
#         y=room_data.y,
#         z=room_data.z,
#         units=room_data.units,
#         standard=room_data.standard,
#         enable_reflectance=room_data.enable_reflectance,
#         reflectances=room_data.reflectances,
#         reflectance_x_spacings=room_data.reflectance_x_spacings,
#         reflectance_y_spacings=room_data.reflectance_y_spacings,
#         reflectance_max_num_passes=room_data.reflectance_max_num_passes,
#         reflectance_threshold=room_data.reflectance_threshold,
#         air_changes=room_data.air_changes,
#         ozone_decay_constant=room_data.ozone_decay_constant,
#         colormap=room_data.colormap,
#         room_name=room_data.room_name
#     )
#     room_store[room.room_id] = room
#     return room.summary()


# @room_router.get("/", response_model=List[RoomSummaryResponse])
# def get_all_rooms():
#     return [room.summary() for room in room_store.values()]


# @room_router.get("/{room_id}", response_model=RoomSummaryResponse)
# def get_room_by_id(room_id: str):
#     room = room_store.get(room_id)
#     if not room:
#         raise HTTPException(status_code=404, detail="Room not found.")
#     return room.summary()




# @room_router.put("/room/{room_id}", response_model=RoomSummaryResponse)
# def update_room(room_id: str, update: RoomUpdateRequest):
#     room = room_registry.get(room_id)
#     if not room:
#         raise HTTPException(status_code=404, detail="Room not found")

#     # Apply updates only if they’re provided
#     if update.x is not None: room.x = update.x
#     if update.y is not None: room.y = update.y
#     if update.z is not None: room.z = update.z
#     if update.standard is not None: room.standard = update.standard
#     if update.enable_reflectance is not None: room.enable_reflectance = update.enable_reflectance
#     if update.air_changes is not None: room.air_changes = update.air_changes
#     if update.ozone_decay_constant is not None: room.ozone_decay_constant = update.ozone_decay_constant
#     if update.colormap is not None: room.colormap = update.colormap

#     return RoomSummaryResponse(**room.summary())