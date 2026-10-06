# Fixture Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users set which housing face the beam leaves, the emitter's 90° roll, and an arbitrary emitter offset — on custom-lamp upload and in the advanced Fixture tab — with a live 3D preview, backed natively by guv_calcs.

**Architecture:** guv_calcs `Fixture` gains `beam_face` / `roll` / `emitter_offset` and computes the housing box in a new housing frame rotated into the aim frame; lamp position stays the emitter so photometry is untouched. The API passes the fields through (with `photometric_depth` as a legacy alias). The UI gets a TS port of the box math and one shared `FixtureEditor` (controls + Threlte scene) used by `LampManagerModal` and `AdvancedLampTabFixture`.

**Tech Stack:** Python 3 / numpy (guv_calcs), FastAPI + pydantic (api), SvelteKit 5 runes + Threlte/three.js + vitest (ui), Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-10-05-fixture-editor-design.md`

## Global Constraints

- Lamp X/Y/Z remains the emitter (photometric center); no calculation result may change.
- Default fixture (`beam_face="bottom"`, `roll=0`, `emitter_offset=(0,0,0)`) reproduces today's housing box exactly; legacy `photometric_depth=d` ≡ `emitter_offset=(0,0,d)` on the bottom face.
- Housing corners keep guv's order: 0–3 at aim z-min (`[lo,lo],[hi,lo],[hi,hi],[lo,hi]` in x,y), 4–7 the same at z-max.
- Face tokens exactly: `bottom, top, front, back, left, right`; rolls exactly `0, 90, 180, 270`.
- guv_calcs: commit as you go in the guv-calcs worktree `$GC` on branch `fixture-editor` (user granted; never on guv-calcs main), laconic lowercase one-line messages, **no attribution trailers**, changelog under `[Unreleased]`; never push or release.
- Illuminate: no `Co-Authored-By`; `CHANGELOG.md` `[Unreleased]` entry with the user-facing commit; `pnpm check` zero errors; no `[DIAG]`; never inline `0.3048`; API types generated, never hand-written for new fields (alias from `api-types.ts` in `contract.ts`).
- `.svelte` files use tabs; never edit them with the Edit tool or sed — use the Write tool for whole files or a Python helper script in the scratchpad (`editing-svelte-files` skill).
- Every mutating session handler stays inside `with locked_session(session):`.
- Editor components must not mirror store state in local `$state` (the advanced modal's existing backend-settings draft is the established exception and is extended, not copied).

## Review Focus

1. **Legacy data** — a 0.8.1 `.guv` / lamp dict / `CustomLampDef` with `photometric_depth` / `photometricDepth` and no new keys loads with an identical box. Tests: Task 1 (`test_legacy_depth_equivalence`), Task 2 (`test_from_dict_legacy_fixture`), Task 6 (`migrates photometricDepth`).
2. **Unit switch** — switching the room from meters to feet converts `emitter_offset` with the housing. Tests: Task 2 (`test_set_units_converts_offset`), Task 4 (`test_set_units_converts_offset`).
3. **Negative / protruding offsets** — an emitter in front of its face (negative inward component) is accepted end to end and the box does not include the emitter. Tests: Task 1 (`test_protruding_emitter`), Task 4 (`test_negative_offset_accepted`).
4. **Preset / type rebuild and IES re-upload** — changing lamp type or re-uploading an IES keeps face/roll/offset. Tests: Task 4 (`test_survives_lamp_type_change`, `test_survives_ies_upload`).
5. **Session reinit** — after backend expiry the store re-applies the instance's face/roll/offset. Test: Task 6 (`reinit re-applies fixture layout`).

---

## Task 0: Workspace setup (no commit)

**Files:** none tracked.

Paths used below: `WT=/home/jvbelenky/illuminate-v2/.claude/worktrees/fixture-editor` (Illuminate worktree, branch `fixture-editor`), `GC=/home/jvbelenky/guv-calcs/.claude/worktrees/fixture-editor` (guv-calcs worktree, branch `fixture-editor`).

- [ ] **Step 1: Leave harness worktree isolation.** The session's worktree guard refuses git commands aimed at any other repo, so guv-calcs commits are impossible while isolated. Call `ExitWorktree` with `action: "keep"` (the Illuminate worktree stays on disk) and from then on run every command with explicit `cd $WT/...` or `cd $GC`.

- [ ] **Step 2: guv-calcs worktree** (user preference: cross-repo features commit in a matching guv-calcs worktree, never on its main; never push/release):

```bash
cd /home/jvbelenky/guv-calcs
grep -qx '.claude/worktrees/' .git/info/exclude || echo '.claude/worktrees/' >> .git/info/exclude
git worktree add .claude/worktrees/fixture-editor -b fixture-editor main
```

- [ ] **Step 3: API venv.** The committed `api/uv.lock` points at PyPI; use the user's uncommitted editable lock, then shadow the editable `~/guv-calcs` with the worktree via `PYTHONPATH` on **every** api/guv-calcs Python command:

```bash
cd $WT/api
cp /home/jvbelenky/illuminate-v2/api/uv.lock uv.lock   # editable lock; never commit it
uv sync --frozen
PYTHONPATH=$GC/src uv run --frozen python -c "import guv_calcs; print(guv_calcs.__file__)"
```
Expected: `$GC/src/guv_calcs/__init__.py`. Restore with `git checkout api/uv.lock` before any commit that might stage it.

- [ ] **Step 4: UI deps.** `cd $WT/ui && pnpm install --frozen-lockfile`; `cd $WT/e2e && npm ci`.

- [ ] **Step 5: Baselines.** `cd $GC && PYTHONPATH=$GC/src uv run --frozen --project $WT/api pytest -q tests/test_fixture.py tests/test_lamp_geometry.py tests/test_lamp_placement.py tests/test_photometric_axis.py` — PASS. `cd $WT/api && PYTHONPATH=$GC/src uv run --frozen pytest -q tests/test_photometric_axis.py` — PASS. `cd $WT/ui && pnpm test:run && pnpm check` — PASS / 0 errors.

---

## Task 1: guv_calcs — `HousingFace` and the new `Fixture`

**Files:**
- Modify: `$GC/src/guv_calcs/lamp/fixture.py`
- Modify: `$GC/src/guv_calcs/lamp/__init__.py` (export `HousingFace`)
- Modify: `$GC/src/guv_calcs/__init__.py` (export `HousingFace` next to `Fixture` if `Fixture` is exported there)
- Test: `$GC/tests/test_fixture.py`

**Interfaces:**
- Produces:
  - `HousingFace(ParseableEnum)` with members `BOTTOM..RIGHT`, `.normal -> np.ndarray` (outward, housing frame), `.rotation -> np.ndarray` (3×3, face→aim).
  - `Fixture(housing_width=0, housing_length=0, housing_height=0, beam_face=None, roll=0, emitter_offset=None, shape=RECTANGULAR, photometric_depth=None)`; fields `beam_face: HousingFace`, `roll: int`, `emitter_offset: tuple[float, float, float]`.
  - `Fixture.housing_matrix -> (3,3)`, `Fixture.photometric_depth -> float`, `Fixture.emitter_position() -> (3,)`, `Fixture.aim_bounds(surface_height=0.0) -> (lo, hi)`, `Fixture.aim_corners(surface_height=0.0) -> (8,3)`, `Fixture.aim_to_housing_extents(length, width, height) -> (L, W, H)`, `Fixture.with_photometric_depth(depth) -> Fixture`.

- [ ] **Step 1: Write the failing tests** (append to `tests/test_fixture.py`):

```python
import itertools
import numpy as np
from guv_calcs.lamp import Fixture, FixtureShape, HousingFace

FACES = ["bottom", "top", "front", "back", "left", "right"]


class TestHousingFace:
    @pytest.mark.parametrize("face", FACES)
    def test_rotation_sends_outward_normal_to_beam(self, face):
        f = HousingFace.from_any(face)
        np.testing.assert_allclose(f.rotation @ f.normal, [0, 0, -1], atol=1e-12)

    @pytest.mark.parametrize("token,face", [("-z", "bottom"), ("+z", "top"), ("+x", "front"),
                                             ("-x", "back"), ("+y", "left"), ("-y", "right")])
    def test_axis_aliases(self, token, face):
        assert HousingFace.from_token(token) is HousingFace(face)

    def test_default_bottom(self):
        assert HousingFace.from_any(None) is HousingFace.BOTTOM

    def test_unknown_raises(self):
        with pytest.raises(ValueError):
            HousingFace.from_token("sideways")


class TestFixtureLayout:
    def test_defaults(self):
        f = Fixture()
        assert f.beam_face is HousingFace.BOTTOM
        assert f.roll == 0
        assert f.emitter_offset == (0.0, 0.0, 0.0)
        np.testing.assert_array_equal(f.housing_matrix, np.eye(3))

    def test_roll_normalised_and_validated(self):
        assert Fixture(roll=450).roll == 90
        assert Fixture(roll=-90).roll == 270
        with pytest.raises(ValueError):
            Fixture(roll=45)

    def test_offset_must_have_three_components(self):
        with pytest.raises(ValueError):
            Fixture(emitter_offset=(0.0, 1.0))

    def test_all_24_orientations_distinct(self):
        mats = {Fixture(beam_face=f, roll=r).housing_matrix.round(6).tobytes()
                for f in FACES for r in (0, 90, 180, 270)}
        assert len(mats) == 24

    def test_legacy_depth_equivalence(self):
        # today's box: z from -d to h-d, xy centered
        f = Fixture(housing_width=0.2, housing_length=0.4, housing_height=0.1, photometric_depth=0.03)
        assert f.emitter_offset == pytest.approx((0.0, 0.0, 0.03))
        assert f.photometric_depth == pytest.approx(0.03)
        lo, hi = f.aim_bounds()
        np.testing.assert_allclose(lo, [-0.2, -0.1, -0.03], atol=1e-12)
        np.testing.assert_allclose(hi, [0.2, 0.1, 0.07], atol=1e-12)

    def test_corner_order_matches_legacy(self):
        f = Fixture(housing_width=0.2, housing_length=0.4, housing_height=0.1)
        c = f.aim_corners()
        hl, hw = 0.2, 0.1
        expected = [[-hl, -hw, 0], [hl, -hw, 0], [hl, hw, 0], [-hl, hw, 0],
                    [-hl, -hw, 0.1], [hl, -hw, 0.1], [hl, hw, 0.1], [-hl, hw, 0.1]]
        np.testing.assert_allclose(c, expected, atol=1e-12)

    def test_surface_height_unions_along_aim(self):
        f = Fixture(housing_width=0.2, housing_length=0.2, housing_height=0.1)
        lo, hi = f.aim_bounds(surface_height=0.3)
        assert lo[2] == pytest.approx(-0.15)
        assert hi[2] == pytest.approx(0.15)

    def test_front_face_box(self):
        # 0.4 L x 0.2 W x 0.1 H box, beam out of +x face, emitter flush:
        # the whole box lies behind the emitter along aim +z, 0.4 deep
        f = Fixture(housing_width=0.2, housing_length=0.4, housing_height=0.1, beam_face="front")
        lo, hi = f.aim_bounds()
        assert lo[2] == pytest.approx(0.0)
        assert hi[2] == pytest.approx(0.4)
        assert sorted([hi[0] - lo[0], hi[1] - lo[1]]) == pytest.approx([0.1, 0.2])

    def test_offset_moves_box_opposite(self):
        base = Fixture(housing_width=0.2, housing_length=0.4, housing_height=0.1)
        moved = Fixture(housing_width=0.2, housing_length=0.4, housing_height=0.1,
                        emitter_offset=(0.15, 0.0, 0.0))
        lo0, _ = base.aim_bounds()
        lo1, _ = moved.aim_bounds()
        assert lo1[0] == pytest.approx(lo0[0] - 0.15)

    def test_protruding_emitter(self):
        # emitter 5 cm in front of the bottom face: box starts 5 cm behind it
        f = Fixture(housing_width=0.2, housing_length=0.2, housing_height=0.1, emitter_offset=(0, 0, -0.05))
        lo, hi = f.aim_bounds()
        assert f.photometric_depth == pytest.approx(-0.05)
        assert lo[2] == pytest.approx(0.05)
        assert hi[2] == pytest.approx(0.15)

    def test_with_photometric_depth_keeps_in_plane_offset(self):
        f = Fixture(housing_height=0.1, beam_face="front", emitter_offset=(0.0, 0.02, 0.03))
        g = f.with_photometric_depth(0.01)
        # front face inward normal is -x
        assert g.emitter_offset == pytest.approx((-0.01, 0.02, 0.03))

    @pytest.mark.parametrize("face", FACES)
    @pytest.mark.parametrize("roll", [0, 90, 180, 270])
    def test_aim_to_housing_extents_round_trip(self, face, roll):
        f = Fixture(beam_face=face, roll=roll)
        L, W, H = f.aim_to_housing_extents(0.4, 0.2, 0.1)
        back = Fixture(housing_length=L, housing_width=W, housing_height=H, beam_face=face, roll=roll)
        lo, hi = back.aim_bounds()
        assert (hi - lo) == pytest.approx([0.4, 0.2, 0.1])

    def test_dict_round_trip(self):
        f = Fixture(housing_width=0.2, housing_length=0.4, housing_height=0.1,
                    beam_face="left", roll=270, emitter_offset=(0.01, -0.02, 0.03))
        d = f.to_dict()
        assert d["beam_face"] == "left" and d["roll"] == 270
        assert d["emitter_offset"] == [0.01, -0.02, 0.03]
        assert Fixture.from_dict(d) == f

    def test_from_dict_legacy(self):
        f = Fixture.from_dict({"housing_width": 0.2, "housing_length": 0.2, "housing_height": 0.1,
                               "photometric_depth": 0.05, "shape": "rectangular"})
        assert f.emitter_offset == pytest.approx((0.0, 0.0, 0.05))
```

- [ ] **Step 2: Run to verify failure.** `cd $GC && PYTHONPATH=$GC/src uv run --frozen --project $WT/api pytest -q tests/test_fixture.py` → FAIL (`ImportError: cannot import name 'HousingFace'`).

- [ ] **Step 3: Implement** in `lamp/fixture.py` (keep `FixtureShape` unchanged; replace the `Fixture` class):

```python
import itertools
from dataclasses import dataclass, replace
import numpy as np
from ..units import ParseableEnum
from .photometric_axis import _rot_y, _rot_z


