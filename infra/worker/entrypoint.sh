#!/bin/sh
set -eu
# The database is the sole private TCP exception. Configure its exact address
# and port, independently of submitted URLs. Never log DATABASE_URL.
: "${WORKER_DATABASE_HOST:?set the PostgreSQL host}"
: "${WORKER_DATABASE_PORT:?set the PostgreSQL port}"
case "$WORKER_DATABASE_PORT" in ''|*[!0-9]*) exit 1;; esac
DATABASE_IP=$(getent ahostsv4 "$WORKER_DATABASE_HOST" | awk 'NR==1 {print $1}')
[ -n "$DATABASE_IP" ]
iptables -P OUTPUT DROP
iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
# Docker DNATs resolver port 53 before OUTPUT filtering; match the original
# conntrack destination port. Public DNS follows the private blocks.
iptables -A OUTPUT -d 127.0.0.11 -p udp -m conntrack --ctorigdstport 53 -j ACCEPT
iptables -A OUTPUT -d 127.0.0.11 -p tcp -m conntrack --ctorigdstport 53 -j ACCEPT
iptables -A OUTPUT -d "$DATABASE_IP" -p tcp --dport "$WORKER_DATABASE_PORT" -j ACCEPT
for range in 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.0.0.0/24 192.0.2.0/24 192.88.99.0/24 192.168.0.0/16 198.18.0.0/15 198.51.100.0/24 203.0.113.0/24 224.0.0.0/4 240.0.0.0/4; do
 iptables -A OUTPUT -d "$range" -j REJECT
done
iptables -A OUTPUT -p tcp -j ACCEPT
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
# This deployment intentionally disables IPv6 egress; the application policy
# still validates IPv6 for other deployment environments.
ip6tables -P OUTPUT DROP
# The worker cannot change the firewall or regain privileges after startup.
exec setpriv --reuid=65532 --regid=65532 --clear-groups --bounding-set=-all --inh-caps=-all --ambient-caps=-all --no-new-privs /usr/local/bin/linkbook-worker
