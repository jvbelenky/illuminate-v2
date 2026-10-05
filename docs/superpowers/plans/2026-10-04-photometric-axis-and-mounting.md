# Photometric Axis and Mounting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a custom lamp declare where its beam points in the IES file's frame and how deep the photometric center sits in the housing, so Illuminate's aim means "beam direction" for upper-room 254 nm fixtures and the housing box is drawn where the fixture is.

**Architecture:** guv_calcs gains a `PhotometricAxis` enum (six axis-aligned directions, each owning a fixed IES→aim rotation matrix) and a `Fixture.photometric_depth` float. `Lamp.transform_to_lamp/world` compose the axis matrix with the aim pose, so every photometric lookup and web drawing is rotated while the surface points and housing box (which call the pose directly) stay perpendicular to the aim. The API passes both properties through like the housing fields, applies the matrix in the session web endpoint, and adds a stateless `POST /lamps/analyze-ies` endpoint that scores the six directions. The UI stores both on `CustomLampDef`, renders a Threlte picker (six handles + web + housing box) in the lamp manager form and the advanced Fixture tab, and auto-places a horizontal fixture on a wall when a definition is first applied.

**Tech Stack:** Python 3.12 / numpy / pytest (guv_calcs, run with `uv run --frozen pytest` from `~/illuminate-v2/api` so the editable guv_calcs is used, or `pytest` from `~/guv-calcs`); FastAPI + Pydantic (api); SvelteKit 5 runes + Threlte 8 + Three.js + Vitest + Playwright (ui).

**Spec:** `docs/superpowers/specs/2026-10-04-photometric-axis-and-mounting-design.md`

## Global Constraints

- guv_calcs commits: short lowercase one-liners, no prefixes, no attribution trailers, one commit per logical change, a `CHANGELOG.md` `[Unreleased]` entry per user-facing change (its `CLAUDE.md`). Never push guv-calcs.
- Illuminate commits: conventional prefixes as in `git log`, no `Co-Authored-By`, `CHANGELOG.md` `[Unreleased]` entry for user-facing changes (Task 14).
- `.svelte` files use tabs and must be edited with a Python helper via Bash (`~/.claude/skills/editing-svelte-files/SKILL.md`), never with Edit or sed. `.ts` files use 2 spaces, `.py` files 4 spaces.
- API types are generated: never hand-write a request/response type; run `make generate-api` and alias in `ui/src/lib/api/contract.ts`.
- `pnpm check` must stay at zero errors; never `@ts-ignore`.
- No `0.3048` literals; use `convertLength`/`fromMeters`. Never write `'meters' | 'feet'` branches.
- Editor components must not mirror store state in local `$state` for store-owned fields; the lamp manager form owns a draft (not store state), which is fine.
- Every mutating session handler stays inside `with locked_session(session):`.
- Six axis tokens, exactly: `down`, `up`, `horizontal_0`, `horizontal_90`, `horizontal_180`, `horizontal_270`.
- guv_calcs frame conventions: IES θ=0 is local −z, θ=90/φ=0 is +x, zenith is +z; aim frame has −z = aim, +z = behind, +x = fixture length.
- Work on branch `photometric-axis` in a worktree (`superpowers:using-git-worktrees`) for Illuminate; guv_calcs work happens directly in `~/guv-calcs` on its current branch.

## Review Focus

1. **A `.guv` file saved before this change** must load with axis `down` and depth 0 and compute bit-identical results (Task 3 legacy-dict test; Task 5 load test with `tests/fixtures/legacy_preview_lamp.guv`).
2. **Changing a lamp's type** (krcl ↔ lp_254 ↔ other) recreates the backend lamp; axis and depth must survive (Task 5 test).
3. **A session unit change** (meters → feet) must convert depth with the other lengths and leave the axis alone (Task 5 test).
4. **A definition applied to a lamp the user already aimed** must not be re-placed on later edits of that definition (Task 10 test: propagate does not call placement).
5. **An IES with no dominant direction** (four-way or omnidirectional) must suggest `down`, not `up`, even though its mean direction points slightly upward (Task 7 UV-Flow-shaped test).

---

### Task 1: `PhotometricAxis` enum and rotation matrices (guv_calcs)

**Files:**
- Create: `~/guv-calcs/src/guv_calcs/lamp/photometric_axis.py`
- Modify: `~/guv-calcs/src/guv_calcs/lamp/__init__.py` (import + `__all__`)
- Test: `~/guv-calcs/tests/test_photometric_axis.py`

**Interfaces:**
- Produces: `PhotometricAxis` (ParseableEnum) with `.direction -> np.ndarray(3)`, `.matrix -> np.ndarray(3,3)`, `.is_horizontal -> bool`, `.phi -> float | None`, `.permute_extents(length, width, height) -> tuple[float, float, float]`, classmethods `from_any`, `from_token`, `_default` (DOWN).

- [ ] **Step 1: Write the failing tests**

```python
# ~/guv-calcs/tests/test_photometric_axis.py
"""Tests for PhotometricAxis (where the beam points in the IES frame)."""

import numpy as np
import pytest
from guv_calcs.lamp import PhotometricAxis

AXES = list(PhotometricAxis)
HORIZONTAL = [a for a in AXES if a.is_horizontal]


class TestMatrix:
    @pytest.mark.parametrize("axis", AXES)
    def test_beam_maps_to_aim(self, axis):
        np.testing.assert_allclose(axis.matrix @ axis.direction, [0, 0, -1], atol=1e-12)

    @pytest.mark.parametrize("axis", AXES)
    def test_is_proper_rotation(self, axis):
        m = axis.matrix
        np.testing.assert_allclose(m @ m.T, np.eye(3), atol=1e-12)
        assert np.isclose(np.linalg.det(m), 1.0)

    def test_down_is_identity(self):
        np.testing.assert_allclose(PhotometricAxis.DOWN.matrix, np.eye(3))

    @pytest.mark.parametrize("axis", HORIZONTAL)
    def test_horizontal_zenith_maps_to_local_x(self, axis):
        # local +x is what the pose sends to world-up when banked to 90 deg
        np.testing.assert_allclose(axis.matrix @ [0, 0, 1], [1, 0, 0], atol=1e-12)

    def test_matrix_has_clean_zeros(self):
        m = PhotometricAxis.HORIZONTAL_0.matrix
        assert (m == np.array([[0, 0, 1], [0, 1, 0], [-1, 0, 0]])).all()


class TestParsing:
    def test_default_is_down(self):
        assert PhotometricAxis.from_any(None) is PhotometricAxis.DOWN

    def test_tokens_are_forgiving(self):
        assert PhotometricAxis.from_any("Horizontal-90") is PhotometricAxis.HORIZONTAL_90
        assert PhotometricAxis.from_any(" up ") is PhotometricAxis.UP

    def test_unknown_token_raises(self):
        with pytest.raises(ValueError):
            PhotometricAxis.from_any("sideways")

    def test_phi(self):
        assert PhotometricAxis.HORIZONTAL_270.phi == 270
        assert PhotometricAxis.DOWN.phi is None


class TestExtents:
    def test_down_keeps_order(self):
        assert PhotometricAxis.DOWN.permute_extents(1.0, 2.0, 3.0) == (1.0, 2.0, 3.0)

    def test_horizontal_0(self):
        # ies length (along beam) becomes depth; ies height becomes length
        assert PhotometricAxis.HORIZONTAL_0.permute_extents(1.26, 1.94, 0.42) == pytest.approx((0.42, 1.94, 1.26))

    def test_horizontal_90(self):
        assert PhotometricAxis.HORIZONTAL_90.permute_extents(1.26, 1.94, 0.42) == pytest.approx((0.42, 1.26, 1.94))

    def test_up_keeps_extents(self):
        assert PhotometricAxis.UP.permute_extents(1.0, 2.0, 3.0) == pytest.approx((1.0, 2.0, 3.0))
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/guv-calcs && pytest tests/test_photometric_axis.py -q`
Expected: ImportError, `cannot import name 'PhotometricAxis'`

- [ ] **Step 3: Write the module**

```python
# ~/guv-calcs/src/guv_calcs/lamp/photometric_axis.py
"""Where a fixture's beam points in its IES file's own frame."""

import numpy as np
from ..units import ParseableEnum


def _rot_y(deg):
    a = np.radians(deg)
    return np.array([[np.cos(a), 0, np.sin(a)], [0, 1, 0], [-np.sin(a), 0, np.cos(a)]])


def _rot_z(deg):
    a = np.radians(deg)
    return np.array([[np.cos(a), -np.sin(a), 0], [np.sin(a), np.cos(a), 0], [0, 0, 1]])


class PhotometricAxis(ParseableEnum):
    """
    Direction, in the IES frame, that the fixture's beam goes.

    The IES frame puts theta=0 on -z, theta=90/phi=0 on +x and the zenith on +z.
    `matrix` rotates IES-frame vectors into the aim frame (beam on -z); for the
    horizontal axes the IES zenith lands on local +x, which the lamp pose sends
    to world-up when the lamp is banked to 90 degrees.
    """

    DOWN = "down"
    UP = "up"
    HORIZONTAL_0 = "horizontal_0"
    HORIZONTAL_90 = "horizontal_90"
    HORIZONTAL_180 = "horizontal_180"
    HORIZONTAL_270 = "horizontal_270"

    @classmethod
    def _default(cls):
        return cls.DOWN

    @classmethod
    def from_token(cls, token):
        token = str(token).strip().lower().replace("-", "_").replace(" ", "_")
        try:
            return cls(token)
        except ValueError:
            raise ValueError(f"Unknown PhotometricAxis: {token}")

    @property
    def is_horizontal(self):
        return self.value.startswith("horizontal")

    @property
    def phi(self):
        """beam azimuth in the ies frame, horizontal axes only"""
        return float(self.value.split("_")[1]) if self.is_horizontal else None

    @property
    def direction(self):
        """unit vector of the beam in the ies frame"""
        if self is PhotometricAxis.DOWN:
            return np.array([0.0, 0.0, -1.0])
        if self is PhotometricAxis.UP:
            return np.array([0.0, 0.0, 1.0])
        p = np.radians(self.phi)
        return np.array([np.cos(p), np.sin(p), 0.0])

    @property
    def matrix(self):
        """rotation taking ies-frame vectors into the aim frame"""
        if self is PhotometricAxis.DOWN:
            return np.eye(3)
        if self is PhotometricAxis.UP:
            m = _rot_y(180.0)
        else:
            m = _rot_y(90.0) @ _rot_z(-self.phi)
        return np.round(m, 12) + 0.0  # clean -0.0 and 1e-17 noise

    def permute_extents(self, length, width, height):
        """map ies (x, y, z) extents onto aim-frame (length, width, height)"""
        ext = np.abs(self.matrix) @ np.array([length, width, height], dtype=float)
        return (float(ext[0]), float(ext[1]), float(ext[2]))
```

- [ ] **Step 4: Export it**

In `~/guv-calcs/src/guv_calcs/lamp/__init__.py` add after `from .fixture import Fixture, FixtureShape`:

```python
from .photometric_axis import PhotometricAxis
```

and in `__all__` after `"FixtureShape",`:

```python
    "PhotometricAxis",
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd ~/guv-calcs && pytest tests/test_photometric_axis.py -q`
Expected: all pass

- [ ] **Step 6: Commit (guv-calcs)**

```bash
cd ~/guv-calcs && git add src/guv_calcs/lamp/photometric_axis.py src/guv_calcs/lamp/__init__.py tests/test_photometric_axis.py && git commit -m "photometric axis enum with ies-to-aim rotation matrices"
```

---

### Task 2: `Fixture.photometric_depth` and the housing box formula (guv_calcs)

**Files:**
- Modify: `~/guv-calcs/src/guv_calcs/lamp/fixture.py`
- Modify: `~/guv-calcs/src/guv_calcs/lamp/lamp_geometry.py:96-134` (`get_bounding_box_corners`)
- Test: `~/guv-calcs/tests/test_fixture.py`, `~/guv-calcs/tests/test_lamp_geometry.py`

**Interfaces:**
- Produces: `Fixture(photometric_depth: float = 0.0)` field, serialized in `to_dict()` as `"photometric_depth"`; `get_bounding_box_corners()` spans local z from `min(-d, -s)` to `max(h - d, s)`.

- [ ] **Step 1: Write the failing tests**

Append to `~/guv-calcs/tests/test_fixture.py`:

```python
class TestPhotometricDepth:
    def test_default_zero(self):
        assert Fixture().photometric_depth == 0.0

    def test_round_trip(self):
        f = Fixture(housing_width=0.5, housing_height=0.1, photometric_depth=0.05)
        assert Fixture.from_dict(f.to_dict()) == f

    def test_legacy_dict_without_depth(self):
        f = Fixture.from_dict({"housing_width": 0.5, "housing_length": 0.3, "housing_height": 0.1, "shape": "rectangular"})
        assert f.photometric_depth == 0.0
```

Append to `~/guv-calcs/tests/test_lamp_geometry.py`:

```python
class TestBoundingBoxDepth:
    """Housing box extent along the aim axis (local z, +z = behind)."""

    @staticmethod
    def _z_range(lamp):
        corners = lamp.geometry.get_bounding_box_corners()
        return corners[:, 2].min(), corners[:, 2].max()

    def test_default_unchanged_for_flat_presets(self):
        lamp = Lamp.from_keyword("beacon", x=0, y=0, z=0, aimx=0, aimy=0, aimz=-1)
        zmin, zmax = self._z_range(lamp)
        assert zmin == pytest.approx(0.0)
        assert zmax == pytest.approx(0.08)

    def test_luminous_volume_shown_both_ways(self):
        # a 0.12 m tall luminous volume with no housing is centered on the point
        lamp = Lamp.from_keyword("sterilray", x=0, y=0, z=0, aimx=0, aimy=0, aimz=-1, height=0.12, housing_height=0.0)
        zmin, zmax = self._z_range(lamp)
        assert (zmin, zmax) == pytest.approx((-0.06, 0.06))

    def test_depth_slides_housing_forward(self):
        lamp = Lamp.from_keyword("beacon", x=0, y=0, z=0, aimx=0, aimy=0, aimz=-1, housing_height=0.12, photometric_depth=0.06)
        zmin, zmax = self._z_range(lamp)
        assert (zmin, zmax) == pytest.approx((-0.06, 0.06))
```

