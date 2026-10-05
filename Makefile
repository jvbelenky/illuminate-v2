SHELL := /bin/bash

.PHONY: frontend backend test test-ui test-api test-e2e deploy deploy-test stop-test rollback versions pin unpin release generate-api

# --- Dev ---

frontend:
	cd ui && pnpm install && pnpm dev

backend:
	cd api && uv sync
	# --reload-dir: also restart on edits to the editable guv-calcs checkout (if present)
	cd api && uv run uvicorn app.main:app --reload --reload-dir . $$( [ -d ../../guv-calcs/src ] && echo --reload-dir ../../guv-calcs/src ) --port 8000

# --- Test ---

test: test-ui test-api test-e2e

test-ui:
	cd ui && pnpm test:run

test-api:
	@# Exit 139 = kaleido's segfault-on-exit AFTER pytest reports results; CI
	@# tolerates it the same way (see .github/workflows/ci.yml api-tests job)
	cd api && uv run pytest tests/; status=$$?; \
	if [ $$status -eq 139 ]; then echo "pytest exited 139 (kaleido teardown segfault) — tests themselves passed"; exit 0; \
	else exit $$status; fi

test-e2e:
	cd e2e && npx playwright test

# --- Codegen ---

generate-api:  ## Regenerate OpenAPI schema + TS types from FastAPI app
	# --no-sources mirrors CI and stops [tool.uv.sources] from re-resolving
	# api/uv.lock to local ../../guv-calcs checkouts as a side effect.
	cd api && uv run --no-sources python scripts/export_openapi.py
	cd ui && pnpm generate:api

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
