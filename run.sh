#!/usr/bin/env bash

# Start Career Tracker for this Mac only, for devices on the same LAN, or for
# the public internet through a tunnel.
#
# Usage:
#   ./run.sh local
#   ./run.sh lan
#   ./run.sh global       # alias for "lan"; this does not expose the app publicly
#   ./run.sh global --https   # same, over HTTPS so the app can be installed
#   ./run.sh local --tunnel cloudflare   # also reachable from anywhere, via Cloudflare
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

# The tunnel provider, if any ("" means none — local/LAN only, unchanged).
# Everything provider-specific (the binary, how it's invoked, how its public
# hostname is shaped) lives behind this one variable and the two functions
# below, so swapping Cloudflare for something else later — ngrok, Tailscale
# Funnel — means adding one more `case` arm each, not touching the rest of
# this script.
TUNNEL=""
TUNNEL_HOST_SUFFIX=""
TUNNEL_URL=""
TUNNEL_LOG=""

BACKEND_PID=""
FRONTEND_PID=""
TUNNEL_PID=""
TUNNEL_PANEL=""
STOPPING=0

# Colour only when stdout is an actual terminal — never when it's redirected
# to a file or piped, so logs stay plain text.
if [[ -t 1 ]]; then
  C_RESET=$'\033[0m'
  C_BOLD=$'\033[1m'
  C_DIM=$'\033[2m'
  C_RED=$'\033[31m'
  C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'
  C_CYAN=$'\033[36m'
else
  C_RESET="" C_BOLD="" C_DIM="" C_RED="" C_GREEN="" C_YELLOW="" C_CYAN=""
fi

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
  --tunnel <provider>   Also expose the app on the public internet through a
                       tunnel (currently only "cloudflare" is supported).
                       Implies --https: the tunnel needs a secure local origin
                       to forward to, and gets one for free from that. Does
                       not affect local/LAN access — it's an extra front door,
                       not a replacement for the other modes.

Aliases -local, --local, -lan, --lan, -global and --global also work.

Optional environment variables:
  LAN_IP=192.168.1.50  Override automatic LAN IP detection
  BACKEND_PORT=8000    Override the Django port
  FRONTEND_PORT=5173   Override the Vite port
EOF
}

