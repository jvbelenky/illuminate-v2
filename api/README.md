# Illuminate API (FastAPI)

_Last updated: 2025-08-13_

Backend for UV disinfection simulation with clean API versioning and a path toward a modern React/Next.js frontend.

---

## What’s implemented

**API Shape**

- Central API prefix: **`/api/v1/*`** (set in `app/main.py`)
- OpenAPI + docs:
  - Swagger UI: **`/api/v1/docs`**
  - ReDoc: **`/api/v1/redoc`**

**Utility**

- `GET /api/v1/health` — liveness (200 when up; can return 503 if flagged)
- `GET /api/v1/ready` — readiness (checks imports/flags; returns 200/503)
- `GET /api/v1/version` — app & API version info

**Lamps (Catalog presets)**

- `GET /api/v1/lamps` — list with filters & pagination (`X-Total-Count`)
- `POST /api/v1/lamps` — create preset
- `GET /api/v1/lamps/{preset_id}` — read preset
- `PATCH /api/v1/lamps/{preset_id}` — partial update
- `DELETE /api/v1/lamps/{preset_id}` — delete (future: block if in use)

**Room Lamps (Instances)**

- `GET /api/v1/rooms/{room_id}/lamps` — list (supports `expand=preset`)
- `POST /api/v1/rooms/{room_id}/lamps` — add lamp from `preset_id` or full custom
- `GET /api/v1/rooms/{room_id}/lamps/{lamp_id}` — read (supports `expand=preset`)
- `PATCH /api/v1/rooms/{room_id}/lamps/{lamp_id}` — partial update (can swap `preset_id`)
- `DELETE /api/v1/rooms/{room_id}/lamps/{lamp_id}` — delete

**Rooms**

- `GET /api/v1/rooms` — **Get All Rooms**
- `POST /api/v1/rooms` — **Create Room**
- `GET /api/v1/rooms/{room_id}` — **Get Room By Id**
- `PUT /api/v1/rooms/{room_id}` — **Update Room**
- _(Next additions — optional)_: `PATCH /rooms/{room_id}`, `DELETE /rooms/{room_id}` (with `?force=true`), list filters/pagination with `X-Total-Count`, `:duplicate`, and `POST /rooms/{room_id}/simulate` to run against stored state.

**Simulation**

- `POST /api/v1/simulate` — run a simulation from a request payload (logic WIP; has starter tests)

---

## Project layout (key files)

```
app/
  main.py                      # FastAPI app; central API prefix; docs paths
api/
  v1/
    utility_routers.py         # /health, /ready, /version
    lamp_presets_router.py     # /lamps (catalog presets)
    room_lamps_router.py       # /rooms/{room_id}/lamps (room-scoped lamps)
    room_routers.py            # /rooms CRUD (Get All, Create, Get By Id, Update)
data/
  lamp_presets.json            # (optional) seed presets loaded at startup
tests/
  test_simulation_api.py       # API tests (sanity/monotonicity/invalids)
README_QUICKSTART.md           # local setup notes (venv, run, tests)
requirements.txt               # runtime deps
requirements-dev.txt           # dev/test deps
```

---

## Quickstart

Python **3.11/3.12** recommended.

```bash
python3 -m venv .venv
source .venv/bin/activate               # Windows: .\.venv\Scripts\Activate.ps1
pip install -U pip
pip install -r requirements.txt
pip install -r requirements-dev.txt
uvicorn app.main:app --reload
```

Open docs: <http://127.0.0.1:8000/api/v1/docs>

---

## Seeding lamp presets (recommended)

Put your UI catalog into `data/lamp_presets.json`:

```json
[
  {
    "id": "LED-265-10W",
    "name": "LED 265 nm – 10W",
    "guv_type": "LED",
    "wavelength": 265.0,
    "default_power": 10.0,
    "spectrum": "narrowband",
    "tags": ["uvc", "preset"]
  }
]
```

Load on startup (snippet — add near app initialization):

```python
# app/main.py
from pathlib import Path
import json

app.state.lamp_catalog = {}
p = Path("data/lamp_presets.json")
if p.exists():
    items = json.loads(p.read_text(encoding="utf-8"))
    app.state.lamp_catalog = {i["id"]: i for i in items}
```

The **room-lamps** endpoints will read from this catalog, apply defaults, and support `?expand=preset`.

---

## Example calls

List presets (filtered):

```bash
curl "http://127.0.0.1:8000/api/v1/lamps?guv_type=LED&wl_min=250&wl_max=280&limit=20"
```

Create a room lamp from a preset:

```bash
ROOM=ROOM123
curl -X POST http://127.0.0.1:8000/api/v1/rooms/$ROOM/lamps   -H "Content-Type: application/json"   -d '{"preset_id":"LED-265-10W","x":1,"y":1,"z":2,"aimx":0,"aimy":0,"aimz":-1,"scaling_factor":1.0}'
```

Run a simulation (WIP):

```bash
curl -X POST http://127.0.0.1:8000/api/v1/simulate   -H "Content-Type: application/json"   -d '{"room":{"x":5,"y":5,"z":3,"units":"meters","precision":3},"lamp":{"x":1,"y":1,"z":2,"wavelength":265,"guv_type":"LED","aimx":0,"aimy":0,"aimz":-1,"scaling_factor":1.0}}'
```

---

## Testing

```bash
pytest -q
```

Included:

- `tests/test_simulation_api.py` — sanity shape, determinism, monotonic scaling, invalid geometry
- `sample_payloads.py` — baseline + variants (if present)

---

## Conventions

- **Versioning**: all routes under `/api/v1`; future breaking changes will be under `/api/v2`.
- **Pagination**: list endpoints accept `limit/offset` and return `X-Total-Count`.
- **Validation**: `wavelength 200–320`, `guv_type ∈ {LED,LP,MP}`, `scaling_factor ≥ 0`; room bounds enforced when dimensions are known.
- **ETag**: read endpoints set `ETag` (client caching); conditional GETs (`If-None-Match`) can be added later.
- **CORS**: wide-open in dev; restrict to known origins in staging/prod.

---

## Roadmap (short list)

- `POST /api/v1/rooms/{id}/simulate` — build simulation from stored room state
- Authn/z — cookie session (same-site) or JWT/OAuth2 (cross-site); role guards for write routes
- Persistence — replace in-memory stores with DB + migrations
- Bulk import — `POST /api/v1/lamps:import` (admin)
- Observability — request IDs, Prometheus metrics, error reporting
- ETag handling — support `If-None-Match` on catalog/room GETs
