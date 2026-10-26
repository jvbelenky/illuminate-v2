"""The UI's grid-resolution readouts and guv_calcs must agree on the rules.

The table is shared with ui/src/lib/utils/calculations.test.ts, so a pin bump
that changes guv_calcs' rules fails here instead of drifting from the UI.
"""
import json
from pathlib import Path

import pytest
from guv_calcs.geometry import Axis1D

CASES = json.loads((Path(__file__).parent / "fixtures" / "grid_axis_cases.json").read_text())


@pytest.mark.parametrize("case", CASES["from_num_points"])
def test_spacing_from_num_points(case):
    axis = Axis1D(span=case["span"], num_points_init=case["num_points"])
    assert axis.spacing == pytest.approx(case["spacing"], rel=1e-12)
    assert axis.num_points == case["num_points"]


@pytest.mark.parametrize("case", CASES["from_spacing"])
def test_num_points_from_spacing(case):
    axis = Axis1D(span=case["span"], spacing_init=case["spacing"])
    assert axis.num_points == case["num_points"]