(`photometric_depth` as a `Lamp` kwarg is wired in Task 3; the geometry test for it will fail until then, which is expected. Run only the first two geometry tests in this task.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/guv-calcs && pytest tests/test_fixture.py::TestPhotometricDepth tests/test_lamp_geometry.py::TestBoundingBoxDepth::test_luminous_volume_shown_both_ways -q`
Expected: FAIL (`unexpected keyword argument 'photometric_depth'`; z range `(-0.06, 0.0)`)

- [ ] **Step 3: Add the field**

In `fixture.py`, in the `Fixture` dataclass after `housing_height: float = 0.0`:

```python
    photometric_depth: float = 0.0
```

Update the docstring attributes list with:

```
        photometric_depth: Distance from the emitting face back to the photometric
            center (lamp position). 0 = face at the point; housing_height/2 = centered.
```

In `to_dict` add `"photometric_depth": self.photometric_depth,` after `"housing_height"`.

- [ ] **Step 4: Update the box formula**

In `lamp_geometry.py` `get_bounding_box_corners`, replace the block from `hh = self._fixture.housing_height` through `z_max = hh` with:

```python
        hh = self._fixture.housing_height
        d = self._fixture.photometric_depth

        # Luminous z-extent (3D openings like cylinders) shows in both directions
        surface_z = self._surface.height / 2

        # Local frame: length along X, width along Y, +Z opposite to aim.
        # The emitting face sits `d` in front of the point (toward the aim);
        # the housing extends `hh` behind the face.
        z_min = min(-d, -surface_z)
        z_max = max(hh - d, surface_z)
```

and update the docstring bullets to:

```
        - housing_height extending behind the emitting face, which sits
          photometric_depth in front of the lamp position
        - LampSurface.height (luminous z-extent) extends both directions
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd ~/guv-calcs && pytest tests/test_fixture.py tests/test_lamp_geometry.py -q -k "not depth_slides"`
Expected: all pass

- [ ] **Step 6: Commit (guv-calcs)**

```bash
cd ~/guv-calcs && git add src/guv_calcs/lamp/fixture.py src/guv_calcs/lamp/lamp_geometry.py tests/test_fixture.py tests/test_lamp_geometry.py && git commit -m "fixture photometric depth; housing box shows the luminous volume both ways"
```

---

### Task 3: Lamp integration: axis-aware transforms, dimension remap, serialization (guv_calcs)

**Files:**
- Modify: `~/guv-calcs/src/guv_calcs/lamp/lamp.py` (constructor, `to_dict`, `from_dict`, `_prepare_from_key`, `calc_state`, `load_ies`, `transform_to_world`, `transform_to_lamp`, `irradiance_at`, `set_units`, new properties)
- Modify: `~/guv-calcs/src/guv_calcs/lamp/lamp_surface.py:172-190` (`set_ies` gets `axis=`)
- Modify: `~/guv-calcs/CHANGELOG.md`
- Test: `~/guv-calcs/tests/test_photometric_axis.py` (append), `~/guv-calcs/tests/test_lamp_geometry.py` (Task 2's third test now passes)

**Interfaces:**
- Consumes: `PhotometricAxis` (Task 1), `Fixture.photometric_depth` (Task 2).
- Produces: `Lamp(..., photometric_axis=None, photometric_depth=0.0)`; `Lamp.photometric_axis -> PhotometricAxis`; `Lamp.set_photometric_axis(axis) -> Lamp`; `Lamp.photometric_axis_matrix -> np.ndarray(3,3)`; `Lamp.transform_to_lamp(coords, which)` / `transform_to_world(coords, scale, which)` now photometric-frame; `to_dict()["photometric_axis"]` token and `to_dict()["fixture"]["photometric_depth"]`; `LampSurface.set_ies(ies, override=False, axis=None)`.

- [ ] **Step 1: Write the failing tests**

Append to `~/guv-calcs/tests/test_photometric_axis.py`:

```python
from guv_calcs import Lamp, Room


class TestLampIntegration:
    def test_default_axis_is_down(self):
        lamp = Lamp.from_keyword("aerolamp")
        assert lamp.photometric_axis is PhotometricAxis.DOWN
        np.testing.assert_allclose(lamp.photometric_axis_matrix, np.eye(3))

    def test_horizontal_lamp_banked_sees_beam_along_aim(self):
        # wall-mounted: at origin, aimed along +x (bank 90, heading 0)
        lamp = Lamp.from_keyword("aerolamp", x=0, y=0, z=0, aimx=1, aimy=0, aimz=0, photometric_axis="horizontal_0")
        th, ph, r = lamp.transform_to_lamp(np.array([[2.0, 0.0, 0.0]]), which="polar")
        assert th[0] == pytest.approx(90.0)
        assert ph[0] % 360 == pytest.approx(0.0, abs=1e-9)
        assert r[0] == pytest.approx(2.0)
        # world up is the ies zenith
        th_up, _, _ = lamp.transform_to_lamp(np.array([[0.0, 0.0, 2.0]]), which="polar")
        assert th_up[0] == pytest.approx(180.0)

    def test_down_lamp_unchanged(self):
        lamp = Lamp.from_keyword("aerolamp", x=0, y=0, z=0, aimx=0, aimy=0, aimz=-1)
        th, _, _ = lamp.transform_to_lamp(np.array([[0.0, 0.0, -2.0]]), which="polar")
        assert th[0] == pytest.approx(0.0)

    def test_world_round_trip(self):
        lamp = Lamp.from_keyword("aerolamp", x=1, y=2, z=3, aimx=4, aimy=2, aimz=3, photometric_axis="horizontal_90")
        pts = np.array([[0.3, -0.2, 0.9], [-1.0, 0.5, 0.1]])
        ies = lamp.transform_to_lamp(pts - lamp.position)  # (3, N)
        back = lamp.transform_to_world(ies.T).T  # pose returns (3, N)
        np.testing.assert_allclose(back, pts, atol=1e-9)

    def test_photometric_coords_web_points_along_aim(self):
        lamp = Lamp.from_keyword("aerolamp", x=0, y=0, z=0, aimx=1, aimy=0, aimz=0, photometric_axis="horizontal_0")
        world = lamp.transform_to_world(lamp.photometric_coords, scale=lamp.values.max())
        # aerolamp is a downlight in its own frame; declared horizontal_0 its
        # file-frame beam (-z) lands on world... (the matrix sends ies -z to
        # local -x, i.e. world -z when banked). So most energy goes down.
        assert world[2].mean() < 0

    def test_surface_dims_permute_with_axis(self):
        # sterilray ies: width 0.3 (y), length 0.05 (x), height 0 (z)
        lamp = Lamp.from_keyword("sterilray", photometric_axis="horizontal_0")
        assert lamp.length == pytest.approx(0.0)      # ies height -> length
        assert lamp.width == pytest.approx(0.3)       # width stays
        assert lamp.surface.height == pytest.approx(0.05)  # ies length -> depth

    def test_set_axis_rederives_dims_unless_user_set(self):
        lamp = Lamp.from_keyword("sterilray")
        lamp.set_photometric_axis("horizontal_0")
        assert lamp.surface.height == pytest.approx(0.05)
        lamp.set_width(0.4)
        lamp.set_photometric_axis("down")
        assert lamp.width == pytest.approx(0.4)
        assert lamp.surface.height == pytest.approx(0.0)

    def test_calc_state_changes_with_axis(self):
        lamp = Lamp.from_keyword("aerolamp")
        before = lamp.calc_state
        lamp.set_photometric_axis("up")
        assert lamp.calc_state != before

    def test_to_dict_round_trip(self):
        lamp = Lamp.from_keyword("aerolamp", photometric_axis="horizontal_180", photometric_depth=0.04)
        loaded = Lamp.from_dict(lamp.to_dict())
        assert loaded.photometric_axis is PhotometricAxis.HORIZONTAL_180
        assert loaded.fixture.photometric_depth == pytest.approx(0.04)

    def test_legacy_dict_loads_defaults(self):
        data = Lamp.from_keyword("aerolamp").to_dict()
        data.pop("photometric_axis")
        data["fixture"].pop("photometric_depth")
        loaded = Lamp.from_dict(data)
        assert loaded.photometric_axis is PhotometricAxis.DOWN
        assert loaded.fixture.photometric_depth == 0.0

    def test_set_units_converts_depth(self):
        lamp = Lamp.from_keyword("aerolamp", photometric_depth=0.3048)
        lamp.set_units("feet")
        assert lamp.fixture.photometric_depth == pytest.approx(1.0)
        assert lamp.photometric_axis is PhotometricAxis.DOWN

    def test_room_calculates_with_horizontal_lamp(self):
        room = Room(x=4, y=3, z=2.7)
        lamp = Lamp.from_keyword("aerolamp", lamp_id="wall", x=0.05, y=1.5, z=2.3, aimx=4, aimy=1.5, aimz=2.3, photometric_axis="horizontal_0")
        room.add_lamp(lamp)
        room.calculate()
        zone = room.calc_zones["WholeRoomFluence"]
        assert np.nanmax(zone.values) > 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/guv-calcs && pytest tests/test_photometric_axis.py::TestLampIntegration -q`
Expected: FAIL with `unexpected keyword argument 'photometric_axis'`

- [ ] **Step 3: Thread the axis through `LampSurface.set_ies`**

In `lamp_surface.py`, add the import at the top (after the `IntensityMap` import):

```python
from .photometric_axis import PhotometricAxis
```

Replace `set_ies` with:

```python
    def set_ies(self, ies, override=False, axis=None):
        """
        Populate length/width/height/units values from an IESFile object.
        Only overwrites values if user didn't explicitly provide them. `axis`
        (a PhotometricAxis) permutes the file's extents into the aim frame.
        """
        if ies is not None:
            src = ies_units(ies)
            axis = PhotometricAxis.from_any(axis)
            length, width, height = axis.permute_extents(abs(ies.length), abs(ies.width), abs(ies.height))
            if self._user_units is None or override:
                self.units = src
            # the IES file only knows feet or meters; the surface may be in any
            # unit (e.g. a lamp restored into a centimeter room), so convert
            if self._user_width is None or override:
                self.width = convert_length(src, self.units, width)
            if self._user_length is None or override:
                self.length = convert_length(src, self.units, length)
            if self._user_height is None or override:
                self.height = convert_length(src, self.units, height)

            self._recompute()
```

- [ ] **Step 4: Lamp constructor, properties and transforms**

In `lamp.py`:

a) Import: alongside the existing `from .fixture import Fixture` style imports add `from .photometric_axis import PhotometricAxis`.

b) Constructor signature: after `housing_units=None,` add

```python
        photometric_axis=None,
        photometric_depth: float = 0.0,
```

c) Docstring, after the `housing_units` entry:

```
    photometric_axis: str or PhotometricAxis, default="down"
        Direction in the IES file's frame that the beam goes. "down" (theta=0)
        is the usual convention; wall-mounted upper-room fixtures are often
        "horizontal_0" (theta=90 toward phi=0). The aim always means the beam.
    photometric_depth: float, default=0.0
        Distance from the fixture's emitting face back to the photometric center.
```

d) Right after `self.enabled = ...` add:

```python
        self._photometric_axis = PhotometricAxis.from_any(photometric_axis)
```

e) In the housing-units conversion block, convert the depth too: after the `housing_height` conversion line add

```python
            photometric_depth = convert_length(h_units, target_units, photometric_depth)
```

f) Both `Fixture(...)` constructions in `__init__` (the placeholder and the finalize-after-IES one) get `photometric_depth=photometric_depth or 0.0,`.

g) `load_ies`: change `self.surface.set_ies(self.ies, override=override)` to

```python
        self.surface.set_ies(self.ies, override=override, axis=self._photometric_axis)
```

h) Replace `transform_to_world` / `transform_to_lamp`:

```python
    def transform_to_world(self, coords, scale=1, which="cartesian"):
        """
        Transform photometric (ies-frame) coordinates to the world.
        Scale parameter should generally only be used for photometric_coords.
        """
        coords = (self.photometric_axis_matrix @ np.asarray(coords, dtype=float).T).T
        return self.pose.transform_to_world(coords, scale=scale, which=which)

    def transform_to_lamp(self, coords, which="cartesian"):
        """Transform world-relative coordinates into the photometric (ies) frame."""
        local = self.pose.transform_to_lamp(coords, which="cartesian")
        ies = self.photometric_axis_matrix.T @ local
        if which == "polar":
            return to_polar(*ies)
        elif which == "cartesian":
            return ies
        raise ValueError(f"`which` must be polar or cartesian, not {which}")
```

(`to_polar` is already imported in `lamp.py`; if not, add `from ..geometry import to_polar`.)

i) In `irradiance_at`, change the near-field target line to

```python
            target = self.pose.inverse_rotation_matrix @ (self.photometric_axis_matrix @ local) + self.surface.position
```

j) Add next to the `# ---------------------- Surface` properties:

```python
    # ---------------------- Photometric axis ---------------------------

    @property
    def photometric_axis(self):
        return self._photometric_axis

    @property
    def photometric_axis_matrix(self):
        """rotation taking ies-frame vectors into the aim frame"""
        return self._photometric_axis.matrix

    def set_photometric_axis(self, axis):
        """Declare where the beam points in the IES frame; re-derives file dimensions."""
        self._photometric_axis = PhotometricAxis.from_any(axis)
        if self.ies is not None:
            self.surface.set_ies(self.ies, axis=self._photometric_axis)
        return self
```

k) `calc_state`: add `self._photometric_axis.value,` after `self.aimz,`.

l) `to_dict`: after `data["aimz"] = ...` add `data["photometric_axis"] = self._photometric_axis.value`.

m) `from_dict`: in the fixture-flatten block add `data["photometric_depth"] = fixture_data.get("photometric_depth", 0.0)`.

n) `_prepare_from_key`: change the tuple to `("housing_width", "housing_length", "housing_height", "photometric_depth")` and after that loop add

```python
        if config.get("photometric_axis") is not None:
            kwargs.setdefault("photometric_axis", config["photometric_axis"])
```

o) `set_units`: replace the fixture conversion block with

```python
        # Convert fixture dimensions if units changed
        if old_units != new_units:
            hw, hl, hh, pd = convert_length(
                old_units, new_units,
                self.fixture.housing_width,
                self.fixture.housing_length,
                self.fixture.housing_height,
                self.fixture.photometric_depth,
            )
            self.geometry._fixture = Fixture(
                housing_width=hw,
                housing_length=hl,
                housing_height=hh,
                photometric_depth=pd,
                shape=self.fixture.shape,
            )
```

- [ ] **Step 5: Run the whole guv_calcs suite**

Run: `cd ~/guv-calcs && pytest -q -x`
Expected: all pass, including `TestBoundingBoxDepth::test_depth_slides_housing_forward` from Task 2. If `test_photometric_coords_web_points_along_aim` fails on sign, drop it: the other transform tests pin the convention.

- [ ] **Step 6: Changelog**

Under `## [Unreleased]` → `### Added` in `~/guv-calcs/CHANGELOG.md` add:

```
- Lamp(photometric_axis=...) / Lamp.set_photometric_axis(): declare where the beam points in the IES file's frame ("down", "up", "horizontal_0/90/180/270"). The aim always means the beam; file dimensions are permuted into the aim frame; serialized in to_dict
- Fixture.photometric_depth: how far the photometric center sits behind the emitting face, so a housing can be centered on the point
```

Under `### Changed`:

```
- Housing bounding box shows a 3D luminous opening (surface height) in both directions along the aim axis instead of only in front
```

- [ ] **Step 7: Commit (guv-calcs)**

```bash
cd ~/guv-calcs && git add -A src/guv_calcs/lamp tests CHANGELOG.md && git commit -m "lamp photometric axis: transforms, dimension remap, serialization; depth converts with units"
```

---

### Task 4: API schemas and pass-through (PATCH, advanced settings, units, creation, type change, upload)

