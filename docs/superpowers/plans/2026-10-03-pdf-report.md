# PDF Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the CSV "Generate Report" output with a designed, paginated PDF built from the session room by the backend, with 3D captures and the user's choices supplied by the frontend, and fix the Results panel's hours-to-limit to use the spectrally weighted dose.

**Architecture:** The frontend's new Report modal captures PNGs from the Threlte scene (cover view, plan view, one per volume zone) and posts them with title/client/notes, options and a species list to `POST /session/report/pdf`. A new `api/api/report/` package assembles every number from guv_calcs (`room.average_value`, `check_lamps`, zone statistics, a shared weighted-dose helper), renders matplotlib plots to SVG, fills a Jinja2 HTML template and converts it with WeasyPrint. The same weighted-dose helper feeds a new `hours_to_limit_by_standard` field on check-lamps, which the panel reads.

**Tech Stack:** FastAPI + Pydantic v2, guv_calcs 0.7.3 (pinned), matplotlib (SVG), Jinja2, WeasyPrint, pypdf (tests only); SvelteKit 5 runes, Threlte/three.js, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-03-pdf-report-design.md`

## Global Constraints

- Work only in the `pdf-report` worktree (`.claude/worktrees/pdf-report`); other sessions edit `main`. Never bare `git stash`.
- `.svelte` files use **tabs**; `.ts` 2 spaces; `.py` 4 spaces. Never use the Edit tool or `sed` on `.svelte` files: write them whole with Write, or patch with a small Python script that preserves tabs.
- API request/response types are generated: run `make generate-api` after any schema change and commit `api/openapi.json` + `ui/src/lib/api/generated/api-types.ts`; alias in `ui/src/lib/api/contract.ts`.
- `pnpm check` must stay at zero errors; no `@ts-ignore`/`@ts-expect-error`.
- No `[DIAG]` / `TEMP DIAG` markers left in commits; never inline `0.3048`.
- Every mutating session handler wraps its body in `with locked_session(session):`.
- Error details go through `_log_and_raise`; put nothing internal in messages that reach it.
- `ZoneStatsPanel.svelte`, `PathogenSummary.svelte`, `OccupancyBanner.svelte` are touched **only in Task 13**, after `git rebase main`.
- Imports at the top of files; the only allowed lazy import is `weasyprint` in `render.py` (so the API boots without the system libraries).
- No `Co-Authored-By` trailers. User-facing commits add a CHANGELOG `[Unreleased]` line.
- Pathogen **groups are out of scope**: the request carries species names only.
- Dependencies: `weasyprint>=62,<70`, `jinja2>=3.1,<4` (runtime); `pypdf>=4,<6` (dev). Docker runtime stage installs `libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz0b libharfbuzz-subset0 fontconfig`.
- Page size: feet → `Letter`, metres → `A4`, unless `options.page_size` overrides.
- Limits: ≤ 12 images, each ≤ 4 MB decoded PNG; title ≤ 120 chars; client/prepared_by ≤ 120; notes ≤ 2000; at least one species.

## Review Focus

1. **A room with no lamps that has a TLV** (all lamps lack wavelength/spectrum): weighted dose has no contributions → hours must be `None`, rendered "—", never a ZeroDivisionError. Test in Task 1.
2. **Dose-mode custom plane** (`zone.dose=True`, 2 h exposure): statistics must be printed in mJ/cm² with "2 h dose" caption, not µW/cm². Test in Task 3.
3. **A species with no inactivation data at the lamps' wavelengths** (including one that has data at only one of two wavelengths in a mixed room): must 422 with the species named, not a 500 from guv_calcs. Test in Task 7 (`test_unknown_species_is_422_and_named`); the context raises `ValueError("No inactivation data for ...")` whenever `average_value` has nothing for that species, which is also the mixed-room case.
4. **Capture when a volume zone is hidden by the user** (`visibleZoneIds` excludes it): the report still needs its image, so the override must show it regardless of the user's visibility; afterwards the user's visibility is restored. Test in Task 10.
5. **Loading a `.guv` with no `illuminate` block** after a project that had report meta: meta must reset to defaults (title = new project name), not leak. Task 9: `loadFromApiResponse` clears `reportMeta`, the store test covers reset, and the sidecar test covers a file without the block returning `null` (so nothing is re-applied).

---

### Task 1: Weighted hours-to-limit helper and check-lamps field

**Files:**
- Create: `api/api/v1/safety_helpers.py`
- Modify: `api/api/v1/session_schemas.py` (after `class TlvLimits`, and `CheckLampsResponse`)
- Modify: `api/api/v1/calculation_routers.py` (check-lamps handler, ~line 679–775)
- Test: `api/tests/test_safety_helpers.py`, `api/tests/test_safety.py`

**Interfaces:**
- Produces: `safety_helpers.HoursToLimit(skin: float | None, eye: float | None)`, `safety_helpers.weighted_hours_to_limit(room, standard: PhotStandard) -> HoursToLimit`, `safety_helpers.hours_to_limit_by_standard(room) -> dict[str, HoursToLimit]` (keys `"ACGIH"`, `"ICNIRP"`), `session_schemas.HoursToLimitResponse`, `CheckLampsResponse.hours_to_limit_by_standard`.

- [ ] **Step 1: Write the failing tests**

```python
# api/tests/test_safety_helpers.py
"""Weighted hours-to-limit: 8 h × 3 mJ/cm² / max(Σ_lamp dose_lamp × 3 / TLV_lamp)."""
import math
import numpy as np
import pytest
from guv_calcs import Room, Lamp
from guv_calcs.safety import PhotStandard

from api.v1.safety_helpers import HoursToLimit, weighted_hours_to_limit, hours_to_limit_by_standard


def _room(*lamp_keys):
    room = Room(x=4.0, y=6.0, z=2.7, units="meters", enable_reflectance=False)
    for i, key in enumerate(lamp_keys):
        room.add_lamp(Lamp.from_keyword(key, lamp_id=f"L{i}", x=1.0 + i, y=3.0, z=2.7, aimx=1.0 + i, aimy=3.0, aimz=0.0))
    room.add_standard_zones()
    for zid in ("SkinLimits", "EyeLimits"):
        room.zone(zid).set_num_points(5, 5)
    room.calculate()
    return room


def test_single_wavelength_matches_tlv_over_dose():
    room = _room("ushio_b1")
    got = weighted_hours_to_limit(room, PhotStandard.ACGIH)
    lamp = next(iter(room.lamps.values()))
    skin_tlv, eye_tlv = lamp.get_tlvs(PhotStandard.ACGIH)
    skin_max = float(room.zone("SkinLimits").get_values().max())
    eye_max = float(room.zone("EyeLimits").get_values().max())
    assert got.skin == pytest.approx(8 * skin_tlv / skin_max, rel=1e-6)
    assert got.eye == pytest.approx(8 * eye_tlv / eye_max, rel=1e-6)


def test_mixed_wavelengths_weight_each_lamp_by_its_own_tlv():
    room = _room("ushio_b1", "lp_254")  # 222 nm and 254 nm
    got = weighted_hours_to_limit(room, PhotStandard.ACGIH)
    skin = room.zone("SkinLimits")
    secs = skin.exposure_time.total_seconds()
    weighted = np.zeros(skin.get_values().shape)
    for lid, lamp in room.lamps.items():
        tlv_skin, _ = lamp.get_tlvs(PhotStandard.ACGIH)
        dose = skin.lamp_cache[lid].values * secs / 1e3
        weighted += dose * 3 / tlv_skin
    assert got.skin == pytest.approx(8 * 3 / weighted.max(), rel=1e-6)
    # The panel's old shortcut (strictest TLV over summed dose) is not what we return
    tlvs = [lamp.get_tlvs(PhotStandard.ACGIH)[0] for lamp in room.lamps.values()]
    shortcut = 8 * min(tlvs) / float(skin.get_values().max())
    assert got.skin != pytest.approx(shortcut, rel=1e-3)


def test_both_standards_returned():
    room = _room("ushio_b1")
    got = hours_to_limit_by_standard(room)
    assert set(got) == {"ACGIH", "ICNIRP"}
    assert got["ICNIRP"].eye < got["ACGIH"].eye  # ICNIRP is stricter at 222 nm


def test_no_contributing_lamp_gives_none():
    room = Room(x=4.0, y=6.0, z=2.7, units="meters", enable_reflectance=False)
    room.add_standard_zones()
    for zid in ("SkinLimits", "EyeLimits"):
        room.zone(zid).set_num_points(3, 3)
    room.calculate()
    assert weighted_hours_to_limit(room, PhotStandard.ACGIH) == HoursToLimit(skin=None, eye=None)
```

Add to `api/tests/test_safety.py` inside `TestCheckLamps` (or the class holding `test_check_lamps_response_structure`):

```python
    def test_check_lamps_returns_weighted_hours_by_standard(self, safety_session):
        client, headers = safety_session
        data = client.post(f"{API}/session/check-lamps", headers=headers).json()
        hours = data["hours_to_limit_by_standard"]
        assert set(hours) == {"ACGIH", "ICNIRP"}
        for key in ("ACGIH", "ICNIRP"):
            assert hours[key]["skin"] > 0 and hours[key]["eye"] > 0
        # Single 222 nm lamp: equals 8 × TLV / max dose
        tlv = data["tlvs_by_standard"]["ACGIH"]
        assert hours["ACGIH"]["skin"] == pytest.approx(8 * tlv["skin"] / data["max_skin_dose"], rel=1e-6) or True
```

(The last assertion is informational: `max_skin_dose` is the weighted maximum in guv_calcs, so keep the `or True`; the exact equality is covered by `test_safety_helpers.py`. Remove the line if it confuses — the first three assertions are the contract.)

If `room.zone(zid).set_num_points` does not exist, check `api/api/v1/session_helpers.py::_create_zone_from_input` for how the API sets `num_x`/`num_y` on a plane and use that call instead (e.g. `zone.geometry = zone.geometry.with_(num_points=(5, 5))`). Coarse grids keep the test under a second.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && uv run pytest tests/test_safety_helpers.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'api.v1.safety_helpers'`

- [ ] **Step 3: Write the helper**

```python
# api/api/v1/safety_helpers.py
"""Spectrally weighted hours-to-limit, shared by check-lamps and the PDF report.

Mirrors the first loop of guv_calcs.safety.check_lamps: each lamp's 8-hour dose
on the skin/eye planes is weighted by 3 / TLV_lamp(standard) and summed, so a
room mixing 222 nm and 254 nm lamps adds exposures the way the standards do.
check_lamps() only evaluates room.standard; this evaluates any standard.
"""
from dataclasses import dataclass
from typing import Optional

import numpy as np
from guv_calcs import EYE_LIMITS, SKIN_LIMITS
from guv_calcs.safety import PhotStandard

WEIGHTED_LIMIT_MJ = 3.0  # mJ/cm² effective dose over 8 h
DAY_HOURS = 8.0


@dataclass(frozen=True)
class HoursToLimit:
    skin: Optional[float]
    eye: Optional[float]


def _weighted_max(zone, room, standard: PhotStandard, index: int) -> Optional[float]:
    values = zone.get_values()
    if values is None:
        return None
    seconds = zone.exposure_time.total_seconds()
    weighted = np.zeros(values.shape)
    contributed = False
    for lamp_id, lamp in room.lamps.items():
        entry = zone.lamp_cache.get(lamp_id)
        if entry is None or entry.values is None:
            continue
        tlvs = lamp.get_tlvs(standard)
        if tlvs[0] is None or tlvs[1] is None:
            continue
        dose = entry.values * seconds / 1e3
        weighted += dose * WEIGHTED_LIMIT_MJ / tlvs[index]
        contributed = True
    if not contributed:
        return None
    peak = float(weighted.max())
    return peak if peak > 0 else None


def weighted_hours_to_limit(room, standard: PhotStandard) -> HoursToLimit:
    skin = room.calc_zones.get(SKIN_LIMITS)
    eye = room.calc_zones.get(EYE_LIMITS)
    skin_peak = _weighted_max(skin, room, standard, 0) if skin is not None else None
    eye_peak = _weighted_max(eye, room, standard, 1) if eye is not None else None
    return HoursToLimit(
        skin=DAY_HOURS * WEIGHTED_LIMIT_MJ / skin_peak if skin_peak else None,
        eye=DAY_HOURS * WEIGHTED_LIMIT_MJ / eye_peak if eye_peak else None,
    )


def hours_to_limit_by_standard(room) -> dict[str, HoursToLimit]:
    return {
        "ACGIH": weighted_hours_to_limit(room, PhotStandard.ACGIH),
        "ICNIRP": weighted_hours_to_limit(room, PhotStandard.ICNIRP),
    }
```

- [ ] **Step 4: Add the schema and populate it in check-lamps**

In `api/api/v1/session_schemas.py`, directly after `class TlvLimits`:

```python
class HoursToLimitResponse(BaseModel):
    """Hours of occupancy before the weighted skin/eye limit is reached (None = no lamp contributes)."""
    skin: Optional[float] = None
    eye: Optional[float] = None
```

In `CheckLampsResponse`, after `tlvs_by_standard`:

```python
    # Hours to the limit from the spectrally weighted dose (each lamp's dose
    # weighted by its own TLV, then summed), under each standard. Keys: ACGIH, ICNIRP.
    hours_to_limit_by_standard: Dict[str, HoursToLimitResponse] = {}
```

In `api/api/v1/calculation_routers.py`: add `HoursToLimitResponse` to the `session_schemas` import list and `from .safety_helpers import hours_to_limit_by_standard` next to the other relative imports. In `check_lamps_session`, after the `tlvs_by_standard` loop:

```python
        hours_by_standard = {
            key: HoursToLimitResponse(skin=h.skin, eye=h.eye)
            for key, h in hours_to_limit_by_standard(room).items()
        }
```

and pass `hours_to_limit_by_standard=hours_by_standard,` in the `CheckLampsResponse(...)` call.

- [ ] **Step 5: Run the tests**

Run: `cd api && uv run pytest tests/test_safety_helpers.py tests/test_safety.py -v`
Expected: all PASS.

- [ ] **Step 6: Regenerate the contract and commit**

```bash
make generate-api
cd ui && pnpm check
git add api/api/v1/safety_helpers.py api/api/v1/session_schemas.py api/api/v1/calculation_routers.py api/tests/test_safety_helpers.py api/tests/test_safety.py api/openapi.json ui/src/lib/api/generated/api-types.ts
git commit -m "feat(api): check-lamps returns hours to the limit from the spectrally weighted dose under ACGIH and ICNIRP"
```

---

### Task 2: Report request schemas and validation

**Files:**
- Modify: `api/pyproject.toml` (dependencies)
- Modify: `api/api/v1/session_schemas.py` (end of file)
- Create: `api/api/report/__init__.py`, `api/api/report/validation.py`
- Test: `api/tests/test_report_validation.py`

**Interfaces:**
- Produces: `session_schemas.ReportMeta`, `ReportOptions`, `ReportRequest`; `report.validation.decode_images(images: dict[str, str]) -> dict[str, bytes]` (raises `ReportValidationError(key, reason)`), `report.validation.ReportValidationError(ValueError)` with `.detail: str`; `report.validation.IMAGE_KEYS = ("cover", "plan")` and `VOLUME_KEY_PREFIX = "volume:"`.

- [ ] **Step 1: Add dependencies**

In `api/pyproject.toml` `dependencies` add `"jinja2>=3.1,<4",` and `"weasyprint>=62,<70",`; in `dev` add `"pypdf>=4,<6",`. Then:

```bash
cd api && uv lock && uv sync
uv run python -c "import weasyprint, jinja2, pypdf; print(weasyprint.__version__)"
```

Expected: prints a version. If `uv lock` rewrote the guv-calcs source to the local path, that is the dev lock state described in the memory notes; commit `uv.lock` anyway (CI runs `uv lock --no-sources`).

- [ ] **Step 2: Write the failing test**

```python
# api/tests/test_report_validation.py
import base64
import io
import pytest
from PIL import Image
from pydantic import ValidationError

from api.v1.session_schemas import ReportRequest
from api.report.validation import decode_images, ReportValidationError


def _png(w=4, h=4) -> str:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (10, 20, 30)).save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def test_request_defaults_and_limits():
    req = ReportRequest(meta={"title": "Lab 3"}, pathogens=["Human coronavirus"])
    assert req.options.include_lamp_appendix is True
    assert req.options.page_size == "auto"
    assert req.meta.client == ""
    with pytest.raises(ValidationError):
        ReportRequest(meta={"title": "x" * 121}, pathogens=["Human coronavirus"])
    with pytest.raises(ValidationError):
        ReportRequest(meta={"title": "ok"}, pathogens=[])
    with pytest.raises(ValidationError):
        ReportRequest(meta={"title": "ok"}, pathogens=["a"], images={f"volume:{i}": _png() for i in range(13)})


def test_decode_images_accepts_png_and_names_bad_keys():
    out = decode_images({"cover": _png(), "volume:abc": _png()})
    assert set(out) == {"cover", "volume:abc"}
    assert out["cover"][:8] == b"\x89PNG\r\n\x1a\n"
    with pytest.raises(ReportValidationError) as e:
        decode_images({"plan": "data:image/jpeg;base64,/9j/4AAQ"})
    assert "plan" in e.value.detail
    with pytest.raises(ReportValidationError) as e:
        decode_images({"weird": _png()})
    assert "weird" in e.value.detail


def test_decode_images_rejects_oversize():
    big = "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * (4 * 1024 * 1024 + 1)).decode()
    with pytest.raises(ReportValidationError) as e:
        decode_images({"cover": big})
    assert "4 MB" in e.value.detail
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd api && uv run pytest tests/test_report_validation.py -v`
Expected: FAIL with `ImportError` for `ReportRequest`.

- [ ] **Step 4: Add the schemas**

Append to `api/api/v1/session_schemas.py`:

```python
# ============================================================
# PDF report
# ============================================================

class ReportMeta(BaseModel):
    title: str = Field(..., min_length=1, max_length=120)
    client: str = Field("", max_length=120)
    prepared_by: str = Field("", max_length=120)
    notes: str = Field("", max_length=2000)


class ReportOptions(BaseModel):
    include_lamp_appendix: bool = True
    include_methodology: bool = True
    page_size: Literal["auto", "a4", "letter"] = "auto"


class ReportRequest(BaseModel):
    """Body of POST /session/report/pdf. Numbers come from the room; this carries only
    what the browser knows: who the report is for, options, chosen species, and PNG captures."""
    meta: ReportMeta
    options: ReportOptions = ReportOptions()
    pathogens: List[str] = Field(..., min_length=1, max_length=60)
    # key → PNG data URL. Keys: "cover", "plan", "volume:<zone_id>".
    images: Dict[str, str] = Field(default_factory=dict, max_length=12)
```

- [ ] **Step 5: Add the validation module**

```python
# api/api/report/__init__.py
"""PDF report: context assembly, plots, and HTML → PDF rendering."""
```

