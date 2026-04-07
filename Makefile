SHELL := /bin/bash

.PHONY: frontend backend test test-ui test-api test-e2e deploy rollback versions pin unpin release setup-hooks

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
	bash deploy.sh deploy

rollback:
	bash deploy.sh rollback $(VERSION)

versions:
	bash deploy.sh versions

pin:
	bash deploy.sh pin $(VERSION)

unpin:
	bash deploy.sh unpin $(VERSION)

# --- Release (milestones) ---

release:
	@bash scripts/release.sh $(VERSION)

# --- Setup ---

setup-hooks:
	cp scripts/hooks/pre-commit .git/hooks/pre-commit
	chmod +x .git/hooks/pre-commit
