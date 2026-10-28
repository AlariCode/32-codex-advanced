-include .env
export

.PHONY: setup db-up db-down db-logs db-shell test test-db-up test-db-down test-integration test-login openapi web api worker worker-dev build check ralph

TEST_DATABASE_URL ?= postgres://linkbook_test:linkbook_test_local@127.0.0.1:15433/linkbook_test?sslmode=disable

setup:
	@test -f .env || cp .env.example .env
	npm ci
	npm ci --prefix web

db-up:
	docker compose up -d --wait postgres

db-down:
	docker compose down

db-logs:
	docker compose logs -f postgres

db-shell:
	docker compose exec postgres sh -c 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'

test-db-up:
	docker compose -f compose.test.yaml up -d --wait postgres-test

test-db-down:
	docker compose -f compose.test.yaml down

test: test-db-up
	go test -tags=integration ./backend/api/... ./backend/worker/... ./backend/migrations/... ./backend/linkprocessing/... -count=1

test-integration:
	go test -tags=integration ./backend/api/... -count=1 -v

test-login:
	go test -tags=integration ./backend/api/internal/httpapi -run '^TestLoginIntegration' -count=1 -v

openapi:
	bash scripts/sync-openapi.sh

web:
	npm run dev

api:
	go run ./backend/api/cmd/api

worker:
	docker compose -f compose.worker.yaml up --build worker

worker-dev:
	go run ./backend/worker/cmd/worker

build:
	mkdir -p bin
	go build -o bin/api ./backend/api/cmd/api
	go build -o bin/worker ./backend/worker/cmd/worker
	npm run build

check:
	@mkdir -p tmp; \
	log=$$(mktemp tmp/check.XXXXXX) || exit 1; \
	trap 'rm -f "$$log"' EXIT; \
	if { \
		node --test scripts/archive-benchmark/metrics.test.mjs && \
		go test ./backend/api/... ./backend/worker/... ./backend/migrations/... ./backend/linkprocessing/... && \
		go vet ./backend/api/... ./backend/worker/... ./backend/migrations/... ./backend/linkprocessing/... && \
		npm run lint && \
		npm run typecheck; \
	} >"$$log" 2>&1; then \
		:; \
	else \
		status=$$?; cat "$$log"; exit "$$status"; \
	fi

ralph:
	@test -n "$(PHASE)" || (echo "Usage: make ralph PHASE=2"; exit 1)
	node tools/ralph/ralph.ts --phase "$(PHASE)"