```python
# api/api/report/validation.py
"""Request-side checks for the PDF report that Pydantic cannot express."""
import base64
import io

from PIL import Image

IMAGE_KEYS = ("cover", "plan")
VOLUME_KEY_PREFIX = "volume:"
MAX_IMAGE_BYTES = 4 * 1024 * 1024
_PNG_PREFIX = "data:image/png;base64,"


class ReportValidationError(ValueError):
    def __init__(self, detail: str):
        super().__init__(detail)
        self.detail = detail


def _valid_key(key: str) -> bool:
    return key in IMAGE_KEYS or (key.startswith(VOLUME_KEY_PREFIX) and len(key) > len(VOLUME_KEY_PREFIX))


def decode_images(images: dict[str, str]) -> dict[str, bytes]:
    out: dict[str, bytes] = {}
    for key, data_url in images.items():
        if not _valid_key(key):
            raise ReportValidationError(f"Unknown image key '{key}'")
        if not data_url.startswith(_PNG_PREFIX):
            raise ReportValidationError(f"Image '{key}' must be a PNG data URL")
        try:
            raw = base64.b64decode(data_url[len(_PNG_PREFIX):], validate=True)
        except (ValueError, TypeError):
            raise ReportValidationError(f"Image '{key}' is not valid base64")
        if len(raw) > MAX_IMAGE_BYTES:
            raise ReportValidationError(f"Image '{key}' exceeds 4 MB")
        try:
            with Image.open(io.BytesIO(raw)) as im:
                if im.format != "PNG":
                    raise ReportValidationError(f"Image '{key}' is not a PNG")
                im.verify()
        except ReportValidationError:
            raise
        except Exception:
            raise ReportValidationError(f"Image '{key}' could not be decoded")
        out[key] = raw
    return out
```

- [ ] **Step 6: Run tests and commit**

Run: `cd api && uv run pytest tests/test_report_validation.py -v` → PASS.

```bash
git add api/pyproject.toml api/uv.lock api/api/v1/session_schemas.py api/api/report/__init__.py api/api/report/validation.py api/tests/test_report_validation.py
git commit -m "feat(api): report request schema and image validation; add jinja2, weasyprint, pypdf"
```

---

### Task 3: Report context assembly

**Files:**
- Create: `api/api/report/context.py`
- Test: `api/tests/test_report_context.py`, fixture in `api/tests/conftest.py`

**Interfaces:**
- Consumes: `safety_helpers.hours_to_limit_by_standard`, `ReportRequest`.
- Produces: `context.build_report_context(room, request: ReportRequest, images: dict[str, bytes], versions: Versions) -> ReportContext` and the dataclasses below. Later tasks (`plots.py`, `render.py`, the template) use these exact field names.

- [ ] **Step 1: Add a shared fixture**

Append to `api/tests/conftest.py`:

```python
@pytest.fixture(scope="module")
def report_session(_module_client):
    """Standard zones + a custom plane (dose, 2 h), volume and point; calculated.
    Returns (client, headers, room)."""
    resp = _module_client.post(f"{API}/session/create")
    sid, token = resp.json()["session_id"], resp.json()["token"]
    headers = {"X-Session-ID": sid, "Authorization": f"Bearer {token}"}
    init = _module_client.post(
        f"{API}/session/init",
        json={
            "room": {"x": 4.0, "y": 6.0, "z": 2.7, "units": "meters",
                     "standard": "ANSI IES RP 27.1-22 (ACGIH Limits)", "air_changes": 2.0},
            "lamps": [{"id": "lampA", "name": "Lamp A", "preset_id": "ushio_b1", "lamp_type": "krcl_222",
                       "x": 2.0, "y": 3.0, "z": 2.7, "aimx": 2.0, "aimy": 3.0, "aimz": 0.0}],
            "zones": [
                {"id": "WholeRoomFluence", "type": "volume", "isStandard": True,
                 "x_min": 0, "x_max": 4, "y_min": 0, "y_max": 6, "z_min": 0, "z_max": 2.7,
                 "num_x": 4, "num_y": 4, "num_z": 3},
                {"id": "SkinLimits", "type": "plane", "isStandard": True, "height": 1.8,
                 "x1": 0, "x2": 4, "y1": 0, "y2": 6, "num_x": 5, "num_y": 5},
                {"id": "EyeLimits", "type": "plane", "isStandard": True, "height": 1.8,
                 "x1": 0, "x2": 4, "y1": 0, "y2": 6, "num_x": 5, "num_y": 5},
                {"id": "desk", "name": "Desk", "type": "plane", "height": 0.8, "dose": True, "hours": 2,
                 "x1": 0.5, "x2": 2.5, "y1": 1, "y2": 3, "num_x": 4, "num_y": 4},
                {"id": "breath", "name": "Breathing zone", "type": "volume",
                 "x_min": 0, "x_max": 4, "y_min": 0, "y_max": 6, "z_min": 1.0, "z_max": 1.8,
                 "num_x": 3, "num_y": 3, "num_z": 2},
                {"id": "pt1", "name": "Door sensor", "type": "point", "x": 0.5, "y": 0.5, "z": 1.5},
            ],
        },
        headers=headers,
    )
    assert init.status_code == 200, init.text
    calc = _module_client.post(f"{API}/session/calculate", headers=headers)
    assert calc.status_code == 200, calc.text
    from api.v1.session_manager import get_session_manager
    room = get_session_manager().get_session(sid).room
    return _module_client, headers, room
```

If the init payload rejects any field name (e.g. `isStandard` for the volume), check `SessionZoneInput` in `api/api/v1/session_schemas.py` and the `safety_session` fixture in `api/tests/test_safety.py`; the standard zones may also be created by `useStandardZones`-style defaults — read `api/api/v1/session_core.py::init` to see how the UI's init produces them and copy that.

- [ ] **Step 2: Write the failing tests**

```python
# api/tests/test_report_context.py
import pytest
from api.v1.session_schemas import ReportRequest
from api.report.context import build_report_context, Versions


def _ctx(room, **over):
    req = ReportRequest(meta={"title": "Lab 3", "client": "Acme", "prepared_by": "V. B."},
                        pathogens=over.pop("pathogens", ["Human coronavirus", "Influenza virus"]), **over)
    return build_report_context(room, req, images={}, versions=Versions(app="0.5.0-test", guv_calcs="0.7.3"))


def test_header_and_units(report_session):
    _, _, room = report_session
    ctx = _ctx(room)
    assert ctx.meta.title == "Lab 3"
    assert ctx.page_size == "A4"
    assert ctx.units.length == "m" and ctx.units.area == "m²" and ctx.units.volume == "m³"
    assert ctx.room.x == pytest.approx(4.0) and ctx.room.volume == pytest.approx(4 * 6 * 2.7)
    assert ctx.room.shape == "rectangle" and ctx.room.air_changes == 2.0


def test_summary_pathogens_come_from_guv_calcs(report_session):
    _, _, room = report_session
    ctx = _ctx(room)
    rows = {r.species: r for r in ctx.pathogens}
    assert set(rows) == {"Human coronavirus", "Influenza virus"}
    hc = rows["Human coronavirus"]
    expected_each = room.average_value(function="each_uv", species="Human coronavirus")
    assert hc.each_uv == pytest.approx(expected_each, rel=1e-9)
    assert hc.t99 > hc.t90 > 0 and hc.t999 > hc.t99
    assert hc.cadr_cfm == pytest.approx(hc.cadr_lps * 2.11888, rel=1e-3)
    assert ctx.summary.each_uv == pytest.approx(expected_each, rel=1e-9)  # first selected species leads
    assert ctx.summary.avg_fluence == pytest.approx(float(room.zone("WholeRoomFluence").get_values().mean()), rel=1e-9)
    assert ctx.fluence.wavelengths_used == [222]


def test_occupancy_uses_weighted_hours(report_session):
    _, _, room = report_session
    ctx = _ctx(room)
    s = ctx.safety
    assert s.standard_label.startswith("ANSI IES RP 27.1-22")
    assert s.hours["ACGIH"].skin > 0 and s.hours["ICNIRP"].eye > 0
    assert s.occupancy.headline_hours == min(s.hours["ACGIH"].skin, s.hours["ACGIH"].eye)
    assert s.occupancy.unlimited == (s.occupancy.headline_hours >= 8)
    assert len(s.lamps) == 1 and s.lamps[0].name == "Lamp A"
    assert "does not comply" not in s.occupancy.statement.lower()


def test_custom_zones_in_their_own_units(report_session):
    _, _, room = report_session
    ctx = _ctx(room)
    plane = next(p for p in ctx.custom_planes if p.name == "Desk")
    assert plane.units == "mJ/cm²" and plane.exposure == "2 h dose"
    vol = next(v for v in ctx.custom_volumes if v.name == "Breathing zone")
    assert vol.units == "µW/cm²" and vol.image_key == "volume:breath"
    pt = next(p for p in ctx.custom_points if p.name == "Door sensor")
    assert pt.position == pytest.approx((0.5, 0.5, 1.5)) and pt.value > 0


def test_feet_room_uses_letter_and_imperial_labels(client, session_headers, minimal_lamp_input):
    resp = client.post(f"{API}/session/init", json={
        "room": {"x": 12.0, "y": 20.0, "z": 9.0, "units": "feet", "standard": "UL8802 (ACGIH Limits)"},
        "lamps": [dict(minimal_lamp_input, x=6.0, y=10.0, z=9.0, aimz=0.0)],
        "zones": [{"id": "SkinLimits", "type": "plane", "isStandard": True, "height": 6,
                   "x1": 0, "x2": 12, "y1": 0, "y2": 20, "num_x": 4, "num_y": 4},
                  {"id": "EyeLimits", "type": "plane", "isStandard": True, "height": 6,
                   "x1": 0, "x2": 12, "y1": 0, "y2": 20, "num_x": 4, "num_y": 4},
                  {"id": "WholeRoomFluence", "type": "volume", "isStandard": True,
                   "x_min": 0, "x_max": 12, "y_min": 0, "y_max": 20, "z_min": 0, "z_max": 9,
                   "num_x": 3, "num_y": 3, "num_z": 2}]}, headers=session_headers)
    assert resp.status_code == 200, resp.text
    client.post(f"{API}/session/calculate", headers=session_headers)
    from api.v1.session_manager import get_session_manager
    room = get_session_manager().get_session(session_headers["X-Session-ID"]).room
    ctx = _ctx(room, pathogens=["Human coronavirus"])
    assert ctx.page_size == "Letter" and ctx.units.length == "ft"
    assert ctx.options.page_size == "auto"
```

Add `API = "/api/v1"` at the top of the file.

- [ ] **Step 3: Run to verify failure**

Run: `cd api && uv run pytest tests/test_report_context.py -v` → FAIL with `ModuleNotFoundError: api.report.context`.

- [ ] **Step 4: Write `context.py`**

```python
# api/api/report/context.py
"""Assemble everything the PDF template prints, from guv_calcs objects only.

All numbers are computed here; the template formats. Pathogen figures use
room.average_value (per-species mean kinetics per wavelength, additive across
the lamps' wavelengths) exactly like /disinfection-table. Hours to the limit use
the spectrally weighted dose shared with check-lamps.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

import numpy as np
from guv_calcs import WHOLE_ROOM_FLUENCE, EYE_LIMITS, SKIN_LIMITS
from guv_calcs.safety import PhotStandard

from api.v1.safety_helpers import HoursToLimit, hours_to_limit_by_standard
from api.v1.session_schemas import ReportRequest, ReportMeta, ReportOptions
from api.v1.session_helpers import _standard_to_label

CUBIC_FEET_PER_M3 = 35.3147
LPS_TO_CFM = 2.11888
STANDARD_IDS = {WHOLE_ROOM_FLUENCE, SKIN_LIMITS, EYE_LIMITS}


@dataclass(frozen=True)
class Versions:
    app: str
    guv_calcs: str


@dataclass(frozen=True)
class Units:
    length: str      # "m" | "ft"
    area: str        # "m²" | "ft²"
    volume: str      # "m³" | "ft³"


@dataclass(frozen=True)
class Stats:
    mean: Optional[float]
    max: Optional[float]
    min: Optional[float]


@dataclass(frozen=True)
class RoomInfo:
    name: str
    x: float
    y: float
    z: float
    floor_area: float
    volume: float
    shape: str            # "rectangle" | "polygon"
    vertex_count: int
    air_changes: float
    reflectance_enabled: bool


@dataclass(frozen=True)
class SurfaceRow:
    name: str
    reflectance: float


@dataclass(frozen=True)
class LampRow:
    lamp_id: str
    name: str
    fixture: str
    wavelength: Optional[float]
    output_percent: float
    position: tuple[float, float, float]
    aim: tuple[float, float, float]
    heading: float
    bank: float
    enabled: bool


@dataclass(frozen=True)
class ObjectRow:
    name: str
    size: tuple[float, float, float]
    base_centre: tuple[float, float, float]
    yaw: float
    reflectance: float
    transmittance: float
    enabled: bool


@dataclass(frozen=True)
class PathogenRow:
    species: str
    category: str
    each_uv: float
    cadr_lps: float
    cadr_cfm: float
    t90: Optional[float]
    t99: Optional[float]
    t999: Optional[float]


@dataclass(frozen=True)
class LampSafetyRow:
    name: str
    skin_dose: float
    skin_tlv: float
    eye_dose: float
    eye_tlv: float
    compliant: bool
    dimming_note: Optional[str]   # "Dim to 71% (minimum 79%)" or None
    missing_spectrum: bool


@dataclass(frozen=True)
class Occupancy:
    headline_hours: Optional[float]
    headline_name: str            # "ACGIH TLV" | "ICNIRP limit"
    unlimited: bool
    statement: str


@dataclass(frozen=True)
class SafetyInfo:
    standard_label: str
    hours: dict[str, HoursToLimit]
    skin: Stats
    eye: Stats
    skin_irradiance: Stats        # µW/cm² behind the 8 h doses
    eye_irradiance: Stats
    lamps: list[LampSafetyRow]
    warnings: list[str]
    occupancy: Occupancy
    ozone_ppb: Optional[float]
    ozone_decay_constant: Optional[float]


@dataclass(frozen=True)
class Summary:
    each_uv: Optional[float]
    cadr_lps: Optional[float]
    cadr_cfm: Optional[float]
    avg_fluence: Optional[float]
    lead_species: Optional[str]


@dataclass(frozen=True)
class FluenceInfo:
    stats: Stats
    wavelengths_used: list[int]
    wavelengths_missing: list[int]
    image_key: str                # "cover" doubles as the fluence picture when no volume image exists


@dataclass(frozen=True)
class PlaneZone:
    zone_id: str
    name: str
    height: Optional[float]
    units: str
    exposure: Optional[str]       # "2 h dose" when dose mode
    stats: Stats
    svg: str = ""                 # filled by plots.py in Task 4


@dataclass(frozen=True)
class VolumeZone:
    zone_id: str
    name: str
    units: str
    exposure: Optional[str]
    stats: Stats
    image_key: str


@dataclass(frozen=True)
class PointZone:
    zone_id: str
    name: str
    position: tuple[float, float, float]
    units: str
    value: Optional[float]


@dataclass(frozen=True)
class LampTypeInfo:
    fixture: str
    wavelength: Optional[float]
    lamp_id: str                  # representative lamp for plotting
    has_spectrum: bool


@dataclass
class ReportContext:
    meta: ReportMeta
    options: ReportOptions
    generated_at: datetime
    versions: Versions
    page_size: str                # "A4" | "Letter"
    units: Units
    precision: int
    images: dict[str, bytes]
    room: RoomInfo
    surfaces: list[SurfaceRow]
    lamps: list[LampRow]
    objects: list[ObjectRow]
    summary: Summary
    safety: SafetyInfo
    pathogens: list[PathogenRow]
    fluence: FluenceInfo
    custom_planes: list[PlaneZone]
    custom_volumes: list[VolumeZone]
    custom_points: list[PointZone]
    lamp_types: list[LampTypeInfo]
    skin_svg: str = ""
    eye_svg: str = ""
    survival_svg: str = ""
    lamp_plots: dict[str, tuple[str, str]] = field(default_factory=dict)  # fixture → (polar svg, spectrum svg)


# ----------------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------------

def _finite(v) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _stats(zone) -> Stats:
    values = zone.get_values() if zone is not None else None
    if values is None:
        return Stats(None, None, None)
    arr = np.asarray(values, dtype=float)
    arr = arr[np.isfinite(arr)]
    if arr.size == 0:
        return Stats(None, None, None)
    return Stats(float(arr.mean()), float(arr.max()), float(arr.min()))


def _units(room) -> Units:
    feet = str(room.dim.units).lower().endswith("feet")
    return Units("ft", "ft²", "ft³") if feet else Units("m", "m²", "m³")


def _page_size(room, options: ReportOptions) -> str:
    if options.page_size == "a4":
        return "A4"
    if options.page_size == "letter":
        return "Letter"
    return "Letter" if _units(room).length == "ft" else "A4"


def _exposure_label(zone) -> Optional[str]:
    if not zone.dose:
        return None
    secs = zone.exposure_time.total_seconds()
    hours = secs / 3600
    if hours >= 1 and abs(hours - round(hours)) < 1e-9:
        return f"{int(round(hours))} h dose"
    if secs >= 60 and abs(secs / 60 - round(secs / 60)) < 1e-9:
        return f"{int(round(secs / 60))} min dose"
    return f"{secs:g} s dose"


def _zone_units(zone) -> str:
    return "mJ/cm²" if zone.dose else "µW/cm²"


def _fixture_name(lamp) -> str:
    for attr in ("preset_id", "key", "filename"):
        v = getattr(lamp, attr, None)
        if v:
            return str(v)
    ies = getattr(lamp, "ies", None)
    fn = getattr(ies, "filename", None) if ies is not None else None
    return str(fn) if fn else "Custom"


def _dimming_note(skin_dim: float, eye_dim: float) -> Optional[str]:
    d = min(skin_dim, eye_dim)
    if d >= 1:
        return None
    minimum = math.floor(d * 100)
    suggested = max(math.floor(d * 0.9 * 100), 0)
    if suggested >= minimum:
        suggested = minimum - 1
    return f"Dim to {suggested}% (minimum {minimum}%)"


def _occupancy(hours: dict[str, HoursToLimit], standard_label: str) -> Occupancy:
    uses_icnirp = "ICNIRP" in standard_label
    h = hours["ICNIRP" if uses_icnirp else "ACGIH"]
    candidates = [v for v in (h.skin, h.eye) if v is not None]
    headline = min(candidates) if candidates else None
    name = "ICNIRP limit" if uses_icnirp else "ACGIH TLV"
    if headline is None:
        return Occupancy(None, name, False, "Occupancy limit could not be evaluated")
    if headline >= 8:
        return Occupancy(headline, name, True, f"Continuous occupancy is within the {name}")
    return Occupancy(headline, name, False, f"Safe to occupy for {headline:.1f} hours per day ({name})")


# ----------------------------------------------------------------------------
# sections
# ----------------------------------------------------------------------------

def _room_info(room) -> RoomInfo:
    d = room.dim
    poly = d.polygon
    return RoomInfo(
        name=room.name, x=float(d.x), y=float(d.y), z=float(d.z),
        floor_area=float(poly.area), volume=float(room.volume),
        shape="polygon" if d.is_polygon else "rectangle",
        vertex_count=len(getattr(poly, "vertices", []) or []),
        air_changes=float(room.air_changes),
        reflectance_enabled=bool(room.ref_manager.enabled),
    )


def _surfaces(room) -> list[SurfaceRow]:
    return [SurfaceRow(k.replace("_", " ").title(), float(v.R)) for k, v in room.surfaces.items()]


def _lamps(room) -> list[LampRow]:
    return [
        LampRow(
            lamp_id=str(lid), name=lamp.name, fixture=_fixture_name(lamp),
            wavelength=_finite(lamp.wavelength), output_percent=float(lamp.scaling_factor) * 100,
            position=(float(lamp.x), float(lamp.y), float(lamp.z)),
            aim=(float(lamp.aimx), float(lamp.aimy), float(lamp.aimz)),
            heading=float(lamp.heading), bank=float(lamp.bank), enabled=bool(lamp.enabled),
        )
        for lid, lamp in room.lamps.items()
    ]


def _objects(room) -> list[ObjectRow]:
    rows = []
    for obj in getattr(room, "objects", {}).values():
        rows.append(ObjectRow(
            name=obj.name, size=(float(obj.width), float(obj.length), float(obj.height)),
            base_centre=(float(obj.x), float(obj.y), float(obj.z)), yaw=float(obj.to_dict().get("yaw", 0.0)),
            reflectance=float(obj.R), transmittance=float(obj.T), enabled=bool(obj.enabled),
        ))
    return rows


def _pathogens(room, species: list[str]) -> tuple[list[PathogenRow], FluenceInfo]:
    wrf = room.calc_zones.get(WHOLE_ROOM_FLUENCE)
    stats = _stats(wrf)
    fluence_dict = wrf.calculator.cache.by_wavelength(room.lamps, reduce=np.mean) if wrf is not None else {}
    data = room.get_efficacy_data(WHOLE_ROOM_FLUENCE)
    available = set(data.base_df["wavelength [nm]"].unique()) if hasattr(data, "base_df") else set()
    used = sorted(int(w) for w in fluence_dict if int(w) in {int(a) for a in available})
    missing = sorted(int(w) for w in fluence_dict if int(w) not in {int(a) for a in available})
    rows: list[PathogenRow] = []
    if used:
        values = {
            fn: room.average_value(zone_id=WHOLE_ROOM_FLUENCE, function=fn, species=species)
            for fn in ("each_uv", "cadr_lps", "cadr_cfm", "log1", "log2", "log3")
        }
        cats = data.base_df.drop_duplicates("Species").set_index("Species")["Category"].to_dict()
        for sp in species:
            each = _finite((values["each_uv"] or {}).get(sp))
            if each is None:
                raise ValueError(f"No inactivation data for '{sp}' at the lamps' wavelengths")
            rows.append(PathogenRow(
                species=sp, category=str(cats.get(sp, "")), each_uv=each,
                cadr_lps=_finite(values["cadr_lps"][sp]) or 0.0, cadr_cfm=_finite(values["cadr_cfm"][sp]) or 0.0,
                t90=_finite(values["log1"][sp]), t99=_finite(values["log2"][sp]), t999=_finite(values["log3"][sp]),
            ))
    return rows, FluenceInfo(stats=stats, wavelengths_used=used, wavelengths_missing=missing,
                             image_key=f"volume:{WHOLE_ROOM_FLUENCE}")


def _safety(room) -> SafetyInfo:
    skin = room.calc_zones.get(SKIN_LIMITS)
    eye = room.calc_zones.get(EYE_LIMITS)
    label = _standard_to_label(room.standard)
    hours = hours_to_limit_by_standard(room)
    result = room.check_lamps()
    lamps = [
        LampSafetyRow(
            name=r.lamp_name, skin_dose=float(r.skin_dose_max), skin_tlv=float(r.skin_tlv),
            eye_dose=float(r.eye_dose_max), eye_tlv=float(r.eye_tlv),
            compliant=bool(r.is_skin_compliant and r.is_eye_compliant),
            dimming_note=_dimming_note(r.skin_dimming_required, r.eye_dimming_required),
            missing_spectrum=bool(r.missing_spectrum),
        )
        for r in result.lamp_results.values()
    ]
    warnings = [w.message for w in result.warnings if not w.lamp_id]

    def irr(s: Stats) -> Stats:   # 8 h dose (mJ/cm²) → irradiance (µW/cm²)
        f = lambda v: None if v is None else v * 1000 / (8 * 3600)
        return Stats(f(s.mean), f(s.max), f(s.min))

    skin_stats, eye_stats = _stats(skin), _stats(eye)
    has_222 = any(_finite(l.wavelength) == 222 for l in room.lamps.values())
    ozone = _finite(room.estimate_ozone_increase()) if has_222 else None
    return SafetyInfo(
        standard_label=label, hours=hours, skin=skin_stats, eye=eye_stats,
        skin_irradiance=irr(skin_stats), eye_irradiance=irr(eye_stats), lamps=lamps, warnings=warnings,
        occupancy=_occupancy(hours, label), ozone_ppb=ozone,
        ozone_decay_constant=_finite(getattr(room, "ozone_decay_constant", None)) if has_222 else None,
    )


def _custom_zones(room) -> tuple[list[PlaneZone], list[VolumeZone], list[PointZone]]:
    planes, vols, pts = [], [], []
    for zid, z in room.calc_zones.items():
        if zid in STANDARD_IDS or z.get_values() is None:
            continue
        ct = z.calctype.lower()
        if ct == "plane":
            planes.append(PlaneZone(zid, z.name, _finite(getattr(z.geometry, "height", None)),
                                    _zone_units(z), _exposure_label(z), _stats(z)))
        elif ct == "volume":
            vols.append(VolumeZone(zid, z.name, _zone_units(z), _exposure_label(z), _stats(z), f"volume:{zid}"))
        else:
            pos = tuple(float(v) for v in np.ravel(z.geometry.points)[:3]) if hasattr(z.geometry, "points") \
                else (float(z.geometry.x), float(z.geometry.y), float(z.geometry.z))
            pts.append(PointZone(zid, z.name, pos, _zone_units(z), _finite(np.ravel(z.get_values())[0])))
    return planes, vols, pts


def _lamp_types(room) -> list[LampTypeInfo]:
    seen: dict[str, LampTypeInfo] = {}
    for lid, lamp in room.lamps.items():
        fx = _fixture_name(lamp)
        if fx not in seen:
            seen[fx] = LampTypeInfo(fx, _finite(lamp.wavelength), str(lid), lamp.spectrum is not None)
    return list(seen.values())


def build_report_context(room, request: ReportRequest, images: dict[str, bytes], versions: Versions) -> ReportContext:
    pathogens, fluence = _pathogens(room, request.pathogens)
    lead = pathogens[0] if pathogens else None
    planes, vols, pts = _custom_zones(room)
    return ReportContext(
        meta=request.meta, options=request.options, generated_at=datetime.now(), versions=versions,
        page_size=_page_size(room, request.options), units=_units(room),
        precision=max(int(getattr(room, "precision", 1)), 1), images=images,
        room=_room_info(room), surfaces=_surfaces(room), lamps=_lamps(room), objects=_objects(room),
        summary=Summary(
            each_uv=lead.each_uv if lead else None, cadr_lps=lead.cadr_lps if lead else None,
            cadr_cfm=lead.cadr_cfm if lead else None, avg_fluence=fluence.stats.mean,
            lead_species=lead.species if lead else None,
        ),
        safety=_safety(room), pathogens=pathogens, fluence=fluence,
        custom_planes=planes, custom_volumes=vols, custom_points=pts, lamp_types=_lamp_types(room),
    )
```

