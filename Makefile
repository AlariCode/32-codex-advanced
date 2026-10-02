-include .env
export

.PHONY: setup db-up db-down db-logs db-shell web api worker build check

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
	go test ./backend/api/... ./backend/worker/...
	go vet ./backend/api/... ./backend/worker/...
	npm run lint
	npm run typecheck

