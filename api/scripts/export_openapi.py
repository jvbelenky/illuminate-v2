"""Export the FastAPI OpenAPI schema to api/openapi.json (repo contract artifact).

Run via: uv run python scripts/export_openapi.py
Regenerate whenever API schemas change; CI fails if the committed copy is stale.
"""
import json
import os
import sys
from pathlib import Path

# Running this file directly (not via `python -m`) puts the script's own
# directory on sys.path, not the api/ package root — add it explicitly so
# `app` and `api` resolve the same way they do under uvicorn/pytest.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.main import app

OUT = Path(__file__).resolve().parent.parent / "openapi.json"


def main() -> None:
    schema = app.openapi()
    OUT.write_text(json.dumps(schema, indent=2, sort_keys=True) + "\n")
    print(f"Wrote {OUT} ({len(schema.get('paths', {}))} paths)")


if __name__ == "__main__":
    main()
    # guv_calcs pulls in a large native stack (numpy/pandas/scipy/PIL/...). On
    # interpreter shutdown those C extensions intermittently segfault (thread-pool
    # teardown race), so the process exits non-zero *after* the file is written
    # correctly — which used to masquerade as a stale-contract CI failure. The
    # file is fully written by now, so flush our output and hard-exit to skip
    # the crashing finalizers entirely.
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(0)