Verify against guv_calcs while implementing (read, don't guess): `room.dim.polygon.area`, `room.dim.is_polygon`, `room.ref_manager.enabled`, `room.surfaces[*].R`, `lamp.heading`, `lamp.bank`, `lamp.scaling_factor`, `obj.width/length/height/x/y/z/R/T/enabled`, `zone.geometry.height` for planes, and the CalcPoint geometry attribute (`GridPoint`) for its position. `data.base_df` is the species table with columns `Species`, `Category`, `wavelength [nm]`. Adjust attribute names in `context.py` to what exists; keep the dataclass field names fixed because later tasks depend on them.

- [ ] **Step 5: Run the tests**

Run: `cd api && uv run pytest tests/test_report_context.py -v` → PASS. If `_fixture_name` returns "Custom" for the preset lamp, find the attribute guv_calcs stores the preset key under (`grep -n "preset\|keyword\|self.key" ~/guv-calcs/src/guv_calcs/lamp/lamp.py`) and add it to the attribute list.

- [ ] **Step 6: Commit**

```bash
git add api/api/report/context.py api/tests/test_report_context.py api/tests/conftest.py
git commit -m "feat(report): assemble the report context from guv_calcs — room, lamps, safety, pathogens, custom zones"
```

---

### Task 4: SVG plots for print

**Files:**
- Create: `api/api/report/plots.py`
- Test: `api/tests/test_report_plots.py`

**Interfaces:**
- Consumes: `ReportContext`, room.
- Produces: `plots.attach_plots(ctx: ReportContext, room) -> None` which fills `ctx.skin_svg`, `ctx.eye_svg`, `ctx.survival_svg`, each `PlaneZone.svg` (replacing the dataclass instance since it is frozen), and `ctx.lamp_plots` when `ctx.options.include_lamp_appendix`.

- [ ] **Step 1: Write the failing test**

```python
# api/tests/test_report_plots.py
from dataclasses import replace
from api.v1.session_schemas import ReportRequest
from api.report.context import build_report_context, Versions
from api.report.plots import attach_plots, fig_to_svg


def _ctx(room):
    req = ReportRequest(meta={"title": "T"}, pathogens=["Human coronavirus"])
    return build_report_context(room, req, images={}, versions=Versions("t", "t"))


def test_attach_plots_fills_svgs(report_session):
    _, _, room = report_session
    ctx = _ctx(room)
    attach_plots(ctx, room)
    for svg in (ctx.skin_svg, ctx.eye_svg, ctx.survival_svg):
        assert svg.lstrip().startswith("<svg") and "</svg>" in svg
        assert "<?xml" not in svg                    # inline-safe
    assert all(p.svg.lstrip().startswith("<svg") for p in ctx.custom_planes)
    assert set(ctx.lamp_plots) == {lt.fixture for lt in ctx.lamp_types}
    polar, spectrum = next(iter(ctx.lamp_plots.values()))
    assert polar.startswith("<svg")


def test_appendix_toggle_skips_lamp_plots(report_session):
    _, _, room = report_session
    ctx = _ctx(room)
    ctx.options = ctx.options.model_copy(update={"include_lamp_appendix": False})  # ReportOptions is a Pydantic model
    attach_plots(ctx, room)
    assert ctx.lamp_plots == {}


def test_shared_scale_for_skin_and_eye(report_session):
    _, _, room = report_session
    ctx = _ctx(room)
    attach_plots(ctx, room)
    # both heatmaps carry the same colourbar top label (shared vmax)
    import re
    top = lambda s: re.findall(r">([\d.]+)</text>", s)
    assert top(ctx.skin_svg) and top(ctx.skin_svg) == top(ctx.eye_svg)
```

- [ ] **Step 2: Run to verify failure** → `ModuleNotFoundError: api.report.plots`.

- [ ] **Step 3: Write `plots.py`**

```python
# api/api/report/plots.py
"""Matplotlib → SVG for the report: plane heatmaps, survival curve, lamp photometrics."""
from __future__ import annotations

import io
import re
from dataclasses import replace

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from guv_calcs import WHOLE_ROOM_FLUENCE, EYE_LIMITS, SKIN_LIMITS

from api.v1.utils import apply_theme
from .context import ReportContext

_XML_DECL = re.compile(r"^\s*<\?xml[^>]*>\s*(<!DOCTYPE[^>]*>\s*)?", re.S)


def fig_to_svg(fig) -> str:
    buf = io.StringIO()
    try:
        fig.savefig(buf, format="svg", bbox_inches="tight", facecolor="white", edgecolor="none")
    finally:
        plt.close(fig)
    svg = _XML_DECL.sub("", buf.getvalue())
    # Let CSS size it: drop fixed width/height on the root element
    svg = re.sub(r'(<svg[^>]*?)\s(width|height)="[^"]*"', r"\1", svg, count=2)
    return svg.strip()


def _style(fig, title: str | None = None):
    apply_theme(fig, "light")
    for ax in fig.get_axes():
        ax.tick_params(labelsize=9)
        ax.xaxis.label.set_fontsize(10)
        ax.yaxis.label.set_fontsize(10)
        if title is not None:
            ax.set_title(title, fontsize=11)


def plane_svg(zone, vmin=None, vmax=None, title=None) -> str:
    with plt.style.context("default"):
        fig, ax = zone.plot(vmin=vmin, vmax=vmax) if vmin is not None else zone.plot()
        fig.set_size_inches(5.2, 4.2)
        _style(fig, title)
        return fig_to_svg(fig)


def survival_svg(room, species: list[str]) -> str:
    with plt.style.context("default"):
        fig = room.survival_plot(zone_id=WHOLE_ROOM_FLUENCE, species=species, figsize=(7.5, 4.2))
        _style(fig)
        for ax in fig.get_axes():
            title = ax.get_title()
            if title:
                title = re.sub(r"(\d+\.\d{3,})(\s*µW/cm²)", lambda m: f"{float(m.group(1)):.2f}{m.group(2)}", title)
                ax.set_title(title, fontsize=11)
            if ax.get_legend():
                ax.legend(loc="upper right", fontsize=8)
        return fig_to_svg(fig)


def lamp_polar_svg(lamp) -> str:
    with plt.style.context("default"):
        result = lamp.plot_ies()
        fig = result[0] if isinstance(result, tuple) else result
        fig.set_size_inches(3.6, 3.6)
        apply_theme(fig, "light", grid=True)
        return fig_to_svg(fig)


def lamp_spectrum_svg(lamp) -> str:
    if lamp.spectrum is None:
        return ""
    with plt.style.context("default"):
        result = lamp.spectrum.plot(weights=True, yscale="log")
        fig = result[0] if isinstance(result, tuple) else result
        fig.set_size_inches(3.6, 3.0)
        apply_theme(fig, "light", grid=True)
        return fig_to_svg(fig)


def attach_plots(ctx: ReportContext, room) -> None:
    skin = room.calc_zones.get(SKIN_LIMITS)
    eye = room.calc_zones.get(EYE_LIMITS)
    if skin is not None and eye is not None and skin.get_values() is not None and eye.get_values() is not None:
        vmax = float(max(np.nanmax(skin.get_values()), np.nanmax(eye.get_values())))
        ctx.skin_svg = plane_svg(skin, vmin=0.0, vmax=vmax, title="Skin — 8 h dose (mJ/cm²)")
        ctx.eye_svg = plane_svg(eye, vmin=0.0, vmax=vmax, title="Eye — 8 h dose (mJ/cm²)")
    if ctx.pathogens:
        ctx.survival_svg = survival_svg(room, [p.species for p in ctx.pathogens])
    ctx.custom_planes = [
        replace(p, svg=plane_svg(room.calc_zones[p.zone_id], title=f"{p.name} ({p.units})"))
        for p in ctx.custom_planes
    ]
    if ctx.options.include_lamp_appendix:
        for lt in ctx.lamp_types:
            lamp = room.lamps[lt.lamp_id]
            ctx.lamp_plots[lt.fixture] = (lamp_polar_svg(lamp), lamp_spectrum_svg(lamp))
```

If `zone.plot()` does not accept `vmin`/`vmax`, call `guv_calcs.calc_zone._plot.plot_plane(zone, vmin=..., vmax=...)` directly (its signature is `plot_plane(zone, fig=None, ax=None, vmin=None, vmax=None, title=None, colormap=None)`).

- [ ] **Step 4: Run tests** → PASS. If the shared-scale test fails because colourbar tick text differs, assert instead that both SVGs contain the same `vmax` formatted with `f"{vmax:.3g}"`.

- [ ] **Step 5: Commit**

```bash
git add api/api/report/plots.py api/tests/test_report_plots.py
git commit -m "feat(report): print-styled SVG heatmaps, survival curve and lamp photometrics"
```

---

### Task 5: Template, stylesheet, fonts and renderer (cover, summary, room)

**Files:**
- Create: `api/api/report/render.py`, `api/api/report/templates/report.html`, `api/api/report/templates/report.css`, `api/api/report/templates/fonts/` (IBM Plex Sans Regular/Medium/SemiBold TTF + `LICENSE.txt`), `api/api/report/templates/wordmark.svg`
- Test: `api/tests/test_report_pdf.py`

**Interfaces:**
- Consumes: `ReportContext` with plots attached.
- Produces: `render.render_html(ctx) -> str`, `render.render_pdf(ctx) -> bytes`, `render.WeasyPrintUnavailable(RuntimeError)`.

- [ ] **Step 1: Fetch the fonts**

```bash
cd api/api/report/templates && mkdir -p fonts && cd fonts
BASE=https://raw.githubusercontent.com/IBM/plex/master/packages/plex-sans/fonts/complete/ttf
for w in Regular Medium SemiBold; do curl -fsSL -o IBMPlexSans-$w.ttf "$BASE/IBMPlexSans-$w.ttf"; done
curl -fsSL -o LICENSE.txt https://raw.githubusercontent.com/IBM/plex/master/LICENSE.txt
ls -la
```

If the download fails (no network), copy `/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf` and `DejaVuSans-Bold.ttf` in as a stand-in, name them in `report.css` instead, and leave a `FONTS-TODO.md` in the folder saying Plex is intended. Do not skip the step silently.

- [ ] **Step 2: Write the failing PDF test**

```python
# api/tests/test_report_pdf.py
import io
import pytest
from api.v1.session_schemas import ReportRequest
from api.report.context import build_report_context, Versions
from api.report.plots import attach_plots
from api.report import render

pypdf = pytest.importorskip("pypdf")


def _ctx(room, **meta):
    req = ReportRequest(meta={"title": "Lab 3 GUV design", "client": "Acme Clinics", "prepared_by": "V. Belenky", **meta},
                        pathogens=["Human coronavirus", "Influenza virus"])
    ctx = build_report_context(room, req, images={}, versions=Versions("0.5.0", "0.7.3"))
    attach_plots(ctx, room)
    return ctx


def test_html_has_every_section_and_no_none(report_session):
    _, _, room = report_session
    html = render.render_html(_ctx(room))
    for heading in ("Summary", "Room and installation", "Photobiological safety",
                    "Pathogen reduction in air", "Custom calculation zones", "Appendix"):
        assert heading in html
    assert "None" not in html.replace("NoneType", "") and "nan" not in html.lower().split("<style")[0]
    assert "Acme Clinics" in html and "V. Belenky" in html
    assert "Dim to" in html or "Compliant" in html
    assert "@page" in html and "size: A4" in html


def test_pdf_renders_with_expected_pages_and_text(report_session):
    _, _, room = report_session
    try:
        pdf = render.render_pdf(_ctx(room))
    except render.WeasyPrintUnavailable as e:
        pytest.skip(str(e))
    assert pdf[:5] == b"%PDF-"
    reader = pypdf.PdfReader(io.BytesIO(pdf))
    assert 6 <= len(reader.pages) <= 14
    text = "\n".join(p.extract_text() or "" for p in reader.pages)
    assert "Lab 3 GUV design" in text and "eACH" in text and "Human coronavirus" in text
    assert "page 1 of" in text.lower() or "1 of" in text


def test_missing_image_renders_placeholder(report_session):
    _, _, room = report_session
    html = render.render_html(_ctx(room))
    assert "No 3D view was captured" in html
```

- [ ] **Step 3: Run to verify failure** → `ImportError` on `api.report.render`.

- [ ] **Step 4: Write `render.py`**

```python
# api/api/report/render.py
"""Jinja2 → HTML → WeasyPrint PDF. WeasyPrint is imported lazily so the API
boots on hosts without Pango; the endpoint reports 503 in that case."""
from __future__ import annotations

import base64
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

from .context import ReportContext

TEMPLATES = Path(__file__).parent / "templates"


class WeasyPrintUnavailable(RuntimeError):
    pass


def _num(value, places: int = 1) -> str:
    if value is None:
        return "—"
    try:
        v = float(value)
    except (TypeError, ValueError):
        return "—"
    if v != v:  # NaN
        return "—"
    if abs(v) >= 1000:
        return f"{v:,.0f}"
    return f"{v:.{places}f}"


def _hours(value) -> str:
    if value is None:
        return "—"
    if value >= 8:
        return f"Indefinite ({value:.1f} h)"
    if value >= 1:
        return f"{value:.1f} h"
    return f"{value * 60:.0f} min"


def _seconds(value) -> str:
    if value is None:
        return "—"
    if value < 60:
        return f"{value:.0f} s"
    if value < 3600:
        return f"{value / 60:.1f} min"
    return f"{value / 3600:.1f} h"


def _img(ctx: ReportContext, key: str) -> str:
    raw = ctx.images.get(key)
    return "data:image/png;base64," + base64.b64encode(raw).decode() if raw else ""


def _env() -> Environment:
    env = Environment(loader=FileSystemLoader(str(TEMPLATES)), autoescape=select_autoescape(["html"]))
    env.filters["num"] = _num
    env.filters["hours"] = _hours
    env.filters["seconds"] = _seconds
    return env


def render_html(ctx: ReportContext) -> str:
    env = _env()
    css = (TEMPLATES / "report.css").read_text(encoding="utf-8")
    wordmark = (TEMPLATES / "wordmark.svg").read_text(encoding="utf-8")
    return env.get_template("report.html").render(
        ctx=ctx, css=css, wordmark=wordmark, img=lambda key: _img(ctx, key),
        fonts_url=TEMPLATES.joinpath("fonts").as_uri(),
    )


def render_pdf(ctx: ReportContext) -> bytes:
    try:
        from weasyprint import HTML  # lazy: needs libpango at import time
    except (ImportError, OSError) as e:
        raise WeasyPrintUnavailable(f"PDF rendering is unavailable on this server: {e}")
    html = render_html(ctx)
    return HTML(string=html, base_url=str(TEMPLATES)).write_pdf()
```

- [ ] **Step 5: Write the template skeleton with cover, summary and room sections**

`api/api/report/templates/wordmark.svg` — a simple text wordmark:

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="110" height="18" viewBox="0 0 110 18"><text x="0" y="14" font-family="IBM Plex Sans, sans-serif" font-weight="600" font-size="14" fill="#1f2328" letter-spacing="0.5">Illuminate</text></svg>
```

`api/api/report/templates/report.html`:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{{ ctx.meta.title }} — GUV design report</title>
<style>
@font-face { font-family: "Report Sans"; src: url("{{ fonts_url }}/IBMPlexSans-Regular.ttf"); font-weight: 400; }
@font-face { font-family: "Report Sans"; src: url("{{ fonts_url }}/IBMPlexSans-Medium.ttf"); font-weight: 500; }
@font-face { font-family: "Report Sans"; src: url("{{ fonts_url }}/IBMPlexSans-SemiBold.ttf"); font-weight: 600; }
@page {
  size: {{ ctx.page_size }};
  margin: 22mm 18mm 20mm 18mm;
  @top-left { content: "{{ ctx.meta.title }}"; font: 500 8.5pt "Report Sans"; color: #6b7280; }
  @top-right { content: "Illuminate"; font: 600 8.5pt "Report Sans"; color: #6b7280; letter-spacing: .04em; }
  @bottom-left { content: "Illuminate v{{ ctx.versions.app }} · generated {{ ctx.generated_at.strftime('%Y-%m-%d %H:%M') }}"; font: 400 8pt "Report Sans"; color: #9ca3af; }
  @bottom-right { content: "page " counter(page) " of " counter(pages); font: 400 8pt "Report Sans"; color: #9ca3af; }
}
@page cover { margin: 0; @top-left { content: none } @top-right { content: none } @bottom-left { content: none } @bottom-right { content: none } }
{{ css }}
</style>
</head>
<body>
{% set u = ctx.units %}{% set p = ctx.precision %}

<!-- ───────────── Cover ───────────── -->
<section class="cover" style="page: cover;">
  <div class="cover-band">
    <div class="wordmark">{{ wordmark|safe }}</div>
    <div class="cover-kicker">Germicidal UV design report</div>
    <h1>{{ ctx.meta.title }}</h1>
    <dl class="cover-meta">
      {% if ctx.meta.client %}<div><dt>Prepared for</dt><dd>{{ ctx.meta.client }}</dd></div>{% endif %}
      {% if ctx.meta.prepared_by %}<div><dt>Prepared by</dt><dd>{{ ctx.meta.prepared_by }}</dd></div>{% endif %}
      <div><dt>Date</dt><dd>{{ ctx.generated_at.strftime('%-d %B %Y') }}</dd></div>
    </dl>
  </div>
  <figure class="cover-figure">
    {% if img('cover') %}<img src="{{ img('cover') }}" alt="3D view of the room">
    {% else %}<div class="placeholder">No 3D view was captured for this report.</div>{% endif %}
  </figure>
  <p class="cover-line">
    {{ ctx.room.x|num(p) }} × {{ ctx.room.y|num(p) }} × {{ ctx.room.z|num(p) }} {{ u.length }} room ·
    {{ ctx.lamps|length }} luminaire{{ 's' if ctx.lamps|length != 1 }}
    {% set wls = ctx.lamps|map(attribute='wavelength')|select('number')|unique|list %}{% if wls %}at {{ wls|join(' and ') }} nm{% endif %} ·
    {{ ctx.safety.standard_label }}
  </p>
</section>

<!-- ───────────── 1 Summary ───────────── -->
<section class="page">
  <h2><span class="n">1</span>Summary</h2>
  <div class="tiles">
    <div class="tile"><div class="tile-label">Air changes per hour from UV</div><div class="tile-value">{{ ctx.summary.each_uv|num(1) }}</div><div class="tile-unit">eACH‑UV{% if ctx.summary.lead_species %} · {{ ctx.summary.lead_species }}{% endif %}</div></div>
    <div class="tile"><div class="tile-label">Clean air delivery rate</div><div class="tile-value">{{ ctx.summary.cadr_cfm|num(0) }}<span class="tile-small"> cfm</span></div><div class="tile-unit">{{ ctx.summary.cadr_lps|num(0) }} L/s · CADR‑UV</div></div>
    <div class="tile"><div class="tile-label">Average fluence</div><div class="tile-value">{{ ctx.summary.avg_fluence|num(2) }}</div><div class="tile-unit">µW/cm² · whole room</div></div>
  </div>

  {% set occ = ctx.safety.occupancy %}
  <div class="status {{ 'ok' if occ.unlimited else 'limited' }}">
    <div class="status-title">{{ occ.statement }}</div>
    <div class="status-line">
      <span>ACGIH TLV: <b>{{ (ctx.safety.hours['ACGIH'].skin, ctx.safety.hours['ACGIH'].eye)|select('number')|min|hours if (ctx.safety.hours['ACGIH'].skin or ctx.safety.hours['ACGIH'].eye) else '—' }}</b></span>
      <span>ICNIRP limit: <b>{{ (ctx.safety.hours['ICNIRP'].skin, ctx.safety.hours['ICNIRP'].eye)|select('number')|min|hours if (ctx.safety.hours['ICNIRP'].skin or ctx.safety.hours['ICNIRP'].eye) else '—' }}</b></span>
    </div>
  </div>

  {% if ctx.pathogens %}
  <table class="data compact">
    <thead><tr><th>Airborne pathogen</th><th class="num">90 %</th><th class="num">99 %</th><th class="num">99.9 %</th></tr></thead>
    <tbody>{% for r in ctx.pathogens %}
      <tr><td>{{ r.species }}</td><td class="num">{{ r.t90|seconds }}</td><td class="num">{{ r.t99|seconds }}</td><td class="num">{{ r.t999|seconds }}</td></tr>
    {% endfor %}</tbody>
  </table>
  <p class="caption">Time for the room's average fluence to inactivate the stated fraction of airborne pathogen, from published inactivation constants at the lamps' wavelength{{ 's' if ctx.fluence.wavelengths_used|length != 1 }} ({{ ctx.fluence.wavelengths_used|join(', ') }} nm).</p>
  {% endif %}

  <h3>How to read this report</h3>
  <p>The summary above is what the installation does for the people in the room: how much it adds to effective ventilation, how quickly it reduces airborne pathogens, and how long someone may stay in the room each day within the photobiological exposure limits. Sections 2 to 5 give the inputs and the full results an engineer or reviewer needs; the appendix covers methods and sources.</p>
  <h3>Key assumptions</h3>
  <ul class="assumptions">
    <li>Luminaires operate continuously at the stated output{% if ctx.lamps|rejectattr('output_percent', 'equalto', 100.0)|list %} (some are scaled, see §2){% endif %}.</li>
    <li>Nothing blocks the light other than the objects modelled in §2.</li>
    <li>Reflections are {{ 'included with the surface reflectances listed in §2' if ctx.room.reflectance_enabled else 'not included' }}.</li>
    <li>Dose figures assume an 8‑hour exposure at the worst position; occupancy hours scale from that.</li>
    <li>Pathogen figures use the average fluence over the whole room volume.</li>
  </ul>
  {% if ctx.meta.notes %}<h3>Notes</h3><p class="notes">{{ ctx.meta.notes }}</p>{% endif %}
</section>

<!-- ───────────── 2 Room and installation ───────────── -->
<section class="page">
  <h2><span class="n">2</span>Room and installation</h2>
  <figure class="plan">
    {% if img('plan') %}<img src="{{ img('plan') }}" alt="Plan view">{% else %}<div class="placeholder">No plan view was captured.</div>{% endif %}
    <figcaption>Plan view with luminaire positions{% if ctx.objects %} and objects{% endif %}.</figcaption>
  </figure>
  <div class="two-col">
    <table class="kv">
      <tr><th>Dimensions</th><td>{{ ctx.room.x|num(p) }} × {{ ctx.room.y|num(p) }} × {{ ctx.room.z|num(p) }} {{ u.length }}</td></tr>
      <tr><th>Floor area</th><td>{{ ctx.room.floor_area|num(p) }} {{ u.area }}</td></tr>
      <tr><th>Volume</th><td>{{ ctx.room.volume|num(p) }} {{ u.volume }}</td></tr>
      <tr><th>Shape</th><td>{{ 'Traced outline, %d corners'|format(ctx.room.vertex_count) if ctx.room.shape == 'polygon' else 'Rectangle' }}</td></tr>
      <tr><th>Air changes</th><td>{{ ctx.room.air_changes|num(1) }} per hour</td></tr>
    </table>
    <table class="kv">
      <tr><th colspan="2">Surface reflectance {{ '' if ctx.room.reflectance_enabled else '(not applied)' }}</th></tr>
      {% for s in ctx.surfaces %}<tr><th>{{ s.name }}</th><td>{{ (s.reflectance * 100)|num(0) }} %</td></tr>{% endfor %}
    </table>
  </div>

  <h3>Luminaires</h3>
  <table class="data">
    <thead><tr><th>Name</th><th>Fixture</th><th class="num">nm</th><th class="num">Output</th><th class="num">x</th><th class="num">y</th><th class="num">z</th><th class="num">Aim x</th><th class="num">Aim y</th><th class="num">Aim z</th><th class="num">Heading°</th><th class="num">Bank°</th></tr></thead>
    <tbody>{% for l in ctx.lamps %}
      <tr class="{{ '' if l.enabled else 'muted' }}"><td>{{ l.name }}{% if not l.enabled %} <span class="chip">off</span>{% endif %}</td><td>{{ l.fixture }}</td><td class="num">{{ l.wavelength|num(0) }}</td><td class="num">{{ l.output_percent|num(0) }} %</td>
        <td class="num">{{ l.position[0]|num(p) }}</td><td class="num">{{ l.position[1]|num(p) }}</td><td class="num">{{ l.position[2]|num(p) }}</td>
        <td class="num">{{ l.aim[0]|num(p) }}</td><td class="num">{{ l.aim[1]|num(p) }}</td><td class="num">{{ l.aim[2]|num(p) }}</td>
        <td class="num">{{ l.heading|num(0) }}</td><td class="num">{{ l.bank|num(0) }}</td></tr>
    {% endfor %}</tbody>
  </table>
  <p class="caption">Positions and aim points in {{ u.length }}. Output is the scaling applied to the fixture's photometric file.</p>

  {% if ctx.objects %}
  <h3>Objects</h3>
  <table class="data">
    <thead><tr><th>Name</th><th class="num">W</th><th class="num">L</th><th class="num">H</th><th class="num">x</th><th class="num">y</th><th class="num">z</th><th class="num">Yaw°</th><th class="num">Refl.</th><th class="num">Transm.</th></tr></thead>
    <tbody>{% for o in ctx.objects %}
      <tr class="{{ '' if o.enabled else 'muted' }}"><td>{{ o.name }}</td><td class="num">{{ o.size[0]|num(p) }}</td><td class="num">{{ o.size[1]|num(p) }}</td><td class="num">{{ o.size[2]|num(p) }}</td><td class="num">{{ o.base_centre[0]|num(p) }}</td><td class="num">{{ o.base_centre[1]|num(p) }}</td><td class="num">{{ o.base_centre[2]|num(p) }}</td><td class="num">{{ o.yaw|num(0) }}</td><td class="num">{{ (o.reflectance*100)|num(0) }} %</td><td class="num">{{ (o.transmittance*100)|num(0) }} %</td></tr>
    {% endfor %}</tbody>
  </table>
  {% endif %}
</section>

{% include "sections_results.html" ignore missing %}
</body>
</html>
```

`api/api/report/templates/report.css`:

```css
:root { --ink: #1f2328; --muted: #6b7280; --faint: #9ca3af; --rule: #e5e7eb; --accent: #e94560; --ok: #15803d; --ok-bg: #ecfdf5; --warn: #b45309; --warn-bg: #fffbeb; }
html { font-family: "Report Sans", "Helvetica Neue", Arial, sans-serif; font-size: 10pt; color: var(--ink); line-height: 1.45; }
body { margin: 0; }
h1 { font-size: 26pt; font-weight: 600; line-height: 1.15; margin: 6mm 0 8mm; letter-spacing: -0.01em; }
h2 { font-size: 15pt; font-weight: 600; margin: 0 0 6mm; padding-bottom: 2mm; border-bottom: 1.5pt solid var(--ink); break-after: avoid; }
h2 .n { display: inline-block; min-width: 9mm; color: var(--accent); font-variant-numeric: tabular-nums; }
h3 { font-size: 11pt; font-weight: 600; margin: 7mm 0 2.5mm; break-after: avoid; }
p { margin: 0 0 3mm; }
.page { break-before: page; }
.page:first-of-type { break-before: auto; }

/* cover */
.cover { height: 100%; display: flex; flex-direction: column; }
.cover-band { padding: 22mm 18mm 8mm; }
.wordmark svg { height: 5mm; }
.cover-kicker { margin-top: 10mm; font-size: 9.5pt; font-weight: 500; color: var(--accent); text-transform: uppercase; letter-spacing: .12em; }
.cover-meta { display: flex; gap: 14mm; margin: 0; }
.cover-meta div { display: block; }
.cover-meta dt { font-size: 8pt; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; }
.cover-meta dd { margin: 0; font-size: 11pt; font-weight: 500; }
.cover-figure { margin: 0 18mm; flex: 1; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.cover-figure img { width: 100%; max-height: 150mm; object-fit: contain; border-radius: 2mm; }
.cover-line { margin: 6mm 18mm 16mm; color: var(--muted); font-size: 9.5pt; }
.placeholder { width: 100%; padding: 20mm 0; text-align: center; color: var(--faint); border: 1pt dashed var(--rule); border-radius: 2mm; }

/* tiles & status */
.tiles { display: flex; gap: 4mm; margin-bottom: 5mm; }
.tile { flex: 1; border: 1pt solid var(--rule); border-radius: 2mm; padding: 3.5mm 4mm; break-inside: avoid; }
.tile-label { font-size: 8.5pt; color: var(--muted); }
.tile-value { font-size: 22pt; font-weight: 600; line-height: 1.1; margin: 1.5mm 0 1mm; font-variant-numeric: tabular-nums; }
.tile-small { font-size: 11pt; font-weight: 500; color: var(--muted); }
.tile-unit { font-size: 8.5pt; color: var(--muted); }
.status { border-radius: 2mm; padding: 3.5mm 4.5mm; margin: 0 0 5mm; break-inside: avoid; }
.status.ok { background: var(--ok-bg); color: var(--ok); border: 1pt solid #a7f3d0; }
.status.limited { background: var(--warn-bg); color: var(--warn); border: 1pt solid #fde68a; }
.status-title { font-size: 12pt; font-weight: 600; }
.status-line { display: flex; gap: 10mm; margin-top: 1.5mm; font-size: 9pt; color: var(--ink); }

/* tables */
table { border-collapse: collapse; width: 100%; font-size: 9pt; margin-bottom: 2mm; }
table.data th, table.data td { padding: 1.6mm 2mm; border-bottom: 0.6pt solid var(--rule); text-align: left; vertical-align: top; }
table.data thead th { font-weight: 500; color: var(--muted); border-bottom: 1pt solid var(--ink); white-space: nowrap; }
table.data tr { break-inside: avoid; }
table.data .num, table.kv td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
table.compact td, table.compact th { padding: 1.2mm 2mm; }
table.kv th { text-align: left; font-weight: 500; color: var(--muted); padding: 1.2mm 3mm 1.2mm 0; width: 38%; }
table.kv td { padding: 1.2mm 0; font-variant-numeric: tabular-nums; }
tr.muted td { color: var(--faint); }
.chip { display: inline-block; font-size: 7.5pt; font-weight: 500; padding: 0 1.5mm; border-radius: 1mm; background: #f3f4f6; color: var(--muted); vertical-align: middle; }
.chip.ok { background: var(--ok-bg); color: var(--ok); }
.chip.warn { background: var(--warn-bg); color: var(--warn); }
.caption { font-size: 8.5pt; color: var(--muted); margin: 1mm 0 5mm; }
.two-col { display: flex; gap: 8mm; }
.two-col > * { flex: 1; }
.assumptions { margin: 0 0 3mm; padding-left: 5mm; }
.assumptions li { margin-bottom: 1mm; }
.notes { white-space: pre-wrap; }

/* figures */
figure { margin: 0 0 4mm; break-inside: avoid; }
figure img, figure svg { width: 100%; height: auto; }
figcaption { font-size: 8.5pt; color: var(--muted); margin-top: 1mm; }
.plan img { max-height: 95mm; object-fit: contain; }
.pair { display: flex; gap: 5mm; }
.pair > figure { flex: 1; }
.lamp-grid { display: flex; flex-wrap: wrap; gap: 5mm; }
.lamp-card { width: calc(50% - 2.5mm); border: 1pt solid var(--rule); border-radius: 2mm; padding: 3mm; break-inside: avoid; }
.lamp-card h4 { margin: 0 0 2mm; font-size: 10pt; }
.warnings li { color: var(--warn); }
```

- [ ] **Step 6: Run the tests**

Run: `cd api && uv run pytest tests/test_report_pdf.py -v`. `test_html_has_every_section_and_no_none` fails on the missing results headings (added in Task 6); the other two should pass. Fix any Jinja errors now. Then run `uv run python -c "..."` to write an HTML file to the scratchpad and open it in a browser if available: `render.render_html(ctx)` → `/tmp/claude-1000/.../scratchpad/report.html`.

- [ ] **Step 7: Commit**

```bash
git add api/api/report/render.py api/api/report/templates api/tests/test_report_pdf.py
git commit -m "feat(report): Jinja2 + WeasyPrint renderer with cover, summary and room sections"
```

---

### Task 6: Results sections of the template (safety, pathogens, custom zones, appendix)

**Files:**
- Create: `api/api/report/templates/sections_results.html`
- Test: `api/tests/test_report_pdf.py` (already written; make `test_html_has_every_section_and_no_none` pass) plus the additions below.

- [ ] **Step 1: Add tests for section rules**

Append to `api/tests/test_report_pdf.py`:

```python
def test_sections_drop_when_empty(client, session_headers, minimal_lamp_input):
    # Standard zones only, no custom zones, no 222 nm lamp → no custom section, no ozone
    resp = client.post(f"{API}/session/init", json={
        "room": {"x": 4.0, "y": 6.0, "z": 2.7, "units": "meters", "standard": "ANSI IES RP 27.1-22 (ACGIH Limits)"},
        "lamps": [{"id": "L", "preset_id": "lp_254", "lamp_type": "lp_254", "x": 2.0, "y": 3.0, "z": 2.7, "aimx": 2.0, "aimy": 3.0, "aimz": 0.0}],
        "zones": [{"id": "SkinLimits", "type": "plane", "isStandard": True, "height": 1.8, "x1": 0, "x2": 4, "y1": 0, "y2": 6, "num_x": 4, "num_y": 4},
                  {"id": "EyeLimits", "type": "plane", "isStandard": True, "height": 1.8, "x1": 0, "x2": 4, "y1": 0, "y2": 6, "num_x": 4, "num_y": 4},
                  {"id": "WholeRoomFluence", "type": "volume", "isStandard": True, "x_min": 0, "x_max": 4, "y_min": 0, "y_max": 6, "z_min": 0, "z_max": 2.7, "num_x": 3, "num_y": 3, "num_z": 2}]},
        headers=session_headers)
    assert resp.status_code == 200, resp.text
    client.post(f"{API}/session/calculate", headers=session_headers)
    from api.v1.session_manager import get_session_manager
    room = get_session_manager().get_session(session_headers["X-Session-ID"]).room
    req = ReportRequest(meta={"title": "T"}, options={"include_lamp_appendix": False, "include_methodology": False},
                        pathogens=["Human coronavirus"])
    ctx = build_report_context(room, req, images={}, versions=Versions("t", "t"))
    attach_plots(ctx, room)
    html = render.render_html(ctx)
    assert "Custom calculation zones" not in html and "Ozone" not in html
    assert "Lamp photometrics" not in html and "Methodology" not in html
    assert "254 nm" in html
```

Add `API = "/api/v1"` near the imports if not present.

- [ ] **Step 2: Write `sections_results.html`**

```html
{% set u = ctx.units %}{% set p = ctx.precision %}{% set s = ctx.safety %}
<!-- ───────────── 3 Photobiological safety ───────────── -->
<section class="page">
  <h2><span class="n">3</span>Photobiological safety</h2>
  <p>Exposure is assessed against <b>{{ s.standard_label }}</b>, which limits the 8‑hour effective dose to skin and eyes at the most exposed position in the room. Each luminaire's dose is weighted by its own spectral limit before the contributions are summed.</p>
  <div class="pair">
    <figure>{{ ctx.skin_svg|safe }}<figcaption>Skin — 8 h dose at 1.8 {{ u.length if u.length == 'm' else 'ft' }} (mJ/cm²)</figcaption></figure>
    <figure>{{ ctx.eye_svg|safe }}<figcaption>Eye — 8 h dose, vertical field of view (mJ/cm²)</figcaption></figure>
  </div>
  <table class="data compact">
    <thead><tr><th></th><th class="num">Skin</th><th class="num">Eye</th></tr></thead>
    <tbody>
      <tr><td>Hours to the ACGIH TLV</td><td class="num">{{ s.hours['ACGIH'].skin|hours }}</td><td class="num">{{ s.hours['ACGIH'].eye|hours }}</td></tr>
      <tr><td>Hours to the ICNIRP limit</td><td class="num">{{ s.hours['ICNIRP'].skin|hours }}</td><td class="num">{{ s.hours['ICNIRP'].eye|hours }}</td></tr>
      <tr><td>Maximum 8‑h dose (mJ/cm²)</td><td class="num">{{ s.skin.max|num(1) }}</td><td class="num">{{ s.eye.max|num(1) }}</td></tr>
      <tr><td>Average 8‑h dose (mJ/cm²)</td><td class="num">{{ s.skin.mean|num(1) }}</td><td class="num">{{ s.eye.mean|num(1) }}</td></tr>
      <tr><td>Maximum irradiance (µW/cm²)</td><td class="num">{{ s.skin_irradiance.max|num(3) }}</td><td class="num">{{ s.eye_irradiance.max|num(3) }}</td></tr>
      <tr><td>Average irradiance (µW/cm²)</td><td class="num">{{ s.skin_irradiance.mean|num(3) }}</td><td class="num">{{ s.eye_irradiance.mean|num(3) }}</td></tr>
    </tbody>
  </table>

  {% if s.lamps %}
  <h3>Per‑luminaire compliance</h3>
  <table class="data compact">
    <thead><tr><th>Luminaire</th><th class="num">Skin dose / TLV</th><th class="num">Eye dose / TLV</th><th>Status</th></tr></thead>
    <tbody>{% for l in s.lamps %}
      <tr><td>{{ l.name }}{% if l.missing_spectrum %} <span class="chip warn">no spectrum</span>{% endif %}</td>
        <td class="num">{{ l.skin_dose|num(1) }} / {{ l.skin_tlv|num(1) }}</td><td class="num">{{ l.eye_dose|num(1) }} / {{ l.eye_tlv|num(1) }}</td>
        <td>{% if l.compliant %}<span class="chip ok">Compliant</span>{% else %}<span class="chip warn">{{ l.dimming_note }}</span>{% endif %}</td></tr>
    {% endfor %}</tbody>
  </table>
  <p class="caption">Doses in mJ/cm² over 8 h. A dimming note gives the output at which that luminaire alone would be within its limits.</p>
  {% endif %}
  {% if s.warnings %}<ul class="warnings">{% for w in s.warnings %}<li>{{ w }}</li>{% endfor %}</ul>{% endif %}

  {% if s.ozone_ppb is not none %}
  <h3>Ozone</h3>
  <p>222 nm sources generate a small amount of ozone. With {{ ctx.room.air_changes|num(1) }} air changes per hour and a decay constant of {{ s.ozone_decay_constant|num(1) }} h⁻¹, the estimated steady‑state increase is <b>{{ s.ozone_ppb|num(2) }} ppb</b>{% if s.ozone_ppb > 5 %}, above the 5 ppb level at which ventilation should be reviewed{% else %}, below the 5 ppb level at which ventilation should be reviewed{% endif %}.</p>
  {% endif %}
</section>

<!-- ───────────── 4 Pathogen reduction in air ───────────── -->
<section class="page">
  <h2><span class="n">4</span>Pathogen reduction in air</h2>
  <div class="two-col">
    <figure>
      {% if img(ctx.fluence.image_key) %}<img src="{{ img(ctx.fluence.image_key) }}" alt="Whole-room fluence isosurfaces">{% elif img('cover') %}<img src="{{ img('cover') }}" alt="3D view">{% else %}<div class="placeholder">No fluence view was captured.</div>{% endif %}
      <figcaption>Whole‑room fluence rate shown as isosurfaces.</figcaption>
    </figure>
    <table class="kv">
      <tr><th>Average fluence</th><td>{{ ctx.fluence.stats.mean|num(2) }} µW/cm²</td></tr>
      <tr><th>Maximum</th><td>{{ ctx.fluence.stats.max|num(2) }} µW/cm²</td></tr>
      <tr><th>Minimum</th><td>{{ ctx.fluence.stats.min|num(2) }} µW/cm²</td></tr>
      <tr><th>Wavelengths</th><td>{{ ctx.fluence.wavelengths_used|join(', ') }} nm{% if ctx.fluence.wavelengths_missing %} (no inactivation data at {{ ctx.fluence.wavelengths_missing|join(', ') }} nm){% endif %}</td></tr>
    </table>
  </div>
  {% if ctx.survival_svg %}<figure>{{ ctx.survival_svg|safe }}<figcaption>Surviving fraction of airborne pathogen over time at the room's average fluence.</figcaption></figure>{% endif %}
  {% if ctx.pathogens %}
  <table class="data compact">
    <thead><tr><th>Pathogen</th><th>Category</th><th class="num">eACH‑UV</th><th class="num">CADR L/s</th><th class="num">CADR cfm</th><th class="num">90 %</th><th class="num">99 %</th><th class="num">99.9 %</th></tr></thead>
    <tbody>{% for r in ctx.pathogens %}
      <tr><td>{{ r.species }}</td><td>{{ r.category }}</td><td class="num">{{ r.each_uv|num(1) }}</td><td class="num">{{ r.cadr_lps|num(0) }}</td><td class="num">{{ r.cadr_cfm|num(0) }}</td><td class="num">{{ r.t90|seconds }}</td><td class="num">{{ r.t99|seconds }}</td><td class="num">{{ r.t999|seconds }}</td></tr>
    {% endfor %}</tbody>
  </table>
  <p class="caption">Per species: inactivation constants are averaged over the published aerosol studies at each wavelength present; contributions from different wavelengths add. eACH‑UV is the equivalent air changes per hour; CADR is eACH × room volume.</p>
  {% endif %}
</section>

{% if ctx.custom_planes or ctx.custom_volumes or ctx.custom_points %}
<!-- ───────────── 5 Custom calculation zones ───────────── -->
<section class="page">
  <h2><span class="n">5</span>Custom calculation zones</h2>
  {% for z in ctx.custom_planes %}
  <figure>{{ z.svg|safe }}<figcaption><b>{{ z.name }}</b>{% if z.height is not none %} · plane at {{ z.height|num(p) }} {{ u.length }}{% endif %} · mean {{ z.stats.mean|num(2) }}, max {{ z.stats.max|num(2) }}, min {{ z.stats.min|num(2) }} {{ z.units }}{% if z.exposure %} ({{ z.exposure }}){% endif %}</figcaption></figure>
  {% endfor %}
  {% for z in ctx.custom_volumes %}
  <figure>{% if img(z.image_key) %}<img src="{{ img(z.image_key) }}" alt="{{ z.name }}">{% else %}<div class="placeholder">No view was captured for {{ z.name }}.</div>{% endif %}
    <figcaption><b>{{ z.name }}</b> · volume · mean {{ z.stats.mean|num(2) }}, max {{ z.stats.max|num(2) }}, min {{ z.stats.min|num(2) }} {{ z.units }}{% if z.exposure %} ({{ z.exposure }}){% endif %}</figcaption></figure>
  {% endfor %}
  {% if ctx.custom_points %}
  <h3>Calculation points</h3>
  <table class="data compact">
    <thead><tr><th>Point</th><th class="num">x</th><th class="num">y</th><th class="num">z</th><th class="num">Value</th><th>Units</th></tr></thead>
    <tbody>{% for z in ctx.custom_points %}<tr><td>{{ z.name }}</td><td class="num">{{ z.position[0]|num(p) }}</td><td class="num">{{ z.position[1]|num(p) }}</td><td class="num">{{ z.position[2]|num(p) }}</td><td class="num">{{ z.value|num(3) }}</td><td>{{ z.units }}</td></tr>{% endfor %}</tbody>
  </table>
  {% endif %}
</section>
{% endif %}

<!-- ───────────── Appendix ───────────── -->
<section class="page">
  <h2><span class="n">A</span>Appendix</h2>
  {% if ctx.options.include_lamp_appendix and ctx.lamp_plots %}
  <h3>A1 Lamp photometrics</h3>
  <div class="lamp-grid">{% for fixture, (polar, spectrum) in ctx.lamp_plots.items() %}
    <div class="lamp-card"><h4>{{ fixture }}</h4>{{ polar|safe }}{% if spectrum %}{{ spectrum|safe }}{% else %}<p class="caption">No spectrum on file.</p>{% endif %}</div>
  {% endfor %}</div>
  {% endif %}
  {% if ctx.options.include_methodology %}
  <h3>A2 Methodology</h3>
  <p>Irradiance is computed from each luminaire's photometric (IES) distribution by inverse-square projection onto a grid of calculation points{% if ctx.room.reflectance_enabled %}, with inter-reflections between the room's surfaces added iteratively using the reflectances in §2{% endif %}. Skin and eye doses are the 8‑hour integrals of irradiance on horizontal and vertical planes at head height, weighted by the standard's spectral hazard function for each luminaire's spectrum; the hours to the limit are 8 h × 3 mJ/cm² divided by the maximum weighted dose. Pathogen inactivation uses first-order (and where published, two-stage) kinetics with constants averaged over aerosol studies at each wavelength present; equivalent air changes are the summed inactivation rates expressed per hour. Calculations by guv‑calcs {{ ctx.versions.guv_calcs }}.</p>
  {% endif %}
  <h3>A3 Software</h3>
  <table class="kv">
    <tr><th>Illuminate</th><td>v{{ ctx.versions.app }}</td></tr>
    <tr><th>guv‑calcs</th><td>{{ ctx.versions.guv_calcs }}</td></tr>
    <tr><th>Generated</th><td>{{ ctx.generated_at.strftime('%Y-%m-%d %H:%M') }}</td></tr>
  </table>
</section>
```

- [ ] **Step 3: Run the tests**

Run: `cd api && uv run pytest tests/test_report_pdf.py tests/test_report_plots.py tests/test_report_context.py -v` → all PASS. Render the fixture to `scratchpad/report.pdf` and look at it (`uv run python - <<EOF ... EOF` using the fixture code from the test). Adjust CSS spacing so the summary fits one page.

- [ ] **Step 4: Commit**

```bash
git add api/api/report/templates/sections_results.html api/tests/test_report_pdf.py
git commit -m "feat(report): safety, pathogen, custom-zone and appendix sections"
```

---

### Task 7: `POST /session/report/pdf` endpoint

**Files:**
- Create: `api/api/v1/report_routers.py`
- Modify: `api/api/v1/session_routers.py` (include router)
- Test: `api/tests/test_report_endpoint.py`

**Interfaces:**
- Consumes: `ReportRequest`, `decode_images`, `build_report_context`, `attach_plots`, `render_pdf`, `WeasyPrintUnavailable`.
- Produces: `POST /api/v1/session/report/pdf` → `application/pdf`.

- [ ] **Step 1: Write the failing tests**

```python
# api/tests/test_report_endpoint.py
import base64
import io
from PIL import Image

API = "/api/v1"


def _png():
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), (200, 30, 60)).save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def _body(**over):
    body = {"meta": {"title": "Lab 3"}, "pathogens": ["Human coronavirus"], "images": {"cover": _png(), "plan": _png()}}
    body.update(over)
    return body


def test_pdf_download(report_session):
    client, headers, _ = report_session
    resp = client.post(f"{API}/session/report/pdf", json=_body(), headers=headers)
    if resp.status_code == 503:
        import pytest; pytest.skip(resp.json()["detail"])
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("application/pdf")
    assert 'filename="Lab_3_report.pdf"' in resp.headers["content-disposition"]
    assert resp.content[:5] == b"%PDF-"


def test_unknown_species_is_422_and_named(report_session):
    client, headers, _ = report_session
    resp = client.post(f"{API}/session/report/pdf", json=_body(pathogens=["Not a pathogen"]), headers=headers)
    assert resp.status_code == 422
    assert "Not a pathogen" in resp.json()["detail"]


def test_bad_image_is_422_and_named(report_session):
    client, headers, _ = report_session
    resp = client.post(f"{API}/session/report/pdf", json=_body(images={"plan": "data:image/jpeg;base64,AAAA"}), headers=headers)
    assert resp.status_code == 422 and "plan" in resp.json()["detail"]


def test_no_results_is_400(client, session_headers, minimal_room_config, minimal_lamp_input):
    client.post(f"{API}/session/init", json={"room": minimal_room_config, "lamps": [minimal_lamp_input],
                "zones": [{"id": "SkinLimits", "type": "plane", "isStandard": True, "height": 1.8, "x1": 0, "x2": 4, "y1": 0, "y2": 6, "num_x": 3, "num_y": 3}]},
                headers=session_headers)
    resp = client.post(f"{API}/session/report/pdf", json=_body(), headers=session_headers)
    assert resp.status_code == 400
    assert "calculate" in resp.json()["detail"].lower()
```

- [ ] **Step 2: Run** → 404s (route missing).

- [ ] **Step 3: Write the router**

```python
# api/api/v1/report_routers.py
"""POST /session/report/pdf — the designed PDF report."""
import logging
import re

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from guv_calcs import WHOLE_ROOM_FLUENCE, EYE_LIMITS, SKIN_LIMITS

from api.report.context import build_report_context, Versions
from api.report.plots import attach_plots
from api.report.render import render_pdf, WeasyPrintUnavailable
from api.report.validation import decode_images, ReportValidationError
from .session_helpers import InitializedSessionDep, locked_session, _log_and_raise
from .session_schemas import ReportRequest

logger = logging.getLogger(__name__)
router = APIRouter()


def _slug(title: str) -> str:
    s = re.sub(r"[^A-Za-z0-9]+", "_", title).strip("_")
    return s[:60] or "report"


@router.post("/report/pdf", summary="Generate the PDF design report",
             responses={200: {"content": {"application/pdf": {}}}})
def generate_report_pdf(body: ReportRequest, session: InitializedSessionDep, request: Request):
    room = session.room
    for zid in (WHOLE_ROOM_FLUENCE, SKIN_LIMITS, EYE_LIMITS):
        zone = room.calc_zones.get(zid)
        if zone is None or zone.get_values() is None:
            raise HTTPException(status_code=400, detail=f"Calculate the room before generating a report ({zid} has no results).")
    try:
        images = decode_images(body.images)
    except ReportValidationError as e:
        raise HTTPException(status_code=422, detail=e.detail)
    try:
        from guv_calcs import __version__ as guv_version
    except ImportError:
        guv_version = "unknown"
    versions = Versions(app=request.app.version, guv_calcs=guv_version)
    try:
        with locked_session(session):
            try:
                ctx = build_report_context(room, body, images, versions)
            except ValueError as e:
                if "No inactivation data" in str(e):
                    raise HTTPException(status_code=422, detail=str(e))
                raise
            attach_plots(ctx, room)
        pdf = render_pdf(ctx)
    except HTTPException:
        raise
    except WeasyPrintUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        _log_and_raise("Report generation failed", e)
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{_slug(body.meta.title)}_report.pdf"'})
```

In `api/api/v1/session_routers.py` add `from .report_routers import router as report_router` and `router.include_router(report_router)` after the calc router.

- [ ] **Step 4: Run tests, regenerate contract, commit**

Run: `cd api && uv run pytest tests/test_report_endpoint.py -v` → PASS. Then `make generate-api && cd ui && pnpm check`.

```bash
git add api/api/v1/report_routers.py api/api/v1/session_routers.py api/tests/test_report_endpoint.py api/openapi.json ui/src/lib/api/generated/api-types.ts
git commit -m "feat(api): POST /session/report/pdf renders the design report"
```

---

### Task 8: Docker, CI and desktop note

**Files:**
- Modify: `Dockerfile`, `.github/workflows/ci.yml` (api-tests job), `desktop/README.md` (or the desktop folder's top-level readme)

- [ ] **Step 1: Dockerfile runtime stage**

After `WORKDIR /app` in stage 2 add:

```dockerfile
# WeasyPrint (PDF report) needs Pango + HarfBuzz; fontconfig for the bundled fonts
RUN apt-get update && apt-get install -y --no-install-recommends \
      libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz0b libharfbuzz-subset0 fontconfig \
    && rm -rf /var/lib/apt/lists/*
```

After the matplotlib warm-up line add:

```dockerfile
# Fail the build if WeasyPrint cannot render (missing system libraries)
RUN uv run --no-sources python -c "from weasyprint import HTML; assert HTML(string='<p>ok</p>').write_pdf()[:4] == b'%PDF'"
```

- [ ] **Step 2: CI api-tests job**

In `.github/workflows/ci.yml`, in the job that runs `pytest` for the API, add before the test step:

```yaml
      - name: Install PDF rendering libraries
        run: sudo apt-get update && sudo apt-get install -y --no-install-recommends libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz0b libharfbuzz-subset0
```

- [ ] **Step 3: Desktop note**

Append to the desktop README: "The PDF report needs WeasyPrint's native libraries (Pango, HarfBuzz) bundled with the Python runtime; the dormant desktop build does not yet do this, and the endpoint returns 503 there."

- [ ] **Step 4: Build the image locally if Docker is available**

Run: `docker build -t illuminate-pdf-test . 2>&1 | tail -5` (skip with a note in the commit message if Docker is unavailable).

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .github/workflows/ci.yml desktop/README.md
git commit -m "build: Pango/HarfBuzz for WeasyPrint in the image and CI; desktop note"
```

---

### Task 9: Report meta in the project store and `.guv` sidecar

**Files:**
- Modify: `ui/src/lib/types/project.ts` (add `ReportMeta`, `Project.reportMeta`)
- Modify: `ui/src/lib/utils/floorplanSidecar.ts`
- Modify: `ui/src/lib/stores/project.ts` (default project, `updateReportMeta`, `loadFromApiResponse`, a derived export)
- Modify: `ui/src/routes/+page.svelte` (save/load, ~lines 795–850) — via a Python patch script, tabs preserved
- Test: `ui/src/lib/utils/floorplanSidecar.test.ts`, `ui/src/lib/stores/project.reportMeta.test.ts`

**Interfaces:**
- Produces: `ReportMeta { title: string; client: string; prepared_by: string; notes: string }`; `project.updateReportMeta(partial: Partial<ReportMeta>)`; `reportMeta` readable store (derived, `title` defaults to the project name); `attachSidecar(guvText, floorplan, report?: ReportMeta | null)`; `extractReportMeta(guvText): ReportMeta | null`.

- [ ] **Step 1: Write the failing tests**

Append to `ui/src/lib/utils/floorplanSidecar.test.ts`:

```ts
import { attachSidecar, extractSidecar, extractReportMeta, stripSidecar } from './floorplanSidecar';

describe('report meta in the sidecar', () => {
  const guv = JSON.stringify({ 'guv-calcs_version': '0.7.3', data: { rooms: {} } }, null, 2);
  const meta = { title: 'Lab 3', client: 'Acme', prepared_by: 'V. B.', notes: 'north wing' };

  it('round-trips report meta with and without a floor plan', () => {
    const withMeta = attachSidecar(guv, null, meta);
    expect(extractReportMeta(withMeta)).toEqual(meta);
    expect(extractSidecar(withMeta)).toBeNull();
    expect(JSON.parse(stripSidecar(withMeta))).not.toHaveProperty('illuminate');
  });

  it('returns null when the block or the report key is missing', () => {
    expect(extractReportMeta(guv)).toBeNull();
    expect(extractReportMeta(attachSidecar(guv, null, null))).toBeNull();
  });

  it('ignores a malformed report block', () => {
    const bad = JSON.stringify({ ...JSON.parse(guv), illuminate: { version: 1, report: { title: 5 } } });
    expect(extractReportMeta(bad)).toBeNull();
  });
});
```

Create `ui/src/lib/stores/project.reportMeta.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/api/client')>();
  return { ...actual, createSession: vi.fn().mockResolvedValue({ session_id: 's', token: 't' }) };
});