def _rot_x(deg):
    a = np.radians(deg)
    return np.array([[1, 0, 0], [0, np.cos(a), -np.sin(a)], [0, np.sin(a), np.cos(a)]])


def _clean(m):
    return np.round(m, 12) + 0.0


class HousingFace(ParseableEnum):
    """Face of the housing the beam leaves through (housing frame)."""

    BOTTOM = "bottom"  # -z
    TOP = "top"        # +z
    FRONT = "front"    # +x
    BACK = "back"      # -x
    LEFT = "left"      # +y
    RIGHT = "right"    # -y

    @classmethod
    def _default(cls):
        return cls.BOTTOM

    @classmethod
    def from_token(cls, token):
        token = str(token).strip().lower()
        aliases = {"-z": "bottom", "+z": "top", "+x": "front", "-x": "back", "+y": "left", "-y": "right"}
        try:
            return cls(aliases.get(token, token))
        except ValueError:
            raise ValueError(f"Unknown HousingFace: {token}")

    @property
    def normal(self):
        """outward unit normal in the housing frame"""
        return np.array(_FACE_NORMALS[self], dtype=float)

    @property
    def rotation(self):
        """rotation taking this face's outward normal onto the aim direction (-z)"""
        return _FACE_ROTATIONS[self]


_FACE_NORMALS = {
    HousingFace.BOTTOM: (0, 0, -1), HousingFace.TOP: (0, 0, 1),
    HousingFace.FRONT: (1, 0, 0), HousingFace.BACK: (-1, 0, 0),
    HousingFace.LEFT: (0, 1, 0), HousingFace.RIGHT: (0, -1, 0),
}
_FACE_ROTATIONS = {
    HousingFace.BOTTOM: np.eye(3), HousingFace.TOP: _clean(_rot_x(180)),
    HousingFace.FRONT: _clean(_rot_y(90)), HousingFace.BACK: _clean(_rot_y(-90)),
    HousingFace.LEFT: _clean(_rot_x(-90)), HousingFace.RIGHT: _clean(_rot_x(90)),
}
_ROLLS = (0, 90, 180, 270)


