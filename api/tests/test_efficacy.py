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
