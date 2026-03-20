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
- Node.js 22+
- pnpm
- [uv](https://docs.astral.sh/uv/)

## Quick Start

### Setup

```bash
# Create backend venv and install deps
cd api && uv venv && cd ..
make install            # local editable guv-calcs + photompy
make install-release    # or PyPI guv-calcs
```

### Development

```bash
make frontend             # start UI dev server (localhost:5173)
make backend              # start API with local editable guv-calcs (default)
make backend RELEASE=1    # start API with PyPI guv-calcs
```

API docs: http://localhost:8000/api/v1/docs

### Production

```bash
make deploy
```

## Related Repositories

- [photompy](https://github.com/jvbelenky/photompy/) - Python library for interacting with .ies files
- [guv-calcs](https://github.com/jvbelenky/guv-calcs) - Python library for GUV calculations