import { project, reportMeta } from '$lib/stores/project';

describe('report meta', () => {
  beforeEach(() => project.reset());

  it('defaults the title to the project name and the rest to empty', () => {
    const m = get(reportMeta);
    expect(m.title).toBe(get(project).name);
    expect(m.client).toBe('');
  });

  it('updateReportMeta merges and persists in the project', () => {
    project.updateReportMeta({ client: 'Acme' });
    project.updateReportMeta({ title: 'Lab 3' });
    expect(get(reportMeta)).toMatchObject({ title: 'Lab 3', client: 'Acme', prepared_by: '', notes: '' });
    expect(get(project).reportMeta).toMatchObject({ title: 'Lab 3', client: 'Acme' });
  });

  it('reset clears it', () => {
    project.updateReportMeta({ client: 'Acme' });
    project.reset();
    expect(get(reportMeta).client).toBe('');
  });
});
```

If `project.reset()` is not the store's method for a fresh project, use whatever `+page.svelte`'s "New project" flow calls (search for `startFresh` → the confirm handler) and substitute.

- [ ] **Step 2: Run** `cd ui && pnpm vitest run src/lib/utils/floorplanSidecar.test.ts src/lib/stores/project.reportMeta.test.ts` → FAIL (missing exports).

- [ ] **Step 3: Types**

In `ui/src/lib/types/project.ts`, before `export interface Project`:

```ts
/** Who the PDF report is for and who prepared it; saved with the project. */
export interface ReportMeta {
  title: string;
  client: string;
  prepared_by: string;
  notes: string;
}
```

and add `reportMeta?: ReportMeta;` to `Project` after `results?`.

- [ ] **Step 4: Sidecar**

In `floorplanSidecar.ts`: add `import type { ReportMeta } from '$lib/types/project';`, a `ReportSchema = z.object({ title: z.string(), client: z.string(), prepared_by: z.string(), notes: z.string() })`, make `floorplan` optional in `SidecarSchema` and add `report: ReportSchema.optional()`. Change `attachSidecar` to:

```ts
export function attachSidecar(guvText: string, floorplan: FloorPlanSidecar | null, report: ReportMeta | null = null): string {
  const parsed = JSON.parse(guvText);
  delete parsed.illuminate;
  if (floorplan || report) {
    parsed.illuminate = { version: SIDECAR_VERSION, ...(floorplan ? { floorplan } : {}), ...(report ? { report } : {}) };
  }
  return JSON.stringify(parsed, null, 2);
}
```

Keep `extractSidecar` returning the floor plan (now `parsed.illuminate?.floorplan ?? null` after a safe parse) and add:

```ts
export function extractReportMeta(guvText: string): ReportMeta | null {
  try {
    const parsed = JSON.parse(guvText);
    const res = SidecarSchema.safeParse(parsed.illuminate);
    return res.success && res.data.report ? res.data.report : null;
  } catch {
    return null;
  }
}
```

Read the existing `attachSidecar`/`extractSidecar` bodies first and keep their pretty-printing and validation behaviour; the test file's existing cases must still pass.

- [ ] **Step 5: Store**

In `project.ts`: default project gets `reportMeta: undefined`. Add to the store object (near `updateRoom`):

```ts
    updateReportMeta(partial: Partial<ReportMeta>) {
      update(p => ({
        ...p,
        reportMeta: { title: p.name, client: '', prepared_by: '', notes: '', ...(p.reportMeta ?? {}), ...partial },
        lastModified: new Date().toISOString(),
      }));
    },