fail() {
  local red="" reset=""
  [[ -t 2 ]] && { red="$C_RED"; reset="$C_RESET"; }
  printf '%sError: %s%s\n' "$red" "$*" "$reset" >&2
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

# Best-effort: open a live `tail -f` of the tunnel log in its own tmux pane or
# terminal window, purely so its connection chatter is visible somewhere
# instead of silently piling up in a file. cloudflared itself always stays a
# background child of this script (set in start_cloudflare_tunnel) regardless
# of whether this finds anywhere to show it — a detached window is nothing
# `cleanup`'s trap can reliably reach on Ctrl+C, but a background PID is.
# Sets TUNNEL_PANEL to a human-readable description on success.
open_tunnel_viewer() {
  local viewer=(tail -n +1 -f "$TUNNEL_LOG")
  local title="Career Tracker — Cloudflare tunnel"

  if [[ -n "${TMUX:-}" ]] && command_exists tmux; then
    tmux split-window -h "${viewer[@]}" >/dev/null 2>&1 &&
      { TUNNEL_PANEL="a new tmux pane"; return 0; }
  fi

  if [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
    if command_exists gnome-terminal; then
      gnome-terminal --title="$title" -- "${viewer[@]}" >/dev/null 2>&1 &
      TUNNEL_PANEL="a new terminal window"; return 0
    elif command_exists konsole; then
      konsole -e "${viewer[@]}" >/dev/null 2>&1 &
      TUNNEL_PANEL="a new terminal window"; return 0
    elif command_exists xfce4-terminal; then
      xfce4-terminal --title="$title" -x "${viewer[@]}" >/dev/null 2>&1 &
      TUNNEL_PANEL="a new terminal window"; return 0
    elif command_exists x-terminal-emulator; then
      x-terminal-emulator -e "${viewer[@]}" >/dev/null 2>&1 &
      TUNNEL_PANEL="a new terminal window"; return 0
    elif command_exists xterm; then
      xterm -T "$title" -e "${viewer[@]}" >/dev/null 2>&1 &
      TUNNEL_PANEL="a new terminal window"; return 0
    fi
  fi

  return 1
}

# A Cloudflare "quick tunnel" — no account or DNS setup needed, at the cost
# of a random *.trycloudflare.com hostname that changes every run. TLS runs
# the whole way: the browser holds a real Cloudflare-issued certificate to
# the edge, cloudflared's own connection back to Cloudflare is always
# encrypted (that's the tunnel protocol itself, not something this script
# configures), and the last hop — cloudflared to this machine's Vite server —
# is the same local HTTPS `--https` already sets up. `--no-tls-verify` only
# waives checking *that* hop's mkcert/self-signed certificate against a CA;
# it does not turn off encryption anywhere, and it has no bearing on what the
# browser sees.
#
# The hostname isn't known until the tunnel actually connects, so this starts
# cloudflared in the background and polls its own log for the line it prints
# once assigned, rather than guessing it up front.
start_cloudflare_tunnel() {
  local target="$1"
  command_exists cloudflared ||
    fail "--tunnel cloudflare needs cloudflared. Install: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"

  TUNNEL_LOG="$(mktemp -t career-tracker-tunnel.XXXXXX)"
  printf '%sStarting a Cloudflare quick tunnel...%s\n' "$C_DIM" "$C_RESET"
  cloudflared tunnel --no-autoupdate --url "$target" --no-tls-verify \
    >"$TUNNEL_LOG" 2>&1 &
  TUNNEL_PID=$!

  if open_tunnel_viewer; then
    printf '%sLive tunnel log: %s%s\n' "$C_DIM" "$TUNNEL_PANEL" "$C_RESET"
  else
    printf '%sNo tmux/terminal window available — tunnel log: %s%s\n' \
      "$C_DIM" "$TUNNEL_LOG" "$C_RESET"
  fi

  local tries=0
  while [[ -z "$TUNNEL_URL" && $tries -lt 30 ]]; do
    TUNNEL_URL="$(grep -oE 'https://[a-zA-Z0-9.-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -n1 || true)"
    [[ -n "$TUNNEL_URL" ]] && break
    kill -0 "$TUNNEL_PID" >/dev/null 2>&1 ||
      fail "cloudflared exited before the tunnel came up. Log: $TUNNEL_LOG"
    sleep 1
    tries=$((tries + 1))
  done

  [[ -n "$TUNNEL_URL" ]] ||
    printf '%sWarning: no tunnel URL yet after 30s — check %s%s\n' \
      "$C_YELLOW" "$TUNNEL_LOG" "$C_RESET" >&2
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
  stop_process_tree "$TUNNEL_PID"
  [[ -z "$FRONTEND_PID" ]] || wait "$FRONTEND_PID" 2>/dev/null || true
  [[ -z "$BACKEND_PID" ]] || wait "$BACKEND_PID" 2>/dev/null || true
  [[ -z "$TUNNEL_PID" ]] || wait "$TUNNEL_PID" 2>/dev/null || true
  [[ -z "$TUNNEL_LOG" ]] || rm -f "$TUNNEL_LOG"
}

shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --https|-https|https) USE_HTTPS=1 ;;
    --tunnel)
      shift
      [[ $# -gt 0 ]] || fail "--tunnel needs a provider name, e.g. --tunnel cloudflare"
      TUNNEL="$1"
      ;;
    --tunnel=*) TUNNEL="${1#*=}" ;;
    *) usage >&2; fail "Unknown option: $1" ;;
  esac
  shift
done

case "$TUNNEL" in
  "") ;;
  cloudflare) TUNNEL_HOST_SUFFIX=".trycloudflare.com" ;;
  *) fail "Unknown --tunnel provider: $TUNNEL (supported: cloudflare)" ;;
