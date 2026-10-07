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
            for offset, surface_height in ((None, 0.0), ((0.0, 0.0, 0.0), 0.0), ((0.03, -0.02, 0.01), 0.0), ((0.0, 0.0, -0.02), 0.05)):
                f = Fixture(housing_length=0.4, housing_width=0.2, housing_height=0.1,
                            mount_face=face, roll=roll, emitter_offset=offset)
                cases.append({
                    "face": face, "roll": roll, "offset": list(offset) if offset is not None else None,
                    "length": 0.4, "width": 0.2, "height": 0.1, "surface_height": surface_height,
                    "matrix": f.housing_matrix.tolist(),
                    "corners": f.aim_corners(surface_height).round(12).tolist(),
                    "depth": f.photometric_depth,
                })
    OUT.write_text(json.dumps(cases, indent=1) + "\n")


if __name__ == "__main__":
    main()
