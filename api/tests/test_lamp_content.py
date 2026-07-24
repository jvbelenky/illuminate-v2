"""Content-hash + session lamp files endpoint tests."""

import io

from tests.conftest import API


class TestContentHash:
    def test_same_file_same_hash(self, client, ies_file_bytes):
        data = ies_file_bytes
        r1 = client.post(
            f"{API}/lamps/content-hash",
            files={"ies_file": ("a.ies", io.BytesIO(data))},
        )
        r2 = client.post(
            f"{API}/lamps/content-hash",
            files={"ies_file": ("renamed.ies", io.BytesIO(data))},
        )
        assert r1.status_code == 200 and r2.status_code == 200
        assert r1.json()["content_hash"] == r2.json()["content_hash"]

    def test_spectrum_changes_hash(self, client, ies_file_bytes):
        data = ies_file_bytes
        csv = b"wavelength,intensity\n200,0.1\n222,1.0\n240,0.2\n"
        r1 = client.post(
            f"{API}/lamps/content-hash",
            files={"ies_file": ("a.ies", io.BytesIO(data))},
        )
        r2 = client.post(
            f"{API}/lamps/content-hash",
            files={
                "ies_file": ("a.ies", io.BytesIO(data)),
                "spectrum_file": ("s.csv", io.BytesIO(csv)),
            },
        )
        assert r1.status_code == 200 and r2.status_code == 200
        assert r1.json()["content_hash"] != r2.json()["content_hash"]

    def test_invalid_ies_400(self, client):
        r = client.post(
            f"{API}/lamps/content-hash",
            files={"ies_file": ("a.ies", io.BytesIO(b"not an ies"))},
        )
        assert r.status_code == 400

    def test_malformed_ies_passes_marker_fails_parsing_400(self, client):
        # IES that passes the TILT marker check but crashes Lamp() parsing
        malformed_ies = b"TILT=NONE\nthis is garbage that passes the marker check\n"
        r = client.post(
            f"{API}/lamps/content-hash",
            files={"ies_file": ("a.ies", io.BytesIO(malformed_ies))},
        )
        assert r.status_code == 400


class TestSessionLampFiles:
    def test_roundtrip_hash_matches_stateless(self, client, custom_lamp_session, ies_file_bytes):
        _, headers, lamp_id = custom_lamp_session
        data = ies_file_bytes
        upload = client.post(
            f"{API}/session/lamps/{lamp_id}/ies",
            headers=headers,
            files={"file": ("a.ies", io.BytesIO(data))},
        )
        assert upload.status_code == 200, upload.text

        stateless = client.post(
            f"{API}/lamps/content-hash",
            files={"ies_file": ("a.ies", io.BytesIO(data))},
        )
        assert stateless.status_code == 200, stateless.text

        files = client.get(f"{API}/session/lamps/{lamp_id}/files", headers=headers)
        assert files.status_code == 200
        body = files.json()
        assert body["content_hash"] == stateless.json()["content_hash"]
        assert body["ies_filedata"]  # non-empty
        assert body["spectrum"] is None  # ies upload clears spectrum

    def test_unknown_lamp_404(self, initialized_session):
        client, headers = initialized_session
        r = client.get(f"{API}/session/lamps/nope/files", headers=headers)
        assert r.status_code == 404

    def test_files_with_spectrum_returns_string_arrays(self, client, custom_lamp_session, ies_file_bytes):
        _, headers, lamp_id = custom_lamp_session
        data = ies_file_bytes
        csv = b"wavelength,intensity\n200,0.1\n222,1.0\n240,0.2\n"

        upload_ies = client.post(
            f"{API}/session/lamps/{lamp_id}/ies",
            headers=headers,
            files={"file": ("a.ies", io.BytesIO(data))},
        )
        assert upload_ies.status_code == 200, upload_ies.text

        upload_spectrum = client.post(
            f"{API}/session/lamps/{lamp_id}/spectrum",
            headers=headers,
            files={"file": ("s.csv", io.BytesIO(csv))},
        )
        assert upload_spectrum.status_code == 200, upload_spectrum.text

        stateless = client.post(
            f"{API}/lamps/content-hash",
            files={
                "ies_file": ("a.ies", io.BytesIO(data)),
                "spectrum_file": ("s.csv", io.BytesIO(csv)),
            },
        )
        assert stateless.status_code == 200, stateless.text

        files = client.get(f"{API}/session/lamps/{lamp_id}/files", headers=headers)
        assert files.status_code == 200, files.text
        body = files.json()

        assert body["content_hash"] == stateless.json()["content_hash"]

        spectrum = body["spectrum"]
        assert isinstance(spectrum, dict)
        assert len(spectrum) == 2
        for key, values in spectrum.items():
            assert isinstance(values, list)
            assert len(values) > 0
            for v in values:
                assert isinstance(v, str)
