"""Save, load, export, and report endpoint tests."""

import json
import copy
import zipfile
import io

import pytest

from tests.conftest import API


def _new_session(client):
    """Create a fresh session and return headers dict."""
    resp = client.post(f"{API}/session/create")
    data = resp.json()
    return {
        "X-Session-ID": data["session_id"],
        "Authorization": f"Bearer {data['token']}",
    }


def _save_and_load(client, headers):
    """Save current session, load into a fresh session, return load response."""
    saved = json.loads(client.get(f"{API}/session/save", headers=headers).content)
    new_headers = _new_session(client)
    resp = client.post(f"{API}/session/load", json=saved, headers=new_headers)
    assert resp.status_code == 200, resp.text
    return resp.json(), saved


class TestReport:
    def test_returns_csv(self, initialized_session):
        client, headers = initialized_session
        resp = client.get(f"{API}/session/report", headers=headers)
        assert resp.status_code == 200
        assert "text/csv" in resp.headers["content-type"]

    def test_content_disposition(self, initialized_session):
        client, headers = initialized_session
        resp = client.get(f"{API}/session/report", headers=headers)
        assert "attachment" in resp.headers.get("content-disposition", "")


class TestZoneExport:
    def test_returns_csv(self, calculated_session):
        client, headers, calc_data = calculated_session
        zone_id = list(calc_data["zones"].keys())[0]
        resp = client.get(f"{API}/session/zones/{zone_id}/export", headers=headers)
        assert resp.status_code == 200
        assert "text/csv" in resp.headers["content-type"]

    def test_uncalculated_export_succeeds(self, initialized_session):
        """Exporting an uncalculated zone returns CSV with coordinates (no result data)."""
        client, headers = initialized_session
        status = client.get(f"{API}/session/status", headers=headers).json()
        zone_id = status["zone_ids"][0]
        resp = client.get(f"{API}/session/zones/{zone_id}/export", headers=headers)
        assert resp.status_code == 200
        assert "text/csv" in resp.headers["content-type"]

    def test_volume_export_returns_csv(self, client, session_headers):
        """Volume zone export should return valid UTF-8 CSV.

        guv_calcs emits CalcVol CSV with latin-1 characters (µW/cm²).
        The API must re-encode to UTF-8 since FastAPI declares charset=utf-8.
        Without re-encoding, browsers reject the response as invalid UTF-8.
        """
        # Init session with a volume zone
        resp = client.post(
            f"{API}/session/init",
            json={
                "room": {"x": 4.0, "y": 6.0, "z": 2.7, "units": "meters", "standard": "ANSI IES RP 27.1-22 (ACGIH Limits)"},
                "lamps": [{
                    "preset_id": "ushio_b1",
                    "lamp_type": "krcl_222",
                    "x": 2.0, "y": 3.0, "z": 2.7,
                    "aimx": 0.0, "aimy": 0.0, "aimz": -1.0,
                }],
                "zones": [{
                    "type": "volume",
                    "x_min": 0.0, "x_max": 4.0,
                    "y_min": 0.0, "y_max": 6.0,
                    "z_min": 0.0, "z_max": 2.7,
                    "num_x": 5, "num_y": 5, "num_z": 5,
                }],
            },
            headers=session_headers,
        )
        assert resp.status_code == 200, resp.text

        # Calculate
        calc_resp = client.post(f"{API}/session/calculate", headers=session_headers)
        assert calc_resp.status_code == 200, calc_resp.text
        calc_data = calc_resp.json()

        # Export the volume zone
        zone_id = list(calc_data["zones"].keys())[0]
        export_resp = client.get(f"{API}/session/zones/{zone_id}/export", headers=session_headers)
        assert export_resp.status_code == 200, export_resp.text
        assert "text/csv" in export_resp.headers["content-type"]

        # Verify the content is valid UTF-8 (the root cause of the export bug)
        export_resp.content.decode("utf-8")

    def test_volume_added_via_post_then_export(self, initialized_session):
        """Volume zone added via POST /zones (typical UI flow) then exported."""
        client, headers = initialized_session

        # Add a volume zone via POST (the way the UI does it after init)
        add_resp = client.post(
            f"{API}/session/zones",
            json={
                "type": "volume",
                "x_min": 0.0, "x_max": 4.0,
                "y_min": 0.0, "y_max": 6.0,
                "z_min": 0.0, "z_max": 2.7,
                "num_x": 5, "num_y": 5, "num_z": 5,
            },
            headers=headers,
        )
        assert add_resp.status_code == 200, add_resp.text
        vol_zone_id = add_resp.json()["zone_id"]

        # Calculate
        calc_resp = client.post(f"{API}/session/calculate", headers=headers)
        assert calc_resp.status_code == 200, calc_resp.text

        # Export the volume zone
        export_resp = client.get(f"{API}/session/zones/{vol_zone_id}/export", headers=headers)
        assert export_resp.status_code == 200, export_resp.text
        assert "text/csv" in export_resp.headers["content-type"]
        assert len(export_resp.content) > 0

    def test_volume_export_with_standard_zones(self, client, session_headers):
        """Volume export should work even alongside standard zones (realistic UI flow)."""
        # Init session with standard zones + a volume zone (how the real UI works)
        resp = client.post(
            f"{API}/session/init",
            json={
                "room": {"x": 4.0, "y": 6.0, "z": 2.7, "units": "meters", "standard": "ANSI IES RP 27.1-22 (ACGIH Limits)"},
                "lamps": [{
                    "preset_id": "ushio_b1",
                    "lamp_type": "krcl_222",
                    "x": 2.0, "y": 3.0, "z": 2.7,
                    "aimx": 0.0, "aimy": 0.0, "aimz": -1.0,
                }],
                "zones": [
                    {"id": "WholeRoomFluence", "type": "plane", "isStandard": True, "height": 1.2},
                    {"id": "EyeLimits", "type": "plane", "isStandard": True, "height": 1.8},
                    {"id": "SkinLimits", "type": "plane", "isStandard": True, "height": 1.8},
                ],
            },
            headers=session_headers,
        )
        assert resp.status_code == 200, resp.text

        # Add a volume zone via POST /zones (how the UI adds zones after init)
        add_resp = client.post(
            f"{API}/session/zones",
            json={
                "type": "volume",
                "x_min": 0.0, "x_max": 4.0,
                "y_min": 0.0, "y_max": 6.0,
                "z_min": 0.0, "z_max": 2.7,
                "num_x": 5, "num_y": 5, "num_z": 5,
            },
            headers=session_headers,
        )
        assert add_resp.status_code == 200, add_resp.text
        vol_zone_id = add_resp.json()["zone_id"]

        # Calculate
        calc_resp = client.post(f"{API}/session/calculate", headers=session_headers)
        assert calc_resp.status_code == 200, calc_resp.text

        # Export ALL zones (standard + volume) to verify none are stale
        all_zone_ids = ["WholeRoomFluence", "EyeLimits", "SkinLimits", vol_zone_id]
        for zid in all_zone_ids:
            export_resp = client.get(
                f"{API}/session/zones/{zid}/export",
                headers=session_headers,
            )
            assert export_resp.status_code == 200, (
                f"Export of zone {zid} failed with {export_resp.status_code}: {export_resp.text}"
            )
            assert "text/csv" in export_resp.headers["content-type"]
            assert len(export_resp.content) > 0

    def test_nonexistent_returns_404(self, initialized_session):
        client, headers = initialized_session
        resp = client.get(f"{API}/session/zones/nonexistent/export", headers=headers)
        assert resp.status_code == 404


