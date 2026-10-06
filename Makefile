-include .env
export

.PHONY: setup db-up db-down db-logs db-shell test-db-up test-db-down test-integration openapi web api worker build check

TEST_DATABASE_URL ?= postgres://linkbook_test:linkbook_test_local@127.0.0.1:15433/linkbook_test?sslmode=disable

setup:
	@test -f .env || cp .env.example .env
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

test-integration:
	go test -tags=integration ./backend/api/... -count=1 -v

openapi:
	bash scripts/sync-openapi.sh

web:
	npm run dev

api:
	go run ./backend/api/cmd/api

worker:
	go run ./backend/worker/cmd/worker

build:
	mkdir -p bin
	go build -o bin/api ./backend/api/cmd/api
	go build -o bin/worker ./backend/worker/cmd/worker
	npm run build

check:
	go test ./backend/api/... ./backend/worker/... ./backend/migrations/...
	go vet ./backend/api/... ./backend/worker/... ./backend/migrations/...
	npm run lint
	npm run typecheck
