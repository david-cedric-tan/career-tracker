#!/usr/bin/env bash

# Start Career Tracker for this Mac only or for devices on the same LAN.
#
# Usage:
#   ./run.sh local
#   ./run.sh lan
#   ./run.sh global       # alias for "lan"; this does not expose the app publicly
#   ./run.sh global --https   # same, over HTTPS so the app can be installed
#
# If automatic LAN address detection fails:
#   LAN_IP=192.168.1.50 ./run.sh lan

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
MODE="${1:-local}"
USE_HTTPS=0

BACKEND_PID=""
FRONTEND_PID=""
STOPPING=0

usage() {
  cat <<'EOF'
Usage:
  ./run.sh local       Only this Mac can access the app
  ./run.sh lan         Devices on the same home network can access the app
  ./run.sh global      Alias for lan (not public internet access)

Options:
  --https              Serve over HTTPS with a locally generated certificate.
                       Browsers only offer "install this app" and only run
                       service workers on a secure origin, so LAN devices need
                       this to install Career Tracker as an app. In this mode
                       the API is proxied through the frontend, so there is one
                       address to open and Django needs no certificate.

Aliases -local, --local, -lan, --lan, -global and --global also work.

Optional environment variables:
  LAN_IP=192.168.1.50  Override automatic LAN IP detection
  BACKEND_PORT=8000    Override the Django port
  FRONTEND_PORT=5173   Override the Vite port
EOF
}

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

read_env_value() {
  local key="$1"
  local file="$2"

  [[ -f "$file" ]] || return 0
  awk -F= -v key="$key" '
    $1 == key {
      value = substr($0, index($0, "=") + 1)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      gsub(/^["'\'']|["'\'']$/, "", value)
      print value
      exit
    }
  ' "$file"
}

CERT_AUTHORITY=""

# Produce a certificate covering this Mac's LAN address, reusing one if it is
# already there and still names the right address.
#
# mkcert is preferred because it issues from a local authority you can trust
# once per device, which is what turns "the browser warns every time" into a
# padlock and an install button. Without it, openssl still gets a secure
# origin — enough for service workers and installation — at the cost of an
# interstitial the first time each device connects.
ensure_certificate() {
  local dir="$ROOT_DIR/.certs"
  CERT_FILE="$dir/$HOST_IP.pem"
  KEY_FILE="$dir/$HOST_IP-key.pem"
  mkdir -p "$dir"

  if command_exists mkcert; then
    CERT_AUTHORITY="mkcert"
  else
    CERT_AUTHORITY="openssl"
    command_exists openssl ||
      fail "--https needs mkcert or openssl. Install one: brew install mkcert"
  fi

  if [[ -s "$CERT_FILE" && -s "$KEY_FILE" ]]; then
    return
  fi

  printf 'Generating an HTTPS certificate for %s...\n' "$HOST_IP"
  if [[ "$CERT_AUTHORITY" == "mkcert" ]]; then
    mkcert -cert-file "$CERT_FILE" -key-file "$KEY_FILE" \
      "$HOST_IP" localhost 127.0.0.1 ::1 >/dev/null
  else
    # `subjectAltName` is not optional: browsers have ignored the common name
    # for years, and a certificate without a matching SAN is rejected outright
    # rather than merely warned about.
    openssl req -x509 -newkey rsa:2048 -sha256 -days 825 -nodes \
      -keyout "$KEY_FILE" -out "$CERT_FILE" \
      -subj "/CN=$HOST_IP" \
      -addext "subjectAltName=IP:$HOST_IP,IP:127.0.0.1,DNS:localhost" >/dev/null 2>&1 ||
      fail "Could not generate a certificate with openssl."
  fi

  chmod 600 "$KEY_FILE"
}

