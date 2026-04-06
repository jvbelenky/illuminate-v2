SHELL := /bin/bash

.PHONY: frontend backend install install-release deploy release test test-ui test-api test-e2e

# Install backend deps with local editable guv-calcs + photompy
install:
	cd api && uv sync

# Install backend deps with guv-calcs from PyPI
install-release:
	cd api && uv sync --no-sources

# Start frontend dev server
frontend:
	cd ui && pnpm install && pnpm dev

# Start backend dev server
# Usage:
#   make backend              # installs local editable guv-calcs, then starts
#   make backend RELEASE=1    # installs PyPI guv-calcs, then starts
backend:
ifdef RELEASE
	$(MAKE) install-release
else
	$(MAKE) install
endif
	cd api && uv run uvicorn app.main:app --reload --port 8000

# Run all tests
test: test-ui test-api test-e2e

# Frontend tests
test-ui:
	cd ui && pnpm test:run

# Backend tests
test-api:
	cd api && uv run pytest tests/

# E2E tests (Playwright)
test-e2e:
	cd e2e && npx playwright test

# Tag a release: make release VERSION=patch|minor|major|X.Y.Z
release:
	@bash scripts/release.sh $(VERSION)

# Production deploy
deploy:
	bash deploy.sh
