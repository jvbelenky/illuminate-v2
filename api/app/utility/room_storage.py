import json
import os
import uuid

# Ensure a storage path is available
STORAGE_DIR = os.path.join(os.path.dirname(__file__), "storage")
os.makedirs(STORAGE_DIR, exist_ok=True)

# Path to the rooms data file
ROOMS_FILE_PATH = os.path.join(STORAGE_DIR, "rooms.json")

# Function to save rooms to disk (i.e. rooms.json)
def save_rooms(room_store):
    """
    Save current in-memory room store to disk in JSON format.

    Args:
        room_store (dict): Dictionary mapping room_id to room instances.
    """
    try:
        with open(ROOMS_FILE_PATH, "w") as f:
            json.dump(
                {room_id: room.summary() for room_id, room in room_store.items()},
                f,
                indent=2
            )
    except Exception as e:
        print(f"⚠️ Failed to save rooms: {e}")

# Restore rooms from a JSON file into memory
def restore_rooms(RoomClass, store_dict):
    """
    Restore previously saved rooms from a JSON file into memory.

    Args:
        RoomClass: A Room or ExtendedRoom class to instantiate rooms from.
        store_dict: The dictionary to populate with restored rooms.
    """
    if not os.path.exists(ROOMS_FILE_PATH):
        return

    try:
        with open(ROOMS_FILE_PATH, "r") as f:
            room_data = json.load(f)
    except json.JSONDecodeError:
        print("⚠️ rooms.json could not be decoded properly.")
        return

    for room_id, summary in room_data.items():
        try:
            room = RoomClass(
                x=summary["dimensions"][0],
                y=summary["dimensions"][1],
                z=summary["dimensions"][2],
                units=summary.get("units", "meters"),
                standard=summary.get("standard"),
                enable_reflectance=summary.get("enable_reflectance", False),
                air_changes=summary.get("air_changes"),
                ozone_decay_constant=summary.get("ozone_decay_constant"),
                colormap=summary.get("colormap", "plasma"),
                room_name=summary.get("room_name")
            )
            room.room_id = summary.get("room_id", room_id)
            room.room_uuid = uuid.UUID(summary["room_uuid"]) if isinstance(summary.get("room_uuid"), str) else summary.get("room_uuid")
            store_dict[room.room_id] = room
        except Exception as e:
            print(f"Could not restore room '{room_id}': {e}")
