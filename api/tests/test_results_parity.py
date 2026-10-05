"""The Results panel (TypeScript) and the report (guv_calcs) must agree on the math.

The fixture is written by ui/src/lib/utils/reportParity.fixture.test.ts.
"""
import json
from pathlib import Path

import pytest
from guv_calcs.efficacy.math import eACH_UV, CADR_LPS, CADR_CFM, log1, log2, log3

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "results_parity.json").read_text())


def _args(case):
    """guv_calcs takes scalars for one wavelength and lists for several."""
    irrad, k1, k2, f = case["irrad"], case["k1"], case["k2"], case["f"]
    if len(irrad) == 1:
        return irrad[0], k1[0], k2[0], f[0]
    return irrad, k1, k2, f


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=[c["name"] for c in FIXTURE["cases"]])
def test_pathogen_math_matches_frontend(case):
    irrad, k1, k2, f = _args(case)
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