**Files:**
- Modify: `api/api/v1/session_schemas.py` (`SessionLampInput`, `SessionLampUpdate`, `SetUnitsLampCoords`, `AdvancedLampSettingsResponse`)
- Modify: `api/api/v1/session_helpers.py:289-340` (`_create_lamp_from_input`)
- Modify: `api/api/v1/lamp_session_routers.py` (PATCH handler ~180-262, upload ~690-770, advanced GET ~1225-1290)
- Modify: `api/api/v1/session_core.py:264-282` (set-units coords)
- Test: `api/tests/test_photometric_axis.py` (new)

**Interfaces:**
- Consumes: `Lamp.set_photometric_axis`, `Lamp.photometric_axis`, `Fixture.photometric_depth` (Task 3).
- Produces: `PhotometricAxisToken` Literal; request fields `photometric_axis`, `photometric_depth` on `SessionLampInput` and `SessionLampUpdate`; response fields on `AdvancedLampSettingsResponse` and `SetUnitsLampCoords`.

- [ ] **Step 1: Write the failing tests**

```python
# api/tests/test_photometric_axis.py
"""Photometric axis / depth pass-through on session lamps."""

import io
import json

import pytest

from tests.conftest import API


def _advanced(client, headers, lamp_id):
    r = client.get(f"{API}/session/lamps/{lamp_id}/advanced-settings", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


class TestPatchRoundTrip:
    def test_defaults(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        adv = _advanced(client, headers, lamp_id)
        assert adv["photometric_axis"] == "down"
        assert adv["photometric_depth"] == 0.0

    def test_patch_axis_and_depth(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        r = client.patch(
            f"{API}/session/lamps/{lamp_id}",
            json={"photometric_axis": "horizontal_0", "photometric_depth": 0.05},
            headers=headers,
        )
        assert r.status_code == 200, r.text
        adv = _advanced(client, headers, lamp_id)
        assert adv["photometric_axis"] == "horizontal_0"
        assert adv["photometric_depth"] == pytest.approx(0.05)

    def test_invalid_axis_422(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        r = client.patch(f"{API}/session/lamps/{lamp_id}", json={"photometric_axis": "sideways"}, headers=headers)
        assert r.status_code == 422

    def test_axis_permutes_ies_dimensions(self, lamp_with_ies_session):
        # ushio_b1 ies: width 0.045 (y), length 0.06 (x), height 0
        client, headers, lamp_id = lamp_with_ies_session
        client.patch(f"{API}/session/lamps/{lamp_id}", json={"photometric_axis": "horizontal_0"}, headers=headers)
        adv = _advanced(client, headers, lamp_id)
        assert adv["source_length"] == pytest.approx(0.0)
        assert adv["source_width"] == pytest.approx(0.045)
        assert adv["source_depth"] == pytest.approx(0.06)

    def test_survives_lamp_type_change(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        client.patch(f"{API}/session/lamps/{lamp_id}", json={"preset_id": "custom"}, headers=headers)
        client.patch(
            f"{API}/session/lamps/{lamp_id}",
            json={"photometric_axis": "horizontal_90", "photometric_depth": 0.02},
            headers=headers,
        )
        r = client.patch(f"{API}/session/lamps/{lamp_id}", json={"lamp_type": "lp_254"}, headers=headers)
        assert r.status_code == 200, r.text
        adv = _advanced(client, headers, lamp_id)
        assert adv["photometric_axis"] == "horizontal_90"
        assert adv["photometric_depth"] == pytest.approx(0.02)

    def test_survives_ies_upload(self, custom_lamp_session, ies_file_bytes):
        client, headers, lamp_id = custom_lamp_session
        client.patch(
            f"{API}/session/lamps/{lamp_id}",
            json={"photometric_axis": "horizontal_0", "photometric_depth": 0.03},
            headers=headers,
        )
        r = client.post(
            f"{API}/session/lamps/{lamp_id}/ies",
            files={"file": ("a.ies", io.BytesIO(ies_file_bytes))},
            headers=headers,
        )
        assert r.status_code == 200, r.text
        adv = _advanced(client, headers, lamp_id)
        assert adv["photometric_axis"] == "horizontal_0"
        assert adv["photometric_depth"] == pytest.approx(0.03)
        assert adv["source_depth"] == pytest.approx(0.06)  # ies length became depth


class TestUnitsAndInit:
    def test_set_units_converts_depth(self, lamp_with_ies_session):
        client, headers, lamp_id = lamp_with_ies_session
        client.patch(f"{API}/session/lamps/{lamp_id}", json={"photometric_depth": 0.3048}, headers=headers)
        r = client.patch(f"{API}/session/units", json={"units": "feet"}, headers=headers)
        assert r.status_code == 200, r.text
        assert r.json()["lamps"][lamp_id]["photometric_depth"] == pytest.approx(1.0, abs=1e-6)
        adv = _advanced(client, headers, lamp_id)
        assert adv["photometric_axis"] == "down"

    def test_init_accepts_fields(self, client, session_headers, minimal_room_config):
        resp = client.post(
            f"{API}/session/init",
            json={
                "room": minimal_room_config,
                "lamps": [{
                    "lamp_type": "krcl_222", "preset_id": "aerolamp",
                    "x": 2.0, "y": 3.0, "z": 2.7, "aimx": 2.0, "aimy": 3.0, "aimz": 0.0,
                    "photometric_axis": "up", "photometric_depth": 0.01,
                }],
                "zones": [],
            },
            headers=session_headers,
        )
        assert resp.status_code == 200, resp.text
        lamp_id = client.get(f"{API}/session/status", headers=session_headers).json()["lamp_ids"][0]
        adv = _advanced(client, session_headers, lamp_id)
        assert adv["photometric_axis"] == "up"
        assert adv["photometric_depth"] == pytest.approx(0.01)


class TestSaveLoad:
    def test_legacy_guv_loads_with_defaults(self, client):
        import copy
        import pathlib
        legacy = json.loads((pathlib.Path(__file__).parent / "fixtures" / "legacy_preview_lamp.guv").read_text())
        new_sid = client.post(f"{API}/session/create").json()["session_id"]
        headers = {"X-Session-ID": new_sid}
        r = client.post(f"{API}/session/load", json=copy.deepcopy(legacy), headers=headers)
        assert r.status_code == 200, r.text
        lamp_id = r.json()["lamps"][0]["id"]
        adv = _advanced(client, headers, lamp_id)
        assert adv["photometric_axis"] == "down"
        assert adv["photometric_depth"] == 0.0

    def test_guv_round_trip(self, lamp_with_ies_session, client):
        _, headers, lamp_id = lamp_with_ies_session
        client.patch(
            f"{API}/session/lamps/{lamp_id}",
            json={"photometric_axis": "horizontal_270", "photometric_depth": 0.07},
            headers=headers,
        )
        saved = json.loads(client.get(f"{API}/session/save", headers=headers).content)
        new_sid = client.post(f"{API}/session/create").json()["session_id"]
        new_headers = {"X-Session-ID": new_sid}
        r = client.post(f"{API}/session/load", json=saved, headers=new_headers)
        assert r.status_code == 200, r.text
        adv = _advanced(client, new_headers, lamp_id)
        assert adv["photometric_axis"] == "horizontal_270"
        assert adv["photometric_depth"] == pytest.approx(0.07)
```

Check how `tests/test_save_load_export.py::_new_session` creates a session (lines 14-30) and copy its exact calls into both `TestSaveLoad` tests if `POST /session/create` is not the right path.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/illuminate-v2/api && uv run --frozen pytest tests/test_photometric_axis.py -q`
Expected: FAIL (KeyError `photometric_axis` on the response; 200 instead of 422)

- [ ] **Step 3: Schemas**

In `session_schemas.py`, near the top with the other Literals add:

```python
PhotometricAxisToken = Literal["down", "up", "horizontal_0", "horizontal_90", "horizontal_180", "horizontal_270"]
```

`SessionLampInput`: after `enabled: bool = True` add

```python
    photometric_axis: Optional[PhotometricAxisToken] = None
    photometric_depth: Optional[float] = Field(default=None, ge=0)
```

`SessionLampUpdate`: after `housing_height: Optional[float] = None` add

```python
    # Advanced settings - photometric frame / mounting
    photometric_axis: Optional[PhotometricAxisToken] = None
    photometric_depth: Optional[float] = Field(default=None, ge=0)
```

`SetUnitsLampCoords`: after `housing_height` add `photometric_depth: Optional[float] = None`.

`AdvancedLampSettingsResponse`: after `housing_height` add

```python
    photometric_axis: PhotometricAxisToken = "down"
    photometric_depth: float = 0.0
```

- [ ] **Step 4: Creation helper**

In `session_helpers.py` `_create_lamp_from_input`, build a kwargs dict once before the branches:

```python
    axis_kwargs = {}
    if getattr(lamp_input, "photometric_axis", None) is not None:
        axis_kwargs["photometric_axis"] = lamp_input.photometric_axis
    if getattr(lamp_input, "photometric_depth", None) is not None:
        axis_kwargs["photometric_depth"] = lamp_input.photometric_depth
```

and pass `**axis_kwargs,` into every `Lamp.from_keyword(...)` / `Lamp(...)` call in that function (there are three branches: preset, other, default).

- [ ] **Step 5: PATCH handler**

In `lamp_session_routers.py` `update_session_lamp`, replace the housing block with:

```python
            # Photometric frame (where the beam points in the IES file)
            if updates.photometric_axis is not None:
                lamp.set_photometric_axis(updates.photometric_axis)

            # Apply housing dimensions / depth (Fixture is frozen, so replace it)
            if (updates.housing_width is not None or updates.housing_length is not None
                    or updates.housing_height is not None or updates.photometric_depth is not None):
                current = lamp.fixture
                lamp.geometry._fixture = Fixture(
                    housing_width=updates.housing_width if updates.housing_width is not None else current.housing_width,
                    housing_length=updates.housing_length if updates.housing_length is not None else current.housing_length,
                    housing_height=updates.housing_height if updates.housing_height is not None else current.housing_height,
                    photometric_depth=updates.photometric_depth if updates.photometric_depth is not None else current.photometric_depth,
                    shape=current.shape,
                )
```

In the lamp-type-change block, add `photometric_axis=lamp.photometric_axis,` and `photometric_depth=lamp.fixture.photometric_depth,` to both `new_lamp = Lamp(...)` calls (the `old_fixture` restore already carries depth when IES is restored; the ctor kwarg covers the no-IES path).

Order matters: the axis/housing block must run after the type-change block so it applies to `new_lamp`. Check the current order: housing is applied before the type change today. Move the whole block (axis + fixture) to just after `lamp.set_wavelength(updates.wavelength)` handling and before the `preset_id == "custom"` block.

- [ ] **Step 6: Upload handler**

In `upload_session_lamp_ies`, replace the `else:` fixture rebuild with

```python
                lamp.geometry._fixture = Fixture(
                    housing_width=lamp.surface.width,
                    housing_length=lamp.surface.length,
                    photometric_depth=old_fixture.photometric_depth,
                )
```

(`load_ies` already permutes the dimensions through the lamp's axis after Task 3.)

- [ ] **Step 7: Advanced GET and set-units coords**

In `get_session_lamp_advanced_settings` add to the response:

```python
            photometric_axis=lamp.photometric_axis.value,
            photometric_depth=float(lamp.fixture.photometric_depth),
```

and fix the existing line `source_depth=lamp.depth,` to `source_depth=lamp.surface.height,`: `Lamp.depth` is the backward-compatible alias for *housing_height*, so the GET has been reporting the housing height as the luminous depth (the PATCH side correctly writes `surface.set_height`). `test_axis_permutes_ies_dimensions` depends on the fix.

In `session_core.py` set-units lamp coords add `photometric_depth=lamp.fixture.photometric_depth if lamp.fixture else None,`.

- [ ] **Step 8: Run tests**

Run: `cd ~/illuminate-v2/api && uv run --frozen pytest tests/test_photometric_axis.py tests/test_session_extended_crud.py tests/test_length_units.py tests/test_save_load_export.py -q`
Expected: all pass

- [ ] **Step 9: Commit**

```bash
cd ~/illuminate-v2 && git add api/api/v1/session_schemas.py api/api/v1/session_helpers.py api/api/v1/lamp_session_routers.py api/api/v1/session_core.py api/tests/test_photometric_axis.py && git commit -m "feat(api): photometric_axis and photometric_depth on session lamps"
```

---

### Task 5: Session photometric web in the aim frame

**Files:**
- Modify: `api/api/v1/lamp_session_routers.py:1455-1475` (`get_session_lamp_photometric_web`)
- Test: `api/tests/test_photometric_axis.py` (append)

- [ ] **Step 1: Write the failing test**

```python
class TestPhotometricWeb:
    def test_horizontal_axis_mesh_points_down_aim(self, lamp_with_ies_session):
        # declared horizontal_0, ushio's file-frame beam (-z) lands on local -x,
        # so the web's mass moves off -z: the aim-frame mesh is what the
        # frontend rotates, and it must differ from the file frame
        client, headers, lamp_id = lamp_with_ies_session
        before = client.get(f"{API}/session/lamps/{lamp_id}/photometric-web", headers=headers).json()
        client.patch(f"{API}/session/lamps/{lamp_id}", json={"photometric_axis": "horizontal_0"}, headers=headers)
        after = client.get(f"{API}/session/lamps/{lamp_id}/photometric-web", headers=headers).json()
        zb = sum(v[2] for v in before["vertices"]) / len(before["vertices"])
        xa = sum(v[0] for v in after["vertices"]) / len(after["vertices"])
        za = sum(v[2] for v in after["vertices"]) / len(after["vertices"])
        assert zb < 0                      # downlight in its own frame
        assert xa == pytest.approx(zb, rel=1e-6)   # ies -z -> local -x
        assert abs(za) < abs(zb) * 0.05
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ~/illuminate-v2/api && uv run --frozen pytest tests/test_photometric_axis.py::TestPhotometricWeb -q`
Expected: FAIL on `xa == zb`

- [ ] **Step 3: Apply the axis matrix**

In the session web endpoint replace

```python
        coords = lamp.photometric_coords / init_scale * power_scale * unit_factor  # (N, 3)
```

with

```python
        # Rotate the file-frame coords into the aim frame; the frontend applies
        # the aim pose itself, so the mesh must be canonical in the AIM frame.
        aim_coords = (lamp.photometric_axis_matrix @ lamp.photometric_coords.T).T
        coords = aim_coords / init_scale * power_scale * unit_factor  # (N, 3)