esac

if [[ -n "$TUNNEL" && "$USE_HTTPS" -eq 0 ]]; then
  printf 'Note: --tunnel needs a secure local origin to forward to — enabling --https.\n'
  USE_HTTPS=1
fi

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

# The tunnel's hostname is only known once it connects (see
# start_cloudflare_tunnel below), but its *shape* — the suffix every quick
# tunnel hostname shares — is known up front, so Django and Vite can both be
# told to accept it before that hostname exists.
if [[ -n "$TUNNEL_HOST_SUFFIX" ]]; then
  ALLOWED_HOSTS="$ALLOWED_HOSTS,$TUNNEL_HOST_SUFFIX"
  CSRF_ORIGINS="${CSRF_ORIGINS:+$CSRF_ORIGINS,}https://*$TUNNEL_HOST_SUFFIX"
fi

printf 'Applying database migrations...\n'
(
  cd "$BACKEND_DIR"
  "$PYTHON" manage.py migrate --noinput
)

# The labeled "what's running, with what settings" banner, printed once
# everything — including the tunnel's public URL, if any — is actually known.
# Kept as one function rather than scattered printfs so the two places that
# need it (a normal start, and the "still connecting" case if the tunnel
# hasn't resolved yet) can't drift apart.
print_summary() {
  local bar="────────────────────────────────────────────────────"
  printf '\n%s%s%s\n' "$C_CYAN" "$bar" "$C_RESET"
  printf '%s Career Tracker — running in %s mode%s\n' "$C_BOLD$C_CYAN" "$MODE" "$C_RESET"
  printf '%s%s%s\n' "$C_CYAN" "$bar" "$C_RESET"
  printf ' %-9s %s\n' "Frontend:" "$FRONTEND_URL"
  printf ' %-9s %s\n' "Backend:" "$API_URL"
  if [[ "$USE_HTTPS" -eq 1 ]]; then
    printf ' %-9s on (%s certificate)\n' "HTTPS:" "$CERT_AUTHORITY"
  fi
  if [[ "$TUNNEL" == "cloudflare" ]]; then
    if [[ -n "$TUNNEL_URL" ]]; then
      printf ' %-9s %s%s%s %s(temporary — a new one every run)%s\n' \
        "Public:" "$C_BOLD$C_GREEN" "$TUNNEL_URL" "$C_RESET" "$C_DIM" "$C_RESET"
    else
      printf ' %-9s %s(still connecting — see %s)%s\n' \
        "Public:" "$C_YELLOW" "$TUNNEL_LOG" "$C_RESET"
    fi
  fi
  printf ' %-9s backend %s, frontend %s\n' "Ports:" "$BACKEND_PORT" "$FRONTEND_PORT"
  if [[ "$USE_POSTGRES" == "1" || "$USE_POSTGRES" == "true" || "$USE_POSTGRES" == "yes" || "$USE_POSTGRES" == "on" ]]; then
    printf ' %-9s PostgreSQL (docker compose)\n' "Database:"
  else
    printf ' %-9s SQLite\n' "Database:"
  fi
  printf '%s%s%s\n' "$C_CYAN" "$bar" "$C_RESET"
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
  printf 'Press Ctrl+C to stop.\n\n'
}

trap cleanup EXIT
trap 'cleanup; exit 130' INT TERM

printf '\n%sStarting Career Tracker in %s mode...%s\n' "$C_DIM" "$MODE" "$C_RESET"

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
    VITE_ALLOWED_HOST_SUFFIX="$TUNNEL_HOST_SUFFIX" \
    "$VITE_BIN" --host "$BIND_ADDRESS" --port "$FRONTEND_PORT"
) &
FRONTEND_PID=$!

if [[ "$TUNNEL" == "cloudflare" ]]; then
  start_cloudflare_tunnel "https://127.0.0.1:$FRONTEND_PORT"
fi

print_summary

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