detect_lan_ip() {
  if [[ -n "${LAN_IP:-}" ]]; then
    printf '%s\n' "$LAN_IP"
    return
  fi

  if command_exists ipconfig && command_exists route; then
    local interface
    interface="$(route -n get default 2>/dev/null | awk '/interface:/{print $2; exit}')"
    if [[ -n "$interface" ]]; then
      ipconfig getifaddr "$interface" 2>/dev/null && return
    fi
  fi

  if command_exists hostname; then
    hostname -I 2>/dev/null | awk '{print $1}' | grep -E '.+' && return
  fi

  return 1
}

port_is_busy() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

stop_process_tree() {
  local pid="$1"
  [[ -n "$pid" ]] || return 0

  # npm and Django's reloader may create child processes. Stop those before
  # their parent so neither server is left behind after Ctrl+C.
  pkill -TERM -P "$pid" >/dev/null 2>&1 || true
  kill -TERM "$pid" >/dev/null 2>&1 || true
}

cleanup() {
  if [[ "$STOPPING" -eq 1 ]]; then
    return
  fi
  STOPPING=1
  trap - EXIT INT TERM

  if [[ -n "$BACKEND_PID" || -n "$FRONTEND_PID" ]]; then
    printf '\nStopping Career Tracker...\n'
  fi

  stop_process_tree "$FRONTEND_PID"
  stop_process_tree "$BACKEND_PID"
  [[ -z "$FRONTEND_PID" ]] || wait "$FRONTEND_PID" 2>/dev/null || true
  [[ -z "$BACKEND_PID" ]] || wait "$BACKEND_PID" 2>/dev/null || true
}

shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --https|-https|https) USE_HTTPS=1 ;;
    *) usage >&2; fail "Unknown option: $1" ;;
  esac
  shift
done

case "$MODE" in
  local|-local|--local)
    MODE="local"
    HOST_IP="127.0.0.1"
    BIND_ADDRESS="127.0.0.1"
    ;;
  lan|-lan|--lan|global|-global|--global)
    MODE="lan"
    HOST_IP="$(detect_lan_ip)" ||
      fail "Could not detect this Mac's LAN IP. Try: LAN_IP=192.168.1.50 ./run.sh lan"
    BIND_ADDRESS="0.0.0.0"
    ;;
  help|-h|--help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    fail "Unknown mode: $MODE"
    ;;
esac

command_exists lsof || fail "lsof is required to check whether ports are available."
command_exists node || fail "Node.js is not installed or is not on PATH."

if [[ -x "$ROOT_DIR/.venv/bin/python" ]]; then
  PYTHON="$ROOT_DIR/.venv/bin/python"
elif command_exists python3; then
  PYTHON="$(command -v python3)"
else
  fail "Python was not found. Create .venv or install Python 3."
fi

VITE_BIN="$FRONTEND_DIR/node_modules/.bin/vite"
[[ -x "$VITE_BIN" ]] ||
  fail "Frontend dependencies are missing. Run: cd frontend && npm install"

port_is_busy "$BACKEND_PORT" &&
  fail "Port $BACKEND_PORT is already in use. Stop the existing backend or set BACKEND_PORT."
port_is_busy "$FRONTEND_PORT" &&
  fail "Port $FRONTEND_PORT is already in use. Stop the existing frontend or set FRONTEND_PORT."

USE_POSTGRES="$(read_env_value USE_POSTGRES "$BACKEND_DIR/.env" | tr '[:upper:]' '[:lower:]')"
if [[ "$USE_POSTGRES" == "1" || "$USE_POSTGRES" == "true" || "$USE_POSTGRES" == "yes" || "$USE_POSTGRES" == "on" ]]; then
  command_exists docker || fail "USE_POSTGRES=true, but Docker is not installed or is not on PATH."
  docker info >/dev/null 2>&1 || fail "USE_POSTGRES=true, but Docker Desktop is not running."

  printf 'Starting PostgreSQL...\n'
  (
    cd "$BACKEND_DIR"
    docker compose up -d db
  )
fi

SCHEME="http"
[[ "$USE_HTTPS" -eq 1 ]] && SCHEME="https"