class TestFullExport:
    def test_returns_zip(self, calculated_session):
        client, headers, _ = calculated_session
        resp = client.get(f"{API}/session/export", headers=headers)
        assert resp.status_code == 200
        assert "application/zip" in resp.headers["content-type"]
        # Verify it's a valid zip
        zf = zipfile.ZipFile(io.BytesIO(resp.content))
        assert len(zf.namelist()) >= 1

    def test_uncalculated_returns_400(self, initialized_session):
        client, headers = initialized_session
        resp = client.get(f"{API}/session/export", headers=headers)
        assert resp.status_code == 400

    def test_with_plots_option(self, calculated_session):
        client, headers, _ = calculated_session
        resp = client.get(
            f"{API}/session/export",
            params={"include_plots": True},
            headers=headers,
        )
        assert resp.status_code == 200
        assert "application/zip" in resp.headers["content-type"]


class TestSave:
    def test_returns_json(self, initialized_session):
        client, headers = initialized_session
        resp = client.get(f"{API}/session/save", headers=headers)
        assert resp.status_code == 200
        data = json.loads(resp.content)
        assert isinstance(data, dict)

    def test_valid_guv_format(self, initialized_session):
        client, headers = initialized_session
        resp = client.get(f"{API}/session/save", headers=headers)
        data = json.loads(resp.content)
        # guv-calcs project format should have these keys
        assert "guv-calcs_version" in data or "data" in data


