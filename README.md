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

**Version source of truth.** The repo-root `VERSION` file is canonical: the
backend reads it and serves it at `/api/v1/version` (shown in the status bar),
the Dockerfile copies it, and deploys tag the Docker image from it.
(`api/pyproject.toml` and `ui/package.json` also carry version strings, but
nothing reads them at runtime.)

**Cutting a release** (the normal path — this is what keeps `CHANGELOG.md` honest):

```bash
make release VERSION=minor   # or: patch | major | X.Y.Z
make deploy                  # ship the tagged version (no auto-bump — the tag already exists)
```

`make release` bumps `VERSION`, promotes the `CHANGELOG.md` `[Unreleased]`
section into a dated `[X.Y.Z]` section, commits, tags `vX.Y.Z`, and — after you
confirm — pushes. It refuses to run on a dirty tree, off `main`, out of sync with
`origin/main`, on an existing tag, or with an empty `[Unreleased]`. Preview
without changing anything first:

```bash
make release VERSION=minor RELEASE_FLAGS=--dry-run
```

**Managing deployed versions:**

```bash
make rollback VERSION=0.1.3    # revert to a previous version (instant, no rebuild)
make versions                  # list available versions
make pin VERSION=0.1.3         # pin a version (never pruned)
make unpin VERSION=0.1.3       # unpin a version
```

Docker images are tagged with the version; the last 20 are kept, pinned ones
indefinitely. Rollback swaps the running container to an older image (no rebuild).

> **⚠ Bare `make deploy` auto-bumps.** Running `make deploy` on a HEAD with no
> release tag auto-bumps the patch version and ships it **without touching the
> changelog** — which is exactly how v0.1.1–v0.1.3 went out undocumented. Use
> `make release` for anything that deserves a changelog entry.

## Local Development with guv-calcs / photompy

`api/pyproject.toml` includes a `[tool.uv.sources]` section that points guv-calcs and photompy at local editable checkouts (expected as sibling directories: `../guv-calcs`, `../photompy`). This lets you iterate on the libraries and the API together without publishing new versions.

If you don't have these repos cloned locally, remove or comment out the `[tool.uv.sources]` section and uv will pull the pinned versions from PyPI instead. `api/uv.lock` is tracked (CI builds with `--locked`); a pre-commit hook (`scripts/hooks/pre-commit`) rewrites it to its `--no-sources` form on commit, so the editable-source paths from local development never get committed.

## Related Repositories

- [photompy](https://github.com/jvbelenky/photompy/) - Python library for interacting with .ies files
- [guv-calcs](https://github.com/jvbelenky/guv-calcs) - Python library for GUV calculations