```

and update the comment block above it ("Return photometric web in CANONICAL orientation") to say "canonical aim-frame orientation".

- [ ] **Step 4: Run to verify it passes, then commit**

Run: `cd ~/illuminate-v2/api && uv run --frozen pytest tests/test_photometric_axis.py -q`

```bash
cd ~/illuminate-v2 && git add api/api/v1/lamp_session_routers.py api/tests/test_photometric_axis.py && git commit -m "fix(api): session photometric web honours the lamp's photometric axis"
```

---

### Task 6: Stateless `POST /lamps/analyze-ies`

**Files:**
- Modify: `api/api/v1/lamp_routers.py` (new schema + endpoint after `get_lamp_content_hash`)
- Test: `api/tests/test_photometric_axis.py` (append) and a synthetic-IES helper in it

**Interfaces:**
- Produces: `IesAnalysisResponse { suggested_axis: PhotometricAxisToken, axis_scores: dict[str,float], ies_dimensions: {width,length,height} (meters), vertices: list[[x,y,z]], triangles: list[[i,j,k]], extents_by_axis: dict[str, {length,width,height}] (meters, aim frame) }`. (Spec said `fixture_bounds_by_axis`; extents are the same information in 3 numbers and let the client re-run its bounds formula for any housing height/depth without a round trip.)

- [ ] **Step 1: Write the failing tests**

Append to `api/tests/test_photometric_axis.py`:

```python
import numpy as np


def _synthetic_ies(values, thetas, phis, width=0.5, length=0.5, height=0.0):
    """Minimal LM-63-2002 type C file. values: (n_phi, n_theta)."""
    lines = [
        "IESNA:LM-63-2002",
        "[TEST] synthetic",
        "TILT=NONE",
        f"1 -1 1 {len(thetas)} {len(phis)} 1 2 {width} {length} {height}",
        "1.0 1.0 10.0",
        " ".join(f"{t:g}" for t in thetas),
        " ".join(f"{p:g}" for p in phis),
    ]
    for row in values:
        lines.append(" ".join(f"{v:g}" for v in row))
    return ("\n".join(lines) + "\n").encode()


THETAS = list(range(0, 181, 10))        # 19
PHIS = [0, 90, 180, 270, 360]           # full 360 type C


def _downlight():
    v = np.ones((5, 19)); v[:, 0] = 100; v[:, 1] = 60
    return _synthetic_ies(v, THETAS, PHIS)


def _wall_sheet():
    # one-directional horizontal beam toward phi=0 (Lumalier-shaped)
    v = np.ones((5, 19)); v[0, 9] = 100; v[0, 10] = 60; v[4, 9] = 100; v[4, 10] = 60
    return _synthetic_ies(v, THETAS, PHIS, width=1.94, length=1.26, height=0.42)


def _four_way_sheet():
    # UV-Flow-shaped: horizontal sheet all around, slightly upward
    v = np.ones((5, 19)); v[:, 9] = 100; v[:, 10] = 100; v[:, 11] = 40
    return _synthetic_ies(v, THETAS, PHIS, width=0.58, length=0.58, height=0.12)


def _analyze(client, data):
    r = client.post(f"{API}/lamps/analyze-ies", files={"ies_file": ("a.ies", io.BytesIO(data))})
    assert r.status_code == 200, r.text
    return r.json()


class TestAnalyzeIes:
    def test_downlight_suggests_down(self, client):
        a = _analyze(client, _downlight())
        assert a["suggested_axis"] == "down"
        assert a["axis_scores"]["down"] > 0.5

    def test_wall_sheet_suggests_horizontal_0(self, client):
        a = _analyze(client, _wall_sheet())
        assert a["suggested_axis"] == "horizontal_0"
        assert a["axis_scores"]["horizontal_0"] > 2 * a["axis_scores"]["horizontal_90"]

    def test_four_way_sheet_suggests_down(self, client):
        a = _analyze(client, _four_way_sheet())
        assert a["suggested_axis"] == "down"
        assert a["axis_scores"]["down"] < 0.1

    def test_dimensions_and_extents(self, client):
        a = _analyze(client, _wall_sheet())
        assert a["ies_dimensions"] == pytest.approx({"width": 1.94, "length": 1.26, "height": 0.42})
        assert a["extents_by_axis"]["down"] == pytest.approx({"length": 1.26, "width": 1.94, "height": 0.42})
        assert a["extents_by_axis"]["horizontal_0"] == pytest.approx({"length": 0.42, "width": 1.94, "height": 1.26})
        assert set(a["extents_by_axis"]) == {"down", "up", "horizontal_0", "horizontal_90", "horizontal_180", "horizontal_270"}

    def test_web_present(self, client):
        a = _analyze(client, _downlight())
        assert len(a["vertices"]) > 10 and len(a["triangles"]) > 10

    def test_invalid_400(self, client):
        r = client.post(f"{API}/lamps/analyze-ies", files={"ies_file": ("a.ies", io.BytesIO(b"nope"))})
        assert r.status_code == 400
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd ~/illuminate-v2/api && uv run --frozen pytest tests/test_photometric_axis.py::TestAnalyzeIes -q`
Expected: 404s

- [ ] **Step 3: Implement**

In `lamp_routers.py`, add imports `from guv_calcs.lamp import PhotometricAxis  # type: ignore` and `from .session_schemas import PhotometricAxisToken`, then after `get_lamp_content_hash`:

```python
class IesAnalysisResponse(BaseModel):
    """Stateless analysis of an uploaded IES file for the orientation picker."""
    suggested_axis: PhotometricAxisToken
    axis_scores: Dict[str, float] = Field(description="Fraction of emitted power within 45 degrees of each axis")
    ies_dimensions: Dict[str, float] = Field(description="width/length/height as the file states them, meters")
    vertices: List[List[float]] = Field(description="Photometric web in the file's own frame, meters")
    triangles: List[List[int]]
    extents_by_axis: Dict[str, Dict[str, float]] = Field(description="Surface length/width/height in the aim frame for each axis, meters")


def _axis_scores(lamp) -> Dict[str, float]:
    phot = lamp.ies.photometry.expanded()
    thetas = np.radians(np.asarray(phot.thetas, dtype=float))
    phis = np.radians(np.asarray(phot.phis, dtype=float))
    values = np.asarray(phot.values, dtype=float)  # (n_phi, n_theta)
    T, P = np.meshgrid(thetas, phis)
    dT = np.gradient(thetas) if len(thetas) > 1 else np.array([1.0])
    dP = np.gradient(phis) if len(phis) > 1 else np.array([1.0])
    weight = values * np.sin(T) * dT[None, :] * dP[:, None]
    dirs = np.stack([np.sin(T) * np.cos(P), np.sin(T) * np.sin(P), -np.cos(T)], axis=-1)
    total = float(weight.sum())
    cos45 = np.cos(np.radians(45))
    scores = {}
    for axis in PhotometricAxis:
        inside = (dirs @ axis.direction) >= cos45
        scores[axis.value] = float(weight[inside].sum() / total) if total > 0 else 0.0
    return scores


def _suggest_axis(scores: Dict[str, float]) -> str:
    down, up = scores["down"], scores["up"]
    horizontals = sorted(
        ((scores[a.value], a.value) for a in PhotometricAxis if a.is_horizontal), reverse=True
    )
    best, second = horizontals[0], horizontals[1]
    # a horizontal axis wins only when one direction clearly dominates the
    # others: four-way or omnidirectional sheets are correct as "down"
    if best[0] > max(down, up) and best[0] >= 2 * second[0]:
        return best[1]
    if up > down and up > best[0]:
        return "up"
    return "down"


@lamp_router.post(
    "/lamps/analyze-ies",
    summary="Analyze an IES file's beam direction and dimensions",
    description=(
        "Stateless. Scores the six photometric axes by emitted power, suggests one, "
        "and returns the file-frame photometric web plus the surface extents each axis "
        "would produce, for the custom-lamp orientation picker."
    ),
    response_model=IesAnalysisResponse,
)
async def analyze_lamp_ies(ies_file: UploadFile = File(...)):
    if Delaunay is None:
        raise HTTPException(status_code=500, detail="scipy is required for photometric web visualization")
    try:
        ies_bytes = await _read_and_validate_upload(ies_file, MAX_IES_FILE_SIZE, _validate_ies_content)
        lamp = Lamp(filedata=ies_bytes, x=0, y=0, z=0, aimx=0, aimy=0, aimz=-1)
        if lamp.ies is None:
            raise HTTPException(status_code=400, detail="No photometric data in file")

        scores = _axis_scores(lamp)

        init_scale = lamp.values.max()
        power_scale = lamp.get_total_power() / 100.0
        coords = lamp.photometric_coords / init_scale * power_scale  # file frame, meters
        Theta, Phi, _ = to_polar(*lamp.photometric_coords.T)
        tri = Delaunay(np.column_stack((Theta.flatten(), Phi.flatten())))

        header = lamp.ies.header
        to_m = convert_length("feet" if header.units == 1 else "meters", "meters", 1.0)
        dims = {"width": abs(header.width) * to_m, "length": abs(header.length) * to_m, "height": abs(header.height) * to_m}
        extents = {}
        for axis in PhotometricAxis:
            length, width, height = axis.permute_extents(dims["length"], dims["width"], dims["height"])
            extents[axis.value] = {"length": length, "width": width, "height": height}

        return IesAnalysisResponse(
            suggested_axis=_suggest_axis(scores),
            axis_scores=scores,
            ies_dimensions=dims,
            vertices=[[float(c[0]), float(c[1]), float(c[2])] for c in coords],
            triangles=[[int(s[0]), int(s[1]), int(s[2])] for s in tri.simplices],
            extents_by_axis=extents,
        )
    except Exception as e:
        _log_and_raise("Failed to analyze IES file", e)
```

Check `header.units` is the LM-63 code (1 = feet, 2 = meters) by printing `lamp.ies.header.units` for ushio_b1 (`Units.METERS: 2` was printed during exploration; compare with `== 1` or use `.value` if it is an enum: `int(header.units) == 1`).

- [ ] **Step 4: Run tests, commit**

Run: `cd ~/illuminate-v2/api && uv run --frozen pytest tests/test_photometric_axis.py tests/test_lamp_content.py -q`
Expected: all pass. If photompy rejects the synthetic file, print the exception and adjust the header (e.g. add `[MANUFAC]` or a trailing newline) until `Lamp(filedata=...)` loads it.

```bash
cd ~/illuminate-v2 && git add api/api/v1/lamp_routers.py api/tests/test_photometric_axis.py && git commit -m "feat(api): stateless IES analysis endpoint scoring the six photometric axes"
```

---

### Task 7: Regenerate the contract and adopt the new types in the UI client

**Files:**
- Regenerate: `api/openapi.json`, `ui/src/lib/api/generated/api-types.ts` (`make generate-api`)
- Modify: `ui/src/lib/api/contract.ts`, `ui/src/lib/api/client.ts`
- Test: `pnpm check`

**Interfaces:**
- Produces: `IesAnalysisResponse`, `PhotometricAxisToken` aliases in `contract.ts`; `analyzeLampIes(file: File): Promise<IesAnalysisResponse>` in `client.ts`; `AdvancedLampUpdate.photometric_axis?/photometric_depth?`, `AdvancedLampSettingsResponse.photometric_axis/photometric_depth`, `SetUnitsLampCoords.photometric_depth?`.

- [ ] **Step 1: Regenerate**

Run: `cd ~/illuminate-v2 && make generate-api && git status --short api/openapi.json ui/src/lib/api/generated/api-types.ts`
Expected: both files modified; `grep -c "analyze-ies" api/openapi.json` ≥ 1.

- [ ] **Step 2: Aliases**

Append to `ui/src/lib/api/contract.ts`:

```ts
/**
 * Response from the stateless IES analysis endpoint (`POST /lamps/analyze-ies`):
 * axis scores + suggestion, file-frame web, and per-axis surface extents.
 */
export type IesAnalysisResponse = components['schemas']['IesAnalysisResponse'];

/**
 * Where a lamp's beam points in its IES file's frame
 * (`SessionLampUpdate.photometric_axis`). Six axis-aligned tokens.
 */
export type PhotometricAxisToken = NonNullable<components['schemas']['SessionLampUpdate']['photometric_axis']>;
```

- [ ] **Step 3: Client**

In `client.ts`, import `IesAnalysisResponse, PhotometricAxisToken` from `./contract` (extend the existing import list at the top). Add to `AdvancedLampSettingsResponse`:

```ts
  photometric_axis: PhotometricAxisToken;
  photometric_depth: number;
```

to `AdvancedLampUpdate`:

```ts
  photometric_axis?: PhotometricAxisToken;
  photometric_depth?: number;
```

to `SetUnitsLampCoords`: `photometric_depth?: number | null;`

And after `getLampContentHash`:

```ts
/**
 * Stateless beam-direction analysis of an IES file for the orientation
 * picker. No session header required.
 */
export async function analyzeLampIes(iesFile: File): Promise<IesAnalysisResponse> {
  const formData = new FormData();
  formData.append('ies_file', iesFile);
  const response = await fetch(`${API_BASE}/lamps/analyze-ies`, {
    method: 'POST',
    body: formData,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.detail || `Failed to analyze IES file (${response.status})`);
  }
  return response.json();
}
```

(Mirror the error handling that `getLampContentHash` uses below its `fetch`; copy it exactly.)

- [ ] **Step 4: Check and commit**

Run: `cd ~/illuminate-v2/ui && pnpm check`
Expected: 0 errors.

```bash
cd ~/illuminate-v2 && git add api/openapi.json ui/src/lib/api/generated/api-types.ts ui/src/lib/api/contract.ts ui/src/lib/api/client.ts && git commit -m "chore(contract): regenerate API types for photometric axis; analyzeLampIes client"
```

---

### Task 8: `photometricAxis.ts` pure helpers (UI)

**Files:**
- Create: `ui/src/lib/utils/photometricAxis.ts`
- Test: `ui/src/lib/utils/photometricAxis.test.ts`

**Interfaces:**
- Produces:
  - `PHOTOMETRIC_AXES`, `type PhotometricAxis` (same six tokens), `AXIS_LABELS: Record<PhotometricAxis,string>`
  - `axisDirection(axis): Vec3` (IES frame, θ=0 → −z)
  - `axisMatrix(axis): Mat3` (IES → aim), `transposeMat3`, `applyMat3(m, v)`
  - `snapToAxis(dir: Vec3): PhotometricAxis`
  - `permuteExtents(axis, {length,width,height})`
  - `fixtureBoundsLocal({housingWidth, housingLength, housingHeight, surfaceHeight, depth}): number[][]` (8 corners, guv_calcs local frame, same order as backend)
  - `centeredDepth(housingHeight): number`
  - `axisReadout(axis): string`
  - `guvToThreeMatrix(m: Mat3): Mat3` (conjugate by the x,z,−y swap) so a Three group can take the rotation.

- [ ] **Step 1: Write the failing tests**