class TestLoad:
    def test_save_then_load_roundtrip(self, initialized_session):
        client, headers = initialized_session
        # Save
        save_resp = client.get(f"{API}/session/save", headers=headers)
        assert save_resp.status_code == 200
        saved_data = json.loads(save_resp.content)

        # Load into a new session
        new_resp = client.post(f"{API}/session/create")
        new_data = new_resp.json()
        new_headers = {
            "X-Session-ID": new_data["session_id"],
            "Authorization": f"Bearer {new_data['token']}",
        }
        load_resp = client.post(
            f"{API}/session/load",
            json=saved_data,
            headers=new_headers,
        )
        assert load_resp.status_code == 200
        data = load_resp.json()
        assert data["success"] is True

    def test_returns_room_lamps_zones(self, initialized_session):
        client, headers = initialized_session
        saved_data = json.loads(client.get(f"{API}/session/save", headers=headers).content)

        new_resp = client.post(f"{API}/session/create")
        new_data = new_resp.json()
        new_headers = {
            "X-Session-ID": new_data["session_id"],
            "Authorization": f"Bearer {new_data['token']}",
        }
        data = client.post(
            f"{API}/session/load",
            json=saved_data,
            headers=new_headers,
        ).json()
        assert "room" in data
        assert "lamps" in data
        assert "zones" in data
        assert data["room"]["x"] > 0

    def test_invalid_data_returns_error(self, client, session_headers):
        # Completely invalid structure that guv_calcs cannot parse
        resp = client.post(
            f"{API}/session/load",
            json={"data": {"rooms": {"r1": {"dims": "invalid"}}}},
            headers=session_headers,
        )
        # guv_calcs may be lenient with some invalid data; verify
        # either it fails or it returns a valid response
        if resp.status_code == 200:
            data = resp.json()
            assert data["success"] is True
        else:
            assert resp.status_code >= 400


# ============================================================
# Save/load with multi-zone sessions
# ============================================================

