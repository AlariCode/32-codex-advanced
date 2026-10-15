#!/bin/sh
set -eu
# Reproducible deployment check, independent of application URL-validation mocks.
# PostgreSQL need not be migrated: worker startup waits while we probe firewall.
IMAGE=${WORKER_TEST_IMAGE:-linkbook-worker-egress-test}
NAME="linkbook-egress-$$"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; docker network rm "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM
docker build -q -f infra/worker/Dockerfile -t "$IMAGE" . >/dev/null
docker network create "$NAME" >/dev/null
docker run -d --name "$NAME" --network "$NAME" --cap-drop ALL --cap-add NET_ADMIN --cap-add SETUID --cap-add SETGID --cap-add SETPCAP \
 --security-opt no-new-privileges:true --read-only --tmpfs /tmp:size=16m --memory 512m --cpus 1 --pids-limit 64 \
 --add-host host.docker.internal:host-gateway \
 -e WORKER_DATABASE_HOST=host.docker.internal -e WORKER_DATABASE_PORT=15433 \
 -e 'DATABASE_URL=postgres://linkbook_test:linkbook_test_local@host.docker.internal:15433/linkbook_test?sslmode=disable' \
 "$IMAGE" >/dev/null
# Wait for privilege drop; no arbitrary long sleep.
i=0
while ! docker exec "$NAME" sh -c 'test "$(awk "/^Uid:/ {print \$2}" /proc/1/status)" = 65532'; do
 i=$((i+1)); [ "$i" -lt 20 ]; sleep 1
done
docker exec --user 65532 "$NAME" timeout 5 getent ahostsv4 example.com >/dev/null
for ip in 127.0.0.1 10.0.0.1 169.254.169.254 192.168.0.1; do
 if docker exec --user 65532 "$NAME" timeout 2 bash -c 'echo > /dev/tcp/$1/80' sh "$ip" 2>/dev/null; then
  echo "Forbidden TCP connection succeeded: $ip" >&2; exit 1
 fi
done
# Rules must have rejected real packets; mere connection refusal is insufficient.
docker exec "$NAME" sh -c 'iptables -L OUTPUT -v -n -x | awk '\''$3 == "REJECT" {rejected += $1} END {if (rejected < 4) exit 1}'\'''
if docker exec --user 65532 "$NAME" iptables -F OUTPUT 2>/dev/null; then
 echo 'Worker could change its firewall' >&2; exit 1
fi
docker exec "$NAME" sh -c 'grep -Eq "^Cap(Eff|Prm):[[:space:]]+0000000000000000$" /proc/1/status'
echo 'PASS: private/loopback/metadata TCP blocked by deployment firewall; worker uid 65532, no capabilities'
