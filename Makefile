SHELL := /bin/bash

.PHONY: frontend backend test test-ui test-api test-e2e deploy rollback versions pin unpin release

# --- Dev ---

frontend:
	cd ui && pnpm install && pnpm dev

backend:
	cd api && uv sync
	cd api && uv run uvicorn app.main:app --reload --port 8000

# --- Test ---

test: test-ui test-api test-e2e

test-ui:
	cd ui && pnpm test:run

test-api:
	cd api && uv run pytest tests/

test-e2e:
	cd e2e && npx playwright test

# --- Deploy & Manage ---

deploy:
	bash scripts/deploy.sh deploy

rollback:
	bash scripts/deploy.sh rollback $(VERSION)

versions:
	bash scripts/deploy.sh versions

pin:
	bash scripts/deploy.sh pin $(VERSION)

unpin:
	bash scripts/deploy.sh unpin $(VERSION)

# --- Release (milestones) ---

release:
	@bash scripts/release.sh $(VERSION)
