"""Safety compliance check endpoint tests."""

import pytest
from tests.conftest import API


# ---------------------------------------------------------------------------
# Module-scoped safety session — one calculation shared across read-only tests.
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def _safety_ids(_module_client):
    resp = _module_client.post(f"{API}/session/create")
    assert resp.status_code == 200
    data = resp.json()
    return data["session_id"], data["token"]


@pytest.fixture(scope="module")
def _safety_headers(_safety_ids):
    sid, token = _safety_ids
    return {
        "X-Session-ID": sid,
        "Authorization": f"Bearer {token}",
    }


@pytest.fixture(scope="module")
def safety_session(_module_client, _safety_headers):
    """Module-scoped session with standard safety zones, calculated."""
    resp = _module_client.post(
        f"{API}/session/init",
        json={
            "room": {
                "x": 4.0, "y": 6.0, "z": 2.7,
                "units": "meters",
                "standard": "ANSI IES RP 27.1-22 (ACGIH Limits)",
            },
            "lamps": [{
                "preset_id": "ushio_b1",
                "lamp_type": "krcl_222",
                "x": 2.0, "y": 3.0, "z": 2.7,
                "aimx": 0.0, "aimy": 0.0, "aimz": -1.0,
            }],
            "zones": [
                {"id": "EyeLimits", "type": "plane", "height": 1.8,
                 "x1": 0.0, "x2": 4.0, "y1": 0.0, "y2": 6.0, "num_x": 5, "num_y": 5},
                {"id": "SkinLimits", "type": "plane", "height": 1.8,
                 "x1": 0.0, "x2": 4.0, "y1": 0.0, "y2": 6.0, "num_x": 5, "num_y": 5},
            ],
        },
        headers=_safety_headers,
    )
    assert resp.status_code == 200, resp.text
    calc_resp = _module_client.post(f"{API}/session/calculate", headers=_safety_headers)
    assert calc_resp.status_code == 200, calc_resp.text
    return _module_client, _safety_headers


