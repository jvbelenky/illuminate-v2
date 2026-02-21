"""Efficacy/pathogen data endpoint tests."""

from tests.conftest import API


class TestEfficacySummary:
    def test_summary_returns_pathogens(self, client):
        resp = client.post(
            f"{API}/efficacy/summary",
            json={"fluence": 10.0, "wavelength": 222},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "pathogens" in data
        assert len(data["pathogens"]) >= 1


class TestEfficacyTable:
    def test_table_returns_rows(self, client):
        resp = client.post(
            f"{API}/efficacy/table",
            json={"fluence": 10.0},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "columns" in data
        assert "rows" in data
        assert data["count"] > 0


class TestEfficacyExplore:
    def test_explore_returns_categories_and_table(self, client):
        resp = client.post(
            f"{API}/efficacy/explore",
            json={"fluence": 10.0},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "categories" in data
        assert "mediums" in data
        assert "wavelengths" in data
        assert "table" in data
        assert len(data["categories"]) > 0


class TestEfficacyMediums:
    def test_mediums_returns_list(self, client):
        resp = client.get(f"{API}/efficacy/mediums")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) >= 1

    def test_mediums_contains_aerosol(self, client):
        data = client.get(f"{API}/efficacy/mediums").json()
        assert "Aerosol" in data


class TestEfficacyWavelengths:
    def test_returns_list_of_ints(self, client):
        resp = client.get(f"{API}/efficacy/wavelengths")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert all(isinstance(w, int) for w in data)

    def test_contains_222(self, client):
        data = client.get(f"{API}/efficacy/wavelengths").json()
        assert 222 in data


class TestEfficacyStats:
    def test_returns_each_uv_values(self, client):
        resp = client.post(
            f"{API}/efficacy/stats",
            json={"fluence": 10.0, "medium": "Aerosol"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "each_uv_median" in data
        assert "each_uv_min" in data
        assert "each_uv_max" in data

    def test_pathogen_count_positive(self, client):
        data = client.post(
            f"{API}/efficacy/stats",
            json={"fluence": 10.0, "medium": "Aerosol"},
        ).json()
        assert data["pathogen_count"] > 0