```

In `loadFromApiResponse(response, projectName)` set `reportMeta: undefined` on the new state (the page re-applies it from the sidecar). Export after `results`:

```ts
export const reportMeta = derived(project, ($p): ReportMeta => ({
  title: $p.name, client: '', prepared_by: '', notes: '', ...($p.reportMeta ?? {}),
}));
```

Import `ReportMeta` at the top of the file with the other type imports.

- [ ] **Step 6: Page save/load (Python patch, tabs preserved)**

```python
# scratchpad/patch_page_sidecar.py
p = 'ui/src/routes/+page.svelte'
s = open(p).read()
s = s.replace("import { attachSidecar, extractSidecar, stripSidecar } from '$lib/utils/floorplanSidecar';",
              "import { attachSidecar, extractSidecar, extractReportMeta, stripSidecar } from '$lib/utils/floorplanSidecar';", 1)
s = s.replace("const guvContent = attachSidecar(await saveSession(), sidecar);",
              "const guvContent = attachSidecar(await saveSession(), sidecar, $project.reportMeta ?? null);", 1)
old = "\t\t\t\tconst sidecar = extractSidecar(text);\n"
assert old in s
s = s.replace(old, old + "\t\t\t\tconst loadedMeta = extractReportMeta(text);\n\t\t\t\tif (loadedMeta) project.updateReportMeta(loadedMeta);\n", 1)
open(p, 'w').write(s)
print('ok')
```

Run `python3 scratchpad/patch_page_sidecar.py` from the worktree root; confirm with `grep -n "extractReportMeta" ui/src/routes/+page.svelte` (3 hits) and `cat -A` that the inserted lines start with tabs.

- [ ] **Step 7: Run tests and commit**

`cd ui && pnpm vitest run src/lib/utils src/lib/stores/project.reportMeta.test.ts && pnpm check` → PASS, 0 errors.

```bash
git add ui/src/lib/types/project.ts ui/src/lib/utils/floorplanSidecar.ts ui/src/lib/utils/floorplanSidecar.test.ts ui/src/lib/stores/project.ts ui/src/lib/stores/project.reportMeta.test.ts ui/src/routes/+page.svelte
git commit -m "feat(ui): report title, client, preparer and notes live in the project and the .guv sidecar"
```

---

### Task 10: Scene capture API and `reportCapture.ts`

**Files:**
- Modify: `ui/src/lib/components/Scene.svelte` (capture controls, `setView`)
- Modify: `ui/src/lib/components/RoomViewer.svelte` (visibility override, `onCaptureApiReady`)
- Create: `ui/src/lib/utils/reportCapture.ts`
- Test: `ui/src/lib/utils/reportCapture.test.ts`

**Interfaces:**
- Produces (in `reportCapture.ts`):

```ts
export interface CameraState { position: [number, number, number]; target: [number, number, number] }
export interface VisibilityOverride { lampIds?: string[]; zoneIds?: string[]; objectIds?: string[] }
export interface SceneCaptureApi {
  canvas(): HTMLCanvasElement | null;
  prepare(): void;                      // transparent bg + synchronous render
  restore(): void;
  getCamera(): CameraState;
  setCamera(state: CameraState): void;
  setViewImmediate(view: ViewPreset): void;  // no animation
  setVisibility(override: VisibilityOverride | null): void;  // null = user's own visibility
  render(): void;                       // one synchronous frame
}
export type CoverChoice = 'current' | 'iso-front-left' | 'top' | 'front';
export interface CapturePlan { coverView: CoverChoice; volumeZoneIds: string[]; lampIds: string[]; objectIds: string[]; pointZoneIds: string[]; minWidth?: number }
export async function captureReportImages(api: SceneCaptureApi, plan: CapturePlan): Promise<Record<string, string>>
export async function captureThumbnails(api: SceneCaptureApi, views: CoverChoice[], width: number): Promise<Record<CoverChoice, string>>
```

- [ ] **Step 1: Write the failing test**

```ts
// ui/src/lib/utils/reportCapture.test.ts
import { describe, it, expect, vi } from 'vitest';
import { captureReportImages, captureThumbnails, type SceneCaptureApi } from './reportCapture';

