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

```bash
make setup-hooks    # one-time: install pre-commit hook
make frontend       # start UI dev server (localhost:5173)
make backend        # start API dev server (localhost:8000)
```

API docs: http://localhost:8000/api/v1/docs

## Testing

```bash
make test           # run all tests (UI + API + e2e)
make test-ui        # UI unit tests (Vitest)
make test-api       # API tests (pytest)
make test-e2e       # end-to-end tests (Playwright)
```

## Deployment

```bash
make deploy                    # build and deploy current version
make rollback VERSION=0.1.3    # revert to a previous version (instant, no rebuild)
make versions                  # list available versions
make pin VERSION=0.1.3         # pin a version (never pruned)
make unpin VERSION=0.1.3       # unpin a version
```

**How versioning works:**

- `make deploy` auto-bumps the patch version (e.g., `0.1.3` -> `0.1.4`), tags, and deploys
- Docker images are tagged with the version and the last 20 are kept
- Pinned versions are kept indefinitely
- Rollback swaps the running container to an older image — no rebuild needed

**Named releases** (for milestones):

```bash
make release VERSION=minor   # bumps version, updates CHANGELOG, tags, pushes
make deploy                  # deploys the release (no auto-bump since tag exists)
```

## Related Repositories

- [photompy](https://github.com/jvbelenky/photompy/) - Python library for interacting with .ies files
- [guv-calcs](https://github.com/jvbelenky/guv-calcs) - Python library for GUV calculations