@dataclass(frozen=True, slots=True, repr=False, init=False)
class Fixture:
    """
    Physical housing of a luminaire.

    Lamp position = photometric center = emitter. The housing is a box in its
    own frame (x = length, y = width, z = height); `beam_face` and `roll` say
    how that frame sits relative to the beam, and `emitter_offset` is the
    emitter's position in housing axes measured from the center of the beam
    face. Defaults reproduce the classic layout (box behind the emitting face).
    `photometric_depth` (legacy) sets the offset along the face's inward normal.
    """

    housing_width: float
    housing_length: float
    housing_height: float
    beam_face: HousingFace
    roll: int
    emitter_offset: tuple
    shape: FixtureShape

    def __init__(self, housing_width=0.0, housing_length=0.0, housing_height=0.0,
                 beam_face=None, roll=0, emitter_offset=None,
                 shape=FixtureShape.RECTANGULAR, photometric_depth=None):
        face = HousingFace.from_any(beam_face)
        roll = int(round(float(roll or 0))) % 360
        if roll not in _ROLLS:
            raise ValueError(f"roll must be one of {_ROLLS}, got {roll}")
        if emitter_offset is None:
            offset = -face.normal * float(photometric_depth or 0.0)
        else:
            offset = np.asarray(emitter_offset, dtype=float).ravel()
            if offset.shape != (3,):
                raise ValueError(f"emitter_offset needs 3 components, got {emitter_offset!r}")
        set_ = object.__setattr__
        set_(self, "housing_width", float(housing_width or 0.0))
        set_(self, "housing_length", float(housing_length or 0.0))
        set_(self, "housing_height", float(housing_height or 0.0))
        set_(self, "beam_face", face)
        set_(self, "roll", roll)
        set_(self, "emitter_offset", tuple(float(v) + 0.0 for v in offset))
        set_(self, "shape", FixtureShape.from_any(shape))

    def __repr__(self):
        return (
            f"Fixture({self.housing_width}×{self.housing_length}×{self.housing_height}, "
            f"beam_face={self.beam_face.value!r}, roll={self.roll}, "
            f"emitter_offset={self.emitter_offset}, shape={self.shape.value!r})"
        )

    @property
    def housing_matrix(self):
        """rotation taking housing-frame vectors into the aim frame"""
        return _clean(_rot_z(self.roll) @ self.beam_face.rotation)

    @property
    def photometric_depth(self):
        """offset along the beam face's inward normal (negative = protruding)"""
        return float(-self.beam_face.normal @ np.array(self.emitter_offset)) + 0.0

    def with_photometric_depth(self, depth):
        """copy with only the inward-normal offset component replaced"""
        n = self.beam_face.normal
        off = np.array(self.emitter_offset)
        off = off - n * (off @ n) - n * float(depth)
        return replace(self, emitter_offset=tuple(off))

    def emitter_position(self):
        """emitter position in the housing frame, relative to the box center"""
        half = np.array([self.housing_length, self.housing_width, self.housing_height]) / 2
        return self.beam_face.normal * half + np.array(self.emitter_offset)

    def aim_bounds(self, surface_height=0.0):
        """(lo, hi) of the housing box in the aim frame, emitter at the origin"""
        half = np.array([self.housing_length, self.housing_width, self.housing_height]) / 2
        signs = np.array(list(itertools.product((-1, 1), repeat=3)), dtype=float)
        corners = signs * half - self.emitter_position()
        aim = corners @ self.housing_matrix.T
        lo, hi = aim.min(axis=0), aim.max(axis=0)
        if surface_height and surface_height > 0:
            lo[2] = min(lo[2], -surface_height / 2)
            hi[2] = max(hi[2], surface_height / 2)
        return lo + 0.0, hi + 0.0

    def aim_corners(self, surface_height=0.0):
        """8 box corners in the aim frame: 0-3 at z-min, 4-7 at z-max"""
        (x0, y0, z0), (x1, y1, z1) = self.aim_bounds(surface_height)
        return np.array([
            [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
            [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
        ])

    def aim_to_housing_extents(self, length, width, height):
        """map aim-frame (length, width, height) extents onto housing (L, W, H)"""
        ext = np.abs(self.housing_matrix.T) @ np.array([length, width, height], dtype=float)
        return (float(ext[0]), float(ext[1]), float(ext[2]))

    def to_dict(self) -> dict:
        """Serialize fixture state for persistence."""
        return {
            "housing_width": self.housing_width,
            "housing_length": self.housing_length,
            "housing_height": self.housing_height,
            "beam_face": self.beam_face.value,
            "roll": self.roll,
            "emitter_offset": list(self.emitter_offset),
            "photometric_depth": self.photometric_depth,
            "shape": self.shape.value,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Fixture":
        """Deserialize fixture; legacy dicts carry only photometric_depth."""
        keys = ("housing_width", "housing_length", "housing_height", "beam_face",
                "roll", "emitter_offset", "shape", "photometric_depth")
        kwargs = {k: data[k] for k in keys if data.get(k) is not None}
        if "emitter_offset" in kwargs:
            kwargs.pop("photometric_depth", None)
        return cls(**kwargs)

    @property
    def has_dimensions(self) -> bool:
        """True if fixture has non-zero housing dimensions."""
        return self.housing_width > 0 or self.housing_length > 0 or self.housing_height > 0
```

Drop the now-unused `init_from_dict` import. Export `HousingFace` from `lamp/__init__.py` (import line + `__all__`) and from the package root if `Fixture` is exported there.

- [ ] **Step 4: Run tests.** Same command → PASS. Also run `tests/test_lamp_geometry.py tests/test_photometric_axis.py` → PASS (Lamp still passes `photometric_depth=` to `Fixture`, which the new `__init__` accepts).

- [ ] **Step 5: Commit (guv-calcs).**

```bash
cd $GC && git add src/guv_calcs/lamp/fixture.py src/guv_calcs/lamp/__init__.py src/guv_calcs/__init__.py tests/test_fixture.py
git commit -m "fixture: beam face, roll and emitter offset; housing box in its own frame"
```

---

## Task 2: guv_calcs — wire the layout through `Lamp` / `LampGeometry`

**Files:**
- Modify: `$GC/src/guv_calcs/lamp/lamp_geometry.py` (`get_bounding_box_corners`)
- Modify: `$GC/src/guv_calcs/lamp/lamp.py` (constructor, `from_dict` flatten block ~:333, `from_keyword` fixture cfg ~:400, `set_units` ~:1003, new `update_fixture`)
- Test: `$GC/tests/test_lamp_geometry.py`

**Interfaces:**
- Consumes: Task 1 `Fixture` API.
- Produces: `Lamp(..., beam_face=None, housing_roll=None, emitter_offset=None, photometric_depth=0.0)`; `Lamp.update_fixture(**changes) -> Lamp` (keys: any `Fixture` field name, plus `photometric_depth`; `None` values are ignored).

- [ ] **Step 1: Failing tests** (append to `tests/test_lamp_geometry.py`):

```python
import numpy as np
import pytest
from guv_calcs import Lamp


class TestFixtureLayoutOnLamp:
    def _lamp(self, **kw):
        return Lamp(lamp_id="t", x=1, y=1, z=2, housing_width=0.2, housing_length=0.4,
                    housing_height=0.1, **kw)

    def test_bbox_uses_layout(self):
        lamp = self._lamp(beam_face="front")
        corners = lamp.geometry.get_bounding_box_corners()
        # aimed down: aim +z is world +z, so the 0.4 deep box sits above the emitter
        assert corners[:, 2].min() == pytest.approx(2.0)
        assert corners[:, 2].max() == pytest.approx(2.4)

    def test_constructor_kwargs(self):
        lamp = self._lamp(beam_face="left", housing_roll=90, emitter_offset=(0.01, 0.0, 0.02))
        f = lamp.fixture
        assert (f.beam_face.value, f.roll, f.emitter_offset) == ("left", 90, (0.01, 0.0, 0.02))

    def test_update_fixture_partial(self):
        lamp = self._lamp()
        lamp.update_fixture(beam_face="top", housing_length=None)
        assert lamp.fixture.beam_face.value == "top"
        assert lamp.fixture.housing_length == pytest.approx(0.4)

    def test_update_fixture_depth_alias(self):
        lamp = self._lamp(emitter_offset=(0.05, 0.0, 0.0))
        lamp.update_fixture(photometric_depth=-0.01)
        assert lamp.fixture.emitter_offset == pytest.approx((0.05, 0.0, -0.01))

    def test_to_dict_round_trip(self):
        lamp = self._lamp(beam_face="back", housing_roll=180, emitter_offset=(0.0, 0.01, -0.02))
        again = Lamp.from_dict(lamp.to_dict())
        assert again.fixture == lamp.fixture

    def test_from_dict_legacy_fixture(self):
        d = self._lamp().to_dict()
        d["fixture"] = {"housing_width": 0.2, "housing_length": 0.4, "housing_height": 0.1,
                        "photometric_depth": 0.03, "shape": "rectangular"}
        lamp = Lamp.from_dict(d)
        assert lamp.fixture.emitter_offset == pytest.approx((0.0, 0.0, 0.03))

    def test_set_units_converts_offset(self):
        lamp = self._lamp(emitter_offset=(0.3048, 0.0, 0.0))
        lamp.set_units("feet")
        assert lamp.fixture.emitter_offset[0] == pytest.approx(1.0)
        assert lamp.fixture.beam_face.value == "bottom"

    def test_default_housing_mapped_into_housing_frame(self):
        # no housing dims: housing defaults to the surface footprint in the aim frame
        lamp = Lamp(lamp_id="t", width=0.2, length=0.4, beam_face="front")
        lo, hi = lamp.fixture.aim_bounds()
        assert (hi - lo)[:2] == pytest.approx([0.4, 0.2])
```

(The `0.3048` literal is only in guv-calcs tests, not Illuminate; Illuminate's CI grep does not cover `~/guv-calcs`.)

- [ ] **Step 2: Run** → FAIL (`TypeError: unexpected keyword argument 'beam_face'`).

- [ ] **Step 3: Implement.**

`lamp_geometry.py` — replace the body of `get_bounding_box_corners` after the docstring (update the docstring to "housing box from Fixture.aim_corners, plus the luminous z-extent"):

```python
        local_corners = self._fixture.aim_corners(self._surface.height)
        world_corners = self._pose.transform_to_world(local_corners)
        return world_corners.T  # (8, 3)
```

`lamp.py` constructor — add parameters after `photometric_depth: float = 0.0,`:

```python
        beam_face=None,
        housing_roll=None,
        emitter_offset=None,
```

document them in the class docstring next to `photometric_depth`. In the housing-units block convert the offset too:

```python
            if emitter_offset is not None:
                emitter_offset = convert_length(h_units, target_units, *emitter_offset)
```

(check `convert_length` returns a tuple for several values — it does for `set_units`' 4-value call.) Replace both `Fixture(...)` constructions:

```python
        layout = dict(beam_face=beam_face, roll=housing_roll or 0,
                      emitter_offset=emitter_offset, photometric_depth=photometric_depth or 0.0)
        fixture = Fixture(
            housing_width=housing_width if housing_width is not None else (width or 0.0),
            housing_length=housing_length if housing_length is not None else (length or 0.0),
            housing_height=housing_height or 0.0,
            **layout,
        )
        ...
        if housing_width is None and housing_length is None:
            L, W, H = fixture.aim_to_housing_extents(self.surface.length, self.surface.width, 0.0)
            self.geometry._fixture = Fixture(
                housing_width=W, housing_length=L,
                housing_height=housing_height if housing_height is not None else H,
                **layout,
            )
```

New method in the "Surface" section near `set_units`:

```python
    def update_fixture(self, **changes):
        """Replace fixture fields (None = keep); photometric_depth sets the inward offset."""
        depth = changes.pop("photometric_depth", None)
        changes = {k: v for k, v in changes.items() if v is not None}
        fixture = replace(self.fixture, **changes)
        if depth is not None and "emitter_offset" not in changes:
            fixture = fixture.with_photometric_depth(depth)
        self.geometry._fixture = fixture
        return self
```

(`from dataclasses import replace` at the top of lamp.py.) Note `Fixture.__init__` parses tokens, so `replace(..., beam_face="top")` works.

`set_units` — replace the fixture rebuild:

```python
        if old_units != new_units:
            f = self.fixture
            hw, hl, hh, ox, oy, oz = convert_length(
                old_units, new_units,
                f.housing_width, f.housing_length, f.housing_height, *f.emitter_offset,
            )
            self.geometry._fixture = replace(
                f, housing_width=hw, housing_length=hl, housing_height=hh, emitter_offset=(ox, oy, oz)
            )
```

`from_dict` flatten block — after the `photometric_depth` line add:

```python
            data["beam_face"] = fixture_data.get("beam_face")
            data["housing_roll"] = fixture_data.get("roll")
            data["emitter_offset"] = fixture_data.get("emitter_offset")
```

`from_keyword` fixture cfg — extend the loop keys with `"beam_face", "emitter_offset"` and add `if fixture_cfg.get("roll") is not None: kwargs.setdefault("housing_roll", fixture_cfg["roll"])`.

Check `Lamp.__eq__` (lamp.py:195): if it compares `to_dict()` or fixtures, the new fields are covered automatically; if it lists fields explicitly, add the fixture comparison.

- [ ] **Step 4: Run** `tests/test_lamp_geometry.py tests/test_fixture.py tests/test_photometric_axis.py tests/test_lamp.py tests/test_io.py` → PASS.

- [ ] **Step 5: Commit (guv-calcs).** `git commit -m "lamp: beam_face/housing_roll/emitter_offset kwargs, update_fixture, unit conversion and serialization"`

---

## Task 3: guv_calcs — placement uses the real housing box; changelog

**Files:**
- Modify: `$GC/src/guv_calcs/lamp/lamp_placement.py` (`ceiling_offset`, `wall_clearance`)
- Modify: `$GC/CHANGELOG.md` (`[Unreleased]`)
- Test: `$GC/tests/test_lamp_placement.py`

**Interfaces:**
- Consumes: `Fixture.aim_bounds()`.

- [ ] **Step 1: Failing tests** (append to `TestLampPlacer`-style class or a new class):

```python
class TestPlacementWithLayout:
    def test_ceiling_offset_uses_box_behind_emitter(self):
        from guv_calcs import Lamp
        from guv_calcs.lamp.lamp_placement import LampPlacer, FIXTURE_MARGIN_M
        lamp = Lamp(lamp_id="t", housing_width=0.2, housing_length=0.2, housing_height=0.1,
                    emitter_offset=(0, 0, 0.04))  # recessed 4 cm: 6 cm of box behind it
        assert LampPlacer.ceiling_offset(lamp) == pytest.approx(0.06 + FIXTURE_MARGIN_M)

    def test_ceiling_offset_default_unchanged(self):
        from guv_calcs import Lamp
        from guv_calcs.lamp.lamp_placement import LampPlacer, FIXTURE_MARGIN_M
        lamp = Lamp(lamp_id="t", housing_width=0.2, housing_length=0.2, housing_height=0.1)
        assert LampPlacer.ceiling_offset(lamp) == pytest.approx(0.1 + FIXTURE_MARGIN_M)

    def test_wall_clearance_default_unchanged(self):
        from guv_calcs import Lamp
        from guv_calcs.lamp.lamp_placement import LampPlacer
        lamp = Lamp(lamp_id="t", housing_width=0.3, housing_length=0.2, housing_height=0.1)
        assert LampPlacer.wall_clearance(lamp) == pytest.approx((0.3**2 + 0.2**2) ** 0.5 / 2 + 0.05)

    def test_wall_clearance_grows_with_offset(self):
        from guv_calcs import Lamp
        from guv_calcs.lamp.lamp_placement import LampPlacer
        centered = Lamp(lamp_id="a", housing_width=0.2, housing_length=0.2, housing_height=0.1)
        off = Lamp(lamp_id="b", housing_width=0.2, housing_length=0.2, housing_height=0.1,
                   emitter_offset=(0.08, 0, 0))
        assert LampPlacer.wall_clearance(off) > LampPlacer.wall_clearance(centered)
```

- [ ] **Step 2: Run** → the offset tests FAIL.

- [ ] **Step 3: Implement**:

```python
    @staticmethod
    def ceiling_offset(lamp) -> float:
        """Distance below the ceiling: the housing's extent behind the emitter plus a margin."""
        m = _lamp_per_meter(lamp)
        fixture = getattr(lamp, "fixture", None)
        if fixture is not None and fixture.has_dimensions:
            _, hi = fixture.aim_bounds()
            if hi[2] > 0:
                return max(hi[2] + FIXTURE_MARGIN_M * m, WALL_OFFSET_M * m)
        return CEILING_OFFSET_M * m

    @staticmethod
    def wall_clearance(lamp) -> float:
        """Minimum distance from walls: farthest housing corner in plan plus half the depth behind."""
        m = _lamp_per_meter(lamp)
        fixture = getattr(lamp, "fixture", None)
        if fixture is None or not fixture.has_dimensions:
            return WALL_OFFSET_M * m
        lo, hi = fixture.aim_bounds()
        reach = float(np.hypot(max(-lo[0], hi[0]), max(-lo[1], hi[1])))
        return max(reach + max(hi[2], 0.0) / 2, WALL_OFFSET_M * m)
```

(import numpy as np at the top if not already.) Update the `get_placement` docstring's `offset`/`wall_clearance` lines to "from the housing box (Fixture.aim_bounds)".

- [ ] **Step 4: Run the whole guv-calcs suite** `PYTHONPATH=$GC/src uv run --frozen --project $WT/api pytest -q` → PASS.

- [ ] **Step 5: Changelog + commit.** Under `## [Unreleased]` in `$GC/CHANGELOG.md`:

```markdown
### Added
- Fixture.beam_face (HousingFace: bottom/top/front/back/left/right), Fixture.roll (0/90/180/270) and Fixture.emitter_offset (x, y, z from the beam face center, in housing axes, any sign): the housing box is described in its own frame and can sit anywhere relative to the emitter; Lamp(beam_face=, housing_roll=, emitter_offset=), Lamp.update_fixture(**changes), Fixture.aim_bounds()/aim_corners()/aim_to_housing_extents()

### Changed
- Fixture.photometric_depth is derived from emitter_offset (still accepted by Fixture(), Lamp() and from_dict, may be negative)
- LampPlacer.ceiling_offset and wall_clearance use the housing box's real extent around the emitter
```

`git add -A src tests CHANGELOG.md && git commit -m "placement uses the housing box around the emitter; changelog"`

---

## Task 4: API — schemas, handlers, OpenAPI

**Files:**
- Modify: `api/api/v1/session_schemas.py` (:76 tokens, :79 `SessionLampInput`, :350 `SessionLampUpdate`, :646 `SetUnitsLampCoords`, :784 `AdvancedLampSettingsResponse`, :871 `LoadedLamp`)
- Modify: `api/api/v1/session_helpers.py` (:290 `_create_lamp_from_input`, :641 `LoadedLamp` build)
- Modify: `api/api/v1/lamp_session_routers.py` (:205–300 rebuilds + PATCH, :743–770 IES upload default, :1301 advanced GET)
- Modify: `api/api/v1/session_core.py` (:279 set-units lamp coords)
- Regenerate: `api/openapi.json` (or wherever `export_openapi.py` writes), `ui/src/lib/api/generated/api-types.ts`
- Modify: `ui/src/lib/api/contract.ts` (aliases)
- Test: `api/tests/test_fixture_layout.py` (new)

**Interfaces:**
- Produces (wire format, all session units):
  - `HousingFaceToken = Literal["bottom","top","front","back","left","right"]`, `HousingRoll = Literal[0, 90, 180, 270]`, `EmitterOffset = tuple[float, float, float]`.
  - `SessionLampInput` / `SessionLampUpdate`: `beam_face: Optional[HousingFaceToken]`, `housing_roll: Optional[HousingRoll]`, `emitter_offset: Optional[EmitterOffset]`; `photometric_depth: Optional[float]` (no `ge=0`).
  - `AdvancedLampSettingsResponse` / `LoadedLamp`: `beam_face: HousingFaceToken = "bottom"`, `housing_roll: HousingRoll = 0`, `emitter_offset: EmitterOffset = (0.0, 0.0, 0.0)` (keep `photometric_depth`).
  - `SetUnitsLampCoords`: `emitter_offset: Optional[EmitterOffset] = None`.
  - TS (`contract.ts`): `HousingFaceToken`, `HousingRoll`, `EmitterOffset`.

- [ ] **Step 1: Failing tests** — `api/tests/test_fixture_layout.py`, reusing fixtures from `tests/test_photometric_axis.py` (`lamp_with_ies_session`, `custom_lamp_session`, `ies_file_bytes` live in `conftest.py`; confirm and import helpers the same way):

```python
"""Housing layout (beam face, roll, emitter offset) on session lamps."""

import pytest

from tests.conftest import API


def _advanced(client, headers, lamp_id):
    r = client.get(f"{API}/session/lamps/{lamp_id}/advanced-settings", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _patch(client, headers, lamp_id, body):
    r = client.patch(f"{API}/session/lamps/{lamp_id}", json=body, headers=headers)
    assert r.status_code == 200, r.text


class TestLayoutRoundTrip:
    def test_defaults(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        adv = _advanced(client, headers, lamp_id)
        assert adv["beam_face"] == "bottom"
        assert adv["housing_roll"] == 0
        assert adv["emitter_offset"] == [0.0, 0.0, 0.0]

    def test_patch_layout(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        _patch(client, headers, lamp_id, {"beam_face": "front", "housing_roll": 90,
                                           "emitter_offset": [0.01, -0.02, 0.03]})
        adv = _advanced(client, headers, lamp_id)
        assert (adv["beam_face"], adv["housing_roll"]) == ("front", 90)
        assert adv["emitter_offset"] == pytest.approx([0.01, -0.02, 0.03])

    def test_negative_offset_accepted(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        _patch(client, headers, lamp_id, {"photometric_depth": -0.02})
        adv = _advanced(client, headers, lamp_id)
        assert adv["photometric_depth"] == pytest.approx(-0.02)
        assert adv["emitter_offset"] == pytest.approx([0.0, 0.0, -0.02])

    def test_invalid_face_and_roll_422(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        for body in ({"beam_face": "side"}, {"housing_roll": 45}, {"emitter_offset": [0, 1]}):
            r = client.patch(f"{API}/session/lamps/{lamp_id}", json=body, headers=headers)
            assert r.status_code == 422, body

    def test_fixture_bounds_follow_layout(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        _patch(client, headers, lamp_id, {"housing_width": 0.1, "housing_length": 0.1,
                                           "housing_height": 0.1, "emitter_offset": [0, 0, -0.05]})
        web = client.get(f"{API}/session/lamps/{lamp_id}/photometric-web", headers=headers).json()
        zs = [c[2] for c in web["fixture_bounds"]]
        assert min(zs) == pytest.approx(0.05) and max(zs) == pytest.approx(0.15)

    def test_survives_lamp_type_change(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        _patch(client, headers, lamp_id, {"beam_face": "left", "emitter_offset": [0.0, 0.0, 0.01]})
        _patch(client, headers, lamp_id, {"lamp_type": "lp_254"})
        adv = _advanced(client, headers, lamp_id)
        assert adv["beam_face"] == "left"
        assert adv["emitter_offset"] == pytest.approx([0.0, 0.0, 0.01])

    def test_survives_ies_upload(self, custom_lamp_session, ies_file_bytes):
        client, headers, lamp_id = custom_lamp_session
        _patch(client, headers, lamp_id, {"beam_face": "top", "housing_roll": 180})
        r = client.post(f"{API}/session/lamps/{lamp_id}/ies",
                        files={"file": ("x.ies", ies_file_bytes, "application/octet-stream")},
                        headers=headers)
        assert r.status_code == 200, r.text
        adv = _advanced(client, headers, lamp_id)
        assert (adv["beam_face"], adv["housing_roll"]) == ("top", 180)

    def test_set_units_converts_offset(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        _patch(client, headers, lamp_id, {"emitter_offset": [0.1, 0.0, 0.0]})
        r = client.patch(f"{API}/session/units", json={"units": "centimeters"}, headers=headers)
        assert r.status_code == 200, r.text
        assert r.json()["lamps"][lamp_id]["emitter_offset"] == pytest.approx([10.0, 0.0, 0.0])

    def test_init_accepts_layout(self, client, session_headers, minimal_room_config):
        cfg = {**minimal_room_config}
        cfg["lamps"] = [{**cfg["lamps"][0], "beam_face": "back", "housing_roll": 270,
                         "emitter_offset": [0.0, 0.01, 0.0]}]
        r = client.post(f"{API}/session/init", json=cfg, headers=session_headers)
        assert r.status_code == 200, r.text

    def test_guv_round_trip(self, lamp_with_ies_session, client):
        client_, headers, lamp_id = lamp_with_ies_session
        _patch(client_, headers, lamp_id, {"beam_face": "right", "emitter_offset": [0.0, 0.0, 0.02]})
        saved = client_.get(f"{API}/session/save", headers=headers)
        assert saved.status_code == 200, saved.text
        # mirror test_photometric_axis.py::test_guv_round_trip for loading the saved .guv
```

Before writing `test_set_units_converts_offset`, `test_init_accepts_layout` and `test_guv_round_trip`, open `tests/test_photometric_axis.py::test_set_units_converts_depth`, `::test_init_accepts_fields` and `::test_guv_round_trip` and copy their exact request shapes (endpoint paths, response keys such as `lamps`, how the `.guv` is reloaded and what is asserted on the loaded lamp) — assert `beam_face`/`emitter_offset` on the loaded lamp the same way they assert `photometric_axis`.

- [ ] **Step 2: Run** `cd $WT/api && PYTHONPATH=$GC/src uv run --frozen pytest -q tests/test_fixture_layout.py` → FAIL.

- [ ] **Step 3: Implement.**

`session_schemas.py` next to `PhotometricAxisToken`:

```python
HousingFaceToken = Literal["bottom", "top", "front", "back", "left", "right"]
HousingRoll = Literal[0, 90, 180, 270]
EmitterOffset = tuple[float, float, float]
```

Add to `SessionLampInput` and `SessionLampUpdate` (replace the `photometric_depth` line):

```python
    photometric_depth: Optional[float] = None  # legacy alias: inward offset along the beam face normal
    beam_face: Optional[HousingFaceToken] = None
    housing_roll: Optional[HousingRoll] = None
    emitter_offset: Optional[EmitterOffset] = None
```

`AdvancedLampSettingsResponse` and `LoadedLamp` after `photometric_depth`:

```python
    beam_face: HousingFaceToken = "bottom"
    housing_roll: HousingRoll = 0
    emitter_offset: EmitterOffset = (0.0, 0.0, 0.0)
```

`SetUnitsLampCoords`: `emitter_offset: Optional[EmitterOffset] = None`.

`session_helpers.py` — add a shared helper (top-level, near `_create_lamp_from_input`) and use it everywhere a lamp's layout is read:

```python
def fixture_layout_kwargs(lamp) -> dict:
    """Lamp constructor kwargs that carry the photometric frame and housing layout."""
    f = lamp.fixture
    return {
        "photometric_axis": lamp.photometric_axis,
        "beam_face": f.beam_face,
        "housing_roll": f.roll,
        "emitter_offset": f.emitter_offset,
    }


def fixture_layout_fields(lamp) -> dict:
    """Response fields for the housing layout."""
    f = lamp.fixture
    return {
        "photometric_depth": float(f.photometric_depth),
        "beam_face": f.beam_face.value,
        "housing_roll": f.roll,
        "emitter_offset": tuple(float(v) for v in f.emitter_offset),
    }
```

In `_create_lamp_from_input`, after the `photometric_depth` line:

```python
    for key in ("beam_face", "housing_roll", "emitter_offset"):
        if getattr(lamp_input, key, None) is not None:
            axis_kwargs[key] = getattr(lamp_input, key)
```

In the `LoadedLamp(...)` build replace `photometric_depth=...` with `**fixture_layout_fields(lamp),`.

`lamp_session_routers.py`:
- In all four `Lamp(...)` rebuilds replace the two lines `photometric_axis=lamp.photometric_axis, photometric_depth=lamp.fixture.photometric_depth,` with `**fixture_layout_kwargs(lamp),` (import it from `.session_helpers`).
- Replace the "Apply housing dimensions / depth" block:

```python
            # Housing dimensions and layout (Fixture is frozen; update_fixture replaces it)
            lamp.update_fixture(
                housing_width=updates.housing_width,
                housing_length=updates.housing_length,
                housing_height=updates.housing_height,
                beam_face=updates.beam_face,
                roll=updates.housing_roll,
                emitter_offset=updates.emitter_offset,
                photometric_depth=updates.photometric_depth,
            )
```
- IES upload default (`else:` branch at ~:764); argument order is `(length, width, height)`:

```python
                L, W, H = old_fixture.aim_to_housing_extents(lamp.surface.length, lamp.surface.width, 0.0)
                lamp.geometry._fixture = dataclasses.replace(
                    old_fixture, housing_length=L, housing_width=W, housing_height=H
                )
```
(`import dataclasses` at the top) so face/roll/offset survive the upload.
- Advanced GET: replace `photometric_depth=float(lamp.fixture.photometric_depth),` with `**fixture_layout_fields(lamp),`.
- If `Fixture` is no longer referenced in the file, drop its import.

`session_core.py` set-units: add `emitter_offset=tuple(lamp.fixture.emitter_offset) if lamp.fixture else None,`.

- [ ] **Step 4: Run** `cd $WT/api && PYTHONPATH=$GC/src uv run --frozen pytest -q tests/test_fixture_layout.py tests/test_photometric_axis.py tests/test_save_load_export.py tests/test_length_units.py` → PASS.

- [ ] **Step 5: Regenerate the contract** (editable guv_calcs, so not `make generate-api`):

```bash
cd $WT/api && PYTHONPATH=$GC/src uv run --frozen python scripts/export_openapi.py && cd ../ui && pnpm generate:api
```

Add to `ui/src/lib/api/contract.ts` next to `PhotometricAxisToken`:

```ts
/** Housing face the beam leaves through (`SessionLampUpdate.beam_face`). */
export type HousingFaceToken = NonNullable<components['schemas']['SessionLampUpdate']['beam_face']>;

/** Emitter roll about the beam relative to the housing, degrees. */
export type HousingRoll = NonNullable<components['schemas']['SessionLampUpdate']['housing_roll']>;

/** Emitter position from the beam-face center in housing axes (x=length, y=width, z=height). */
export type EmitterOffset = NonNullable<components['schemas']['SessionLampUpdate']['emitter_offset']>;
```

Run `cd ui && pnpm check` → 0 errors.

- [ ] **Step 6: Commit.** `git add api/api api/tests/test_fixture_layout.py api/openapi.json ui/src/lib/api/generated ui/src/lib/api/contract.ts && git commit -m "feat(api): housing beam face, roll and emitter offset on session lamps"` (check `git status` first that `api/uv.lock` is **not** staged).

---

## Task 5: UI — housing geometry port + shared cases

**Files:**
- Create: `api/scripts/export_housing_cases.py`
- Create: `ui/src/lib/utils/housingGeometry.cases.json` (generated, committed)
- Create: `ui/src/lib/utils/housingGeometry.ts`
- Modify: `ui/src/lib/utils/photometricAxis.ts` (export `rotY`, `rotZ`, `mulMat3`, `clean`)
- Test: `ui/src/lib/utils/housingGeometry.test.ts`

**Interfaces:**
- Consumes: `HousingFaceToken`, `HousingRoll`, `EmitterOffset` (Task 4); `axisMatrix`, `Mat3`, `Vec3`, `Extents`, `PhotometricAxis` from `photometricAxis.ts`.
- Produces (`housingGeometry.ts`):
  - `HOUSING_FACES`, `FACE_LABELS: Record<HousingFaceToken, string>`, `HOUSING_ROLLS`.
  - `interface HousingLayout { length: number; width: number; height: number; face: HousingFaceToken; roll: HousingRoll; offset: EmitterOffset }`
  - `faceNormal(face): Vec3`, `housingMatrix(face, roll): Mat3`, `emitterPosition(h): Vec3`, `housingAimBounds(h, surfaceHeight?) => { lo: Vec3; hi: Vec3 }`, `housingAimCorners(h, surfaceHeight?) => number[][]`, `aimToHousingExtents(face, roll, e: Extents): Extents`, `matchFileFrame(axis) => { face; roll }`, `photometricDepthOf(face, offset): number`, `centerOffset(h): EmitterOffset`, `nextRoll(roll): HousingRoll`.
  - `interface FixtureDraft { axis: PhotometricAxis; housingWidth?: number; housingLength?: number; housingHeight?: number; face: HousingFaceToken; roll: HousingRoll; offset: EmitterOffset }`
  - `DEFAULT_LAYOUT = { face: 'bottom', roll: 0, offset: [0, 0, 0] }`.

- [ ] **Step 1: Case generator** `api/scripts/export_housing_cases.py`:

```python
"""Write housing-box cases from guv_calcs for the UI port's tests (ui/src/lib/utils/housingGeometry.cases.json)."""

import json
import pathlib

from guv_calcs.lamp import Fixture

FACES = ["bottom", "top", "front", "back", "left", "right"]
OUT = pathlib.Path(__file__).resolve().parents[2] / "ui/src/lib/utils/housingGeometry.cases.json"


def main():
    cases = []
    for face in FACES:
        for roll in (0, 90, 180, 270):
            for offset, surface_height in (((0.0, 0.0, 0.0), 0.0), ((0.03, -0.02, 0.01), 0.0), ((0.0, 0.0, -0.02), 0.05)):
                f = Fixture(housing_length=0.4, housing_width=0.2, housing_height=0.1,
                            beam_face=face, roll=roll, emitter_offset=offset)
                cases.append({
                    "face": face, "roll": roll, "offset": list(offset),
                    "length": 0.4, "width": 0.2, "height": 0.1, "surface_height": surface_height,
                    "matrix": f.housing_matrix.tolist(),
                    "corners": f.aim_corners(surface_height).round(12).tolist(),
                    "depth": f.photometric_depth,
                })
    OUT.write_text(json.dumps(cases, indent=1) + "\n")


if __name__ == "__main__":
    main()
```

Run: `cd $WT/api && PYTHONPATH=$GC/src uv run --frozen python scripts/export_housing_cases.py` → writes 72 cases.

- [ ] **Step 2: Failing tests** `ui/src/lib/utils/housingGeometry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import cases from './housingGeometry.cases.json';
import {
  housingMatrix, housingAimCorners, aimToHousingExtents, matchFileFrame,
  photometricDepthOf, centerOffset, emitterPosition, nextRoll, type HousingLayout
} from './housingGeometry';
import { axisMatrix, PHOTOMETRIC_AXES } from './photometricAxis';
import type { HousingFaceToken, HousingRoll, EmitterOffset } from '$lib/api/contract';

const close = (a: number[][], b: number[][]) =>
  a.forEach((row, i) => row.forEach((v, j) => expect(v).toBeCloseTo(b[i][j], 9)));

describe('housing geometry matches guv_calcs', () => {
  for (const c of cases) {
    const h: HousingLayout = {
      length: c.length, width: c.width, height: c.height,
      face: c.face as HousingFaceToken, roll: c.roll as HousingRoll, offset: c.offset as EmitterOffset,
    };
    it(`${c.face} roll ${c.roll} offset ${c.offset} s=${c.surface_height}`, () => {
      close(housingMatrix(h.face, h.roll), c.matrix);
      close(housingAimCorners(h, c.surface_height), c.corners);
      expect(photometricDepthOf(h.face, h.offset)).toBeCloseTo(c.depth, 9);
    });
  }
});

describe('matchFileFrame', () => {
  it.each(PHOTOMETRIC_AXES)('%s maps housing frame onto the file frame', (axis) => {
    const { face, roll } = matchFileFrame(axis);
    close(housingMatrix(face, roll), axisMatrix(axis));
  });
  it('down is the default layout', () => {
    expect(matchFileFrame('down')).toEqual({ face: 'bottom', roll: 0 });
  });
});

describe('helpers', () => {
  const h: HousingLayout = { length: 0.4, width: 0.2, height: 0.1, face: 'front', roll: 0, offset: [0, 0, 0] };
  it('centerOffset puts the emitter at the box center', () => {
    const p = emitterPosition({ ...h, offset: centerOffset(h) });
    p.forEach((v) => expect(v).toBeCloseTo(0, 12));
  });
  it('aimToHousingExtents inverts the rotation', () => {
    const e = aimToHousingExtents('front', 0, { length: 0.1, width: 0.2, height: 0.4 });
    expect(e).toEqual({ length: 0.4, width: 0.2, height: 0.1 });
  });
  it('nextRoll cycles', () => {
    expect([0, 90, 180, 270].map((r) => nextRoll(r as HousingRoll))).toEqual([90, 180, 270, 0]);
  });
});
```

Run `cd ui && pnpm vitest run src/lib/utils/housingGeometry.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** `ui/src/lib/utils/housingGeometry.ts`:

```ts
/**
 * Housing layout helpers, mirroring guv_calcs `Fixture` / `HousingFace`.
 *
 * Housing frame: x = housing length, y = width, z = height. `housingMatrix`
 * rotates housing-frame vectors into the aim frame (beam on -z, emitter at the
 * origin). Keep in step with guv_calcs/lamp/fixture.py; the shared cases in
 * housingGeometry.cases.json come from api/scripts/export_housing_cases.py.
 */
import type { EmitterOffset, HousingFaceToken, HousingRoll } from '$lib/api/contract';
import {
  applyMat3, axisMatrix, clean, mulMat3, rotY, rotZ, transposeMat3,
  type Extents, type Mat3, type PhotometricAxis, type Vec3
} from './photometricAxis';

export const HOUSING_FACES: readonly HousingFaceToken[] = ['bottom', 'top', 'front', 'back', 'left', 'right'];
export const HOUSING_ROLLS: readonly HousingRoll[] = [0, 90, 180, 270];

export const FACE_LABELS: Record<HousingFaceToken, string> = {
  bottom: 'Bottom', top: 'Top', front: 'Front', back: 'Back', left: 'Left', right: 'Right',
};

export interface HousingLayout {
  length: number;
  width: number;
  height: number;
  face: HousingFaceToken;
  roll: HousingRoll;
  offset: EmitterOffset;
}

/** Everything the fixture editor edits, in display units. */
export interface FixtureDraft {
  axis: PhotometricAxis;
  housingWidth?: number;
  housingLength?: number;
  housingHeight?: number;
  face: HousingFaceToken;
  roll: HousingRoll;
  offset: EmitterOffset;
}

export const DEFAULT_LAYOUT: Pick<FixtureDraft, 'face' | 'roll' | 'offset'> = { face: 'bottom', roll: 0, offset: [0, 0, 0] };

const NORMALS: Record<HousingFaceToken, Vec3> = {
  bottom: [0, 0, -1], top: [0, 0, 1], front: [1, 0, 0], back: [-1, 0, 0], left: [0, 1, 0], right: [0, -1, 0],
};

function rotX(deg: number): Mat3 {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return [[1, 0, 0], [0, c, -s], [0, s, c]];
}

const FACE_ROTATIONS: Record<HousingFaceToken, Mat3> = {
  bottom: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  top: clean(rotX(180)),
  front: clean(rotY(90)),
  back: clean(rotY(-90)),
  left: clean(rotX(-90)),
  right: clean(rotX(90)),
};

export function faceNormal(face: HousingFaceToken): Vec3 {
  return NORMALS[face];
}

export function housingMatrix(face: HousingFaceToken, roll: HousingRoll): Mat3 {
  return clean(mulMat3(rotZ(roll), FACE_ROTATIONS[face]));
}

export function emitterPosition(h: HousingLayout): Vec3 {
  const n = NORMALS[h.face];
  const half: Vec3 = [h.length / 2, h.width / 2, h.height / 2];
  return [0, 1, 2].map((i) => n[i] * half[i] + h.offset[i]) as Vec3;
}

export function housingAimBounds(h: HousingLayout, surfaceHeight = 0): { lo: Vec3; hi: Vec3 } {
  const m = housingMatrix(h.face, h.roll);
  const e = emitterPosition(h);
  const half: Vec3 = [h.length / 2, h.width / 2, h.height / 2];
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const p = applyMat3(m, [sx * half[0] - e[0], sy * half[1] - e[1], sz * half[2] - e[2]]);
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], p[i]);
      hi[i] = Math.max(hi[i], p[i]);
    }
  }
  if (surfaceHeight > 0) {
    lo[2] = Math.min(lo[2], -surfaceHeight / 2);
    hi[2] = Math.max(hi[2], surfaceHeight / 2);
  }
  // `+ 0` folds -0 into 0 so corners compare cleanly
  return { lo: lo.map((v) => v + 0) as Vec3, hi: hi.map((v) => v + 0) as Vec3 };
}