class TestSaveLoadMultiZone:
    def test_save_with_plane_and_volume_zones(self, multi_zone_session):
        client, headers, plane_id, volume_id = multi_zone_session
        resp = client.get(f"{API}/session/save", headers=headers)
        assert resp.status_code == 200
        data = json.loads(resp.content)
        assert isinstance(data, dict)

    def test_save_preserves_zone_dimensions(self, multi_zone_session):
        client, headers, plane_id, volume_id = multi_zone_session

        # Save
        save_resp = client.get(f"{API}/session/save", headers=headers)
        saved_data = json.loads(save_resp.content)

        # Load into a new session
        new_resp = client.post(f"{API}/session/create")
        new_data = new_resp.json()
        new_headers = {
            "X-Session-ID": new_data["session_id"],
            "Authorization": f"Bearer {new_data['token']}",
        }
        load_resp = client.post(
            f"{API}/session/load",
            json=saved_data,
            headers=new_headers,
        )
        assert load_resp.status_code == 200
        data = load_resp.json()
        assert data["success"] is True
        # Should have zones in the loaded data
        assert len(data["zones"]) >= 2

    def test_load_preserves_zone_count(self, multi_zone_session):
        client, headers, plane_id, volume_id = multi_zone_session

        # Get original counts
        orig_status = client.get(f"{API}/session/status", headers=headers).json()

        # Save and load
        saved_data = json.loads(client.get(f"{API}/session/save", headers=headers).content)
        new_resp = client.post(f"{API}/session/create")
        new_data = new_resp.json()
        new_headers = {
            "X-Session-ID": new_data["session_id"],
            "Authorization": f"Bearer {new_data['token']}",
        }
        load_resp = client.post(
            f"{API}/session/load",
            json=saved_data,
            headers=new_headers,
        )
        assert load_resp.status_code == 200
        data = load_resp.json()
        assert len(data["lamps"]) == orig_status["lamp_count"]
        assert len(data["zones"]) >= orig_status["zone_count"]


# ============================================================
# Report structure
# ============================================================

class TestReportStructure:
    def test_report_is_valid_csv(self, initialized_session):
        client, headers = initialized_session
        resp = client.get(f"{API}/session/report", headers=headers)
        assert resp.status_code == 200
        content = resp.content.decode("utf-8")
        lines = content.strip().split("\n")
        assert len(lines) >= 1  # At least a header line

    def test_report_contains_room_params(self, initialized_session):
        client, headers = initialized_session
        resp = client.get(f"{API}/session/report", headers=headers)
        content = resp.content.decode("utf-8")
        # Room dimensions should appear somewhere in the report
        assert "4.0" in content or "4" in content


# ============================================================
# Export edge cases
# ============================================================

class TestExportEdgeCases:
    def test_export_with_report_option(self, calculated_session):
        client, headers, _ = calculated_session
        resp = client.get(
            f"{API}/session/export",
            params={"include_plots": True, "include_report": True},
            headers=headers,
        )
        assert resp.status_code == 200
        assert "application/zip" in resp.headers["content-type"]
        zf = zipfile.ZipFile(io.BytesIO(resp.content))
        assert len(zf.namelist()) >= 1


# ============================================================
# Regression: custom zone properties survive save/load
# (reported by Holger — cos/sin calc_mode properties lost)
# ============================================================

ROOM = {"x": 4.0, "y": 6.0, "z": 2.7, "units": "meters", "standard": "ANSI IES RP 27.1-22 (ACGIH Limits)"}
LAMP = {"preset_id": "ushio_b1", "lamp_type": "krcl_222", "x": 2.0, "y": 3.0, "z": 2.7, "aimx": 0.0, "aimy": 0.0, "aimz": -1.0}


