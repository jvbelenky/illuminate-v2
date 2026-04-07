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

### Testing

```bash
make test          # run all tests (UI + API + e2e)
make test-ui       # UI unit tests (Vitest)
make test-api      # API tests (pytest)
make test-e2e      # end-to-end tests (Playwright)
```

### Setup Git Hooks

```bash
make setup-hooks   # install pre-commit hook (normalizes uv.lock)
```

### Deployment

```bash
make deploy                        # build and deploy current version
bash deploy.sh rollback <version>  # revert to a previous version
bash deploy.sh versions            # list available versions
bash deploy.sh pin <version>       # pin a version (never pruned)
bash deploy.sh unpin <version>     # unpin a version
```

**How versioning works:**

- `make deploy` auto-bumps the patch version (e.g., `0.1.3` -> `0.1.4`), tags, and deploys
- If you already ran `make release VERSION=minor` (or `major`/`patch`), deploy uses that version as-is
- Docker images are tagged with the version (e.g., `illuminate-v2:v0.1.4`) and the last 20 are kept
- Pinned versions are kept indefinitely: `bash deploy.sh pin 0.1.4`
- Rollback is instant (no rebuild): `bash deploy.sh rollback 0.1.3`

**Releasing a named version** (for milestones):

```bash
make release VERSION=minor   # bumps version, updates CHANGELOG, tags, pushes
make deploy                  # deploys the release (no auto-bump since tag exists)
```

## Related Repositories

- [photompy](https://github.com/jvbelenky/photompy/) - Python library for interacting with .ies files
- [guv-calcs](https://github.com/jvbelenky/guv-calcs) - Python library for GUV calculations