```ts
// ui/src/lib/utils/photometricAxis.test.ts
import { describe, it, expect } from 'vitest';
import {
  PHOTOMETRIC_AXES, axisDirection, axisMatrix, applyMat3, transposeMat3, snapToAxis,
  permuteExtents, fixtureBoundsLocal, centeredDepth, axisReadout, guvToThreeMatrix,
} from './photometricAxis';

const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9));

describe('axisMatrix', () => {
  it('sends each beam direction to -z', () => {
    for (const axis of PHOTOMETRIC_AXES) close(applyMat3(axisMatrix(axis), axisDirection(axis)), [0, 0, -1]);
  });
  it('sends the zenith to local +x for horizontal axes', () => {
    close(applyMat3(axisMatrix('horizontal_0'), [0, 0, 1]), [1, 0, 0]);
    close(applyMat3(axisMatrix('horizontal_270'), [0, 0, 1]), [1, 0, 0]);
  });
  it('transpose inverts', () => {
    const m = axisMatrix('horizontal_90');
    close(applyMat3(transposeMat3(m), applyMat3(m, [0.3, -0.2, 0.9])), [0.3, -0.2, 0.9]);
  });
});

describe('snapToAxis', () => {
  it('picks the nearest axis by angle', () => {
    expect(snapToAxis([0.1, 0.05, -1])).toBe('down');
    expect(snapToAxis([1, 0.2, 0.1])).toBe('horizontal_0');
    expect(snapToAxis([-0.2, -1, 0])).toBe('horizontal_270');
    expect(snapToAxis([0, 0, 1])).toBe('up');
  });
});

describe('permuteExtents', () => {
  it('matches guv_calcs for horizontal_0', () => {
    expect(permuteExtents('horizontal_0', { length: 1.26, width: 1.94, height: 0.42 })).toEqual({ length: 0.42, width: 1.94, height: 1.26 });
  });
  it('is identity for down', () => {
    expect(permuteExtents('down', { length: 1, width: 2, height: 3 })).toEqual({ length: 1, width: 2, height: 3 });
  });
});

describe('fixtureBoundsLocal', () => {
  const zs = (c: number[][]) => [Math.min(...c.map((p) => p[2])), Math.max(...c.map((p) => p[2]))];
  it('matches guv_calcs: face at point, housing behind', () => {
    const c = fixtureBoundsLocal({ housingWidth: 0.12, housingLength: 0.12, housingHeight: 0.08, surfaceHeight: 0, depth: 0 });
    expect(c).toHaveLength(8);
    expect(zs(c)).toEqual([0, 0.08]);
    expect(c[0]).toEqual([-0.06, -0.06, 0]);
  });
  it('centers a luminous volume', () => {
    expect(zs(fixtureBoundsLocal({ housingWidth: 0.58, housingLength: 0.58, housingHeight: 0, surfaceHeight: 0.12, depth: 0 }))).toEqual([-0.06, 0.06]);
  });
  it('slides with depth', () => {
    expect(zs(fixtureBoundsLocal({ housingWidth: 0.1, housingLength: 0.1, housingHeight: 0.12, surfaceHeight: 0, depth: 0.06 }))).toEqual([-0.06, 0.06]);
  });
});

describe('misc', () => {
  it('centeredDepth is half the housing height', () => expect(centeredDepth(0.12)).toBeCloseTo(0.06));
  it('readout names the direction', () => {
    expect(axisReadout('down')).toMatch(/straight down/i);
    expect(axisReadout('horizontal_0')).toMatch(/0°/);
    expect(axisReadout('horizontal_0')).toMatch(/wall/i);
  });
  it('guvToThreeMatrix maps the horizontal beam to Three -y', () => {
    // ies +x is Three +x; after rotation it must point down (Three -y)
    close(applyMat3(guvToThreeMatrix(axisMatrix('horizontal_0')), [1, 0, 0]), [0, -1, 0]);
    close(applyMat3(guvToThreeMatrix(axisMatrix('down')), [0.2, 0.3, 0.4]), [0.2, 0.3, 0.4]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd ~/illuminate-v2/ui && pnpm vitest run src/lib/utils/photometricAxis.test.ts`
Expected: FAIL, module not found

- [ ] **Step 3: Implement**

```ts
// ui/src/lib/utils/photometricAxis.ts
/**
 * Photometric axis helpers, mirroring guv_calcs `PhotometricAxis`.
 *
 * Frames: the IES frame puts theta=0 on -z, theta=90/phi=0 on +x and the
 * zenith on +z. The aim frame has -z = aim, +z = behind the surface, +x =
 * fixture length. `axisMatrix` rotates IES-frame vectors into the aim frame.
 * Keep the matrices in step with guv_calcs/lamp/photometric_axis.py.
 */

export const PHOTOMETRIC_AXES = ['down', 'up', 'horizontal_0', 'horizontal_90', 'horizontal_180', 'horizontal_270'] as const;
export type PhotometricAxis = (typeof PHOTOMETRIC_AXES)[number];

export const AXIS_LABELS: Record<PhotometricAxis, string> = {
  down: 'Down',
  up: 'Up',
  horizontal_0: '0°',
  horizontal_90: '90°',
  horizontal_180: '180°',
  horizontal_270: '270°',
};

export type Vec3 = [number, number, number];
export type Mat3 = [Vec3, Vec3, Vec3];

export function isPhotometricAxis(v: unknown): v is PhotometricAxis {
  return typeof v === 'string' && (PHOTOMETRIC_AXES as readonly string[]).includes(v);
}

function isHorizontal(axis: PhotometricAxis): boolean {
  return axis.startsWith('horizontal');
}

function phiOf(axis: PhotometricAxis): number {
  return Number(axis.split('_')[1]);
}

function rotY(deg: number): Mat3 {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
}

function rotZ(deg: number): Mat3 {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
}

function mulMat3(a: Mat3, b: Mat3): Mat3 {
  const r: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i][j] += a[i][k] * b[k][j];
  return r as Mat3;
}

function clean(m: Mat3): Mat3 {
  return m.map((row) => row.map((v) => (Math.abs(v) < 1e-12 ? 0 : Math.round(v * 1e12) / 1e12))) as Mat3;
}

export function transposeMat3(m: Mat3): Mat3 {
  return [[m[0][0], m[1][0], m[2][0]], [m[0][1], m[1][1], m[2][1]], [m[0][2], m[1][2], m[2][2]]];
}

export function applyMat3(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

/** Unit beam direction in the IES frame. */
export function axisDirection(axis: PhotometricAxis): Vec3 {
  if (axis === 'down') return [0, 0, -1];
  if (axis === 'up') return [0, 0, 1];
  const p = (phiOf(axis) * Math.PI) / 180;
  return [Math.cos(p), Math.sin(p), 0];
}

/** Rotation taking IES-frame vectors into the aim frame (beam -> -z). */
export function axisMatrix(axis: PhotometricAxis): Mat3 {
  if (axis === 'down') return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  if (axis === 'up') return clean(rotY(180));
  return clean(mulMat3(rotY(90), rotZ(-phiOf(axis))));
}

/** Nearest of the six axes to an IES-frame direction. */
export function snapToAxis(dir: Vec3): PhotometricAxis {
  let best: PhotometricAxis = 'down';
  let bestDot = -Infinity;
  const n = Math.hypot(...dir) || 1;
  for (const axis of PHOTOMETRIC_AXES) {
    const d = axisDirection(axis);
    const dot = (dir[0] * d[0] + dir[1] * d[1] + dir[2] * d[2]) / n;
    if (dot > bestDot) { bestDot = dot; best = axis; }
  }
  return best;
}

export interface Extents { length: number; width: number; height: number }

/** Map IES (x, y, z) extents onto aim-frame (length, width, height). */
export function permuteExtents(axis: PhotometricAxis, e: Extents): Extents {
  const m = axisMatrix(axis);
  const abs = m.map((r) => r.map(Math.abs)) as Mat3;
  const [length, width, height] = applyMat3(abs, [e.length, e.width, e.height]);
  return { length, width, height };
}

export interface FixtureBoundsInput {
  housingWidth: number;
  housingLength: number;
  housingHeight: number;
  surfaceHeight: number;
  depth: number;
}

/**
 * Eight housing-box corners in the guv_calcs local frame, same order and
 * formula as `LampGeometry.get_bounding_box_corners`: corners 0-3 at z_min,
 * 4-7 at z_max; z_min = min(-d, -s/2), z_max = max(h - d, s/2).
 */
export function fixtureBoundsLocal(i: FixtureBoundsInput): number[][] {
  const hl = i.housingLength / 2;
  const hw = i.housingWidth / 2;
  const s = i.surfaceHeight / 2;
  const zMin = Math.min(-i.depth, -s);
  const zMax = Math.max(i.housingHeight - i.depth, s);
  return [
    [-hl, -hw, zMin], [hl, -hw, zMin], [hl, hw, zMin], [-hl, hw, zMin],
    [-hl, -hw, zMax], [hl, -hw, zMax], [hl, hw, zMax], [-hl, hw, zMax],
  ];
}

export function centeredDepth(housingHeight: number): number {
  return housingHeight / 2;
}

export function axisReadout(axis: PhotometricAxis): string {
  if (axis === 'down') return 'Beam exits straight down in the file (θ = 0°); aim as usual.';
  if (axis === 'up') return 'Beam exits straight up in the file (θ = 180°); aim it upward to mount facing the ceiling.';
  return `Beam exits horizontally toward ${AXIS_LABELS[axis]} in the file; aim it horizontally to mount on a wall.`;
}

/**
 * Conjugate a guv_calcs-frame rotation by the guv -> Three axis swap
 * (x, y, z) -> (x, z, -y) so it can drive a Three.js group.
 */
export function guvToThreeMatrix(m: Mat3): Mat3 {
  const S: Mat3 = [[1, 0, 0], [0, 0, 1], [0, -1, 0]];
  const Sinv: Mat3 = transposeMat3(S);
  return clean(mulMat3(mulMat3(S, m), Sinv));
}
```

- [ ] **Step 4: Run tests, commit**

Run: `cd ~/illuminate-v2/ui && pnpm vitest run src/lib/utils/photometricAxis.test.ts`
Expected: all pass

```bash
cd ~/illuminate-v2 && git add ui/src/lib/utils/photometricAxis.ts ui/src/lib/utils/photometricAxis.test.ts && git commit -m "feat(ui): photometric axis helpers mirroring guv_calcs"
```

---

### Task 9: Definition fields, instance fields, apply flow, reinit replay, web cache key (UI store)

**Files:**
- Modify: `ui/src/lib/types/lampLibrary.ts` (`CustomLampDef`)
- Modify: `ui/src/lib/types/project.ts` (`LampInstance`)
- Modify: `ui/src/lib/stores/project.ts` (`advancedFieldsFromDef`, `applyCustomLamp`, `reuploadCustomFiles`)
- Modify: `ui/src/lib/components/photometricWeb.ts` (session cache key)
- Test: `ui/src/lib/stores/project.test.ts`, `ui/src/lib/components/photometricWeb.test.ts`

**Interfaces:**
- Consumes: `PhotometricAxis` type + `isPhotometricAxis` (Task 8); `placeSessionLamp` (existing client).
- Produces: `CustomLampDef.photometricAxis?: PhotometricAxis`, `CustomLampDef.housing.photometricDepth?: number`; `LampInstance.photometric_axis?: PhotometricAxis`, `LampInstance.photometric_depth?: number`.

- [ ] **Step 1: Write the failing tests**

Append inside the existing applyCustomLamp `describe` in `project.test.ts` (reuse its `baseDef`, mocks and `stubLampFileEndpoints`; add `placeSessionLamp: vi.fn()` to the `$lib/api/client` mock factory at the top of the file if it is not already mocked):

```ts
    it('applyCustomLamp sends the photometric axis and depth (in session units) with the property update', async () => {
      const { lampLibrary } = await import('$lib/stores/lampLibrary');
      vi.mocked(lampLibrary.get).mockReturnValue({
        ...baseDef,
        photometricAxis: 'horizontal_0',
        surface: { units: 'centimeters' },
        housing: { height: 12, photometricDepth: 6 },
      });
      vi.mocked(lampLibrary.toIesFile).mockReturnValue(new File(['ies'], 'test.ies'));
      const { project } = await import('./project');
      const id = await project.addLamp({
        lamp_type: 'lp_254', x: 1, y: 1, z: 2.5, aimx: 1, aimy: 1, aimz: 0, scaling_factor: 1, enabled: true,
      });
      await project.applyCustomLamp(id, 'def-1');
      const lamp = get(project).lamps.find((l) => l.id === id)!;
      expect(lamp.photometric_axis).toBe('horizontal_0');
      expect(lamp.photometric_depth).toBeCloseTo(0.06);
      expect(lamp.pending_advanced?.housing_height).toBeCloseTo(0.12);
      expect(lamp.pending_advanced?.photometric_depth).toBeCloseTo(0.06);
    });

    it('a horizontal definition applied to a default-aimed lamp runs horizontal placement once', async () => {
      const { lampLibrary } = await import('$lib/stores/lampLibrary');
      const { placeSessionLamp } = await import('$lib/api/client');
      vi.mocked(lampLibrary.get).mockReturnValue({ ...baseDef, photometricAxis: 'horizontal_90' });
      vi.mocked(lampLibrary.toIesFile).mockReturnValue(new File(['ies'], 'test.ies'));
      vi.mocked(placeSessionLamp).mockResolvedValue({
        x: 0.05, y: 1.5, z: 2.3, aimx: 4, aimy: 1.5, aimz: 2.3, angle: 0, tilt: 90, orientation: 0, position_index: 0,
      } as any);
      const { project } = await import('./project');
      const id = await project.addLamp({
        lamp_type: 'lp_254', x: 2, y: 1.5, z: 2.7, aimx: 2, aimy: 1.5, aimz: 0, scaling_factor: 1, enabled: true,
      });
      await project.applyCustomLamp(id, 'def-1');
      expect(placeSessionLamp).toHaveBeenCalledWith(id, 'horizontal');
      const lamp = get(project).lamps.find((l) => l.id === id)!;
      expect(lamp.aimz).toBeCloseTo(2.3);
      // re-applying (propagate after a def edit) must not move it again
      vi.mocked(placeSessionLamp).mockClear();
      await project.propagateCustomLampEdit('def-1');
      expect(placeSessionLamp).not.toHaveBeenCalled();
    });

    it('a down definition never triggers placement', async () => {
      const { lampLibrary } = await import('$lib/stores/lampLibrary');
      const { placeSessionLamp } = await import('$lib/api/client');
      vi.mocked(lampLibrary.get).mockReturnValue({ ...baseDef });
      vi.mocked(lampLibrary.toIesFile).mockReturnValue(new File(['ies'], 'test.ies'));
      const { project } = await import('./project');
      const id = await project.addLamp({
        lamp_type: 'krcl_222', x: 2, y: 1.5, z: 2.7, aimx: 2, aimy: 1.5, aimz: 0, scaling_factor: 1, enabled: true,
      });
      await project.applyCustomLamp(id, 'def-1');
      expect(placeSessionLamp).not.toHaveBeenCalled();
    });
```

Append to `photometricWeb.test.ts`:

```ts
  it('session key changes with photometric axis and depth', () => {
    const base = lamp({ preset_id: 'custom', custom_lamp_id: 'def-1', has_ies_file: true });
    const k0 = photometricWebCacheKey(base, 'meters');
    expect(photometricWebCacheKey({ ...base, photometric_axis: 'horizontal_0' }, 'meters')).not.toBe(k0);
    expect(photometricWebCacheKey({ ...base, photometric_depth: 0.05 }, 'meters')).not.toBe(k0);
    expect(photometricWebCacheKey({ ...base, photometric_axis: 'down', photometric_depth: 0 }, 'meters')).toBe(k0);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `cd ~/illuminate-v2/ui && pnpm vitest run src/lib/stores/project.test.ts src/lib/components/photometricWeb.test.ts`
Expected: the new tests fail (type errors / undefined fields / placement not called)

- [ ] **Step 3: Types**

`lampLibrary.ts`: add `import type { PhotometricAxis } from '$lib/utils/photometricAxis';` and in `CustomLampDef`:

```ts
  // Where the beam points in the IES file's frame (guv_calcs PhotometricAxis).
  // Undefined means 'down', the convention every bundled preset follows.
  photometricAxis?: PhotometricAxis;
  housing?: { width?: number; length?: number; height?: number; photometricDepth?: number };
```

(replace the existing `housing?` line.)

`project.ts` (types): add the import and, in `LampInstance` under `// Advanced settings`:

```ts
  photometric_axis?: PhotometricAxis;  // guv_calcs PhotometricAxis token; undefined = 'down'
  photometric_depth?: number;          // session units; undefined = 0
```

- [ ] **Step 4: Store**

In `advancedFieldsFromDef` add after the housing lines:

```ts
  if (def.housing?.photometricDepth != null) adv.photometric_depth = toSessionUnits(def.housing.photometricDepth);
```

In `applyCustomLamp`, after `partial.lamp_type = def.lampType` style lines (i.e. after building `partial` but before `advancedFieldsFromDef`) add:

```ts
      // Photometric frame travels with the property update (before the IES
      // upload) so load_ies permutes the file's dimensions through it.
      partial.photometric_axis = def.photometricAxis ?? 'down';
      const defUnits = toLengthUnit(def.surface?.units);
      partial.photometric_depth = def.housing?.photometricDepth != null
        ? convertLength(def.housing.photometricDepth, defUnits, get(userSettings).units)
        : 0;
```

Replace the final `this.updateLamp(lampId, partial);` with:

```ts
      const before = get({ subscribe }).lamps.find((l) => l.id === lampId);
      const firstApplication = before?.custom_lamp_id !== defId;
      this.updateLamp(lampId, partial);

      // First application of a wall-mounted (horizontal) definition to a lamp
      // still aimed straight down: put it on a wall aiming across the room, so
      // the first thing the user sees is the fixture emitting into the room.
      const isHorizontal = (def.photometricAxis ?? 'down').startsWith('horizontal');
      const aimedDown = !!before && before.aimx === before.x && before.aimy === before.y && before.aimz < before.z;
      if (firstApplication && isHorizontal && aimedDown) {
        try {
          const r = await placeSessionLamp(lampId, 'horizontal');
          this.updateLamp(lampId, {
            x: r.x, y: r.y, z: r.z, aimx: r.aimx, aimy: r.aimy, aimz: r.aimz, angle: r.angle ?? 0,
          });
        } catch (e) {
          console.warn('[session] horizontal placement after applying definition failed', e);
        }
      }
```

Import `placeSessionLamp` from `$lib/api/client` if not already imported in `project.ts`.

In `reuploadCustomFiles`, after the IES upload `try` block (inside the `for` loop, still inside `if (def)`), add:

```ts
    // Product fields (housing, depth, source dims, axis) live on the definition
    // and are lost with the session; re-apply them after the files.
    const adv = advancedFieldsFromDef(def, get(userSettings).units);
    const axisUpdate = {
      ...(adv ?? {}),
      photometric_axis: def.photometricAxis ?? 'down',
    };
    try {
      await updateSessionLampAdvanced(lamp.id, axisUpdate);
    } catch (e) {
      console.warn(`[session] Failed to re-apply definition fields for lamp ${lamp.id}:`, e);
    }
```

`advancedFieldsFromDef` is defined later in the file; function declarations hoist, so the call is fine. Import `updateSessionLampAdvanced` if not already imported.

`photometricWeb.ts` session branch: append `-${lamp.photometric_axis ?? 'down'}-${lamp.photometric_depth ?? 0}` to the returned template string.

- [ ] **Step 5: Run tests and check**

Run: `cd ~/illuminate-v2/ui && pnpm vitest run src/lib/stores/project.test.ts src/lib/components/photometricWeb.test.ts && pnpm check`
Expected: pass, 0 errors

- [ ] **Step 6: Commit**

```bash
cd ~/illuminate-v2 && git add ui/src/lib/types/lampLibrary.ts ui/src/lib/types/project.ts ui/src/lib/stores/project.ts ui/src/lib/stores/project.test.ts ui/src/lib/components/photometricWeb.ts ui/src/lib/components/photometricWeb.test.ts && git commit -m "feat(ui): custom lamp definitions carry photometric axis and depth; horizontal defs auto-place on a wall"
```

---

### Task 10: `PhotometricAxisPicker` component (scene + controls)

**Files:**
- Create: `ui/src/lib/components/PhotometricAxisScene.svelte` (Threlte scene; lives inside a `<Canvas>`)
- Create: `ui/src/lib/components/PhotometricAxisPicker.svelte` (canvas + six buttons + depth control + readout)
- Test: `ui/src/lib/components/PhotometricAxisPicker.test.ts`

**Interfaces:**
- Consumes: `IesAnalysisResponse` (Task 7), helpers (Task 8), `lampLocalToThree` from `$lib/utils/fixturePreviewGeometry`.
- Produces: `PhotometricAxisPicker` props:

```ts
interface Props {
  analysis: IesAnalysisResponse | null;   // null while loading / no file
  axis: PhotometricAxis;
  depth: number | undefined;               // in `units`
  housingWidth: number | undefined;        // in `units`; undefined -> permuted surface extent
  housingLength: number | undefined;
  housingHeight: number | undefined;
  units: LengthUnit;
  onAxisChange: (axis: PhotometricAxis) => void;
  onDepthChange: (depth: number | undefined) => void;
}
```

The six buttons carry `data-axis="<token>"` and `aria-pressed`, the readout has class `axis-readout`, the depth input has id `photometric-depth`, the preset buttons have classes `depth-face` and `depth-centered`.

- [ ] **Step 1: Write the failing component test**

```ts
// ui/src/lib/components/PhotometricAxisPicker.test.ts
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import PhotometricAxisPicker from './PhotometricAxisPicker.svelte';

// jsdom has no WebGL: stub the Threlte canvas and the scene.
vi.mock('@threlte/core', async () => ({ Canvas: (await import('./__mocks__/Empty.svelte')).default, T: {} }));
vi.mock('./PhotometricAxisScene.svelte', async () => ({ default: (await import('./__mocks__/Empty.svelte')).default }));

const analysis = {
  suggested_axis: 'horizontal_0',
  axis_scores: { down: 0, up: 0, horizontal_0: 0.85, horizontal_90: 0.04, horizontal_180: 0, horizontal_270: 0.04 },
  ies_dimensions: { width: 1.94, length: 1.26, height: 0.42 },
  vertices: [[0, 0, -1]],
  triangles: [],
  extents_by_axis: {
    down: { length: 1.26, width: 1.94, height: 0.42 },
    up: { length: 1.26, width: 1.94, height: 0.42 },
    horizontal_0: { length: 0.42, width: 1.94, height: 1.26 },
    horizontal_90: { length: 0.42, width: 1.26, height: 1.94 },
    horizontal_180: { length: 0.42, width: 1.94, height: 1.26 },
    horizontal_270: { length: 0.42, width: 1.26, height: 1.94 },
  },
} as any;

function setup(over: Partial<Record<string, unknown>> = {}) {
  const onAxisChange = vi.fn();
  const onDepthChange = vi.fn();
  const r = render(PhotometricAxisPicker, {
    props: {
      analysis, axis: 'horizontal_0', depth: undefined,
      housingWidth: undefined, housingLength: undefined, housingHeight: 0.3,
      units: 'meters', onAxisChange, onDepthChange, ...over,
    },
  });
  return { ...r, onAxisChange, onDepthChange };
}

describe('PhotometricAxisPicker', () => {
  it('marks the current axis pressed and dims zero-score handles', () => {
    setup();
    expect(screen.getByRole('button', { name: /^0°/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^Down/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /^Down/ }).className).toMatch(/dim/);
  });

  it('emits the clicked axis', async () => {
    const { onAxisChange } = setup();
    await fireEvent.click(screen.getByRole('button', { name: /^Up/ }));
    expect(onAxisChange).toHaveBeenCalledWith('up');
  });

  it('shows the readout for the axis', () => {
    setup();
    expect(document.querySelector('.axis-readout')!.textContent).toMatch(/0°/);
  });

  it('depth presets emit 0 and half the housing height', async () => {
    const { onDepthChange } = setup();
    await fireEvent.click(document.querySelector('.depth-face')!);
    expect(onDepthChange).toHaveBeenCalledWith(0);
    await fireEvent.click(document.querySelector('.depth-centered')!);
    expect(onDepthChange).toHaveBeenCalledWith(0.15);
  });

  it('centered preset is disabled without a housing height', () => {
    setup({ housingHeight: undefined });
    expect(document.querySelector('.depth-centered')).toBeDisabled();
  });

  it('typing a depth emits it', async () => {
    const { onDepthChange } = setup();
    const input = document.querySelector('#photometric-depth') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: '0.07' } });
    expect(onDepthChange).toHaveBeenCalledWith(0.07);
  });
});
```

Create `ui/src/lib/components/__mocks__/Empty.svelte` containing exactly:

```svelte
<script lang="ts">
	let { children } = $props();
</script>

{@render children?.()}
```

If `vi.mock` with a top-level `await import` fails, use `vi.mock('@threlte/core', () => import('./__mocks__/threlteCore'))` with a `threlteCore.ts` that re-exports `Empty` as `Canvas`. Check how `AdvancedLampSettingsModal.test.ts` renders a component that contains `<Canvas>` (lines 31-60) and copy its approach if it already solves this.

- [ ] **Step 2: Run to verify failure**

Run: `cd ~/illuminate-v2/ui && pnpm vitest run src/lib/components/PhotometricAxisPicker.test.ts`
Expected: FAIL, component not found

- [ ] **Step 3: Write the scene**

Write `ui/src/lib/components/PhotometricAxisScene.svelte` with the Write tool (tabs):

```svelte
<script lang="ts">
	import { T, useThrelte, useTask } from '@threlte/core';
	import { OrbitControls, interactivity, Text } from '@threlte/extras';
	import * as THREE from 'three';
	import { theme } from '$lib/stores/theme';
	import { lampLocalToThree } from '$lib/utils/fixturePreviewGeometry';
	import {
		PHOTOMETRIC_AXES, AXIS_LABELS, axisDirection, axisMatrix, transposeMat3, applyMat3,
		snapToAxis, guvToThreeMatrix, type PhotometricAxis
	} from '$lib/utils/photometricAxis';

	interface Props {
		vertices: number[][];          // IES frame, meters
		triangles: number[][];
		axis: PhotometricAxis;
		scores: Record<string, number>;
		fixtureBounds: number[][] | null;  // aim frame (guv local), scene units
		onPick: (axis: PhotometricAxis) => void;
	}

	let { vertices, triangles, axis, scores, fixtureBounds, onPick }: Props = $props();

	interactivity();

	const { scene } = useThrelte();
	$effect(() => {
		scene.background = new THREE.Color($theme === 'light' ? '#d0d7de' : '#1a1a2e');
	});

	// Normalise the web so its longest spoke is 1 scene unit
	const webRadius = $derived.by(() => {
		let r = 0;
		for (const [x, y, z] of vertices) r = Math.max(r, Math.hypot(x, y, z));
		return r || 1;
	});

	const webGeometry = $derived.by(() => {
		const g = new THREE.BufferGeometry();
		const pos: number[] = [];
		for (const v of vertices) {
			const [x, y, z] = lampLocalToThree([v[0] / webRadius, v[1] / webRadius, v[2] / webRadius]);
			pos.push(x, y, z);
		}
		g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
		if (triangles.length) g.setIndex(triangles.flat());
		g.computeVertexNormals();
		return g;
	});

	// Target rotation: IES frame -> aim frame, expressed for Three
	const targetQuat = $derived.by(() => {
		const m = guvToThreeMatrix(axisMatrix(axis));
		const m4 = new THREE.Matrix4().set(
			m[0][0], m[0][1], m[0][2], 0,
			m[1][0], m[1][1], m[1][2], 0,
			m[2][0], m[2][1], m[2][2], 0,
			0, 0, 0, 1
		);
		return new THREE.Quaternion().setFromRotationMatrix(m4);
	});

	const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	let currentQuat = $state(new THREE.Quaternion());
	useTask((delta) => {
		if (currentQuat.angleTo(targetQuat) < 1e-4) return;
		if (reduceMotion) { currentQuat = targetQuat.clone(); return; }
		const q = currentQuat.clone().slerp(targetQuat, Math.min(1, delta * 6));
		currentQuat = q;
	});
	const quatArray = $derived([currentQuat.x, currentQuat.y, currentQuat.z, currentQuat.w] as [number, number, number, number]);

	// Six handles sit at the IES-frame axis tips (they rotate with the web)
	const handles = $derived(PHOTOMETRIC_AXES.map((a) => {
		const d = axisDirection(a);
		const pos = lampLocalToThree([d[0] * 1.25, d[1] * 1.25, d[2] * 1.25]);
		const dim = (scores[a] ?? 0) < 0.05;
		return { axis: a, pos, dim, label: AXIS_LABELS[a] };
	}));

	function fixtureGeometry(): THREE.BufferGeometry | null {
		if (!fixtureBounds || fixtureBounds.length !== 8) return null;
		const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
		const g = new THREE.BufferGeometry();
		const pos: number[] = [];
		for (const [a, b] of edges) {
			pos.push(...lampLocalToThree(fixtureBounds[a]), ...lampLocalToThree(fixtureBounds[b]));
		}
		g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
		return g;
	}
	const boxGeometry = $derived(fixtureGeometry());

	const aimGeometry = (() => {
		const g = new THREE.BufferGeometry();
		g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, -1.4, 0], 3));
		return g;
	})();

	// Clicking a lobe: un-rotate the hit point into the IES frame and snap
	function onWebClick(e: { point: THREE.Vector3; stopPropagation: () => void }) {
		e.stopPropagation();
		const p = e.point.clone().applyQuaternion(currentQuat.clone().invert());
		const guv: [number, number, number] = [p.x, -p.z, p.y];
		onPick(snapToAxis(guv));
	}

	const webColor = $derived($theme === 'light' ? '#7a3fd6' : '#cc61ff');
	const wireColor = $derived($theme === 'light' ? '#4a7fcf' : '#6a9fff');
	const handleColor = $derived($theme === 'light' ? '#1f6feb' : '#58a6ff');
	const dimColor = $derived($theme === 'light' ? '#9aa4b2' : '#4b5563');
</script>

<T.PerspectiveCamera makeDefault position={[2.2, 1.6, 2.2]} fov={45}>
	<OrbitControls enableDamping dampingFactor={0.1} target={[0, 0, 0]} />
</T.PerspectiveCamera>

<T.AmbientLight intensity={0.6} />
<T.DirectionalLight position={[5, 8, 5]} intensity={0.8} />

<!-- Web + handles rotate together from the file frame into the aim frame -->
<T.Group quaternion={quatArray}>
	<T.Mesh geometry={webGeometry} onclick={onWebClick}>
		<T.MeshStandardMaterial color={webColor} transparent opacity={0.55} side={THREE.DoubleSide} />
	</T.Mesh>
	{#each handles as h (h.axis)}
		<T.Mesh position={h.pos} onclick={(e: any) => { e.stopPropagation(); onPick(h.axis); }}>
			<T.SphereGeometry args={[h.axis === axis ? 0.09 : 0.06, 16, 16]} />
			<T.MeshStandardMaterial color={h.dim ? dimColor : handleColor} emissive={h.axis === axis ? handleColor : '#000000'} emissiveIntensity={h.axis === axis ? 0.6 : 0} />
		</T.Mesh>
		<Text text={h.label} position={[h.pos[0] * 1.15, h.pos[1] * 1.15 + 0.08, h.pos[2] * 1.15]} fontSize={0.12} color={h.dim ? dimColor : handleColor} anchorX="center" anchorY="middle" />
	{/each}
</T.Group>

<!-- Housing box and aim arrow stay in the aim frame -->
{#if boxGeometry}
	<T.LineSegments geometry={boxGeometry}>
		<T.LineBasicMaterial color={wireColor} />
	</T.LineSegments>
{/if}
<T.Line geometry={aimGeometry}>
	<T.LineBasicMaterial color="#ff8c00" />
</T.Line>
<T.Mesh position={[0, -1.4, 0]} rotation={[Math.PI, 0, 0]}>
	<T.ConeGeometry args={[0.06, 0.16, 12]} />
	<T.MeshBasicMaterial color="#ff8c00" />
</T.Mesh>
```

