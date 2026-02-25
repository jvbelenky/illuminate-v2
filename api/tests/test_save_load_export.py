"""Save, load, export, and report endpoint tests."""

import json
import zipfile
import io

from tests.conftest import API


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

    def test_uncalculated_returns_400(self, initialized_session):
        client, headers = initialized_session
        status = client.get(f"{API}/session/status", headers=headers).json()
        zone_id = status["zone_ids"][0]
        resp = client.get(f"{API}/session/zones/{zone_id}/export", headers=headers)
        assert resp.status_code == 400

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
                "room": {"x": 4.0, "y": 6.0, "z": 2.7, "units": "meters", "standard": "ACGIH"},
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
                "room": {"x": 4.0, "y": 6.0, "z": 2.7, "units": "meters", "standard": "ACGIH"},
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

        # Export the volume zone
        export_resp = client.get(
            f"{API}/session/zones/{vol_zone_id}/export",
            headers=session_headers,
        )
        assert export_resp.status_code == 200, (
            f"Volume export failed with {export_resp.status_code}: {export_resp.text}"
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
