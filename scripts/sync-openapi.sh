#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd -- "$script_dir/../backend/api"

go run github.com/swaggo/swag/cmd/swag@v1.16.6 \
  init -g cmd/api/main.go -d . -o docs --parseInternal

npx --yes redoc-cli@0.13.21 bundle docs/swagger.yaml -o docs/swagger.html
