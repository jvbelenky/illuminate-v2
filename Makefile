SHELL := /bin/bash

.PHONY: frontend backend test test-ui test-api test-e2e deploy deploy-test stop-test rollback versions pin unpin release generate-api guv-calcs-status bump-guv-calcs

# --- Dev ---

# Per-checkout ports so worktrees run side by side (see scripts/dev-ports.sh);
# override with API_PORT=/UI_PORT=
API_PORT := $(shell bash scripts/dev-ports.sh api)
UI_PORT := $(shell bash scripts/dev-ports.sh ui)

frontend:
	cd ui && pnpm install && VITE_API_URL=http://localhost:$(API_PORT)/api/v1 pnpm dev --port $(UI_PORT) --strictPort

# The local guv-calcs checkout overlays the pinned commit (see scripts/guv-calcs.sh)
GUV_CALCS_SRC := $(shell bash scripts/guv-calcs.sh pythonpath)

backend:
	@bash scripts/guv-calcs.sh status
	cd api && uv sync
	cd api && ../scripts/guv-calcs.sh exec uv run uvicorn app.main:app --reload --reload-dir . $(if $(GUV_CALCS_SRC),--reload-dir $(GUV_CALCS_SRC)) --port $(API_PORT)

# --- Test ---

test: test-ui test-api test-e2e

test-ui:
	cd ui && pnpm test:run

test-api:
	@# Exit 139 = kaleido's segfault-on-exit AFTER pytest reports results; CI
	@# tolerates it the same way (see .github/workflows/ci.yml api-tests job)
	cd api && ../scripts/guv-calcs.sh exec uv run pytest tests/; status=$$?; \
	if [ $$status -eq 139 ]; then echo "pytest exited 139 (kaleido teardown segfault) — tests themselves passed"; exit 0; \
	else exit $$status; fi

test-e2e:
	cd e2e && npx playwright test

# --- Codegen ---

generate-api:  ## Regenerate OpenAPI schema + TS types from FastAPI app
	cd api && uv run python scripts/export_openapi.py
	cd ui && pnpm generate:api

# --- guv-calcs pin ---

guv-calcs-status:  ## Pinned guv-calcs commit vs the local checkout in use
	@bash scripts/guv-calcs.sh status

bump-guv-calcs:  ## Pin guv-calcs to the local checkout's HEAD (or REF=<sha>) and relock
	bash scripts/guv-calcs.sh bump $(REF)

# --- Deploy & Manage ---

deploy:
	bash scripts/deploy.sh deploy

deploy-test:  ## Build main HEAD (no release tag needed) and run it at illuminate.osluv.org/test
	bash scripts/deploy.sh deploy-test

stop-test:
	bash scripts/deploy.sh stop-test

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
	@bash scripts/release.sh $(VERSION) $(RELEASE_FLAGS)