/** Eight corners in the aim frame, same order as guv_calcs `Fixture.aim_corners`. */
export function housingAimCorners(h: HousingLayout, surfaceHeight = 0): number[][] {
  const { lo: [x0, y0, z0], hi: [x1, y1, z1] } = housingAimBounds(h, surfaceHeight);
  return [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
}

/** Map aim-frame extents onto housing (length, width, height). */
export function aimToHousingExtents(face: HousingFaceToken, roll: HousingRoll, e: Extents): Extents {
  const mt = transposeMat3(housingMatrix(face, roll)).map((r) => r.map(Math.abs)) as Mat3;
  const [length, width, height] = applyMat3(mt, [e.length, e.width, e.height]);
  return { length, width, height };
}

/** The layout whose housing frame is the IES file's own frame. */
export function matchFileFrame(axis: PhotometricAxis): { face: HousingFaceToken; roll: HousingRoll } {
  const target = axisMatrix(axis);
  for (const face of HOUSING_FACES) {
    for (const roll of HOUSING_ROLLS) {
      const m = housingMatrix(face, roll);
      if (m.every((row, i) => row.every((v, j) => Math.abs(v - target[i][j]) < 1e-9))) return { face, roll };
    }
  }
  return { face: 'bottom', roll: 0 };
}

/** Offset along the face's inward normal (negative = emitter protrudes). */
export function photometricDepthOf(face: HousingFaceToken, offset: EmitterOffset): number {
  const n = NORMALS[face];
  return -(n[0] * offset[0] + n[1] * offset[1] + n[2] * offset[2]) + 0;
}

/** Offset that puts the emitter at the center of the housing. */
export function centerOffset(h: HousingLayout): EmitterOffset {
  const n = NORMALS[h.face];
  return [-n[0] * h.length / 2 + 0, -n[1] * h.width / 2 + 0, -n[2] * h.height / 2 + 0];
}

export function nextRoll(roll: HousingRoll): HousingRoll {
  return HOUSING_ROLLS[(HOUSING_ROLLS.indexOf(roll) + 1) % HOUSING_ROLLS.length];
}
```

In `photometricAxis.ts` add `export` to `rotY`, `rotZ`, `mulMat3`, `clean`. Leave `fixtureBoundsLocal` / `centeredDepth` in place; Task 7 deletes them together with their last caller.

- [ ] **Step 4: Run** the new test file + `photometricAxis.test.ts` → PASS; `pnpm check` → 0 errors.

- [ ] **Step 5: Commit.** `git add api/scripts/export_housing_cases.py ui/src/lib/utils/housingGeometry.* ui/src/lib/utils/photometricAxis.ts && git commit -m "feat(ui): housing layout geometry port with guv_calcs-generated cases"`

---

## Task 6: UI — data plumbing (types, library migration, store, API client)

**Files:**
- Modify: `ui/src/lib/types/lampLibrary.ts:32` (`housing`)
- Modify: `ui/src/lib/stores/lampLibrary.ts` (normalise defs on read)
- Modify: `ui/src/lib/types/project.ts:143` (`LampInstance`)
- Modify: `ui/src/lib/api/client.ts` (`AdvancedLampSettingsResponse` :611, `AdvancedLampUpdate` :637, lamp-input type :1170, `SetUnitsLampCoords` :1635)
- Modify: `ui/src/lib/api/schemas.ts:241` (`LoadedLamp` zod)
- Modify: `ui/src/lib/stores/project.ts` (:337–348 reinit, :490–500 session input, :694–718 `advancedFieldsFromDef`, :2145 `.guv` load, :2262–2280 `.guv` def import, :2810–2830 `applyCustomLamp`, set-units handler)
- Modify: `ui/src/lib/components/photometricWeb.ts:46` (cache key)
- Modify: `ui/src/lib/components/LampEditor.svelte:903`, `ui/src/routes/+page.svelte:1806` (store mirror after advanced save) — Python helper, tabs
- Test: `ui/src/lib/stores/lampLibrary.test.ts`, `ui/src/lib/stores/project.test.ts`, `ui/src/lib/components/photometricWeb.test.ts`

**Interfaces:**
- Consumes: contract aliases (Task 4), `DEFAULT_LAYOUT` (Task 5).
- Produces:
  - `CustomLampDef.housing?: { width?; length?; height?; beamFace?: HousingFaceToken; roll?: HousingRoll; offset?: EmitterOffset }` (units = `def.surface.units`; `photometricDepth` removed from the type, migrated on read).
  - `LampInstance.beam_face?: HousingFaceToken; housing_roll?: HousingRoll; emitter_offset?: EmitterOffset` (session units; undefined = default).
  - `AdvancedLampSettingsResponse` gains `beam_face`, `housing_roll`, `emitter_offset`; `AdvancedLampUpdate` gains the same as optionals — typed with the contract aliases.

- [ ] **Step 1: Failing tests.**

`lampLibrary.test.ts`, inside `describe('init', …)`:

```ts
    it('migrates a stored photometricDepth to an emitter offset', async () => {
      const stored = {
        id: 'legacy', name: 'Legacy', lampType: 'krcl_222', ies: { filename: 'db.ies', dataBase64: 'AA==' },
        scope: 'browser', contentHash: 'db-hash', createdAt: 'a', updatedAt: 'a',
        housing: { width: 0.2, photometricDepth: 0.03 },
      };
      mockGetAllLamps.mockResolvedValue([stored]);
      const { lampLibrary } = await import('./lampLibrary');
      await lampLibrary.init(false);
      expect(lampLibrary.get('legacy')?.housing).toEqual({ width: 0.2, offset: [0, 0, 0.03] });
    });
```

`project.test.ts` — update the four existing depth tests to the new fields:

- `'applyCustomLamp sends the photometric axis and depth (in session units) with the property update'` → rename to `'… axis and housing layout …'`; def `housing: { height: 12, beamFace: 'front', roll: 90, offset: [1, 0, -2] }`; expect `lamp.photometric_depth` toBeUndefined, `lamp.beam_face` 'front', `lamp.housing_roll` 90, `lamp.emitter_offset` ≈ `[0.01, 0, -0.02]` (toBeCloseTo per component); `advanced.beam_face` 'front', `advanced.housing_roll` 90, `advanced.emitter_offset[2]` toBeCloseTo(-0.02).
- the reinit-body test at ~:778 → `project.updateLamp(id, { photometric_axis: 'horizontal_90', beam_face: 'left', emitter_offset: [0, 0, 0.04] })`; expect `sent?.beam_face` 'left' and `sent?.emitter_offset` `[0, 0, 0.04]`.
- `"re-applies the lamp's own photometric axis and depth over the definition's on recovery"` (~:1355) → this is **Review Focus 5**: def `housing: { offset: [0, 0, 0.1] }`, `project.updateLamp(id, { photometric_axis: 'up', beam_face: 'left', emitter_offset: [0, 0, 0.05] })`; expect `reapply.beam_face` 'left', `reapply.emitter_offset` `[0, 0, 0.05]`, and `'photometric_depth' in reapply` false.
- the `.guv` link test at ~:2615 → extend `LampOverride` with `beam_face?: string; emitter_offset?: number[]` (spread into the response like `photometric_depth`); load `{ id: 'L0', photometric_axis: 'horizontal_0', beam_face: 'front', emitter_offset: [0, 0, 0.05] }`; expect `lamp.beam_face` 'front', `lamp.emitter_offset` `[0, 0, 0.05]`, `fields.housing?.beamFace` 'front', `fields.housing?.offset[2]` toBeCloseTo(0.05).

`photometricWeb.test.ts` — copy the existing cache-key test for axis/depth and assert the key changes when `emitter_offset` goes from undefined to `[0, 0, 0.01]` and when `beam_face` becomes `'top'`.

Run `pnpm vitest run src/lib/stores/lampLibrary.test.ts src/lib/stores/project.test.ts src/lib/components/photometricWeb.test.ts` → new tests FAIL.

- [ ] **Step 2: Implement.**

`types/lampLibrary.ts`:

```ts
  // Housing box (in surface units) and how the emitter sits in it; see
  // guv_calcs Fixture. Undefined layout fields mean bottom face, roll 0, flush.
  housing?: {
    width?: number;
    length?: number;
    height?: number;
    beamFace?: HousingFaceToken;
    roll?: HousingRoll;
    offset?: EmitterOffset;
  };
```

`stores/lampLibrary.ts` — add and apply in `init()` to both loops (`map.set(def.id, migrateDef(def))`):

```ts
/** Defs saved before the fixture editor stored `photometricDepth`; fold it into the offset. */
export function migrateDef(def: CustomLampDef): CustomLampDef {
  const housing = def.housing as (CustomLampDef['housing'] & { photometricDepth?: number }) | undefined;
  if (housing?.photometricDepth == null) return def;
  const { photometricDepth, ...rest } = housing;
  return { ...def, housing: { ...rest, offset: rest.offset ?? [0, 0, photometricDepth] } };
}
```

`types/project.ts` after `photometric_depth`:

```ts
  beam_face?: HousingFaceToken;        // housing face the beam leaves; undefined = 'bottom'
  housing_roll?: HousingRoll;          // undefined = 0
  emitter_offset?: EmitterOffset;      // session units, housing axes from the face center; undefined = flush
```

`client.ts` — add to `AdvancedLampSettingsResponse`: `beam_face: HousingFaceToken; housing_roll: HousingRoll; emitter_offset: EmitterOffset;`; to `AdvancedLampUpdate`, the session lamp input type (:1170) and `SetUnitsLampCoords` (:1646) the same as optionals (`emitter_offset?: EmitterOffset | null` on SetUnits). Import the aliases from `./contract`.

`schemas.ts` LoadedLamp zod: `beam_face: z.string().optional(), housing_roll: z.number().optional(), emitter_offset: z.array(z.number()).length(3).optional(),`.

`project.ts`:
- Reinit (:341): replace the `axisUpdate` construction with:

```ts
    const axisUpdate = {
      ...(adv ?? {}),
      photometric_axis: lamp.photometric_axis ?? def.photometricAxis ?? 'down',
      ...(lamp.beam_face != null ? { beam_face: lamp.beam_face } : {}),
      ...(lamp.housing_roll != null ? { housing_roll: lamp.housing_roll } : {}),
      ...(lamp.emitter_offset != null
        ? { emitter_offset: lamp.emitter_offset }
        : lamp.photometric_depth != null ? { photometric_depth: lamp.photometric_depth } : {}),
    };
```
- Session input (:498): add `beam_face: lamp.beam_face, housing_roll: lamp.housing_roll, emitter_offset: lamp.emitter_offset,`.
- `advancedFieldsFromDef`: replace the `photometricDepth` line with

```ts
  if (def.housing?.beamFace != null) adv.beam_face = def.housing.beamFace;
  if (def.housing?.roll != null) adv.housing_roll = def.housing.roll;
  if (def.housing?.offset != null) adv.emitter_offset = def.housing.offset.map(toSessionUnits) as EmitterOffset;
```
- `.guv` load (:2145): add `beam_face: lamp.beam_face as HousingFaceToken | undefined, housing_roll: lamp.housing_roll as HousingRoll | undefined, emitter_offset: lamp.emitter_offset as EmitterOffset | undefined,` — validate with `HOUSING_FACES.includes` / `HOUSING_ROLLS.includes` like `isPhotometricAxis` does for the axis.
- `.guv` def import (:2273): build `housing` from the loaded lamp's layout:

```ts
              housing: l.beam_face || l.housing_roll || l.emitter_offset?.some((v) => v !== 0)
                ? {
                    beamFace: l.beam_face as HousingFaceToken | undefined,
                    roll: l.housing_roll as HousingRoll | undefined,
                    offset: l.emitter_offset?.map((v) => convertLength(v, get(userSettings).units, 'meters')) as EmitterOffset | undefined,
                  }
                : undefined,
```
- `applyCustomLamp` (:2820): replace the `photometric_depth` assignment with

```ts
      partial.photometric_depth = undefined;
      partial.beam_face = def.housing?.beamFace ?? 'bottom';
      partial.housing_roll = def.housing?.roll ?? 0;
      partial.emitter_offset = (def.housing?.offset ?? [0, 0, 0])
        .map((v) => convertLength(v, defUnits, get(userSettings).units)) as EmitterOffset;
```
- Set-units handler: find where the `SetUnitsLampCoords` response is applied (grep `housing_height` / `source_depth` in `project.ts` and `routes/+page.svelte`); add `emitter_offset: coords.emitter_offset ?? undefined` next to where `photometric_depth` (or the source fields) are copied.
- Sync: grep `ui/src/lib/sync` for how a lamp property partial becomes a `PATCH` body (e.g. a key whitelist or `pick`). If there is a whitelist, add `beam_face`, `housing_roll`, `emitter_offset`; if the partial is sent whole, nothing to do. The reinit-body test above covers the init path; if a whitelist exists, also assert in the nearest existing sync PATCH test that `emitter_offset` reaches the body.

`photometricWeb.ts:46` — append `-${lamp.beam_face ?? 'bottom'}-${lamp.housing_roll ?? 0}-${(lamp.emitter_offset ?? [0, 0, 0]).join(',')}` to the key.

`LampEditor.svelte:903` and `+page.svelte:1806` — after `photometric_depth: updatedSettings.photometric_depth,` add (tabs, via a scratchpad Python script doing an exact-string replace):

```
					beam_face: updatedSettings.beam_face,
					housing_roll: updatedSettings.housing_roll,
					emitter_offset: updatedSettings.emitter_offset,
```

- [ ] **Step 3: Run** the three test files → PASS; full `pnpm test:run` → PASS; `pnpm check` → 0 errors. Fix any remaining `photometricDepth` references on `CustomLampDef.housing` that `pnpm check` reports (they are in `LampManagerModal.svelte` — keep the modal compiling by reading `def.housing?.offset?.[2]` there until Task 8 replaces the code).

- [ ] **Step 4: Commit.** `git commit -m "feat(ui): carry housing beam face, roll and emitter offset through library, store and sync"`

---

## Task 7: UI — `FixtureScene` + `FixtureEditor`; slim the axis picker

**Files:**
- Create: `ui/src/lib/components/FixtureScene.svelte`
- Create: `ui/src/lib/components/FixtureEditor.svelte`
- Create: `ui/src/lib/components/FixtureEditor.test.ts`
- Modify: `ui/src/lib/components/PhotometricAxisPicker.svelte` (controls only: drop the canvas, `fixtureBounds`, housing/depth props and the `SHOW_DEPTH` block)
- Modify: `ui/src/lib/components/PhotometricAxisPicker.test.ts` (drop canvas/depth tests incl. the `describe.skip` block)
- Delete: `ui/src/lib/components/PhotometricAxisScene.svelte`
- Modify: `ui/src/lib/utils/photometricAxis.ts` (now delete `fixtureBoundsLocal`, `FixtureBoundsInput`, `centeredDepth` + their tests)

**Interfaces:**
- Consumes: Task 5 helpers and `FixtureDraft`; `IesAnalysisResponse`; `lampLocalToThree`, `luminousOpeningPlaneArgs`; `axisMatrix`, `guvToThreeMatrix`; `toMeters`, `unitAbbrev`, `unitFineStep`.
- Produces:
  - `PhotometricAxisPicker` props: `{ analysis, axis, onAxisChange }`.
  - `FixtureScene` props: `{ layout: HousingLayout /* meters */; axis: PhotometricAxis; surfaceLength: number; surfaceWidth: number /* meters */; web: { vertices: number[][]; triangles: number[][] } | null }`.
  - `FixtureEditor` props: `{ value: FixtureDraft; onchange: (next: FixtureDraft) => void; analysis: IesAnalysisResponse | null; units: LengthUnit; fallbackHousing: Extents | null /* display units, used when a housing dim is unset */; surface: { width: number; length: number } | null /* display units */ }`. Element ids/test hooks: `#housing-width|length|height`, `button[data-face=<token>]` with `aria-pressed`, `button.rotate-emitter`, `#emitter-offset-x|y|z`, `button.offset-flush`, `button.offset-center`, `.fixture-canvas`.

- [ ] **Step 1: Failing tests** `FixtureEditor.test.ts` (Threlte's `Canvas` is mocked in other component tests — copy the `vi.mock('@threlte/core', …)` / `vi.mock('./FixtureScene.svelte', …)` pattern from `PhotometricAxisPicker.test.ts`):

```ts
import { render, screen, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';
import FixtureEditor from './FixtureEditor.svelte';
import type { FixtureDraft } from '$lib/utils/housingGeometry';

const base: FixtureDraft = {
  axis: 'down', housingWidth: 0.2, housingLength: 0.4, housingHeight: 0.1,
  face: 'bottom', roll: 0, offset: [0, 0, 0],
};

function setup(over: Partial<FixtureDraft> = {}) {
  const onchange = vi.fn();
  render(FixtureEditor, {
    props: { value: { ...base, ...over }, onchange, analysis: null, units: 'meters', fallbackHousing: null, surface: null },
  });
  return onchange;
}

describe('FixtureEditor', () => {
  it('marks the current face pressed', () => {
    setup({ face: 'front' });
    expect(document.querySelector('[data-face="front"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('[data-face="bottom"]')!.getAttribute('aria-pressed')).toBe('false');
  });

  it('picking a face emits it and keeps the rest', async () => {
    const onchange = setup();
    await fireEvent.click(document.querySelector('[data-face="left"]')!);
    expect(onchange).toHaveBeenCalledWith({ ...base, face: 'left' });
  });

  it('rotate emitter steps the roll', async () => {
    const onchange = setup({ roll: 270 });
    await fireEvent.click(document.querySelector('button.rotate-emitter')!);
    expect(onchange).toHaveBeenCalledWith({ ...base, roll: 0 });
  });

  it('accepts a negative offset', async () => {
    const onchange = setup();
    const z = document.querySelector('#emitter-offset-z') as HTMLInputElement;
    await fireEvent.input(z, { target: { value: '-0.02' } });
    await fireEvent.change(z, { target: { value: '-0.02' } });
    expect(onchange).toHaveBeenLastCalledWith({ ...base, offset: [0, 0, -0.02] });
  });

  it('center snaps the emitter to the box center', async () => {
    const onchange = setup({ face: 'front' });
    await fireEvent.click(document.querySelector('button.offset-center')!);
    expect(onchange).toHaveBeenCalledWith({ ...base, face: 'front', offset: [-0.2, 0, 0] });
  });

  it('flush zeroes the offset', async () => {
    const onchange = setup({ offset: [0.1, 0.1, 0.1] });
    await fireEvent.click(document.querySelector('button.offset-flush')!);
    expect(onchange).toHaveBeenCalledWith({ ...base, offset: [0, 0, 0] });
  });

  it('clearing a housing dim emits undefined and shows the fallback as placeholder', async () => {
    const onchange = vi.fn();
    render(FixtureEditor, {
      props: { value: { ...base, housingHeight: undefined }, onchange, analysis: null, units: 'meters',
               fallbackHousing: { length: 0.4, width: 0.2, height: 0.05 }, surface: null },
    });
    expect((document.querySelector('#housing-height') as HTMLInputElement).placeholder).toBe('0.05');
  });
});
```

Match the input-commit event to how the component commits (below it commits on `change`; adjust the test's events to that). Run → FAIL.

- [ ] **Step 2: Slim `PhotometricAxisPicker.svelte`** (Write the whole file): keep `GROUPS`, `scores`, `group`, `suggestedGroup`, `pickGroup`, `handleAzimuthChange`, the group buttons and the azimuth row with their styles; remove the `Canvas`/scene import, the `fixtureBounds` derivation, the canvas markup, `SHOW_DEPTH`, the depth block, and the `depth`/`housing*`/`units`/`onDepthChange` props and their styles. Update its tests accordingly (delete the `describe.skip` depth block and any canvas-placeholder tests; those move to `FixtureEditor` as "Analyzing photometry…" placeholder below). Delete `PhotometricAxisScene.svelte`, `fixtureBoundsLocal`, `FixtureBoundsInput`, `centeredDepth` and their tests.

- [ ] **Step 3: `FixtureScene.svelte`** (Write tool, tabs). The housing frame is the scene frame (box upright, centered at the origin); an emitter group placed at the emitter and rotated aim→housing holds the emissive rectangle, the beam arrow and the web.

```svelte
<script lang="ts">
	import { T, useThrelte } from '@threlte/core';
	import { OrbitControls, Text, Billboard } from '@threlte/extras';
	import * as THREE from 'three';
	import { theme } from '$lib/stores/theme';
	import { lampLocalToThree, luminousOpeningPlaneArgs } from '$lib/utils/fixturePreviewGeometry';
	import { axisMatrix, guvToThreeMatrix, transposeMat3, type Mat3, type PhotometricAxis } from '$lib/utils/photometricAxis';
	import { emitterPosition, housingMatrix, type HousingLayout } from '$lib/utils/housingGeometry';

	interface Props {
		layout: HousingLayout;   // meters
		axis: PhotometricAxis;
		surfaceLength: number;   // meters
		surfaceWidth: number;    // meters
		web: { vertices: number[][]; triangles: number[][] } | null;  // IES frame
	}

	let { layout, axis, surfaceLength, surfaceWidth, web }: Props = $props();

	const { scene } = useThrelte();
	$effect(() => {
		scene.background = new THREE.Color($theme === 'light' ? '#d0d7de' : '#1a1a2e');
	});

	// Fit the larger of the housing and the emitter's reach into ~1 scene unit
	const scale = $derived.by(() => {
		const e = emitterPosition(layout);
		const r = Math.max(layout.length, layout.width, layout.height, surfaceLength, surfaceWidth,
			2 * Math.hypot(...e));
		return r > 0 ? 1 / r : 1;
	});

	function quat(m: Mat3): [number, number, number, number] {
		const t = guvToThreeMatrix(m);
		const m4 = new THREE.Matrix4().set(
			t[0][0], t[0][1], t[0][2], 0,
			t[1][0], t[1][1], t[1][2], 0,
			t[2][0], t[2][1], t[2][2], 0,
			0, 0, 0, 1
		);
		const q = new THREE.Quaternion().setFromRotationMatrix(m4);
		return [q.x, q.y, q.z, q.w];
	}

	// aim frame -> housing frame
	const emitterQuat = $derived(quat(transposeMat3(housingMatrix(layout.face, layout.roll))));
	const emitterPos = $derived(lampLocalToThree(emitterPosition(layout).map((v) => v * scale)));
	const webQuat = $derived(quat(axisMatrix(axis)));

	const boxGeometry = $derived.by(() => {
		const [hl, hw, hh] = [layout.length / 2, layout.width / 2, layout.height / 2].map((v) => v * scale);
		if (hl <= 0 && hw <= 0 && hh <= 0) return null;
		const c = [
			[-hl, -hw, -hh], [hl, -hw, -hh], [hl, hw, -hh], [-hl, hw, -hh],
			[-hl, -hw, hh], [hl, -hw, hh], [hl, hw, hh], [-hl, hw, hh],
		];
		const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
		const g = new THREE.BufferGeometry();
		const pos: number[] = [];
		for (const [a, b] of edges) pos.push(...lampLocalToThree(c[a]), ...lampLocalToThree(c[b]));
		g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
		return g;
	});

	// The web is shown at a fixed size so it reads next to any housing
	const webGeometry = $derived.by(() => {
		if (!web || web.vertices.length === 0) return null;
		let r = 0;
		for (const [x, y, z] of web.vertices) r = Math.max(r, Math.hypot(x, y, z));
		const k = 0.6 / (r || 1);
		const g = new THREE.BufferGeometry();
		const pos: number[] = [];
		for (const v of web.vertices) pos.push(...lampLocalToThree([v[0] * k, v[1] * k, v[2] * k]));
		g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
		if (web.triangles.length) g.setIndex(web.triangles.flat());
		g.computeVertexNormals();
		return g;
	});

	const opening = $derived(
		surfaceLength > 0 && surfaceWidth > 0
			? luminousOpeningPlaneArgs(surfaceWidth * scale, surfaceLength * scale)
			: ([0.08, 0.08] as [number, number])
	);

	const beamGeometry = (() => {
		const g = new THREE.BufferGeometry();
		g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, -0.9, 0], 3));
		return g;
	})();

	const labels = $derived([
		{ text: 'L', at: lampLocalToThree([(layout.length / 2) * scale + 0.08, 0, 0]) },
		{ text: 'W', at: lampLocalToThree([0, (layout.width / 2) * scale + 0.08, 0]) },
		{ text: 'H', at: lampLocalToThree([0, 0, (layout.height / 2) * scale + 0.08]) },
	]);

	const webColor = $derived($theme === 'light' ? '#7a3fd6' : '#cc61ff');
	const wireColor = $derived($theme === 'light' ? '#4a7fcf' : '#6a9fff');
	const textColor = $derived($theme === 'light' ? '#333' : '#ccc');
	const beamColor = '#ff8c00';
</script>

<T.PerspectiveCamera makeDefault position={[1.6, 1.1, 1.6]} fov={45}>
	<OrbitControls enableDamping dampingFactor={0.1} target={[0, 0, 0]} />
</T.PerspectiveCamera>
<T.AmbientLight intensity={0.6} />
<T.DirectionalLight position={[5, 8, 5]} intensity={0.8} />

{#if boxGeometry}
	<T.LineSegments geometry={boxGeometry}>
		<T.LineBasicMaterial color={wireColor} />
	</T.LineSegments>
{/if}
{#each labels as l (l.text)}
	<Billboard position={l.at}>
		<Text text={l.text} fontSize={0.08} color={textColor} anchorX="center" anchorY="middle" />
	</Billboard>
{/each}

<T.Group position={emitterPos} quaternion={emitterQuat}>
	<T.Mesh rotation={[-Math.PI / 2, 0, 0]}>
		<T.PlaneGeometry args={opening} />
		<T.MeshBasicMaterial color={beamColor} transparent opacity={0.7} side={THREE.DoubleSide} />
	</T.Mesh>
	{#if webGeometry}
		<T.Group quaternion={webQuat}>
			<T.Mesh geometry={webGeometry}>
				<T.MeshStandardMaterial color={webColor} transparent opacity={0.45} side={THREE.DoubleSide} />
			</T.Mesh>
		</T.Group>
	{/if}
	<T.Line geometry={beamGeometry}>
		<T.LineBasicMaterial color={beamColor} />
	</T.Line>
	<T.Mesh position={[0, -0.9, 0]} rotation={[Math.PI, 0, 0]}>
		<T.ConeGeometry args={[0.05, 0.12, 12]} />
		<T.MeshBasicMaterial color={beamColor} />
	</T.Mesh>
</T.Group>
```

Check `luminousOpeningPlaneArgs(sourceWidth, sourceLength)` argument order in `fixturePreviewGeometry.ts` (width first) — the call above passes width then length.

- [ ] **Step 4: `FixtureEditor.svelte`** (Write tool, tabs). No local mirrors of `value`; each input commits on `change` via `onchange({ ...value, … })`.

```svelte
<script lang="ts">
	import { Canvas } from '@threlte/core';
	import PhotometricAxisPicker from './PhotometricAxisPicker.svelte';
	import FixtureScene from './FixtureScene.svelte';
	import type { IesAnalysisResponse, EmitterOffset } from '$lib/api/contract';
	import type { Extents } from '$lib/utils/photometricAxis';
	import { toMeters, unitAbbrev, unitFineStep, type LengthUnit } from '$lib/utils/unitConversion';
	import {
		HOUSING_FACES, FACE_LABELS, centerOffset, nextRoll, photometricDepthOf,
		type FixtureDraft, type HousingLayout
	} from '$lib/utils/housingGeometry';

	interface Props {
		value: FixtureDraft;
		onchange: (next: FixtureDraft) => void;
		analysis: IesAnalysisResponse | null;
		units: LengthUnit;
		fallbackHousing: Extents | null;
		surface: { width: number; length: number } | null;
	}

	let { value, onchange, analysis, units, fallbackHousing, surface }: Props = $props();

	const abbrev = $derived(unitAbbrev(units));
	const step = $derived(unitFineStep(units));

	// Effective dims (display units): typed value, else the fallback, else 0
	const dims = $derived({
		length: value.housingLength ?? fallbackHousing?.length ?? 0,
		width: value.housingWidth ?? fallbackHousing?.width ?? 0,
		height: value.housingHeight ?? fallbackHousing?.height ?? 0,
	});

	const layoutDisplay = $derived<HousingLayout>({ ...dims, face: value.face, roll: value.roll, offset: value.offset });
	const layoutMeters = $derived<HousingLayout>({
		length: toMeters(dims.length, units), width: toMeters(dims.width, units), height: toMeters(dims.height, units),
		face: value.face, roll: value.roll,
		offset: value.offset.map((v) => toMeters(v, units)) as EmitterOffset,
	});
	const surfaceMeters = $derived({
		length: surface ? toMeters(surface.length, units) : (analysis?.extents_by_axis[value.axis]?.length ?? 0),
		width: surface ? toMeters(surface.width, units) : (analysis?.extents_by_axis[value.axis]?.width ?? 0),
	});
	const web = $derived(analysis ? { vertices: analysis.vertices, triangles: analysis.triangles } : null);
	const depth = $derived(photometricDepthOf(value.face, value.offset));

	function parse(raw: string): number | undefined {
		if (raw.trim() === '') return undefined;
		const v = Number(raw);
		return Number.isFinite(v) ? v : undefined;
	}

	function setDim(key: 'housingWidth' | 'housingLength' | 'housingHeight', e: Event) {
		const v = parse((e.currentTarget as HTMLInputElement).value);
		if (v != null && v < 0) return;
		onchange({ ...value, [key]: v });
	}

	function setOffset(i: 0 | 1 | 2, e: Event) {
		const v = parse((e.currentTarget as HTMLInputElement).value) ?? 0;
		const offset = [...value.offset] as EmitterOffset;
		offset[i] = v;
		onchange({ ...value, offset });
	}

	const fmt = (v: number) => String(parseFloat(v.toFixed(4)));
</script>

<div class="fixture-editor">
	<section>
		<h4>Beam direction in file</h4>
		<PhotometricAxisPicker {analysis} axis={value.axis} onAxisChange={(axis) => onchange({ ...value, axis })} />
	</section>

	<section>
		<h4>Housing [{abbrev}]</h4>
		<div class="row-3">
			{#each [['housingLength', 'Length (L)', 'length'], ['housingWidth', 'Width (W)', 'width'], ['housingHeight', 'Height (H)', 'height']] as [key, label, fb] (key)}
				<label>
					<span>{label}</span>
					<input
						id={`housing-${fb}`}
						type="number"
						min="0"
						{step}
						value={value[key as 'housingWidth'] ?? ''}
						placeholder={fallbackHousing ? fmt(fallbackHousing[fb as keyof Extents]) : '0'}
						onchange={(e) => setDim(key as 'housingWidth', e)}
					/>
				</label>
			{/each}
		</div>
	</section>

	<section>
		<h4>Beam leaves through</h4>
		<div class="faces" role="group" aria-label="Housing face the beam leaves through">
			{#each HOUSING_FACES as f (f)}
				<button type="button" data-face={f} aria-pressed={value.face === f} onclick={() => onchange({ ...value, face: f })}>
					{FACE_LABELS[f]}
				</button>
			{/each}
		</div>
		<button type="button" class="secondary small rotate-emitter" onclick={() => onchange({ ...value, roll: nextRoll(value.roll) })}>
			Rotate emitter 90° (now {value.roll}°)
		</button>
	</section>

	<section>
		<h4>Emitter position [{abbrev}]</h4>
		<div class="row-3">
			{#each ['x', 'y', 'z'] as axisName, i (axisName)}
				<label>
					<span>{axisName.toUpperCase()} ({['L', 'W', 'H'][i]})</span>
					<input
						id={`emitter-offset-${axisName}`}
						type="number"
						{step}
						value={value.offset[i]}
						onchange={(e) => setOffset(i as 0 | 1 | 2, e)}
					/>
				</label>
			{/each}
		</div>
		<div class="snap">
			<button type="button" class="secondary small offset-flush" onclick={() => onchange({ ...value, offset: [0, 0, 0] })}>Flush with face</button>
			<button type="button" class="secondary small offset-center" onclick={() => onchange({ ...value, offset: centerOffset(layoutDisplay) })}>Center of housing</button>
		</div>
		<span class="hint">
			Measured from the center of the {FACE_LABELS[value.face].toLowerCase()} face along the housing's L / W / H.
			{#if depth > 0}Recessed {fmt(depth)} {abbrev}.{:else if depth < 0}Protrudes {fmt(-depth)} {abbrev}.{/if}
		</span>
	</section>

	<div class="fixture-canvas">
		<Canvas>
			<FixtureScene layout={layoutMeters} axis={value.axis} surfaceLength={surfaceMeters.length} surfaceWidth={surfaceMeters.width} {web} />
		</Canvas>
		<div class="canvas-hint">{analysis ? 'Housing upright; drag to rotate.' : 'Analyzing photometry…'}</div>
	</div>
</div>

<style>
	.fixture-editor { display: flex; flex-direction: column; gap: var(--spacing-md); }
	section { display: flex; flex-direction: column; gap: var(--spacing-xs); }
	h4 { margin: 0; font-size: var(--font-size-sm); color: var(--color-text-muted); font-weight: 600; }
	.row-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--spacing-xs); }
	.row-3 label { display: flex; flex-direction: column; gap: 2px; font-size: var(--font-size-sm); }
	.row-3 input { min-width: 0; }
	.faces { display: grid; grid-template-columns: repeat(6, 1fr); gap: var(--spacing-xs); }
	.faces button {
		padding: 4px 6px; border: 1px solid var(--color-border); border-radius: var(--radius-sm);
		background: var(--color-bg-secondary); color: var(--color-text); cursor: pointer;
	}
	.faces button[aria-pressed="true"] {
		border-color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 18%, transparent);
	}
	.snap { display: flex; gap: var(--spacing-xs); }
	.secondary.small { width: auto; padding: 4px 8px; font-size: var(--font-size-sm); white-space: nowrap; align-self: flex-start; }
	.hint { font-size: var(--font-size-sm); color: var(--color-text-muted); }
	.fixture-canvas { position: relative; height: 260px; border-radius: var(--radius-md); overflow: hidden; background: var(--color-bg-secondary); }
	.canvas-hint { position: absolute; left: 0; right: 0; bottom: 0; padding: 4px 8px; font-size: var(--font-size-sm); color: var(--color-text-muted); text-align: center; pointer-events: none; }
	@media (max-width: 480px) {
		.faces { grid-template-columns: repeat(3, 1fr); }
	}
</style>
```

(`--color-primary` is undefined app-wide; the picker's existing `aria-pressed` style uses it — switch it to `--color-accent` while slimming the picker.)

- [ ] **Step 5: Run** `pnpm vitest run src/lib/components/FixtureEditor.test.ts src/lib/components/PhotometricAxisPicker.test.ts src/lib/utils` → PASS; `pnpm check` will still fail in `LampManagerModal`/`AdvancedLampTabFixture` (they pass removed picker props) — fix those call sites minimally in this task by passing only `{analysis, axis, onAxisChange}` so the build is green; Tasks 8–9 replace them.

- [ ] **Step 6: Commit.** `git commit -m "feat(ui): shared FixtureEditor with live housing/emitter preview"`

---

## Task 8: UI — upload flow uses `FixtureEditor`

**Files:**
- Modify: `ui/src/lib/components/LampManagerModal.svelte` (Python helper / Write; tabs)
- Test: `ui/src/lib/components/LampManagerModal.test.ts`

**Interfaces:**
- Consumes: `FixtureEditor`, `FixtureDraft`, `DEFAULT_LAYOUT`, `matchFileFrame`, `aimToHousingExtents`, `fromMeters`.

- [ ] **Step 1: Failing tests.** The modal now renders `FixtureEditor` instead of the picker, so swap the test stub. Create `ui/src/lib/components/test/FixtureEditorStub.svelte`:

```svelte
<script lang="ts">
	// Stand-in for FixtureEditor in unit tests: exposes the draft and buttons that edit it.
	let { value, onchange }: { value: any; onchange: (v: any) => void; [key: string]: unknown } = $props();
</script>

<div data-testid="fixture-stub">
	<span data-testid="axis">{value.axis}</span>
	<span data-testid="face">{value.face}</span>
	<span data-testid="roll">{value.roll}</span>
	<span data-testid="offset">{value.offset.join(',')}</span>
	<button type="button" data-testid="pick-up" onclick={() => onchange({ ...value, axis: 'up' })}>up</button>
	<button type="button" data-testid="face-top" onclick={() => onchange({ ...value, face: 'top' })}>top</button>
	<button type="button" data-testid="face-left" onclick={() => onchange({ ...value, face: 'left' })}>left</button>
	<button type="button" data-testid="roll-90" onclick={() => onchange({ ...value, roll: 90 })}>roll</button>
	<button type="button" data-testid="protrude" onclick={() => onchange({ ...value, offset: [0, 0, -0.01] })}>protrude</button>
</div>
```

In `LampManagerModal.test.ts` replace the `vi.mock('./PhotometricAxisPicker.svelte', …)` block with `vi.mock('./FixtureEditor.svelte', async () => ({ default: (await import('./test/FixtureEditorStub.svelte')).default }));`. The existing `'analyzes a chosen IES file…'` and `'saves the chosen axis…'` tests keep working (`axis`, `pick-up`). Replace `'editing a definition shows its stored axis and depth without re-suggesting'` and add, in `describe('LampManagerModal orientation & mounting')`:

```ts
  it('a sideways file defaults the housing to the file frame', async () => {
    render(LampManagerModal, { props: { onClose: vi.fn(), initialLampType: 'lp_254' } });
    await chooseIes();
    await waitFor(() => expect(screen.getByTestId('axis').textContent).toBe('horizontal_0'));
    expect(screen.getByTestId('face').textContent).toBe('front');
  });

  it('follows the axis with the file frame until the user picks a face', async () => {
    render(LampManagerModal, { props: { onClose: vi.fn(), initialLampType: 'lp_254' } });
    await chooseIes();
    await waitFor(() => expect(screen.getByTestId('face').textContent).toBe('front'));
    await fireEvent.click(screen.getByTestId('pick-up'));
    expect(screen.getByTestId('face').textContent).toBe('top');
    expect(screen.getByTestId('roll').textContent).toBe('180');
    await fireEvent.click(screen.getByTestId('face-left'));
    await fireEvent.click(screen.getByTestId('pick-up'));
    expect(screen.getByTestId('face').textContent).toBe('left');
  });

  it('saves face, roll and offset on the definition', async () => {
    render(LampManagerModal, { props: { onClose: vi.fn(), initialLampType: 'lp_254' } });
    await chooseIes();
    await waitFor(() => expect(screen.getByTestId('axis').textContent).toBe('horizontal_0'));
    await fireEvent.click(screen.getByTestId('face-top'));
    await fireEvent.click(screen.getByTestId('roll-90'));
    await fireEvent.click(screen.getByTestId('protrude'));
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockAdd).toHaveBeenCalled());
    expect(mockAdd.mock.calls[0][0].housing).toEqual(
      expect.objectContaining({ beamFace: 'top', roll: 90, offset: [0, 0, -0.01] })
    );
  });

  it('editing a definition shows its stored layout without re-suggesting', async () => {
    const def = makeDef({ id: 'd1', photometricAxis: 'horizontal_90', housing: { height: 0.3, beamFace: 'back', roll: 270, offset: [0, 0, 0.15] } });
    customLampsStore.set([def]);
    mockGet.mockReturnValue(def);
    mockToIesFile.mockReturnValue(new File(['TILT=NONE'], 'x.ies'));
    render(LampManagerModal, { props: { onClose: vi.fn(), initialEditDefId: 'd1' } });
    await waitFor(() => expect(analyzeLampIes).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('axis').textContent).toBe('horizontal_90'));
    expect(screen.getByTestId('face').textContent).toBe('back');
    expect(screen.getByTestId('roll').textContent).toBe('270');
    expect(screen.getByTestId('offset').textContent).toBe('0,0,0.15');
  });
```

Run → the new tests FAIL.

- [ ] **Step 2: Implement.**
- State: replace `photometricDepth` with `let beamFace = $state<HousingFaceToken>('bottom'); let housingRoll = $state<HousingRoll>(0); let emitterOffset = $state<EmitterOffset>([0, 0, 0]); let layoutTouched = $state(false);` — reset in `resetDraft()` (`layoutTouched = false`), loaded in `startEdit()` from `def.housing?.beamFace ?? 'bottom'`, `def.housing?.roll ?? 0`, `def.housing?.offset ?? [0, 0, 0]` and `layoutTouched = true` (a saved def keeps its own layout).
- `analyzeIes(..., suggest)`: after adopting `suggested_axis`, `if (!layoutTouched) ({ face: beamFace, roll: housingRoll } = matchFileFrame(photometricAxis));`.
- Derived draft and handler:

```ts
	const fixtureDraft = $derived<FixtureDraft>({
		axis: photometricAxis, housingWidth, housingLength, housingHeight,
		face: beamFace, roll: housingRoll, offset: emitterOffset,
	});

	function handleFixtureChange(next: FixtureDraft) {
		if (next.face !== beamFace || next.roll !== housingRoll) layoutTouched = true;
		photometricAxis = next.axis;
		housingWidth = next.housingWidth;
		housingLength = next.housingLength;
		housingHeight = next.housingHeight;
		if (!layoutTouched && next.axis !== fixtureDraft.axis) {
			({ face: beamFace, roll: housingRoll } = matchFileFrame(next.axis));
		} else {
			beamFace = next.face;
			housingRoll = next.roll;
		}
		emitterOffset = next.offset;
	}

	// Housing the backend would default to (surface footprint), in this frame
	const fallbackHousing = $derived.by(() => {
		const ext = iesAnalysis?.extents_by_axis[photometricAxis];
		if (!ext) return null;
		const e = aimToHousingExtents(beamFace, housingRoll, { length: ext.length, width: ext.width, height: 0 });
		return { length: fromMeters(e.length, surfaceUnits), width: fromMeters(e.width, surfaceUnits), height: fromMeters(e.height, surfaceUnits) };
	});
```
- `buildHousing()`:

```ts
	function buildHousing() {
		const layoutSet = beamFace !== 'bottom' || housingRoll !== 0 || emitterOffset.some((v) => v !== 0);
		if (housingWidth == null && housingLength == null && housingHeight == null && !layoutSet) return undefined;
		return {
			width: housingWidth, length: housingLength, height: housingHeight,
			...(layoutSet ? { beamFace, roll: housingRoll, offset: emitterOffset } : {}),
		};
	}
```
- Markup: replace the "Orientation & Mounting" `PhotometricAxisPicker` block with

```svelte
					{#if iesFile || currentIesFilename}
						<div class="form-group orientation-group" role="group" aria-labelledby="orientation-heading">
							<span id="orientation-heading" class="label">Fixture</span>
							<FixtureEditor
								value={fixtureDraft}
								onchange={handleFixtureChange}
								analysis={iesAnalysis}
								units={surfaceUnits}
								{fallbackHousing}
								surface={surfaceWidth != null && surfaceLength != null ? { width: surfaceWidth, length: surfaceLength } : null}
							/>
						</div>
					{/if}
```
and delete the Advanced section's "Housing Width / Length / Height" `form-row` (the editor owns those ids now; ids must stay unique). Update any existing tests that targeted `#housing-width` inside Advanced — the id is unchanged, only its location moved.

- [ ] **Step 3: Run** `pnpm vitest run src/lib/components/LampManagerModal.test.ts` → PASS; `pnpm test:run` → PASS; `pnpm check` → 0.

- [ ] **Step 4: Commit.** `git commit -m "feat(ui): fixture editor in the custom lamp upload form"`

---

## Task 9: UI — advanced Fixture tab uses `FixtureEditor`

**Files:**
- Modify: `ui/src/lib/components/AdvancedLampTabFixture.svelte` (Write; tabs)
- Modify: `ui/src/lib/components/AdvancedLampSettingsModal.svelte` (Python helper; tabs)
- Delete if unused afterwards: `ui/src/lib/components/FixturePreview3D.svelte` (+ its test if any), `localFixtureBounds`, `photometricWebData`/`fetchPhotometricWeb` in the modal (grep for other readers first; keep them if anything else uses them)
- Test: `ui/src/lib/components/AdvancedLampSettingsModal.test.ts`

**Interfaces:**
- Consumes: `FixtureEditor`, `FixtureDraft`; `AdvancedLampSettingsResponse.beam_face/housing_roll/emitter_offset` (Task 6).
- Produces: `AdvancedLampTabFixture` props `{ draft: FixtureDraft; onchange: (d: FixtureDraft) => void; iesAnalysis: IesAnalysisResponse | null; units: LengthUnit; sourceWidth: number | null; sourceLength: number | null }`.

- [ ] **Step 1: Failing tests** in `AdvancedLampSettingsModal.test.ts`: replace the `FixturePreview3D` and `PhotometricAxisPicker` mocks with `vi.mock('./FixtureEditor.svelte', async () => ({ default: (await import('./test/FixtureEditorStub.svelte')).default }));`; add `beam_face: 'bottom' as const, housing_roll: 0 as const, emitter_offset: [0, 0, 0] as [number, number, number],` to `mockSettings`; delete `test/PickerStub.svelte` when nothing imports it. The existing `'fixture tab analyzes the stored IES, saves a changed axis and reports it'` keeps working via the stub's `axis`/`pick-up`. Add:

```ts
  it('fixture tab loads and saves the housing layout', async () => {
    vi.mocked(getSessionLampAdvancedSettings).mockResolvedValue({
      ...mockSettings, beam_face: 'front', housing_roll: 90, emitter_offset: [0.01, 0, 0],
    });
    vi.mocked(getSessionLampFiles).mockResolvedValue({ ies_filedata: 'TILT=NONE', ies_filename: 'x.ies', spectrum: null, content_hash: 'h' } as any);
    vi.mocked(analyzeLampIes).mockResolvedValue({
      suggested_axis: 'down', axis_scores: {}, ies_dimensions: { width: 1, length: 1, height: 0 }, vertices: [], triangles: [], extents_by_axis: {},
    } as any);
    vi.mocked(updateSessionLampAdvanced).mockResolvedValue({ success: true });
    const onUpdate = vi.fn();
    render(AdvancedLampSettingsModal, {
      props: { initialLampId: 'lamp-1', room: defaultRoom(), onClose: vi.fn(), onUpdate },
    });
    await waitFor(() => expect(getSessionLampAdvancedSettings).toHaveBeenCalled());
    await fireEvent.click(screen.getByRole('tab', { name: /Lamp Fixture/ }));
    await waitFor(() => expect(screen.getByTestId('face').textContent).toBe('front'));
    expect(screen.getByTestId('roll').textContent).toBe('90');
    expect(screen.getByTestId('offset').textContent).toBe('0.01,0,0');
    // the modal arms its auto-save effect 50 ms after the settings load
    await new Promise((r) => setTimeout(r, 100));
    await fireEvent.click(screen.getByTestId('face-top'));
    await waitFor(
      () => expect(updateSessionLampAdvanced).toHaveBeenCalledWith('lamp-1', expect.objectContaining({
        beam_face: 'top', housing_roll: 90, emitter_offset: [0.01, 0, 0],
      })),
      { timeout: 3000 }
    );
    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
  });
```

Run → FAIL.

- [ ] **Step 2: Implement the modal.**
- State: replace `let photometricDepth = $state<number>(0);` with `let beamFace = $state<HousingFaceToken>('bottom'); let housingRoll = $state<HousingRoll>(0); let emitterOffset = $state<EmitterOffset>([0, 0, 0]);`.
- `fetchSettings`: replace `photometricDepth = settings.photometric_depth;` with the three assignments from `settings.beam_face`, `settings.housing_roll`, `settings.emitter_offset`.
- Autosave `$effect`: replace `const _depth = photometricDepth;` with `const _face = beamFace; const _roll = housingRoll; const _off = emitterOffset;`.
- `saveChanges`: replace `update.photometric_depth = photometricDepth;` with `update.beam_face = beamFace; update.housing_roll = housingRoll; update.emitter_offset = emitterOffset;` and type `update` as `AdvancedLampUpdate` instead of `Record<string, unknown>` + `as any` if that compiles cleanly (it should now that the type has the fields).
- Replace `handlePhotometricDepthChange`/housing handlers with one:

```ts
	const fixtureDraft = $derived<FixtureDraft>({
		axis: photometricAxis,
		housingWidth: housingWidth ?? undefined,
		housingLength: housingLength ?? undefined,
		housingHeight: housingHeight ?? undefined,
		face: beamFace, roll: housingRoll, offset: emitterOffset,
	});

	function handleFixtureChange(next: FixtureDraft) {
		photometricAxis = next.axis;
		housingWidth = next.housingWidth ?? null;
		housingLength = next.housingLength ?? null;
		housingHeight = next.housingHeight ?? null;
		beamFace = next.face;
		housingRoll = next.roll;
		emitterOffset = next.offset;
	}
```
- Delete `localFixtureBounds`. If `photometricWebData` is read only by the Fixture tab, delete it, `fetchPhotometricWeb` and their calls.
- Tab markup:

```svelte
						{:else if activeTab === 'fixture'}
							<AdvancedLampTabFixture
								draft={fixtureDraft}
								onchange={handleFixtureChange}
								{iesAnalysis}
								units={$userSettings.units}
								{sourceWidth}
								{sourceLength}
							/>
```

- [ ] **Step 3: Rewrite `AdvancedLampTabFixture.svelte`:**

```svelte
<script lang="ts">
	import FixtureEditor from './FixtureEditor.svelte';
	import type { IesAnalysisResponse } from '$lib/api/contract';
	import type { LengthUnit } from '$lib/utils/unitConversion';
	import type { FixtureDraft } from '$lib/utils/housingGeometry';

	interface Props {
		draft: FixtureDraft;
		onchange: (d: FixtureDraft) => void;
		iesAnalysis: IesAnalysisResponse | null;
		units: LengthUnit;
		sourceWidth: number | null;
		sourceLength: number | null;
	}

	let { draft, onchange, iesAnalysis, units, sourceWidth, sourceLength }: Props = $props();
</script>

<div class="tab-fixture">
	<section class="settings-section">
		<h3>Fixture</h3>
		<div class="section-content">
			<FixtureEditor
				value={draft}
				{onchange}
				analysis={iesAnalysis}
				{units}
				fallbackHousing={null}
				surface={sourceWidth != null && sourceLength != null ? { width: sourceWidth, length: sourceLength } : null}
			/>
		</div>
	</section>
</div>
```

Keep the file's existing `<style>` rules that still apply (`.tab-fixture`, `.settings-section`, `h3`, `.section-content`); drop the `form-row-3` / preview styles.

- [ ] **Step 4: Run** `pnpm vitest run src/lib/components/AdvancedLampSettingsModal.test.ts` → PASS; `pnpm test:run` → PASS; `pnpm check` → 0.

- [ ] **Step 5: Commit.** `git commit -m "feat(ui): fixture editor in the advanced Fixture tab"`

---

## Task 10: e2e, changelog, final verification

**Files:**
- Create: `e2e/tests/fixture-editor.spec.ts`
- Modify: `e2e/helpers/*` only if a helper needs a `face`/`offset` option (see `createCustomLamp({axis})`)
- Modify: `CHANGELOG.md` (`[Unreleased]`)

- [ ] **Step 1: Worktree e2e servers** (main checkout holds 8000/5173): `cd $WT/api && PYTHONPATH=$GC/src uv run --frozen uvicorn app.main:app --port 8010` (background) and `cd ui && VITE_API_URL=http://localhost:8010/api/v1 pnpm dev --port 5183` (background); uncommitted `e2e/playwright.worktree.config.ts` copied from the playwright-axis worktree pattern (baseURL `http://localhost:5183`, no `webServer`); run with `E2E_API_URL=http://localhost:8010/api/v1`.

- [ ] **Step 2: Write the spec.** First extend `CustomLampOptions` / `createCustomLamp` in `e2e/helpers/lamps.ts` (after the `opts.axis` block), with `face?: 'bottom' | 'top' | 'front' | 'back' | 'left' | 'right'; offset?: [number, number, number];` added to `CustomLampOptions`:

```ts
  if (opts.face) {
    const btn = form.locator(`button[data-face="${opts.face}"]`);
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
  }
  if (opts.offset) {
    for (const [i, axis] of (['x', 'y', 'z'] as const).entries()) {
      const input = form.locator(`#emitter-offset-${axis}`);
      await input.fill(String(opts.offset[i]));
      await input.press('Tab');
    }
  }
```

Then `e2e/tests/fixture-editor.spec.ts`:

```ts
import { test, expect } from '../fixtures';
import { waitForSession } from '../helpers/session';
import { addLampWithType, createCustomLamp, openAdvancedSettings, selectAdvancedTab } from '../helpers/lamps';
import { getLampsFromStore } from '../helpers/api';
import path from 'path';

const IES_FIXTURE = path.resolve(__dirname, '../fixtures/test-lamp.ies');

test('fixture layout set on upload reaches the advanced tab and the backend', async ({ page }) => {
  await waitForSession(page);
  await addLampWithType(page, 'other');
  await createCustomLamp(page, { ies: IES_FIXTURE, wavelength: 280, face: 'front', offset: [0, 0, -0.02] });

  await expect.poll(async () => (await getLampsFromStore(page))[0].beam_face).toBe('front');
  const lamp = (await getLampsFromStore(page))[0];
  expect(lamp.emitter_offset).toEqual([0, 0, -0.02]);

  await openAdvancedSettings(page);
  await selectAdvancedTab(page, 'Lamp Fixture');
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog.locator('button[data-face="front"]')).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
  await expect(dialog.locator('#emitter-offset-z')).toHaveValue('-0.02');

  const saved = page.waitForResponse(
    (r) => r.request().method() === 'PATCH' && r.url().includes(`/session/lamps/${lamp.id}`)
      && r.request().postDataJSON()?.emitter_offset?.[0] === 0.05
  );
  const x = dialog.locator('#emitter-offset-x');
  await x.fill('0.05');
  await x.press('Tab');
  await saved;
  await expect.poll(async () => (await getLampsFromStore(page))[0].emitter_offset?.[0]).toBe(0.05);
});
```

If the e2e default room is not in meters, scale the expected values to its units. Run: `cd $WT/e2e && E2E_API_URL=http://localhost:8010/api/v1 npx playwright test -c playwright.worktree.config.ts tests/fixture-editor.spec.ts tests/lamp-instance-source.spec.ts` → PASS.

- [ ] **Step 3: Changelog.** Under `## [Unreleased]` in `CHANGELOG.md` (match the section headings already there):

```markdown
- Fixture editor for custom lamps (upload form and the advanced Fixture tab): choose which face of the housing the beam leaves through, rotate the emitter in 90° steps, and place the emitter anywhere relative to the housing (including in front of it), with a live 3D preview of housing, emitting surface and beam
```

- [ ] **Step 4: Full verification.**
  - `cd $GC && PYTHONPATH=$GC/src uv run --frozen --project $WT/api pytest -q` → PASS
  - `cd $WT/api && PYTHONPATH=$GC/src uv run --frozen pytest -q` → PASS
  - `cd ui && pnpm test:run && pnpm check` → PASS / 0 errors
  - `grep -rn "\[DIAG\]\|TEMP DIAG" ui/src api/` → nothing; `grep -rn "0\.3048" ui/src api/api` → nothing new
  - `git status`: `api/uv.lock` **not** modified-and-staged (restore with `git checkout api/uv.lock` before committing if needed); `e2e/playwright.worktree.config.ts` untracked, not committed.

- [ ] **Step 5: Commit.** `git add e2e/tests/fixture-editor.spec.ts CHANGELOG.md && git commit -m "test(e2e): fixture layout from upload to room; changelog"`

- [ ] **Step 6: Report** that Illuminate CI will fail on the PyPI guv_calcs 0.8.1 pin until the user releases guv_calcs (new `Fixture` API) and the pin in `api/pyproject.toml` + `api/uv.lock` is bumped.