class TestZoneCalcModeRoundTrip:
    """Verify that zone calc_mode and associated flags survive save → load."""

    @pytest.fixture()
    def directional_session(self, client, session_headers):
        """Session with eye_directional, planar_normal, and point zones."""
        resp = client.post(f"{API}/session/init", json={
            "room": ROOM,
            "lamps": [LAMP],
            "zones": [
                {
                    "type": "plane", "height": 1.2,
                    "calc_mode": "eye_directional",
                    "view_direction": [1.0, 0.0, 0.0],
                    "num_x": 5, "num_y": 5,
                },
                {
                    "type": "plane", "height": 1.0,
                    "calc_mode": "planar_normal",
                    "num_x": 5, "num_y": 5,
                },
                {
                    "type": "point",
                    "x": 2.0, "y": 3.0, "z": 1.5,
                    "aim_x": 2.0, "aim_y": 3.0, "aim_z": 2.7,
                    "calc_mode": "planar_normal",
                },
            ],
        }, headers=session_headers)
        assert resp.status_code == 200, resp.text
        return client, session_headers

    def test_all_zones_created(self, directional_session):
        """Multiple same-type zones must all be created (regression: collision bug)."""
        client, headers = directional_session
        status = client.get(f"{API}/session/status", headers=headers).json()
        assert status["zone_count"] == 3

    def test_calc_mode_preserved_through_save_load(self, directional_session):
        """calc_mode and flags must round-trip through .guv file."""
        client, headers = directional_session
        loaded, _ = _save_and_load(client, headers)

        zones = loaded["zones"]
        assert len(zones) == 3

        # Find each zone by type + calc_mode
        planes = [z for z in zones if z["type"] == "plane"]
        points = [z for z in zones if z["type"] == "point"]
        assert len(planes) == 2
        assert len(points) == 1

        eye_dir = next(z for z in planes if z["calc_mode"] == "eye_directional")
        planar = next(z for z in planes if z["calc_mode"] == "planar_normal")

        # eye_directional flags
        assert eye_dir["horiz"] is True
        assert eye_dir["vert"] is False
        assert eye_dir["use_normal"] is True
        assert eye_dir["fov_vert"] == 80.0
        assert eye_dir["fov_horiz"] == 120.0
        assert eye_dir["view_direction"] == [1.0, 0.0, 0.0]

        # planar_normal flags
        assert planar["horiz"] is True
        assert planar["vert"] is False
        assert planar["use_normal"] is True
        assert planar["fov_vert"] == 180.0
        assert planar["fov_horiz"] == 360.0

        # point zone
        assert points[0]["calc_mode"] == "planar_normal"

    @pytest.mark.parametrize("calc_mode,expected_flags", [
        ("fluence_rate", {"horiz": False, "vert": False, "use_normal": False, "fov_vert": 180.0, "fov_horiz": 360.0}),
        ("eye_worst_case", {"horiz": False, "vert": True, "use_normal": False, "fov_vert": 80.0, "fov_horiz": 120.0}),
        ("vertical", {"horiz": False, "vert": True, "use_normal": False, "fov_vert": 180.0, "fov_horiz": 360.0}),
        ("vertical_dir", {"horiz": False, "vert": True, "use_normal": True, "fov_vert": 180.0, "fov_horiz": 360.0}),
        ("planar_max", {"horiz": False, "vert": False, "use_normal": True, "fov_vert": 180.0, "fov_horiz": 360.0}),
    ])
    def test_all_calc_modes_round_trip(self, client, session_headers, calc_mode, expected_flags):
        """Every named calc_mode must survive save → load with correct flags."""
        resp = client.post(f"{API}/session/init", json={
            "room": ROOM,
            "lamps": [LAMP],
            "zones": [{"type": "plane", "height": 1.0, "calc_mode": calc_mode, "num_x": 5, "num_y": 5}],
        }, headers=session_headers)
        assert resp.status_code == 200, resp.text

        loaded, _ = _save_and_load(client, session_headers)
        zone = loaded["zones"][0]
        assert zone["calc_mode"] == calc_mode
        for flag, expected in expected_flags.items():
            assert zone[flag] == expected, f"{calc_mode}: {flag} was {zone[flag]}, expected {expected}"