API_URL="http://$HOST_IP:$BACKEND_PORT"
FRONTEND_URL="$SCHEME://$HOST_IP:$FRONTEND_PORT"
ALLOWED_HOSTS="localhost,127.0.0.1,[::1]"
CORS_ORIGINS="http://localhost:$FRONTEND_PORT,http://127.0.0.1:$FRONTEND_PORT"

if [[ "$MODE" == "lan" ]]; then
  ALLOWED_HOSTS="$ALLOWED_HOSTS,$HOST_IP"
  CORS_ORIGINS="$CORS_ORIGINS,$FRONTEND_URL"
fi

# Browser-facing API base. Empty in HTTPS mode: the frontend calls /api on its
# own origin and Vite forwards it to Django, so the page never makes a
# plain-HTTP request that a secure page would refuse to send.
BROWSER_API_URL="$API_URL"
PROXY_TARGET=""
CERT_FILE=""
KEY_FILE=""

CSRF_ORIGINS=""
if [[ "$USE_HTTPS" -eq 1 ]]; then
  BROWSER_API_URL=""
  PROXY_TARGET="http://127.0.0.1:$BACKEND_PORT"
  CSRF_ORIGINS="$FRONTEND_URL"
  ensure_certificate
fi

printf 'Applying database migrations...\n'
(
  cd "$BACKEND_DIR"
  "$PYTHON" manage.py migrate --noinput
)

trap cleanup EXIT
trap 'cleanup; exit 130' INT TERM

printf '\nStarting Career Tracker in %s mode...\n' "$MODE"
printf 'Frontend: %s\n' "$FRONTEND_URL"
printf 'Backend:  %s\n' "$API_URL"
if [[ "$MODE" == "lan" ]]; then
  printf 'Open the frontend URL on devices connected to the same home network.\n'
  printf 'This does not enable internet access or router port forwarding.\n'
fi
if [[ "$USE_HTTPS" -eq 1 ]]; then
  if [[ "$CERT_AUTHORITY" == "mkcert" ]]; then
    printf 'HTTPS: mkcert certificate. Run "mkcert -install" on each device once.\n'
  else
    printf 'HTTPS: self-signed certificate — browsers will warn once per device.\n'
    printf 'Accept the warning, then use the browser menu to install the app.\n'
  fi
fi
printf 'Press Ctrl+C to stop both servers.\n\n'

(
  cd "$BACKEND_DIR"
  exec env \
    DJANGO_ALLOWED_HOSTS="$ALLOWED_HOSTS" \
    CORS_ALLOWED_ORIGINS="$CORS_ORIGINS" \
    CSRF_TRUSTED_ORIGINS="$CSRF_ORIGINS" \
    "$PYTHON" manage.py runserver "$BIND_ADDRESS:$BACKEND_PORT"
) &
BACKEND_PID=$!

(
  cd "$FRONTEND_DIR"
  exec env VITE_API_URL="$BROWSER_API_URL" \
    VITE_PROXY_TARGET="$PROXY_TARGET" \
    VITE_HTTPS_CERT="$CERT_FILE" \
    VITE_HTTPS_KEY="$KEY_FILE" \
    "$VITE_BIN" --host "$BIND_ADDRESS" --port "$FRONTEND_PORT"
) &
FRONTEND_PID=$!

# Bash 3.2 (the macOS default) has no `wait -n`, so monitor both processes.
# If either server exits, the EXIT trap shuts down the other one.
while true; do
  if ! kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
    set +e
    wait "$BACKEND_PID"
    STATUS=$?
    set -e
    printf 'The backend stopped (status %s).\n' "$STATUS" >&2
    exit "$STATUS"
  fi

  if ! kill -0 "$FRONTEND_PID" >/dev/null 2>&1; then
    set +e
    wait "$FRONTEND_PID"
    STATUS=$?
    set -e
    printf 'The frontend stopped (status %s).\n' "$STATUS" >&2
    exit "$STATUS"
  fi

  sleep 1
done