Note on scale: the web is normalised to radius 1, so `fixtureBounds` passed in must be in the same normalised units (the picker divides by the web radius). Expose the radius: compute it in the picker instead (same formula) and pass pre-scaled bounds.

- [ ] **Step 4: Write the picker**

Write `ui/src/lib/components/PhotometricAxisPicker.svelte`:

```svelte
<script lang="ts">
	import { Canvas } from '@threlte/core';
	import PhotometricAxisScene from './PhotometricAxisScene.svelte';
	import type { IesAnalysisResponse } from '$lib/api/contract';
	import { fromMeters, unitAbbrev, unitFineStep, type LengthUnit } from '$lib/utils/unitConversion';
	import {
		PHOTOMETRIC_AXES, AXIS_LABELS, axisReadout, fixtureBoundsLocal, centeredDepth, type PhotometricAxis
	} from '$lib/utils/photometricAxis';

	interface Props {
		analysis: IesAnalysisResponse | null;
		axis: PhotometricAxis;
		depth: number | undefined;
		housingWidth: number | undefined;
		housingLength: number | undefined;
		housingHeight: number | undefined;
		units: LengthUnit;
		onAxisChange: (axis: PhotometricAxis) => void;
		onDepthChange: (depth: number | undefined) => void;
	}

	let { analysis, axis, depth, housingWidth, housingLength, housingHeight, units, onAxisChange, onDepthChange }: Props = $props();

	const scores = $derived(analysis?.axis_scores ?? {});

	// Longest spoke of the web, meters: the scene is normalised to it
	const webRadius = $derived.by(() => {
		let r = 0;
		for (const [x, y, z] of analysis?.vertices ?? []) r = Math.max(r, Math.hypot(x, y, z));
		return r || 1;
	});

	// Housing box in the aim frame, scaled to the scene. Housing dims default
	// to the permuted surface extents for the chosen axis.
	const fixtureBounds = $derived.by(() => {
		if (!analysis) return null;
		const ext = analysis.extents_by_axis[axis];
		if (!ext) return null;
		const toM = (v: number | undefined, fallbackM: number) => (v == null ? fallbackM : v / fromMeters(1, units));
		const w = toM(housingWidth, ext.width);
		const l = toM(housingLength, ext.length);
		const h = toM(housingHeight, 0);
		const d = toM(depth, 0);
		if (w <= 0 && l <= 0 && h <= 0 && ext.height <= 0) return null;
		// luminous volume proportional to the web so it reads at a glance
		const scale = 0.6 / Math.max(w, l, h, ext.height, 1e-6);
		return fixtureBoundsLocal({
			housingWidth: w, housingLength: l, housingHeight: h, surfaceHeight: ext.height, depth: d
		}).map((c) => c.map((v) => v * scale));
	});

	const readout = $derived(axisReadout(axis));
	const canCenter = $derived(housingHeight != null && housingHeight > 0);

	function handleDepthInput(e: Event) {
		const raw = (e.currentTarget as HTMLInputElement).value;
		if (raw === '') { onDepthChange(undefined); return; }
		const v = Number(raw);
		if (Number.isFinite(v) && v >= 0) onDepthChange(v);
	}
</script>

<div class="axis-picker">
	<div class="axis-canvas">
		{#if analysis}
			<Canvas>
				<PhotometricAxisScene
					vertices={analysis.vertices}
					triangles={analysis.triangles}
					{axis}
					{scores}
					{fixtureBounds}
					onPick={onAxisChange}
				/>
			</Canvas>
			<div class="canvas-hint">Click the beam or a handle to say where the light goes. Drag to rotate.</div>
		{:else}
			<div class="canvas-placeholder">Analyzing photometry…</div>
		{/if}
	</div>

	<div class="axis-buttons" role="group" aria-label="Beam direction in file">
		{#each PHOTOMETRIC_AXES as a (a)}
			<button
				type="button"
				class="axis-btn"
				class:dim={(scores[a] ?? 0) < 0.05 && a !== axis}
				data-axis={a}
				aria-pressed={a === axis}
				title={`${Math.round((scores[a] ?? 0) * 100)}% of power within 45° of this direction`}
				onclick={() => onAxisChange(a)}
			>{AXIS_LABELS[a]}</button>
		{/each}
	</div>

	<p class="axis-readout">{readout}</p>

	<div class="depth-row">
		<label for="photometric-depth">Photometric center depth [{unitAbbrev(units)}]</label>
		<div class="depth-controls">
			<input
				id="photometric-depth"
				type="number"
				min="0"
				step={unitFineStep(units)}
				value={depth ?? ''}
				placeholder="0"
				oninput={handleDepthInput}
			/>
			<button type="button" class="secondary small depth-face" onclick={() => onDepthChange(0)}>At emitting face</button>
			<button type="button" class="secondary small depth-centered" disabled={!canCenter} onclick={() => onDepthChange(centeredDepth(housingHeight ?? 0))}>Centered</button>
		</div>
		<span class="hint">How far behind the emitting face the photometric center sits. Centered = half the housing height.</span>
	</div>
</div>

<style>
	.axis-picker {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
	}

	.axis-canvas {
		position: relative;
		height: 260px;
		border-radius: var(--radius-md);
		overflow: hidden;
		background: var(--color-bg-secondary);
	}

	.canvas-hint,
	.canvas-placeholder {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		padding: 4px 8px;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		text-align: center;
		pointer-events: none;
	}

	.canvas-placeholder {
		top: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.axis-buttons {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: var(--spacing-xs);
	}

	.axis-btn {
		padding: 4px 0;
		font-size: var(--font-size-sm);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg-secondary);
		color: var(--color-text);
		cursor: pointer;
	}

	.axis-btn[aria-pressed="true"] {
		border-color: var(--color-primary);
		background: color-mix(in srgb, var(--color-primary) 18%, transparent);
	}

	.axis-btn.dim {
		opacity: 0.45;
	}

	.axis-readout {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}

	.depth-row {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.depth-controls {
		display: flex;
		gap: var(--spacing-xs);
		align-items: center;
	}

	.depth-controls input {
		flex: 1;
		min-width: 0;
	}

	.depth-controls .secondary.small {
		width: auto;
		padding: 4px 8px;
		font-size: var(--font-size-sm);
		white-space: nowrap;
	}

	.hint {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}

	@media (max-width: 480px) {
		.axis-buttons {
			grid-template-columns: repeat(3, 1fr);
		}
	}
</style>
```

Check the CSS custom property names used elsewhere (`grep -rn "var(--color-primary\|var(--radius-md\|--spacing-xs" ui/src/app.css | head`) and substitute the project's actual names.

- [ ] **Step 5: Run the component test and `pnpm check`**

Run: `cd ~/illuminate-v2/ui && pnpm vitest run src/lib/components/PhotometricAxisPicker.test.ts && pnpm check`
Expected: pass, 0 errors. Fix any Threlte typing issues (`T.Line`/`T.LineSegments` take `geometry` as a prop; `useTask` callback receives `delta` in seconds).

- [ ] **Step 6: Commit**

```bash
cd ~/illuminate-v2 && git add ui/src/lib/components/PhotometricAxisScene.svelte ui/src/lib/components/PhotometricAxisPicker.svelte ui/src/lib/components/PhotometricAxisPicker.test.ts ui/src/lib/components/__mocks__ && git commit -m "feat(ui): photometric axis picker with 3D web, six handles and depth control"
```

---

### Task 11: Picker in the lamp manager form

**Files:**
- Modify: `ui/src/lib/components/LampManagerModal.svelte` (state, `resetDraft`, `startEdit`, `handleIesChange`, `buildHousing`, `save` fields, markup)
- Test: `ui/src/lib/components/LampManagerModal.test.ts`

**Interfaces:**
- Consumes: `analyzeLampIes` (Task 7), `PhotometricAxisPicker` (Task 10), `CustomLampDef.photometricAxis` / `housing.photometricDepth` (Task 9).

- [ ] **Step 1: Write the failing tests**

Add `analyzeLampIes: vi.fn()` to the `$lib/api/client` mock factory in `LampManagerModal.test.ts`, import it, and mock the picker so the test does not need WebGL: `vi.mock('./PhotometricAxisPicker.svelte', ...)` with a stub component `__mocks__/PickerStub.svelte` that renders `<button data-testid="pick-up" onclick={() => onAxisChange('up')}>up</button><span data-testid="axis">{axis}</span><span data-testid="depth">{depth ?? ''}</span>` from its props. Then append:

```ts
describe('orientation & mounting', () => {
  const analysis = { suggested_axis: 'horizontal_0', axis_scores: {}, ies_dimensions: { width: 1, length: 1, height: 0 }, vertices: [], triangles: [], extents_by_axis: {} };

  it('analyzes a chosen IES file and pre-selects the suggested axis', async () => {
    vi.mocked(analyzeLampIes).mockResolvedValue(analysis as any);
    render(LampManagerModal, { props: { onClose: vi.fn(), initialLampType: 'lp_254' } });
    const input = document.querySelector('#ies-file-input') as HTMLInputElement;
    const file = new File(['TILT=NONE'], 'wall.ies');
    Object.defineProperty(input, 'files', { value: [file] });
    await fireEvent.change(input);
    await waitFor(() => expect(analyzeLampIes).toHaveBeenCalledWith(file));
    await waitFor(() => expect(screen.getByTestId('axis').textContent).toBe('horizontal_0'));
  });

  it('saves the chosen axis and depth on the definition', async () => {
    vi.mocked(analyzeLampIes).mockResolvedValue(analysis as any);
    vi.mocked(getLampContentHash).mockResolvedValue({ content_hash: 'h' });
    mockFileToEmbedded.mockResolvedValue({ filename: 'wall.ies', dataBase64: 'AAAA' });
    render(LampManagerModal, { props: { onClose: vi.fn(), initialLampType: 'lp_254' } });
    const input = document.querySelector('#ies-file-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['TILT=NONE'], 'wall.ies')] });
    await fireEvent.change(input);
    await waitFor(() => expect(screen.getByTestId('axis').textContent).toBe('horizontal_0'));
    await fireEvent.click(screen.getByTestId('pick-up'));
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockAdd).toHaveBeenCalled());
    const fields = mockAdd.mock.calls[0][0];
    expect(fields.photometricAxis).toBe('up');
  });

  it('editing a definition shows its stored axis without re-suggesting', async () => {
    vi.mocked(analyzeLampIes).mockResolvedValue(analysis as any);
    const def = { ...baseDef, id: 'd1', photometricAxis: 'horizontal_90', housing: { height: 0.3, photometricDepth: 0.15 } };
    customLampsStore.set([def as any]);
    mockGet.mockReturnValue(def);
    mockToIesFile.mockReturnValue(new File(['TILT=NONE'], 'x.ies'));
    render(LampManagerModal, { props: { onClose: vi.fn(), initialEditDefId: 'd1' } });
    await waitFor(() => expect(screen.getByTestId('axis').textContent).toBe('horizontal_90'));
    expect(screen.getByTestId('depth').textContent).toBe('0.15');
  });
});
```

Use the file's existing `baseDef`/helpers names (read the top 120 lines of the test to match them exactly; `mockAdd`, `mockGet`, `mockToIesFile`, `mockFileToEmbedded`, `customLampsStore` are already hoisted there).

- [ ] **Step 2: Run to verify failure**

Run: `cd ~/illuminate-v2/ui && pnpm vitest run src/lib/components/LampManagerModal.test.ts`
Expected: new tests fail

- [ ] **Step 3: Edit the modal (Python helper, tabs)**

Script changes to `LampManagerModal.svelte`:

a) Imports: add `import PhotometricAxisPicker from './PhotometricAxisPicker.svelte';`, `import { analyzeLampIes } from '$lib/api/client';` (merge into the existing client import if there is one), `import type { IesAnalysisResponse } from '$lib/api/contract';`, `import type { PhotometricAxis } from '$lib/utils/photometricAxis';`.

b) State, after `let housingHeight = ...`:

```ts
	let photometricAxis = $state<PhotometricAxis>('down');
	let photometricDepth = $state<number | undefined>(undefined);
	let iesAnalysis = $state<IesAnalysisResponse | null>(null);
	let analysisToken = 0;
```

c) A helper after `handleIesChange`:

```ts
	// Analyze the IES for the orientation picker. `suggest` adopts the file's
	// suggested axis (new file); editing a saved definition keeps its own.
	async function analyzeIes(file: File, suggest: boolean) {
		const token = ++analysisToken;
		iesAnalysis = null;
		try {
			const result = await analyzeLampIes(file);
			if (token !== analysisToken) return;
			iesAnalysis = result;
			if (suggest) photometricAxis = result.suggested_axis as PhotometricAxis;
		} catch (err: any) {
			if (token !== analysisToken) return;
			formError = err?.message || 'Failed to analyze IES file';
		}
	}
```

d) In `handleIesChange`, after the file is accepted and `iesFile = file` is set, add `analyzeIes(file, true);`.

e) `resetDraft`: add `photometricAxis = 'down'; photometricDepth = undefined; iesAnalysis = null;`.

f) `startEdit`: add `photometricAxis = def.photometricAxis ?? 'down'; photometricDepth = def.housing?.photometricDepth;` and at the end `const existingIes = lampLibrary.toIesFile(def.id); if (existingIes) analyzeIes(existingIes, false);`.

g) `buildHousing`:

