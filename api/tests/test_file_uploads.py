"""File upload/delete endpoint tests for IES, spectrum, and intensity map."""

from tests.conftest import API


class TestIESUpload:
    def test_valid_upload(self, custom_lamp_session, ies_file_bytes):
        client, headers, lamp_id = custom_lamp_session
        resp = client.post(
            f"{API}/session/lamps/{lamp_id}/ies",
            files={"file": ("test.ies", ies_file_bytes, "application/octet-stream")},
            headers=headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["has_ies_file"] is True

    def test_wrong_extension_400(self, custom_lamp_session):
        client, headers, lamp_id = custom_lamp_session
        resp = client.post(
            f"{API}/session/lamps/{lamp_id}/ies",
            files={"file": ("test.txt", b"some content", "text/plain")},
            headers=headers,
        )
        assert resp.status_code == 400

    def test_invalid_header_400(self, custom_lamp_session):
        client, headers, lamp_id = custom_lamp_session
        resp = client.post(
            f"{API}/session/lamps/{lamp_id}/ies",
            files={"file": ("test.ies", b"NOT AN IES FILE\n", "application/octet-stream")},
            headers=headers,
        )
        assert resp.status_code == 400

    def test_too_large_rejected(self, custom_lamp_session):
        client, headers, lamp_id = custom_lamp_session
        # 2 MB file exceeds 1 MB limit
        large_bytes = b"IESNA:LM-63\n" + b"x" * (2 * 1024 * 1024)
        resp = client.post(
            f"{API}/session/lamps/{lamp_id}/ies",
            files={"file": ("test.ies", large_bytes, "application/octet-stream")},
            headers=headers,
        )
        assert resp.status_code in (400, 413)

    def test_nonexistent_lamp_404(self, initialized_session, ies_file_bytes):
        client, headers = initialized_session
        resp = client.post(
            f"{API}/session/lamps/nonexistent/ies",
            files={"file": ("test.ies", ies_file_bytes, "application/octet-stream")},
            headers=headers,
        )
        assert resp.status_code == 404


class TestIESDelete:
    def test_upload_then_delete(self, custom_lamp_session, ies_file_bytes):
        client, headers, lamp_id = custom_lamp_session
        # Upload first
        client.post(
            f"{API}/session/lamps/{lamp_id}/ies",
            files={"file": ("test.ies", ies_file_bytes, "application/octet-stream")},
            headers=headers,
        )
        # Delete
        resp = client.delete(f"{API}/session/lamps/{lamp_id}/ies", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_nonexistent_lamp_404(self, initialized_session):
        client, headers = initialized_session
        resp = client.delete(f"{API}/session/lamps/nonexistent/ies", headers=headers)
        assert resp.status_code == 404


class TestSpectrumUpload:
    def test_valid_csv(self, custom_lamp_session, minimal_spectrum_csv):
        client, headers, lamp_id = custom_lamp_session
        resp = client.post(
            f"{API}/session/lamps/{lamp_id}/spectrum",
            files={"file": ("spectrum.csv", minimal_spectrum_csv, "text/csv")},
            headers=headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True

    def test_wrong_extension_400(self, custom_lamp_session):
        client, headers, lamp_id = custom_lamp_session
        resp = client.post(
            f"{API}/session/lamps/{lamp_id}/spectrum",
            files={"file": ("spectrum.txt", b"200,0.0\n222,1.0\n", "text/plain")},
            headers=headers,
        )
        assert resp.status_code == 400

    def test_too_large_413(self, custom_lamp_session):
        client, headers, lamp_id = custom_lamp_session
        large_bytes = b"200,0.0\n" * (600 * 1024)  # > 500 KB
        resp = client.post(
            f"{API}/session/lamps/{lamp_id}/spectrum",
            files={"file": ("spectrum.csv", large_bytes, "text/csv")},
            headers=headers,
        )
        assert resp.status_code == 413

    def test_nonexistent_lamp_404(self, initialized_session, minimal_spectrum_csv):
        client, headers = initialized_session
        resp = client.post(
            f"{API}/session/lamps/nonexistent/spectrum",
            files={"file": ("spectrum.csv", minimal_spectrum_csv, "text/csv")},
            headers=headers,
        )
        assert resp.status_code == 404


class TestSpectrumDelete:
    def test_upload_then_delete(self, custom_lamp_session, minimal_spectrum_csv):
        client, headers, lamp_id = custom_lamp_session
        client.post(
            f"{API}/session/lamps/{lamp_id}/spectrum",
            files={"file": ("spectrum.csv", minimal_spectrum_csv, "text/csv")},
            headers=headers,
        )
        resp = client.delete(f"{API}/session/lamps/{lamp_id}/spectrum", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_nonexistent_lamp_404(self, initialized_session):
        client, headers = initialized_session
        resp = client.delete(f"{API}/session/lamps/nonexistent/spectrum", headers=headers)
        assert resp.status_code == 404


class TestIntensityMapUpload:
    def test_valid_upload(self, lamp_with_ies_session, minimal_intensity_map_csv):
        client, headers, lamp_id = lamp_with_ies_session
        resp = client.post(
            f"{API}/session/lamps/{lamp_id}/intensity-map",
            files={"file": ("imap.csv", minimal_intensity_map_csv, "text/csv")},
            headers=headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["has_intensity_map"] is True

    def test_returns_dimensions(self, lamp_with_ies_session, minimal_intensity_map_csv):
        client, headers, lamp_id = lamp_with_ies_session
        data = client.post(
            f"{API}/session/lamps/{lamp_id}/intensity-map",
            files={"file": ("imap.csv", minimal_intensity_map_csv, "text/csv")},
            headers=headers,
        ).json()
        assert data["dimensions"] is not None
        assert data["dimensions"][0] == 3  # 3 rows
        assert data["dimensions"][1] == 3  # 3 cols

    def test_wrong_extension_400(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        resp = client.post(
            f"{API}/session/lamps/{lamp_id}/intensity-map",
            files={"file": ("imap.txt", b"0.5,1.0\n1.0,0.5\n", "text/plain")},
            headers=headers,
        )
        assert resp.status_code == 400

    def test_invalid_csv_400(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        resp = client.post(
            f"{API}/session/lamps/{lamp_id}/intensity-map",
            files={"file": ("imap.csv", b"not,numeric,data\nabc,def,ghi\n", "text/csv")},
            headers=headers,
        )
        assert resp.status_code == 400

    def test_too_large_413(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        large_bytes = b"1.0,2.0,3.0\n" * (50 * 1024)  # > 100 KB
        resp = client.post(
            f"{API}/session/lamps/{lamp_id}/intensity-map",
            files={"file": ("imap.csv", large_bytes, "text/csv")},
            headers=headers,
        )
        assert resp.status_code == 413

    def test_nonexistent_lamp_404(self, initialized_session, minimal_intensity_map_csv):
        client, headers = initialized_session
        resp = client.post(
            f"{API}/session/lamps/nonexistent/intensity-map",
            files={"file": ("imap.csv", minimal_intensity_map_csv, "text/csv")},
            headers=headers,
        )
        assert resp.status_code == 404


class TestIntensityMapDelete:
    def test_upload_then_delete(self, lamp_with_ies_session, minimal_intensity_map_csv):
        client, headers, lamp_id = lamp_with_ies_session
        client.post(
            f"{API}/session/lamps/{lamp_id}/intensity-map",
            files={"file": ("imap.csv", minimal_intensity_map_csv, "text/csv")},
            headers=headers,
        )
        resp = client.delete(f"{API}/session/lamps/{lamp_id}/intensity-map", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_nonexistent_lamp_404(self, initialized_session):
        client, headers = initialized_session
        resp = client.delete(f"{API}/session/lamps/nonexistent/intensity-map", headers=headers)
        assert resp.status_code == 404
