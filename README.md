# Illuminate v2

An interactive environment for the [GUV-Calcs](https://github.com/jvbelenky/guv-calcs/) library, v2 - faster and sexier, now with REAL webslop!

## Project Structure

```
illuminate-v2/
├── api/          # FastAPI backend
│   ├── api/v1/   # API routes
│   ├── app/      # FastAPI app
│   └── ...
├── ui/           # SvelteKit frontend
│   ├── src/
│   └── ...
└── README.md
```

## Prerequisites

- Python 3.11+
- Node.js 18+
- pnpm (for UI)

## Quick Start

### Backend (API)

```bash
cd api
python -m venv .venv
source .venv/bin/activate  # Windows: .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

API docs: http://localhost:8000/api/v1/docs

### Frontend (UI)

```bash
cd ui
pnpm install
pnpm dev
```

App: http://localhost:5173

## Dependencies

- **guv-calcs**: Core UV calculation library ([jvbelenky/guv-calcs](https://github.com/jvbelenky/guv-calcs))
  - Install via pip: `pip install guv-calcs`
  - Or for development: `pip install -e /path/to/guv-calcs/src`

## Related Repositories

- [photompy](https://github.com/jvbelenky/photompy/) - Python library for interacting with .ies files
- [guv-calcs](https://github.com/jvbelenky/guv-calcs) - Python library for GUV calculations
- [illuminate](https://github.com/jvbelenky/illuminate) - Legacy desktop application (being replaced by this project)