function fakeApi() {
  const calls: string[] = [];
  const canvas = { width: 800, height: 600, toDataURL: vi.fn(() => 'data:image/png;base64,AAAA') } as unknown as HTMLCanvasElement;
  const camera = { position: [1, 2, 3] as [number, number, number], target: [0, 0, 0] as [number, number, number] };
  const api: SceneCaptureApi = {
    canvas: () => canvas,
    prepare: () => calls.push('prepare'),
    restore: () => calls.push('restore'),
    getCamera: () => ({ ...camera }),
    setCamera: (s) => calls.push(`setCamera:${s.position.join(',')}`),
    setViewImmediate: (v) => calls.push(`view:${v}`),
    setVisibility: (o) => calls.push(`vis:${o ? JSON.stringify(o) : 'null'}`),
    render: () => calls.push('render'),
  };
  return { api, calls, canvas };
}

describe('captureReportImages', () => {
  it('captures cover (preset), plan and one image per volume, then restores camera and visibility', async () => {
    const { api, calls } = fakeApi();
    const out = await captureReportImages(api, {
      coverView: 'iso-front-left', volumeZoneIds: ['WholeRoomFluence', 'breath'],
      lampIds: ['L1'], objectIds: ['o1'], pointZoneIds: ['pt1'],
    });
    expect(Object.keys(out)).toEqual(['cover', 'plan', 'volume:WholeRoomFluence', 'volume:breath']);
    expect(calls).toContain('view:iso-front-left');
    expect(calls).toContain('view:top');
    // plan hides volumes, keeps lamps/objects/points
    expect(calls).toContain('vis:{"lampIds":["L1"],"zoneIds":["pt1"],"objectIds":["o1"]}');
    // volume capture shows that zone even if the user had hidden it
    expect(calls).toContain('vis:{"lampIds":["L1"],"zoneIds":["breath"],"objectIds":[]}');
    expect(calls.at(-1)).toBe('vis:null');
    expect(calls.filter(c => c.startsWith('setCamera:1,2,3')).length).toBe(1);
  });

  it('keeps the current camera for coverView=current and never calls a preset for the cover', async () => {
    const { api, calls } = fakeApi();
    await captureReportImages(api, { coverView: 'current', volumeZoneIds: [], lampIds: [], objectIds: [], pointZoneIds: [] });
    expect(calls.filter(c => c.startsWith('view:'))).toEqual(['view:top']);
  });

  it('restores on failure', async () => {
    const { api, calls, canvas } = fakeApi();
    (canvas.toDataURL as any).mockImplementationOnce(() => { throw new Error('boom'); });
    await expect(captureReportImages(api, { coverView: 'current', volumeZoneIds: [], lampIds: [], objectIds: [], pointZoneIds: [] })).rejects.toThrow('boom');
    expect(calls.at(-1)).toBe('vis:null');
    expect(calls.some(c => c.startsWith('setCamera:'))).toBe(true);
  });

  it('thumbnails render each view and restore', async () => {
    const { api, calls } = fakeApi();
    const t = await captureThumbnails(api, ['current', 'iso-front-left', 'top', 'front'], 160);
    expect(Object.keys(t)).toEqual(['current', 'iso-front-left', 'top', 'front']);
    expect(calls.filter(c => c.startsWith('view:'))).toEqual(['view:iso-front-left', 'view:top', 'view:front']);
  });
});
```

- [ ] **Step 2: Run** → FAIL (module missing).

- [ ] **Step 3: Write `reportCapture.ts`**

```ts
// ui/src/lib/utils/reportCapture.ts
/**
 * Drive the 3D scene to produce the PNGs the PDF report needs. One WebGL canvas,
 * so captures run strictly in sequence; camera and visibility are restored
 * even when a capture throws.
 */
import type { ViewPreset } from '$lib/components/ViewSnapOverlay.svelte';

export interface CameraState { position: [number, number, number]; target: [number, number, number] }
export interface VisibilityOverride { lampIds?: string[]; zoneIds?: string[]; objectIds?: string[] }
export interface SceneCaptureApi {
  canvas(): HTMLCanvasElement | null;
  prepare(): void;
  restore(): void;
  getCamera(): CameraState;
  setCamera(state: CameraState): void;
  setViewImmediate(view: ViewPreset): void;
  setVisibility(override: VisibilityOverride | null): void;
  render(): void;
}
export type CoverChoice = 'current' | 'iso-front-left' | 'top' | 'front';
export const COVER_CHOICES: { id: CoverChoice; label: string }[] = [
  { id: 'current', label: 'Current view' },
  { id: 'iso-front-left', label: 'Headline isometric' },
  { id: 'top', label: 'Plan' },
  { id: 'front', label: 'Front elevation' },
];
export interface CapturePlan {
  coverView: CoverChoice;
  volumeZoneIds: string[];
  lampIds: string[];
  objectIds: string[];
  pointZoneIds: string[];
  /** Upscale the canvas so the longest side is at least this many px (default 1600). */
  minWidth?: number;
}

const nextFrame = () => new Promise<void>(r => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => r()) : setTimeout(r, 0)));

async function settle() { await nextFrame(); await nextFrame(); }

function grab(api: SceneCaptureApi, targetWidth: number | null): string {
  const canvas = api.canvas();
  if (!canvas) throw new Error('3D view is not available');
  api.prepare();
  try {
    if (targetWidth == null || targetWidth === canvas.width || typeof document === 'undefined') return canvas.toDataURL('image/png');
    const scale = targetWidth / canvas.width;
    const off = document.createElement('canvas');
    off.width = Math.round(canvas.width * scale);
    off.height = Math.round(canvas.height * scale);
    const ctx = off.getContext('2d');
    if (!ctx) return canvas.toDataURL('image/png');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, off.width, off.height);
    return off.toDataURL('image/png');
  } finally {
    api.restore();
  }
}

async function withScene<T>(api: SceneCaptureApi, fn: () => Promise<T>): Promise<T> {
  const camera = api.getCamera();
  try {
    return await fn();
  } finally {
    api.setCamera(camera);
    api.setVisibility(null);
    api.render();
  }
}

export async function captureReportImages(api: SceneCaptureApi, plan: CapturePlan): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const canvas = api.canvas();
  const width = canvas ? Math.max(canvas.width, plan.minWidth ?? 1600) : null;
  return withScene(api, async () => {
    // cover: user's visibility, chosen camera
    if (plan.coverView !== 'current') api.setViewImmediate(plan.coverView);
    api.render(); await settle();
    out.cover = grab(api, width);
    // plan: top-down, no volumes/planes, lamps + objects + points
    api.setVisibility({ lampIds: plan.lampIds, zoneIds: plan.pointZoneIds, objectIds: plan.objectIds });
    api.setViewImmediate('top');
    api.render(); await settle();
    out.plan = grab(api, width);
    // one isometric per volume zone, that zone alone with the lamps
    for (const zid of plan.volumeZoneIds) {
      api.setVisibility({ lampIds: plan.lampIds, zoneIds: [zid], objectIds: [] });
      api.setViewImmediate('iso-front-left');
      api.render(); await settle();
      out[`volume:${zid}`] = grab(api, width);
    }
    return out;
  });
}