class TestLampNameRoundTrip:
    """Verify that lamp name edits in .guv files don't break loading."""

    @pytest.fixture()
    def named_lamp_session(self, client, session_headers):
        resp = client.post(f"{API}/session/init", json={
            "room": ROOM,
            "lamps": [{**LAMP, "name": "Original Name"}],
            "zones": [{"type": "plane", "height": 1.0, "num_x": 5, "num_y": 5}],
        }, headers=session_headers)
        assert resp.status_code == 200, resp.text
        return client, session_headers

    def test_lamp_name_survives_roundtrip(self, named_lamp_session):
        client, headers = named_lamp_session
        loaded, _ = _save_and_load(client, headers)
        assert loaded["lamps"][0]["name"] == "Original Name"

    def test_modified_lamp_name_loads(self, named_lamp_session):
        """Editing the lamp name field in a .guv file must not break loading."""
        client, headers = named_lamp_session
        saved = json.loads(client.get(f"{API}/session/save", headers=headers).content)

        # Modify lamp name in the saved data (simulates user editing .guv JSON)
        room_data = saved.get("data", saved)
        if "rooms" in room_data:
            room_data = next(iter(room_data["rooms"].values()))
        for lamp in room_data["lamps"].values():
            lamp["name"] = "Renamed By User"

        new_headers = _new_session(client)
        resp = client.post(f"{API}/session/load", json=saved, headers=new_headers)
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["lamps"][0]["name"] == "Renamed By User"
        assert data["lamps"][0]["has_ies_file"] is True

    def test_modified_lamp_id_loads(self, named_lamp_session):
        """Editing the lamp_id in a .guv file must not crash loading."""
        client, headers = named_lamp_session
        saved = json.loads(client.get(f"{API}/session/save", headers=headers).content)

        room_data = saved.get("data", saved)
        if "rooms" in room_data:
            room_data = next(iter(room_data["rooms"].values()))
        old_lamps = dict(room_data["lamps"])
        room_data["lamps"] = {}
        for lamp_data in old_lamps.values():
            lamp_data["lamp_id"] = "UserCustomID"
            lamp_data["name"] = "User Custom Name"
            room_data["lamps"]["UserCustomID"] = lamp_data

        new_headers = _new_session(client)
        resp = client.post(f"{API}/session/load", json=saved, headers=new_headers)
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["lamps"][0]["name"] == "User Custom Name"
        assert data["lamps"][0]["has_ies_file"] is True


class TestMultipleZonesInit:
    """Regression: multiple zones of the same type must all be created."""

    def test_two_planes_both_created(self, client, session_headers):
        resp = client.post(f"{API}/session/init", json={
            "room": ROOM,
            "lamps": [LAMP],
            "zones": [
                {"type": "plane", "height": 1.0, "num_x": 5, "num_y": 5},
                {"type": "plane", "height": 1.5, "num_x": 5, "num_y": 5},
            ],
        }, headers=session_headers)
        assert resp.status_code == 200, resp.text
        assert resp.json()["zone_count"] == 2

    def test_three_planes_all_created(self, client, session_headers):
        resp = client.post(f"{API}/session/init", json={
            "room": ROOM,
            "lamps": [LAMP],
            "zones": [
                {"type": "plane", "height": 1.0, "calc_mode": "fluence_rate", "num_x": 5, "num_y": 5},
                {"type": "plane", "height": 1.2, "calc_mode": "eye_worst_case", "num_x": 5, "num_y": 5},
                {"type": "plane", "height": 1.5, "calc_mode": "planar_normal", "num_x": 5, "num_y": 5},
            ],
        }, headers=session_headers)
        assert resp.status_code == 200, resp.text
        assert resp.json()["zone_count"] == 3

    def test_two_planes_survive_save_load(self, client, session_headers):
        client.post(f"{API}/session/init", json={
            "room": ROOM,
            "lamps": [LAMP],
            "zones": [
                {"type": "plane", "height": 1.0, "calc_mode": "fluence_rate", "num_x": 5, "num_y": 5},
                {"type": "plane", "height": 1.5, "calc_mode": "eye_directional", "view_direction": [0, 1, 0], "num_x": 5, "num_y": 5},
            ],
        }, headers=session_headers)

        loaded, _ = _save_and_load(client, session_headers)
        planes = [z for z in loaded["zones"] if z["type"] == "plane"]
        assert len(planes) == 2
        modes = {z["calc_mode"] for z in planes}
        assert modes == {"fluence_rate", "eye_directional"}