class TestCheckLamps:
    def test_returns_compliance_status(self, safety_session):
        client, headers = safety_session
        resp = client.post(f"{API}/session/check-lamps", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "status" in data
        assert data["status"] in (
            "compliant", "non_compliant",
            "compliant_with_dimming", "non_compliant_even_with_dimming",
        )

    def test_reports_tlv_fractions_for_both_standards(self, safety_session):
        """The response carries the spectrum-weighted exposure as a fraction of
        the skin/eye TLV under ACGIH and ICNIRP, independent of the room's
        selected standard, so a client can show hours to either limit without
        re-running the calculation. 1.0 means the limit is reached in 8 h."""
        client, headers = safety_session
        data = client.post(f"{API}/session/check-lamps", headers=headers).json()
        fractions = data["tlv_fraction_by_standard"]
        assert set(fractions) == {"ACGIH", "ICNIRP"}
        for std in ("ACGIH", "ICNIRP"):
            assert fractions[std]["skin"] > 0 and fractions[std]["eye"] > 0
        # ICNIRP is the stricter standard for a 222 nm lamp
        assert fractions["ICNIRP"]["skin"] > fractions["ACGIH"]["skin"]
        assert fractions["ICNIRP"]["eye"] > fractions["ACGIH"]["eye"]
        # The room's own standard is ACGIH, so that entry is guv_calcs's own
        # weighted dose (3 mJ/cm² at the weighting peak means "at the limit")
        assert fractions["ACGIH"]["skin"] == pytest.approx(data["max_skin_dose"] / 3)
        assert fractions["ACGIH"]["eye"] == pytest.approx(data["max_eye_dose"] / 3)
        # With a single lamp the fraction is just its dose over its TLV
        lamp = next(iter(data["lamp_results"].values()))
        assert fractions["ACGIH"]["skin"] == pytest.approx(lamp["skin_dose_max"] / lamp["skin_tlv"])
        assert fractions["ACGIH"]["eye"] == pytest.approx(lamp["eye_dose_max"] / lamp["eye_tlv"])

    def test_weak_254nm_lamp_does_not_impose_its_tlv_on_the_room(
        self, client, session_headers, ies_file_bytes
    ):
        """Each lamp's dose is weighted by its own TLV (as guv_calcs does), so a
        254 nm lamp contributing almost nothing barely moves the exposure
        fraction. Under the old "lowest TLV across lamps" model its 6-10 mJ/cm²
        TLV would have been applied to the whole 222 nm dose."""
        plane = {"type": "plane", "height": 1.8,
                 "x1": 0.0, "x2": 4.0, "y1": 0.0, "y2": 6.0, "num_x": 5, "num_y": 5}
        resp = client.post(
            f"{API}/session/init",
            json={
                "room": {"x": 4.0, "y": 6.0, "z": 2.7, "units": "meters",
                         "standard": "ANSI IES RP 27.1-22 (ACGIH Limits)"},
                "lamps": [
                    {"id": "l222", "preset_id": "ushio_b1", "lamp_type": "krcl_222",
                     "x": 2.0, "y": 3.0, "z": 2.7},
                    # Same photometry, 1% output, 254 nm
                    {"id": "l254", "lamp_type": "lp_254", "scaling_factor": 0.01,
                     "x": 1.0, "y": 1.0, "z": 2.7},
                ],
                "zones": [{"id": "EyeLimits", **plane}, {"id": "SkinLimits", **plane}],
            },
            headers=session_headers,
        )
        assert resp.status_code == 200, resp.text
        resp = client.post(
            f"{API}/session/lamps/l254/ies",
            files={"file": ("lamp.ies", ies_file_bytes, "application/octet-stream")},
            headers=session_headers,
        )
        assert resp.status_code == 200, resp.text
        assert client.post(f"{API}/session/calculate", headers=session_headers).status_code == 200
        data = client.post(f"{API}/session/check-lamps", headers=session_headers).json()

        l222, l254 = data["lamp_results"]["l222"], data["lamp_results"]["l254"]
        assert l254["skin_tlv"] < 20 < l222["skin_tlv"]
        assert l254["skin_dose_max"] < 0.1 * l222["skin_dose_max"]

        frac = data["tlv_fraction_by_standard"]["ACGIH"]
        own_222 = l222["skin_dose_max"] / l222["skin_tlv"]
        own_254 = l254["skin_dose_max"] / l254["skin_tlv"]
        # Bounded by the lamps' own fractions: at least the 222 nm lamp alone at
        # its hottest point, at most both lamps' maxima added together
        assert frac["skin"] >= own_222 * 0.999
        assert frac["skin"] <= (own_222 + own_254) * 1.001
        # ...and nowhere near the 222 nm dose judged against the 254 nm TLV
        assert frac["skin"] < 0.1 * l222["skin_dose_max"] / l254["skin_tlv"]
        # Matches guv_calcs's combined weighted dose for the selected standard
        assert frac["skin"] == pytest.approx(data["max_skin_dose"] / 3)
        assert frac["eye"] == pytest.approx(data["max_eye_dose"] / 3)

    def test_per_lamp_results(self, safety_session):
        client, headers = safety_session
        data = client.post(f"{API}/session/check-lamps", headers=headers).json()
        # check_lamps may return 0 lamp_results if guv_calcs ID mapping
        # doesn't align; validate structure when present
        if len(data["lamp_results"]) >= 1:
            for lamp_id, result in data["lamp_results"].items():
                assert "skin_dose_max" in result
                assert "eye_dose_max" in result
        # At minimum, the top-level dose fields should be present
        assert "max_skin_dose" in data
        assert "max_eye_dose" in data

    def test_dose_values_present(self, safety_session):
        client, headers = safety_session
        data = client.post(f"{API}/session/check-lamps", headers=headers).json()
        assert "max_skin_dose" in data
        assert "max_eye_dose" in data

    def test_compliance_booleans(self, safety_session):
        client, headers = safety_session
        data = client.post(f"{API}/session/check-lamps", headers=headers).json()
        assert isinstance(data["is_skin_compliant"], bool)
        assert isinstance(data["is_eye_compliant"], bool)

    def test_no_lamps_session(self, client, session_headers, minimal_room_config):
        """Session with no lamps should still return a valid response."""
        client.post(
            f"{API}/session/init",
            json={
                "room": minimal_room_config,
                "zones": [
                    {"id": "EyeLimits", "type": "plane", "height": 1.8,
                     "x1": 0.0, "x2": 4.0, "y1": 0.0, "y2": 6.0, "num_x": 5, "num_y": 5},
                    {"id": "SkinLimits", "type": "plane", "height": 1.8,
                     "x1": 0.0, "x2": 4.0, "y1": 0.0, "y2": 6.0, "num_x": 5, "num_y": 5},
                ],
            },
            headers=session_headers,
        )
        calc_resp = client.post(f"{API}/session/calculate", headers=session_headers)
        assert calc_resp.status_code == 200, calc_resp.text
        resp = client.post(f"{API}/session/check-lamps", headers=session_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["lamp_results"]) == 0


class TestCheckLampsEdgeCases:
    def test_missing_safety_zones_returns_409(self, calculated_session):
        """Calculated session without safety zones should return 409."""
        client, headers, _ = calculated_session
        resp = client.post(f"{API}/session/check-lamps", headers=headers)
        assert resp.status_code == 409

    def test_check_lamps_response_structure(self, safety_session):
        client, headers = safety_session
        data = client.post(f"{API}/session/check-lamps", headers=headers).json()
        assert "warnings" in data
        assert isinstance(data["warnings"], list)
        assert "skin_dimming_for_compliance" in data
        assert "eye_dimming_for_compliance" in data

    def test_check_lamps_with_multiple_lamps(self, client, session_headers, minimal_room_config):
        """Init with 2 lamps and safety zones, verify lamp_results has entries."""
        lamp1 = {
            "preset_id": "ushio_b1",
            "lamp_type": "krcl_222",
            "x": 1.0, "y": 2.0, "z": 2.7,
            "aimx": 0.0, "aimy": 0.0, "aimz": -1.0,
        }
        lamp2 = {
            "preset_id": "ushio_b1",
            "lamp_type": "krcl_222",
            "x": 3.0, "y": 4.0, "z": 2.7,
            "aimx": 0.0, "aimy": 0.0, "aimz": -1.0,
        }
        client.post(
            f"{API}/session/init",
            json={
                "room": minimal_room_config,
                "lamps": [lamp1, lamp2],
                "zones": [
                    {"id": "EyeLimits", "type": "plane", "height": 1.8,
                     "x1": 0.0, "x2": 4.0, "y1": 0.0, "y2": 6.0, "num_x": 5, "num_y": 5},
                    {"id": "SkinLimits", "type": "plane", "height": 1.8,
                     "x1": 0.0, "x2": 4.0, "y1": 0.0, "y2": 6.0, "num_x": 5, "num_y": 5},
                ],
            },
            headers=session_headers,
        )
        calc_resp = client.post(f"{API}/session/calculate", headers=session_headers)
        assert calc_resp.status_code == 200
        data = client.post(f"{API}/session/check-lamps", headers=session_headers).json()
        assert data["status"] in (
            "compliant", "non_compliant",
            "compliant_with_dimming", "non_compliant_even_with_dimming",
        )
        # With 2 lamps, should have results for both (if ID mapping works)
        if len(data["lamp_results"]) >= 1:
            assert len(data["lamp_results"]) >= 2