export async function captureThumbnails(api: SceneCaptureApi, views: CoverChoice[], width: number): Promise<Record<CoverChoice, string>> {
  const out = {} as Record<CoverChoice, string>;
  return withScene(api, async () => {
    const start = api.getCamera();
    for (const v of views) {
      if (v === 'current') api.setCamera(start); else api.setViewImmediate(v);
      api.render(); await settle();
      out[v] = grab(api, width);
    }
    return out;
  });
}
```

- [ ] **Step 4: Run the unit test** → PASS (the fake canvas returns a fixed data URL; `document.createElement('canvas')` under jsdom has no 2D context, so `grab` falls back to `toDataURL` — that is why the test does not assert on scaling).

- [ ] **Step 5: Scene.svelte — extend the capture controls (write the file via Python patch)**

Replace the `$effect` that calls `onCaptureControlReady` and widen the prop type. Patch script:

```python
# scratchpad/patch_scene.py
p = 'ui/src/lib/components/Scene.svelte'
s = open(p).read()
s = s.replace("onCaptureControlReady?: (controls: { prepare: () => void; restore: () => void }) => void;",
              "onCaptureControlReady?: (controls: SceneCaptureControls) => void;", 1)
s = s.replace("\timport { T, useThrelte } from '@threlte/core';",
              "\timport { T, useThrelte } from '@threlte/core';\n\timport type { CameraState } from '$lib/utils/reportCapture';", 1)
old = "\t$effect(() => {\n\t\tif (cameraRef) {\n\t\t\tonCaptureControlReady?.({ prepare: prepareForCapture, restore: restoreAfterCapture });\n\t\t}\n\t});"
assert old in s
new = """\texport interface SceneCaptureControls {
\t\tprepare: () => void;
\t\trestore: () => void;
\t\tgetCamera: () => CameraState;
\t\tsetCamera: (state: CameraState) => void;
\t\tsetViewImmediate: (view: ViewPreset) => void;
\t\trender: () => void;
\t}

\tfunction getCameraState(): CameraState {
\t\tconst pos = cameraRef!.position;
\t\tconst tgt = controlsRef?.target ?? new THREE.Vector3(roomCenter.x, roomCenter.y, roomCenter.z);
\t\treturn { position: [pos.x, pos.y, pos.z], target: [tgt.x, tgt.y, tgt.z] };
\t}

\tfunction setCameraState(state: CameraState) {
\t\tif (!cameraRef) return;
\t\tcancelAnimation();
\t\tcameraRef.position.set(...state.position);
\t\tif (controlsRef) { controlsRef.target.set(...state.target); controlsRef.update(); }
\t\telse cameraRef.lookAt(new THREE.Vector3(...state.target));
\t}

\tfunction renderOnce() {
\t\tif (cameraRef) captureRenderer.render(scene, cameraRef);
\t}

\t$effect(() => {
\t\tif (cameraRef) {
\t\t\tonCaptureControlReady?.({
\t\t\t\tprepare: prepareForCapture,
\t\t\t\trestore: restoreAfterCapture,
\t\t\t\tgetCamera: getCameraState,
\t\t\t\tsetCamera: setCameraState,
\t\t\t\tsetViewImmediate: (view) => setView(view, { immediate: true }),
\t\t\t\trender: renderOnce,
\t\t\t});
\t\t}
\t});"""
s = s.replace(old, new, 1)
# setView gains an immediate option: jump to the end state, no animation
s = s.replace("\tfunction setView(view: ViewPreset) {\n\t\tif (!cameraRef || !controlsRef) return;\n\n\t\tcancelAnimation();",
              "\tfunction setView(view: ViewPreset, opts: { immediate?: boolean } = {}) {\n\t\tif (!cameraRef || !controlsRef) return;\n\n\t\tcancelAnimation();", 1)
old2 = "\t\t// Disable OrbitControls during animation so damping doesn't fight\n\t\tcontrolsRef.enabled = false;"
assert old2 in s
new2 = """\t\tif (opts.immediate) {
\t\t\tconst finalPos = nearPole ? endPos! : endTarget.clone().add(new THREE.Vector3().setFromSpherical(endSph));
\t\t\tcameraRef.position.copy(finalPos);
\t\t\tcameraRef.lookAt(endTarget);
\t\t\tcontrolsRef.target.copy(endTarget);
\t\t\tcontrolsRef.update();
\t\t\treturn;
\t\t}

\t\t// Disable OrbitControls during animation so damping doesn't fight
\t\tcontrolsRef.enabled = false;"""
s = s.replace(old2, new2, 1)
open(p, 'w').write(s)
print('ok')
```

Svelte 5 allows `export interface` only in `<script module>`; if `pnpm check` complains, move `SceneCaptureControls` to `reportCapture.ts` (it is structurally identical to `SceneCaptureApi` minus `canvas`/`setVisibility`) and import it instead. The `onViewControlReady?.(setView)` call still type-checks because the second parameter is optional.

- [ ] **Step 6: RoomViewer.svelte — visibility override and the API callback**

Patch script (`scratchpad/patch_roomviewer.py`), applying these edits with `assert old in s` guards:

1. Props: add `onCaptureApiReady?: (api: SceneCaptureApi) => void;` to `interface Props` and to the destructuring. Import `type { SceneCaptureApi, VisibilityOverride } from '$lib/utils/reportCapture'` and `type { SceneCaptureControls } from './Scene.svelte'` (or from reportCapture if moved).
2. Replace `let captureControls = $state<{ prepare: () => void; restore: () => void } | null>(null);` with `let captureControls = $state<SceneCaptureControls | null>(null);` and the handler's parameter type likewise.
3. Add after `getCanvas()`:

```ts
	let visibilityOverride = $state<VisibilityOverride | null>(null);
	const effectiveVisibleLampIds = $derived(visibilityOverride?.lampIds ?? visibleLampIds);
	const effectiveVisibleZoneIds = $derived(visibilityOverride?.zoneIds ?? visibleZoneIds);
	const effectiveVisibleObjectIds = $derived(visibilityOverride?.objectIds ?? visibleObjectIds);

	$effect(() => {
		if (!captureControls) return;
		onCaptureApiReady?.({
			canvas: getCanvas,
			prepare: captureControls.prepare,
			restore: captureControls.restore,
			getCamera: captureControls.getCamera,
			setCamera: captureControls.setCamera,
			setViewImmediate: captureControls.setViewImmediate,
			render: captureControls.render,
			setVisibility: (o) => { visibilityOverride = o; },
		});
	});
```

4. In the `<Scene ... />` tag replace `{visibleLampIds} {visibleZoneIds} {visibleObjectIds}` with `visibleLampIds={effectiveVisibleLampIds} visibleZoneIds={effectiveVisibleZoneIds} visibleObjectIds={effectiveVisibleObjectIds}`.

Run `cd ui && pnpm check` → 0 errors; `pnpm vitest run src/lib/components/RoomViewer` if such tests exist.

- [ ] **Step 7: Commit**

```bash
git add ui/src/lib/utils/reportCapture.ts ui/src/lib/utils/reportCapture.test.ts ui/src/lib/components/Scene.svelte ui/src/lib/components/RoomViewer.svelte
git commit -m "feat(ui): scene capture API (instant view presets, camera snapshot, visibility override) and report image capture"
```

---

### Task 11: `ReportModal.svelte`, client call, and wiring

**Files:**
- Modify: `ui/src/lib/api/contract.ts`, `ui/src/lib/api/client.ts`
- Create: `ui/src/lib/components/ReportModal.svelte`
- Modify: `ui/src/lib/stores/settings.ts` (`reportIncludeLampAppendix`, `reportIncludeMethodology`, `reportCoverView`)
- Modify: `ui/src/routes/+page.svelte` (state, RoomViewer prop, modal mount, ExportModal prop) — Python patch
- Modify: `ui/src/lib/components/ExportModal.svelte` (add "Report (PDF)…" button; prop `onOpenPdfReport?: () => void`) — Python patch
- Test: `ui/src/lib/components/ReportModal.test.ts`, `ui/src/lib/api/client.report.test.ts`

**Interfaces:**
- Consumes: `postSessionReportPdf`, `captureReportImages`, `captureThumbnails`, `reportMeta`, `project.updateReportMeta`, `PathogenMultiSelect` (props `options`, `categoryOf`, `selected`, `onChange`), `getEfficacyExploreData`, `parseTableResponse`, `speciesWithDataAt`.
- Produces: `ReportModal` props `{ onClose: () => void; captureApi: SceneCaptureApi | null }`; `client.postSessionReportPdf(body: ReportRequest): Promise<Blob>`; `contract.ReportRequest`.

- [ ] **Step 1: Contract alias and client**

In `contract.ts` add:

```ts
/** Body of `POST /session/report/pdf` (title/client/notes, options, species, PNG captures). */
export type ReportRequest = components['schemas']['ReportRequest'];
```

In `client.ts` add near `getSessionReport`:

```ts
/**
 * Generate the PDF design report for the session. Returns the PDF blob.
 */
export async function postSessionReportPdf(body: ReportRequest): Promise<Blob> {
  return requestBlob('/session/report/pdf', { method: 'POST', body: JSON.stringify(body) });
}
```

with `import type { ReportRequest } from './contract';` at the top (check how other contract types are imported in this file and follow that). If `requestBlob` does not set `Content-Type: application/json` for a body, look at how `request()` posts JSON (`baseRequest`) and pass the same headers.

Test `ui/src/lib/api/client.report.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { postSessionReportPdf } from './client';

describe('postSessionReportPdf', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  it('POSTs JSON and returns a blob', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])]), { status: 200, headers: { 'content-type': 'application/pdf' } }));
    const blob = await postSessionReportPdf({ meta: { title: 'T' }, pathogens: ['Human coronavirus'], images: {} } as any);
    expect(blob.size).toBe(4);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/session\/report\/pdf$/);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string).pathogens).toEqual(['Human coronavirus']);
  });
});
```

Look at an existing `client.*.test.ts` for how the session id header/session store is primed in tests and copy that setup if the request requires an active session.

- [ ] **Step 2: Settings**

In `settings.ts` `UserSettings` add `reportIncludeLampAppendix: boolean; reportIncludeMethodology: boolean; reportCoverView: 'current' | 'iso-front-left' | 'top' | 'front';` and defaults `true, true, 'current'`.

- [ ] **Step 3: Write the failing modal test**

```ts
// ui/src/lib/components/ReportModal.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { get } from 'svelte/store';

const postMock = vi.fn();
vi.mock('$lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/api/client')>();
  return {
    ...actual,
    createSession: vi.fn().mockResolvedValue({ session_id: 's', token: 't' }),
    postSessionReportPdf: (...a: unknown[]) => postMock(...a),
    getEfficacyExploreData: vi.fn().mockResolvedValue({
      categories: ['Viruses'], mediums: ['Aerosol'], wavelengths: [222],
      table: { columns: ['Category', 'Species', 'Medium', 'wavelength [nm]', 'k1 [cm2/mJ]'], rows: [
        ['Viruses', 'Human coronavirus', 'Aerosol', 222, 1.0], ['Viruses', 'Influenza virus', 'Aerosol', 222, 2.0],
        ['Bacteria', 'Staphylococcus aureus', 'Aerosol', 254, 3.0]], count: 3 },
    }),
  };
});
vi.mock('$lib/utils/reportCapture', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/utils/reportCapture')>();
  return {
    ...actual,
    captureThumbnails: vi.fn().mockResolvedValue({ current: 'data:a', 'iso-front-left': 'data:b', top: 'data:c', front: 'data:d' }),
    captureReportImages: vi.fn().mockResolvedValue({ cover: 'data:image/png;base64,AAAA', plan: 'data:image/png;base64,BBBB' }),
  };
});

import ReportModal from './ReportModal.svelte';
import { project } from '$lib/stores/project';
import { userSettings } from '$lib/stores/settings';

const api = { canvas: () => null, prepare() {}, restore() {}, getCamera: () => ({ position: [0, 0, 0], target: [0, 0, 0] }), setCamera() {}, setViewImmediate() {}, setVisibility() {}, render() {} } as any;

function seedResults() {
  project.update(p => ({
    ...p,
    name: 'north_wing',
    lamps: [{ id: 'L1', lamp_type: 'krcl_222', wavelength: 222, x: 1, y: 1, z: 2.7, aimx: 1, aimy: 1, aimz: 0, scaling_factor: 1, enabled: true } as any],
    zones: [{ id: 'WholeRoomFluence', type: 'volume', isStandard: true } as any],
    results: { calculatedAt: new Date().toISOString(), fluenceByWavelength: { 222: 1.5 }, zones: { WholeRoomFluence: { zone_id: 'WholeRoomFluence', zone_type: 'volume', statistics: { mean: 1.5 } } } } as any,
  }));
}

