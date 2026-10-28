#!/usr/bin/env bash
# Run the soak harness inside a Linux container with real packet-level network
# impairment (tc netem) applied to every packet: media between clients rides
# the container's loopback, signaling rides eth0 out to your dev server.
#
#   ./netem.sh thailand     # ~160ms RTT, jitter, 3% loss — a call across the world
#   ./netem.sh mobile       # 1.5 Mbit, 250ms RTT, 6% loss — one bar of LTE
#   ./netem.sh clean
#
# Needs: Docker, the dev server reachable at $TARGET (default: this machine's LAN
# IP on $PORT, default 5173), and the backend running. Extra args go to soak.mjs.
set -euo pipefail
cd "$(dirname "$0")"

PROFILE="${1:-thailand}"; shift || true
LAN_IP="$(ipconfig 2>/dev/null | grep -oE 'IPv4[^:]*: (10|192\.168)\.[0-9.]+' | grep -oE '[0-9.]+$' | head -1 || true)"
[ -z "$LAN_IP" ] && LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
PORT="${PORT:-5173}"
TARGET="${TARGET:-$LAN_IP:$PORT}"

case "$PROFILE" in
  thailand) NETEM="delay 80ms 20ms distribution normal loss 3%" ;;
  mobile)   NETEM="delay 125ms 40ms distribution normal loss 6% rate 1500kbit" ;;
  clean)    NETEM="delay 1ms" ;;
  *) echo "unknown profile $PROFILE"; exit 1 ;;
esac

echo "profile=$PROFILE netem='$NETEM' target=$TARGET"

# Camera access needs a secure context, and http://localhost is one — so the
# browsers reach the dev server through a localhost proxy, not its LAN IP.
INNER=$(cat <<EOF
set -e
(apt-get update -qq && apt-get install -y -qq iproute2 socat) >/dev/null 2>&1
socat TCP-LISTEN:$PORT,fork,reuseaddr TCP:$TARGET &
sleep 0.5
tc qdisc add dev lo root netem $NETEM
tc qdisc add dev eth0 root netem $NETEM
node soak.mjs --no-backend --url http://localhost:$PORT --out artifacts/netem-$PROFILE \
  --blackout-on 'tc qdisc change dev lo root netem loss 100% && tc qdisc change dev eth0 root netem loss 100%' \
  --blackout-off 'tc qdisc change dev lo root netem $NETEM && tc qdisc change dev eth0 root netem $NETEM' \
  $*
EOF
)

MSYS_NO_PATHCONV=1 docker run --rm --cap-add=NET_ADMIN --ipc=host \
  -v "$(pwd):/e2e" -w /e2e \
  mcr.microsoft.com/playwright:v1.64.1-noble bash -c "$INNER"