```ts
	function buildHousing() {
		if (housingWidth == null && housingLength == null && housingHeight == null && photometricDepth == null) return undefined;
		return { width: housingWidth, length: housingLength, height: housingHeight, photometricDepth };
	}
```

h) `save` fields: add `photometricAxis,` after `housing: buildHousing(),`.

i) Markup: insert directly after the `<SpectrumFileField ... />` block and before `<details class="advanced-section">`:

```svelte
					{#if iesFile || currentIesFilename}
						<div class="form-group orientation-group">
							<label for="photometric-depth">Orientation &amp; Mounting</label>
							<PhotometricAxisPicker
								analysis={iesAnalysis}
								axis={photometricAxis}
								depth={photometricDepth}
								{housingWidth}
								{housingLength}
								{housingHeight}
								units={surfaceUnits}
								onAxisChange={(a) => (photometricAxis = a)}
								onDepthChange={(d) => (photometricDepth = d)}
							/>
						</div>
					{/if}
```

(The depth value is stored in the definition's `surface.units`, like the housing fields; the picker is told `units={surfaceUnits}` so its label matches.)

- [ ] **Step 4: Run tests and check**

Run: `cd ~/illuminate-v2/ui && pnpm vitest run src/lib/components/LampManagerModal.test.ts && pnpm check`
Expected: pass, 0 errors

- [ ] **Step 5: Commit**

```bash
cd ~/illuminate-v2 && git add ui/src/lib/components/LampManagerModal.svelte ui/src/lib/components/LampManagerModal.test.ts ui/src/lib/components/__mocks__ && git commit -m "feat(ui): orientation & mounting picker in the custom lamp form"
```

---

### Task 12: Picker on the advanced Fixture tab (per-instance correction)

**Files:**
- Modify: `ui/src/lib/components/AdvancedLampSettingsModal.svelte` (state from settings, auto-save payload, analysis fetch, echo to store)
- Modify: `ui/src/lib/components/AdvancedLampTabFixture.svelte` (render the picker)
- Test: `ui/src/lib/components/AdvancedLampSettingsModal.test.ts`

**Interfaces:**
- Consumes: `AdvancedLampSettingsResponse.photometric_axis/photometric_depth` and `AdvancedLampUpdate` fields (Task 7), `getSessionLampFiles` + `analyzeLampIes` (client), picker (Task 10), `project.updateLampFromAdvanced` (existing).

- [ ] **Step 1: Write the failing test**

In `AdvancedLampSettingsModal.test.ts`, extend the `$lib/api/client` mock with `analyzeLampIes: vi.fn()`, `getSessionLampFiles: vi.fn()`, and the picker stub mock from Task 11. Extend `mockSettings` with `photometric_axis: 'down', photometric_depth: 0`. Append:

```ts
  it('fixture tab saves a changed photometric axis and echoes it to the store', async () => {
    vi.mocked(getSessionLampAdvancedSettings).mockResolvedValue({ ...mockSettings, photometric_axis: 'down', photometric_depth: 0 });
    vi.mocked(getSessionLampFiles).mockResolvedValue({ ies_filedata: 'TILT=NONE', ies_filename: 'x.ies', spectrum: null, content_hash: 'h' } as any);
    vi.mocked(analyzeLampIes).mockResolvedValue({ suggested_axis: 'down', axis_scores: {}, ies_dimensions: { width: 1, length: 1, height: 0 }, vertices: [], triangles: [], extents_by_axis: {} } as any);
    render(AdvancedLampSettingsModal, { props: defaultProps });
    await waitFor(() => expect(getSessionLampAdvancedSettings).toHaveBeenCalled());
    await fireEvent.click(screen.getByRole('tab', { name: /Fixture/ }));
    await waitFor(() => expect(screen.getByTestId('axis').textContent).toBe('down'));
    await fireEvent.click(screen.getByTestId('pick-up'));
    await waitFor(() => expect(updateSessionLampAdvanced).toHaveBeenCalledWith(
      expect.any(String), expect.objectContaining({ photometric_axis: 'up' })
    ), { timeout: 2000 });
    expect(project.updateLampFromAdvanced).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ photometric_axis: 'up' }));
  });
```

Match the file's actual names for `defaultProps`, the mocked `project`, and `updateSessionLampAdvanced` (read lines 1-120).

- [ ] **Step 2: Run to verify failure**

Run: `cd ~/illuminate-v2/ui && pnpm vitest run src/lib/components/AdvancedLampSettingsModal.test.ts`

- [ ] **Step 3: Modal edits (Python helper)**

a) Imports: `analyzeLampIes`, `getSessionLampFiles` added to the client import list; `import type { IesAnalysisResponse } from '$lib/api/contract';`; `import type { PhotometricAxis } from '$lib/utils/photometricAxis';`.

b) State after `housingHeight`:

```ts
	let photometricAxis = $state<PhotometricAxis>('down');
	let photometricDepth = $state<number>(0);
	let iesAnalysis = $state<IesAnalysisResponse | null>(null);
	let analyzedHash: string | null = null;
```

c) Where settings are loaded (`housingHeight = settings.housing_height;`), add:

```ts
			photometricAxis = settings.photometric_axis;
			photometricDepth = settings.photometric_depth;
			fetchIesAnalysis();
```

d) New function near `fetchPhotometricWeb`:

```ts
	// The picker needs the file-frame web + per-axis extents; build a File
	// from the session lamp's stored IES and analyze it once per content hash.
	async function fetchIesAnalysis() {
		try {
			const files = await getSessionLampFiles(selectedLampId);
			if (!files.ies_filedata) { iesAnalysis = null; return; }
			if (files.content_hash && files.content_hash === analyzedHash && iesAnalysis) return;
			const file = new File([files.ies_filedata], files.ies_filename ?? 'lamp.ies');
			iesAnalysis = await analyzeLampIes(file);
			analyzedHash = files.content_hash ?? null;
		} catch (e) {
			console.warn('Failed to analyze IES for orientation picker:', e);
			iesAnalysis = null;
		}
	}
```

e) Auto-save `$effect`: add `const _axis = photometricAxis; const _depth = photometricDepth;` to the tracked reads. In `saveChanges`, add to `update`:

```ts
			update.photometric_axis = photometricAxis;
			update.photometric_depth = photometricDepth;
```

and after the settings refresh, echo to the store (find the existing `project.updateLampFromAdvanced(...)` call and add `photometric_axis: photometricAxis, photometric_depth: photometricDepth` to its values object; if there is no such call, add one after `settings = updated;`:

```ts
			project.updateLampFromAdvanced(selectedLampId, {
				photometric_axis: photometricAxis,
				photometric_depth: photometricDepth,
			});
```

(`project` is imported from `$lib/stores/project` already; `lamps` is, so extend that import.)

f) Handlers:

```ts
	function handlePhotometricAxisChange(a: PhotometricAxis) {
		photometricAxis = a;
	}

	function handlePhotometricDepthChange(d: number | undefined) {
		photometricDepth = d ?? 0;
	}
```

g) Pass to the fixture tab: add props `{iesAnalysis}`, `{photometricAxis}`, `{photometricDepth}`, `onPhotometricAxisChange={handlePhotometricAxisChange}`, `onPhotometricDepthChange={handlePhotometricDepthChange}`.

- [ ] **Step 4: Fixture tab edits**

In `AdvancedLampTabFixture.svelte` add to `Props` and destructuring:

```ts
		iesAnalysis: IesAnalysisResponse | null;
		photometricAxis: PhotometricAxis;
		photometricDepth: number;
		onPhotometricAxisChange: (a: PhotometricAxis) => void;
		onPhotometricDepthChange: (d: number | undefined) => void;
```

with imports `import PhotometricAxisPicker from './PhotometricAxisPicker.svelte';`, `import type { IesAnalysisResponse } from '$lib/api/contract';`, `import type { PhotometricAxis } from '$lib/utils/photometricAxis';`. Insert a section between Housing Dimensions and 3D Preview:

```svelte
	<section class="settings-section">
		<h3>Orientation &amp; Mounting</h3>
		<div class="section-content">
			<PhotometricAxisPicker
				analysis={iesAnalysis}
				axis={photometricAxis}
				depth={photometricDepth}
				housingWidth={housingWidth ?? undefined}
				housingLength={housingLength ?? undefined}
				housingHeight={housingHeight ?? undefined}
				{units}
				onAxisChange={onPhotometricAxisChange}
				onDepthChange={onPhotometricDepthChange}
			/>
		</div>
	</section>
```

- [ ] **Step 5: Run tests and check; commit**

Run: `cd ~/illuminate-v2/ui && pnpm vitest run src/lib/components/AdvancedLampSettingsModal.test.ts && pnpm check`

```bash
cd ~/illuminate-v2 && git add ui/src/lib/components/AdvancedLampSettingsModal.svelte ui/src/lib/components/AdvancedLampTabFixture.svelte ui/src/lib/components/AdvancedLampSettingsModal.test.ts && git commit -m "feat(ui): orientation & mounting on the advanced fixture tab"
```

---

### Task 13: End-to-end test with a wall-mounted synthetic IES

**Files:**
- Create: `e2e/fixtures/wall-lamp.ies`
- Modify: `e2e/tests/workflow.spec.ts` (new test) 
- Modify: `e2e/helpers/lamps.ts` (`createCustomLamp` gains `axis?: string` to click a handle button)

- [ ] **Step 1: Generate the fixture**

Run from `~/illuminate-v2/api`:

```bash
uv run --frozen python - <<'EOF'
import numpy as np
thetas = list(range(0, 181, 10)); phis = [0, 90, 180, 270, 360]
v = np.ones((5, 19)); v[0, 9] = 100; v[0, 10] = 60; v[4, 9] = 100; v[4, 10] = 60
lines = ["IESNA:LM-63-2002", "[TEST] synthetic wall-mounted upper-room fixture", "[MANUFAC] Illuminate e2e", "TILT=NONE",
         f"1 -1 1 {len(thetas)} {len(phis)} 1 2 1.94 1.26 0.42", "1.0 1.0 10.0",
         " ".join(f"{t:g}" for t in thetas), " ".join(f"{p:g}" for p in phis)]
for row in v: lines.append(" ".join(f"{x:g}" for x in row))
open("../e2e/fixtures/wall-lamp.ies", "w").write("\n".join(lines) + "\n")
EOF
```

Verify `uv run --frozen python -c "from guv_calcs import Lamp; print(Lamp(filedata='../e2e/fixtures/wall-lamp.ies').ies.header)"` prints a header.

- [ ] **Step 2: Helper**

In `e2e/helpers/lamps.ts` `CustomLampOptions` add `/** Click this axis handle in the orientation picker before saving. */ axis?: string;` and in `createCustomLamp`, after the IES `file-status.success` wait:

```ts
  if (opts.axis) {
    const btn = form.locator(`.axis-btn[data-axis="${opts.axis}"]`);
    await expect(btn).toBeVisible({ timeout: 15_000 });
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
  }
```

- [ ] **Step 3: Test**

Append to `e2e/tests/workflow.spec.ts` inside the main describe (next to the existing custom lamp test), importing `getLampsFromStore` from `../helpers/api`:

```ts
  test('wall-mounted custom lamp: picker suggests 0°, lamp is placed aiming horizontally', async () => {
    await addLampWithType(page, 'lp_254');
    const WALL_IES = path.join(__dirname, '../fixtures/wall-lamp.ies');

    await page.locator('select#preset').selectOption('__add_custom__');
    const form = page.locator('.lamp-form');
    await form.locator('#ies-file-input').setInputFiles(WALL_IES);
    const suggested = form.locator('.axis-btn[data-axis="horizontal_0"]');
    await expect(suggested).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
    await expect(form.locator('.axis-readout')).toContainText('0°');
    await form.locator('.form-actions button.primary').click();
    await expect(form).not.toBeVisible({ timeout: 15_000 });
    await waitForApiIdle(page);

    const lamps = await getLampsFromStore(page);
    const wall = lamps[lamps.length - 1];
    expect(wall.photometric_axis).toBe('horizontal_0');
    expect(Math.abs(wall.aimz - wall.z)).toBeLessThan(1e-6);   // aiming horizontally
    expect(Math.hypot(wall.aimx - wall.x, wall.aimy - wall.y)).toBeGreaterThan(0.5);
  });
```

Match the file's existing imports (`path`, `__dirname`/`import.meta.url` usage, `waitForApiIdle`, `addLampWithType`) by reading its first 30 lines.

- [ ] **Step 4: Run the e2e**

Run (dev servers up, as the e2e config expects): `cd ~/illuminate-v2/e2e && npx playwright test tests/workflow.spec.ts -g "wall-mounted" --reporter=line`
Expected: pass. Then the room suite as the light verification loop: `npx playwright test tests/room.spec.ts --reporter=line`.

- [ ] **Step 5: Commit**

```bash
cd ~/illuminate-v2 && git add e2e/fixtures/wall-lamp.ies e2e/helpers/lamps.ts e2e/tests/workflow.spec.ts && git commit -m "test(e2e): wall-mounted custom lamp picks horizontal_0 and is placed on a wall"
```

---

### Task 14: Changelog, manual check with the real files, full verification

**Files:**
- Modify: `CHANGELOG.md` (`[Unreleased]`)

- [ ] **Step 1: Changelog**

Under `## [Unreleased]` add:

```
### Added
- Custom lamps can declare where their beam points in the IES file (down, up, or horizontal toward 0°/90°/180°/270°) and how deep the photometric center sits in the housing. A 3D picker in the lamp manager and the advanced Fixture tab suggests the direction from the file; aim, tilt and orientation then follow the beam, so wall-mounted upper-room 254 nm fixtures can be aimed horizontally like any other lamp.
### Fixed
- Fixtures whose IES states a luminous height (e.g. UV-Flow) drew their housing box hanging below the photometric point; the box is now centered on the luminous volume.
```

- [ ] **Step 2: Manual check with the two real files**

Start the app (`run` skill or `make frontend` / `make backend`), import `/mnt/c/Data/tmp/UV-related/lumalier_iesfiles/1400 (Sep2024).IES` as an lp_254 custom lamp: the picker should pre-select 0°, and after saving the lamp should sit on a wall aiming across the room with the web pointing into the room. Import the UV-Flow file: picker pre-selects Down; set Housing Height 0.12 and click Centered; the box should straddle the point. Run a calculation with each and confirm non-zero results. Note any discrepancy in the final report rather than silently patching unrelated code.

- [ ] **Step 3: Full verification**

```bash
cd ~/guv-calcs && pytest -q
cd ~/illuminate-v2/api && uv run --frozen pytest -q
cd ~/illuminate-v2/ui && pnpm check && pnpm test:run
cd ~/illuminate-v2 && grep -rn "\[DIAG\]\|TEMP DIAG" ui/src api/api || echo clean
```

Expected: all green, `clean`.

- [ ] **Step 4: Commit**

```bash
cd ~/illuminate-v2 && git add CHANGELOG.md && git commit -m "docs: changelog for photometric axis and mounting"
```

Report: guv-calcs commits are local on its branch (not pushed); Illuminate work is on `photometric-axis`; the API cannot ship until the guv-calcs pin is bumped to a release containing Tasks 1-3.
