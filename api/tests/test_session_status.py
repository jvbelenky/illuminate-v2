"""Session status, state hashes, calculation estimates, and plot endpoint tests."""

import base64

from tests.conftest import API


class TestSessionStatus:
    def test_uninitialized_session_shows_inactive(self, client, session_headers):
        resp = client.get(f"{API}/session/status", headers=session_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["active"] is False

    def test_initialized_session_shows_ids(self, initialized_session):
        client, headers = initialized_session
        resp = client.get(f"{API}/session/status", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["active"] is True
        assert len(data["lamp_ids"]) == 1
        assert len(data["zone_ids"]) >= 1
        assert data["lamp_count"] == 1

    def test_counts_update_after_adding_lamp(self, initialized_session, minimal_lamp_input):
        client, headers = initialized_session
        client.post(f"{API}/session/lamps", json=minimal_lamp_input, headers=headers)
        status = client.get(f"{API}/session/status", headers=headers).json()
        assert status["lamp_count"] == 2

    def test_counts_update_after_adding_zone(self, initialized_session, minimal_zone_input):
        client, headers = initialized_session
        client.post(f"{API}/session/zones", json=minimal_zone_input, headers=headers)
        status = client.get(f"{API}/session/status", headers=headers).json()
        assert status["zone_count"] >= 2


class TestStateHashes:
    def test_returns_both_keys(self, initialized_session):
        client, headers = initialized_session
        resp = client.get(f"{API}/session/state-hashes", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "calc_state" in data
        assert "update_state" in data

    def test_hashes_change_after_room_update(self, initialized_session):
        client, headers = initialized_session
        before = client.get(f"{API}/session/state-hashes", headers=headers).json()
        client.patch(f"{API}/session/room", json={"x": 8.0}, headers=headers)
        after = client.get(f"{API}/session/state-hashes", headers=headers).json()
        assert before != after


class TestCalculationEstimate:
    def test_returns_expected_fields(self, initialized_session):
        client, headers = initialized_session
        resp = client.get(f"{API}/session/calculate/estimate", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "estimated_seconds" in data
        assert "grid_points" in data
        assert "lamp_count" in data
        assert "budget_percent" in data

    def test_budget_percent_under_100(self, initialized_session):
        client, headers = initialized_session
        data = client.get(f"{API}/session/calculate/estimate", headers=headers).json()
        assert data["budget_percent"] < 100


class TestDisinfectionTable:
    def test_returns_rows(self, calculated_session):
        client, headers, calc_data = calculated_session
        # Use the first calculated zone (WHOLE_ROOM_FLUENCE may not exist)
        zone_id = list(calc_data["zones"].keys())[0]
        resp = client.get(
            f"{API}/session/disinfection-table",
            params={"zone_id": zone_id},
            headers=headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "rows" in data
        assert len(data["rows"]) >= 1

    def test_has_target_species(self, calculated_session):
        client, headers, calc_data = calculated_session
        zone_id = list(calc_data["zones"].keys())[0]
        data = client.get(
            f"{API}/session/disinfection-table",
            params={"zone_id": zone_id},
            headers=headers,
        ).json()
        species = [row["species"] for row in data["rows"]]
        assert "Human coronavirus" in species

    def test_uncalculated_returns_error(self, initialized_session):
        client, headers = initialized_session
        status = client.get(f"{API}/session/status", headers=headers).json()
        zone_id = status["zone_ids"][0]
        resp = client.get(
            f"{API}/session/disinfection-table",
            params={"zone_id": zone_id},
            headers=headers,
        )
        # Uncalculated zone returns 400; zone not in room.calc_zones returns 404
        assert resp.status_code in (400, 404)


class TestZonePlot:
    def test_returns_base64_png(self, calculated_session):
        client, headers, calc_data = calculated_session
        zone_id = list(calc_data["zones"].keys())[0]
        resp = client.get(f"{API}/session/zones/{zone_id}/plot", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        png_bytes = base64.b64decode(data["image_base64"])
        assert png_bytes[:4] == b"\x89PNG"

    def test_uncalculated_returns_400(self, initialized_session):
        client, headers = initialized_session
        status = client.get(f"{API}/session/status", headers=headers).json()
        zone_id = status["zone_ids"][0]
        resp = client.get(f"{API}/session/zones/{zone_id}/plot", headers=headers)
        assert resp.status_code == 400

    def test_nonexistent_returns_404(self, initialized_session):
        client, headers = initialized_session
        resp = client.get(f"{API}/session/zones/nonexistent/plot", headers=headers)
        assert resp.status_code == 404


class TestSurvivalPlot:
    def test_returns_base64_png(self, calculated_session):
        client, headers, calc_data = calculated_session
        # Use the first zone_id explicitly
        zone_id = list(calc_data["zones"].keys())[0]
        resp = client.get(
            f"{API}/session/survival-plot",
            params={"zone_id": zone_id},
            headers=headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        png_bytes = base64.b64decode(data["image_base64"])
        assert png_bytes[:4] == b"\x89PNG"
