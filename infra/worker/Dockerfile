FROM golang:1.26-bookworm AS build
WORKDIR /src
COPY go.work ./
COPY backend ./backend
RUN CGO_ENABLED=0 go build -trimpath -o /worker ./backend/worker/cmd/worker

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates iptables util-linux && rm -rf /var/lib/apt/lists/*
COPY --from=build /worker /usr/local/bin/linkbook-worker
COPY infra/worker/entrypoint.sh /usr/local/bin/worker-entrypoint
ENTRYPOINT ["/bin/sh", "/usr/local/bin/worker-entrypoint"]