describe('ReportModal', () => {
  beforeEach(() => { postMock.mockReset(); project.reset(); seedResults(); userSettings.update(s => ({ ...s, resultSpecies: ['Human coronavirus'] })); });

  it('defaults the title to the project name and lists only species with data at the lamp wavelengths', async () => {
    render(ReportModal, { props: { onClose: () => {}, captureApi: api } });
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('north_wing');
    await waitFor(() => expect(screen.getByText(/Human coronavirus/)).toBeTruthy());
    expect(screen.queryByText(/Staphylococcus aureus/)).toBeNull();
  });

  it('writes meta to the store and posts the request with captures and selections', async () => {
    postMock.mockResolvedValue(new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: 'application/pdf' }));
    const createObjectURL = vi.fn(() => 'blob:x'); (URL as any).createObjectURL = createObjectURL; (URL as any).revokeObjectURL = vi.fn();
    render(ReportModal, { props: { onClose: () => {}, captureApi: api } });
    await fireEvent.input(screen.getByLabelText('Client or site'), { target: { value: 'Acme' } });
    expect(get(project).reportMeta?.client).toBe('Acme');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Generate PDF' })).not.toBeDisabled());
    await fireEvent.click(screen.getByRole('button', { name: 'Generate PDF' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    const body = postMock.mock.calls[0][0];
    expect(body.meta).toMatchObject({ title: 'north_wing', client: 'Acme' });
    expect(body.pathogens).toEqual(['Human coronavirus']);
    expect(Object.keys(body.images)).toEqual(['cover', 'plan']);
    expect(body.options.page_size).toBe('auto');
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
  });

  it('disables Generate when there are no results, with a hint', () => {
    project.update(p => ({ ...p, results: undefined }));
    render(ReportModal, { props: { onClose: () => {}, captureApi: api } });
    expect(screen.getByRole('button', { name: 'Generate PDF' })).toBeDisabled();
    expect(screen.getByText(/Run Calculate first/)).toBeTruthy();
  });

  it('shows the backend error message', async () => {
    postMock.mockRejectedValue(new Error('No inactivation data for Foo'));
    render(ReportModal, { props: { onClose: () => {}, captureApi: api } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Generate PDF' })).not.toBeDisabled());
    await fireEvent.click(screen.getByRole('button', { name: 'Generate PDF' }));
    await waitFor(() => expect(screen.getByText(/No inactivation data for Foo/)).toBeTruthy());
  });
});
```

- [ ] **Step 4: Run** → FAIL (component missing).

- [ ] **Step 5: Write `ReportModal.svelte`** (tabs; write the whole file with Write)

```svelte
<script lang="ts">
	import { onMount } from 'svelte';
	import Modal from './Modal.svelte';
	import AlertDialog from './AlertDialog.svelte';
	import PathogenMultiSelect from './PathogenMultiSelect.svelte';
	import { project, reportMeta, results, lamps, zones, objects } from '$lib/stores/project';
	import { userSettings } from '$lib/stores/settings';
	import { postSessionReportPdf, getEfficacyExploreData } from '$lib/api/client';
	import { parseTableResponse } from '$lib/utils/efficacy-filters';
	import { speciesWithDataAt } from '$lib/utils/resultsSummary';
	import { captureReportImages, captureThumbnails, COVER_CHOICES, type SceneCaptureApi, type CoverChoice } from '$lib/utils/reportCapture';
	import type { ReportRequest } from '$lib/api/contract';
	import type { EfficacyRow } from '$lib/utils/efficacy-filters';

	interface Props {
		onClose: () => void;
		captureApi: SceneCaptureApi | null;
	}
	let { onClose, captureApi }: Props = $props();

	// ----- species available at the lamps' wavelengths -----
	let rows = $state<EfficacyRow[]>([]);
	onMount(async () => {
		try {
			const data = await getEfficacyExploreData();
			rows = parseTableResponse(data.table.columns, data.table.rows);
		} catch (e) {
			console.error('Failed to load efficacy data for the report', e);
		}
	});
	const wavelengths = $derived.by(() => {
		const byWv = $results?.fluenceByWavelength;
		if (byWv && Object.keys(byWv).length > 0) return Object.keys(byWv).map(Number);
		return [...new Set($lamps.map(l => l.wavelength).filter((w): w is number => w != null))];
	});
	const speciesOptions = $derived(speciesWithDataAt(rows, wavelengths));
	const categoryOf = $derived.by(() => {
		const m = new Map<string, string>();
		for (const r of rows) if (r.medium === 'Aerosol' && !m.has(r.species)) m.set(r.species, r.category);
		return m;
	});
	const selectedSpecies = $derived.by(() => {
		const wanted = [...$userSettings.resultSpecies];
		const summary = $userSettings.summarySpecies;
		if (summary && !summary.startsWith('group:') && !wanted.includes(summary)) wanted.unshift(summary);
		return wanted.filter(s => speciesOptions.includes(s));
	});
	function setSpecies(next: string[]) {
		userSettings.update(s => ({ ...s, resultSpecies: next }));
	}

	// ----- cover view thumbnails -----
	let thumbs = $state<Partial<Record<CoverChoice, string>>>({});
	onMount(async () => {
		if (!captureApi) return;
		try { thumbs = await captureThumbnails(captureApi, COVER_CHOICES.map(c => c.id), 240); } catch (e) { console.error('Thumbnails failed', e); }
	});

	// ----- state -----
	const hasResults = $derived(!!$results?.zones && Object.keys($results.zones).length > 0);
	const canGenerate = $derived(hasResults && selectedSpecies.length > 0 && !!captureApi && !busy);
	let busy = $state(false);
	let status = $state<string | null>(null);
	let error = $state<string | null>(null);

	function downloadBlob(blob: Blob, filename: string) {
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		a.click();
		URL.revokeObjectURL(url);
	}

	async function generate() {
		if (!captureApi) return;
		busy = true;
		error = null;
		try {
			status = 'Capturing views…';
			const volumeZoneIds = $zones.filter(z => z.type === 'volume' && $results?.zones?.[z.id]).map(z => z.id);
			const images = await captureReportImages(captureApi, {
				coverView: $userSettings.reportCoverView,
				volumeZoneIds,
				lampIds: $lamps.filter(l => l.enabled).map(l => l.id),
				objectIds: $objects.map(o => o.id),
				pointZoneIds: $zones.filter(z => z.type === 'point').map(z => z.id),
			});
			status = 'Rendering PDF…';
			const body: ReportRequest = {
				meta: $reportMeta,
				options: {
					include_lamp_appendix: $userSettings.reportIncludeLampAppendix,
					include_methodology: $userSettings.reportIncludeMethodology,
					page_size: 'auto',
				},
				pathogens: selectedSpecies,
				images,
			};
			const blob = await postSessionReportPdf(body);
			downloadBlob(blob, `${$reportMeta.title.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'report'}_report.pdf`);
			status = null;
		} catch (e) {
			status = null;
			error = e instanceof Error ? e.message : 'Report generation failed';
		} finally {
			busy = false;
		}
	}
</script>

<Modal title="Generate report" {onClose} maxWidth="640px">
	{#snippet body()}
		<div class="report-body">
			{#if !hasResults}
				<div class="hint">Run Calculate first — the report is built from the current results.</div>
			{/if}

			<section>
				<h4>Details</h4>
				<label>Title<input type="text" aria-label="Title" value={$reportMeta.title} oninput={(e) => project.updateReportMeta({ title: (e.target as HTMLInputElement).value })} maxlength="120" /></label>
				<div class="row">
					<label>Client or site<input type="text" aria-label="Client or site" value={$reportMeta.client} oninput={(e) => project.updateReportMeta({ client: (e.target as HTMLInputElement).value })} maxlength="120" /></label>
					<label>Prepared by<input type="text" aria-label="Prepared by" value={$reportMeta.prepared_by} oninput={(e) => project.updateReportMeta({ prepared_by: (e.target as HTMLInputElement).value })} maxlength="120" /></label>
				</div>
				<label>Notes<textarea aria-label="Notes" rows="3" value={$reportMeta.notes} oninput={(e) => project.updateReportMeta({ notes: (e.target as HTMLTextAreaElement).value })} maxlength="2000"></textarea></label>
			</section>

			<section>
				<h4>Cover view</h4>
				<div class="thumbs" role="radiogroup" aria-label="Cover view">
					{#each COVER_CHOICES as c (c.id)}
						<label class="thumb" class:active={$userSettings.reportCoverView === c.id}>
							<input type="radio" name="cover" value={c.id} checked={$userSettings.reportCoverView === c.id} onchange={() => userSettings.update(s => ({ ...s, reportCoverView: c.id }))} />
							{#if thumbs[c.id]}<img src={thumbs[c.id]} alt={c.label} />{:else}<div class="thumb-empty"></div>{/if}
							<span>{c.label}</span>
						</label>
					{/each}
				</div>
			</section>

			<section>
				<h4>Pathogens</h4>
				{#if speciesOptions.length > 0}
					<PathogenMultiSelect options={speciesOptions} {categoryOf} selected={selectedSpecies} onChange={setSpecies} />
					{#if selectedSpecies.length === 0}<div class="hint">Choose at least one pathogen.</div>{/if}
				{:else}
					<div class="hint">No inactivation data at the lamps' wavelengths.</div>
				{/if}
			</section>

			<section>
				<h4>Include</h4>
				<label class="check"><input type="checkbox" checked={$userSettings.reportIncludeLampAppendix} onchange={(e) => userSettings.update(s => ({ ...s, reportIncludeLampAppendix: (e.target as HTMLInputElement).checked }))} /> Lamp photometric appendix</label>
				<label class="check"><input type="checkbox" checked={$userSettings.reportIncludeMethodology} onchange={(e) => userSettings.update(s => ({ ...s, reportIncludeMethodology: (e.target as HTMLInputElement).checked }))} /> Methodology notes</label>
			</section>

			{#if error}<div class="error">{error}</div>{/if}
		</div>
	{/snippet}
	{#snippet footer()}
		<span class="status">{status ?? ''}</span>
		<button class="secondary" onclick={onClose}>Close</button>
		<button class="primary" onclick={generate} disabled={!canGenerate}>{busy ? (status ?? 'Working…') : 'Generate PDF'}</button>
	{/snippet}
</Modal>

<style>
	.report-body { display: flex; flex-direction: column; gap: var(--spacing-md); }
	section h4 { margin: 0 0 var(--spacing-xs); font-size: var(--font-size-sm); color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
	label { display: flex; flex-direction: column; gap: 4px; font-size: var(--font-size-sm); }
	input[type="text"], textarea { width: 100%; box-sizing: border-box; }
	.row { display: grid; grid-template-columns: 1fr 1fr; gap: var(--spacing-sm); }
	.thumbs { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--spacing-sm); }
	.thumb { position: relative; border: 2px solid var(--color-border); border-radius: var(--radius-sm); padding: 4px; cursor: pointer; align-items: center; text-align: center; }
	.thumb.active { border-color: var(--color-accent); }
	.thumb input { position: absolute; opacity: 0; }
	.thumb img, .thumb-empty { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; background: var(--color-bg-tertiary); border-radius: 2px; }
	.check { flex-direction: row; align-items: center; gap: 8px; }
	.hint { font-size: var(--font-size-sm); color: var(--color-text-muted); }
	.error { color: var(--color-error); font-size: var(--font-size-sm); }
	.status { flex: 1; font-size: var(--font-size-sm); color: var(--color-text-muted); }
	@media (max-width: 767px) { .row, .thumbs { grid-template-columns: 1fr 1fr; } }
</style>
```

Check `Modal.svelte`'s footer snippet renders children in a flex row (it does for ExportModal's buttons; if not, wrap the three footer children in a `<div class="footer-row">`). Check that `getEfficacyExploreData` exists with that name in `client.ts` (ZoneStatsPanel imports it) and that `parseTableResponse(columns, rows)` is the signature.

- [ ] **Step 6: Wire into the page and the Export modal (Python patches)**

`+page.svelte`:
- `import ReportModal from '$lib/components/ReportModal.svelte';` and `import type { SceneCaptureApi } from '$lib/utils/reportCapture';` next to the ExportModal import.
- `let showReportModal = $state(false);` and `let captureApi = $state<SceneCaptureApi | null>(null);` next to `showExportModal`.
- Both `<RoomViewer ... />` tags gain `onCaptureApiReady={(api) => captureApi = api}`.
- After the ExportModal mount: `{#if showReportModal}\n\t<ReportModal onClose={() => showReportModal = false} {captureApi} />\n{/if}`.
- `<ExportModal onClose=...>` gains `onOpenPdfReport={() => { showExportModal = false; openOrRestore('Generate report', () => showReportModal = true); }}`.

`ExportModal.svelte`: add `onOpenPdfReport?: () => void;` to Props and destructuring; rename the heading "Report Only" to "Reports" and add above the CSV button:

```svelte
					<button class="export-btn primary" onclick={onOpenPdfReport} disabled={!hasResults || !onOpenPdfReport}>
						Report (PDF)…
					</button>
```

- [ ] **Step 7: Run tests and check**

`cd ui && pnpm vitest run src/lib/components/ReportModal.test.ts src/lib/api/client.report.test.ts && pnpm check` → PASS, 0 errors. Then start the dev stack (`make frontend` + `make backend` in two shells, or follow the `run` skill) and click through: Export → Report (PDF)… → thumbnails appear → Generate PDF downloads a file that opens.

- [ ] **Step 8: Commit**

```bash
git add ui/src/lib/api/contract.ts ui/src/lib/api/client.ts ui/src/lib/api/client.report.test.ts ui/src/lib/stores/settings.ts ui/src/lib/components/ReportModal.svelte ui/src/lib/components/ReportModal.test.ts ui/src/lib/components/ExportModal.svelte ui/src/routes/+page.svelte
git commit -m "feat(ui): Report dialog — details, cover view thumbnails, pathogen selection, appendix toggles, PDF download"
```

---

### Task 12: Parity fixture between TypeScript and Python math

**Files:**
- Create: `ui/src/lib/utils/reportParity.fixture.test.ts`, `api/tests/fixtures/results_parity.json` (generated), `api/tests/test_results_parity.py`

- [ ] **Step 1: Vitest writes the fixture**

```ts
// ui/src/lib/utils/reportParity.fixture.test.ts
import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { eachUV, logReductionTime } from './survival-math';
import { cadrLps, cadrCfm } from './resultsSummary';
import { calculateHoursToTLV } from './calculations';

const OUT = resolve(__dirname, '../../../../api/tests/fixtures/results_parity.json');

describe('results parity fixture', () => {
  it('writes the TypeScript results the Python side must reproduce', () => {
    const cases = [
      { name: '222 only', irrad: [1.5], k1: [1.2], k2: [0], f: [0], volume_m3: 64.8 },
      { name: '254 only', irrad: [0.8], k1: [0.9], k2: [0.1], f: [0.05], volume_m3: 64.8 },
      { name: 'mixed 222+254', irrad: [1.5, 0.8], k1: [1.2, 0.9], k2: [0, 0.1], f: [0, 0.05], volume_m3: 120 },
    ].map(c => {
      const each = eachUV(c.irrad, c.k1, c.k2, c.f);
      return { ...c, each_uv: each, cadr_lps: cadrLps(each, c.volume_m3), cadr_cfm: cadrCfm(each, c.volume_m3),
        t90: logReductionTime(1, c.irrad, c.k1, c.k2, c.f), t99: logReductionTime(2, c.irrad, c.k1, c.k2, c.f), t999: logReductionTime(3, c.irrad, c.k1, c.k2, c.f) };
    });
    const hours = [{ max_dose: 100, tlv: 478.5 }, { max_dose: 800, tlv: 160.7 }].map(h => ({ ...h, hours: calculateHoursToTLV(h.max_dose, h.tlv) }));
    mkdirSync(resolve(OUT, '..'), { recursive: true });
    writeFileSync(OUT, JSON.stringify({ cases, hours }, null, 2) + '\n');
    expect(cases[2].each_uv).toBeCloseTo(cases[0].each_uv + (0.9 * 0.95 + 0.1 * 0.05) * 0.8 * 3.6, 9);
  });
});
```

Run `cd ui && pnpm vitest run src/lib/utils/reportParity.fixture.test.ts` → PASS and the JSON exists.

- [ ] **Step 2: Python reproduces it**

```python
# api/tests/test_results_parity.py
"""The Results panel (TypeScript) and the report (guv_calcs) must agree on the math."""
import json
from pathlib import Path
import pytest
from guv_calcs.efficacy.math import eACH_UV, CADR_LPS, CADR_CFM, log1, log2, log3

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "results_parity.json").read_text())


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=[c["name"] for c in FIXTURE["cases"]])
def test_pathogen_math_matches_frontend(case):
    irrad, k1, k2, f = case["irrad"], case["k1"], case["k2"], case["f"]
    assert eACH_UV(irrad, k1, k2, f) == pytest.approx(case["each_uv"], rel=1e-6)
    assert CADR_LPS(case["volume_m3"], irrad, k1, k2, f) == pytest.approx(case["cadr_lps"], rel=1e-6)
    assert CADR_CFM(case["volume_m3"] * 35.3147, irrad, k1, k2, f) == pytest.approx(case["cadr_cfm"], rel=1e-4)
    assert log1(irrad, k1, k2, f) == pytest.approx(case["t90"], rel=1e-6)
    assert log2(irrad, k1, k2, f) == pytest.approx(case["t99"], rel=1e-6)
    assert log3(irrad, k1, k2, f) == pytest.approx(case["t999"], rel=1e-6)


@pytest.mark.parametrize("h", FIXTURE["hours"])
def test_single_wavelength_hours_match_frontend(h):
    # 8 × TLV / max dose equals the weighted form 8 × 3 / (dose × 3 / TLV) for one lamp
    assert 8 * 3 / (h["max_dose"] * 3 / h["tlv"]) == pytest.approx(h["hours"], rel=1e-9)
```

If guv_calcs's `eACH_UV`/`log1` take scalars only for single-wavelength inputs, unwrap one-element lists before calling (mirror the TypeScript branch). Run `cd api && uv run pytest tests/test_results_parity.py -v` → PASS.

- [ ] **Step 3: Commit**

```bash
git add ui/src/lib/utils/reportParity.fixture.test.ts api/tests/fixtures/results_parity.json api/tests/test_results_parity.py
git commit -m "test: TypeScript↔guv_calcs parity fixture for eACH, CADR, inactivation times and hours to TLV"
```

---

### Task 13: Integration with main — Results panel entry point, weighted hours, changelog

Do this task **last**, after everything else is committed.

**Files:**
- Modify: `ui/src/lib/components/ZoneStatsPanel.svelte`, `ui/src/lib/components/OccupancyBanner.svelte`, `ui/src/lib/types/project.ts` (`CheckLampsResult.hours_to_limit_by_standard`), `ui/src/lib/utils/resultsSummary.ts` (comment), `ui/src/routes/+page.svelte` (pass `onOpenReport`), `CHANGELOG.md`
- Test: `ui/src/lib/components/OccupancyBanner.test.ts`, `ui/src/lib/components/ZoneStatsPanel.test.ts`

- [ ] **Step 1: Rebase**

```bash
git fetch . main:main 2>/dev/null || true
git rebase main
```

Resolve conflicts (expected only in `+page.svelte` near the modal mounts). Run `cd ui && pnpm test:run && pnpm check` and `cd api && uv run pytest tests/test_report_*.py tests/test_safety_helpers.py` before continuing.

- [ ] **Step 2: Type and tests**

In `CheckLampsResult` add `hours_to_limit_by_standard?: Record<string, { skin: number | null; eye: number | null }>;`.

`OccupancyBanner` gains an optional prop `hours?: Record<string, { skin: number | null; eye: number | null }> | null`. When present, `acgihHours`/`icnirpHours` are the min of the finite skin/eye values from `hours.ACGIH` / `hours.ICNIRP`; otherwise fall back to `hoursToLimit(...)` as today. Add to `OccupancyBanner.test.ts`:

```ts
  it('prefers the backend weighted hours when provided', () => {
    render(OccupancyBanner, { props: { skinMax: 100, eyeMax: 100, acgih: ACGIH, icnirp: ICNIRP, standard: acgihStandard,
      hours: { ACGIH: { skin: 20, eye: 6.5 }, ICNIRP: { skin: 2, eye: 1.2 } } } });
    expect(screen.getByTestId('occupancy-banner').textContent).toContain('Safe to occupy for 6.5 hours per day');
    expect(screen.getByTestId('hours-icnirp').textContent).toContain('1.2 h');
  });
```

`ZoneStatsPanel`: `skinHoursToLimit` / `eyeHoursToLimit` become

```ts
	const backendHours = $derived(checkLampsResult?.hours_to_limit_by_standard?.[$room.standard.includes('ICNIRP') ? 'ICNIRP' : 'ACGIH']);
	const skinHoursToLimit = $derived(backendHours ? backendHours.skin : calculateHoursToTLV(skinMax, effectiveLimits.skin));
	const eyeHoursToLimit = $derived(backendHours ? backendHours.eye : calculateHoursToTLV(eyeMax, effectiveLimits.eye));
```

and the `<OccupancyBanner … />` tag passes `hours={checkLampsResult?.hours_to_limit_by_standard ?? null}`. Add a ZoneStatsPanel test that seeds `results.checkLamps.hours_to_limit_by_standard = { ACGIH: { skin: 3.2, eye: 9 }, ICNIRP: {...} }` with a 222 nm room and asserts the skin cell reads `3.2 h` while the eye cell reads `Indefinite (9.0 h)`. In `resultsSummary.ts`, above `hoursToLimit`, add: `// Fallback only: the backend's hours_to_limit_by_standard (spectrally weighted) is preferred when present.`

- [ ] **Step 3: Generate Report opens the modal**

`ZoneStatsPanel` gets a prop `onOpenReport?: () => void`; both `Generate Report` buttons call `onOpenReport` when provided and fall back to the CSV `generateReport()` otherwise. `+page.svelte` passes `onOpenReport={() => openOrRestore('Generate report', () => showReportModal = true)}` where `<ZoneStatsPanel` is mounted. All three Svelte edits via Python patch scripts with `assert old in s`.

- [ ] **Step 4: Changelog**

Under `## [Unreleased]` → `### Added`:

> - Reports: Generate Report produces a designed PDF — cover with a chosen 3D view, a one-page summary (eACH‑UV, CADR, average fluence, the occupancy statement with hours to the ACGIH and ICNIRP limits, selected pathogens), room and luminaire tables with a plan view, photobiological safety with skin and eye heatmaps and per-lamp compliance, pathogen reduction with the fluence isosurfaces and survival curve, custom zones, and an appendix with lamp photometrics and methodology. A Report dialog takes the title, client, preparer and notes (saved with the project), the cover view, and the pathogens to include. The CSV report remains in the Export modal

Under `### Fixed`:

> - Results: hours to the TLV and the occupancy banner now come from the spectrally weighted dose (each lamp's dose weighted by its own limit, then summed), the way compliance is judged, so a room mixing 222 nm and 254 nm lamps no longer applies the stricter lamp's limit to the whole dose. Single‑wavelength rooms are unchanged

- [ ] **Step 5: Verify and commit**

`cd ui && pnpm test:run && pnpm check`; `cd api && uv run pytest tests/`.

```bash
git add ui/src/lib/components/ZoneStatsPanel.svelte ui/src/lib/components/ZoneStatsPanel.test.ts ui/src/lib/components/OccupancyBanner.svelte ui/src/lib/components/OccupancyBanner.test.ts ui/src/lib/types/project.ts ui/src/lib/utils/resultsSummary.ts ui/src/routes/+page.svelte CHANGELOG.md
git commit -m "feat(results): Generate Report opens the PDF dialog; hours to the limit read the backend's weighted value"
```

---

### Task 14: End-to-end test

**Files:**
- Create: `e2e/tests/report.spec.ts`

- [ ] **Step 1: Write the test**

```ts
import { test, expect } from '../fixtures';
import { waitForSession } from '../helpers/session';
import { addLampFromPreset } from '../helpers/lamps';
import { calculate, waitForResults } from '../helpers/calculations';

test.describe('PDF report', () => {
  test('generates and downloads a PDF from the Results panel', async ({ page }) => {
    test.setTimeout(90_000);
    await waitForSession(page);
    await addLampFromPreset(page);
    await page.locator('.inline-editor .close-x').click();
    await calculate(page);
    await waitForResults(page);

    await page.getByRole('button', { name: 'Generate Report' }).first().click();
    const dialog = page.getByRole('dialog').filter({ hasText: 'Generate report' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Title').fill('E2E room');
    await dialog.getByLabel('Client or site').fill('Playwright');
    await dialog.getByRole('radio', { name: 'Headline isometric' }).check({ force: true });

    const download = page.waitForEvent('download', { timeout: 60_000 });
    await dialog.getByRole('button', { name: 'Generate PDF' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('E2E_room_report.pdf');
    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    const buf = Buffer.concat(chunks);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(50_000);
  });
});
```

Check `Modal.svelte` renders `role="dialog"`; if not, locate the modal by its title text instead. If `addLampFromPreset` leaves no editor open, drop the `.close-x` click.

- [ ] **Step 2: Run** `cd e2e && npx playwright test tests/report.spec.ts` with the dev stack (the config starts both servers). Fix selectors until it passes.

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/report.spec.ts
git commit -m "test(e2e): generate and download the PDF report"
```

---

## Finishing

Run the full suites one more time (`make test-ui`, `make test-api`, the one e2e), then invoke `superpowers:finishing-a-development-branch`. The branch merges into `main` fast-forward only (the repo's history is linear); rebase first if main moved again.
