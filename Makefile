SHELL := /bin/bash
export PATH := $(HOME)/.local/bin:$(PATH)

.PHONY: frontend backend install install-release deploy test test-ui test-api

# Install backend deps with local editable guv-calcs + photompy
install:
	cd api && uv pip install -e ~/photompy -e ~/guv-calcs -r requirements.txt -r requirements-dev.txt

# Install backend deps with guv-calcs from PyPI
install-release:
	cd api && uv pip install -r requirements.txt -r requirements-dev.txt

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
	cd api && source .venv/bin/activate && uvicorn app.main:app --reload --port 8000

# Run all tests
test: test-ui test-api

# Frontend tests
test-ui:
	cd ui && pnpm test:run

# Backend tests
test-api:
	cd api && .venv/bin/python -m pytest tests/

# Production deploy
deploy:
	bash deploy.sh
