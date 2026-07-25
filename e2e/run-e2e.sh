#!/usr/bin/env bash
# Minimal E2E: install this extension into OHIF per the README Quick Start,
# boot the dev server, and confirm http://localhost:3000/fhir-viewer loads.
#
# Environment overrides:
#   VIEWERS_DIR  path to an OHIF Viewers checkout   (default: ../Viewers)
#   OHIF_PORT    port for the OHIF dev server        (default: 3000)
set -euo pipefail

EXT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VIEWERS_DIR="${VIEWERS_DIR:-$EXT_DIR/../Viewers}"
OHIF_PORT="${OHIF_PORT:-3000}"
URL="http://localhost:$OHIF_PORT"
LOG_FILE="$EXT_DIR/e2e/ohif-dev.log"
SERVER_PID=""

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    echo "[e2e] Stopping OHIF dev server (pid $SERVER_PID)"
    pkill -P "$SERVER_PID" 2>/dev/null || true
    kill "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# ── 1. OHIF checkout side by side (README: clone side by side) ──
if [ ! -d "$VIEWERS_DIR" ]; then
  echo "[e2e] Cloning OHIF Viewers into $VIEWERS_DIR"
  git clone https://github.com/OHIF/Viewers "$VIEWERS_DIR"
fi

# ── 2. Install dependencies ──
echo "[e2e] Installing extension dependencies"
(cd "$EXT_DIR" && pnpm install --config.auto-install-peers=false)

echo "[e2e] Installing OHIF dependencies"
(cd "$VIEWERS_DIR" && pnpm install)

# ── 3. Link the extension and its companion mode ──
if grep -q '"@ohif/fhir-viewer"' "$VIEWERS_DIR/platform/app/pluginConfig.json"; then
  echo "[e2e] Extension already linked in pluginConfig.json"
else
  (cd "$VIEWERS_DIR" && pnpm run cli link-extension "$EXT_DIR")
  (cd "$VIEWERS_DIR" && pnpm run cli link-mode "$EXT_DIR/mode")
fi

# ── 4. Boot the dev server (or reuse a running OHIF instance) ──
probe="$(mktemp)"
if curl -sf --max-time 3 "$URL" -o "$probe" 2>/dev/null; then
  if grep -qi "ohif" "$probe"; then
    echo "[e2e] Reusing running OHIF dev server at $URL"
  else
    echo "[e2e] ERROR: port $OHIF_PORT is serving something that is not OHIF." >&2
    echo "[e2e] Stop it, or rerun with OHIF_PORT=<free port> $0" >&2
    exit 1
  fi
else
  echo "[e2e] Starting OHIF dev server on port $OHIF_PORT (log: $LOG_FILE)"
  (cd "$VIEWERS_DIR" && OHIF_PORT="$OHIF_PORT" exec pnpm dev) > "$LOG_FILE" 2>&1 &
  SERVER_PID=$!

  # Initial compile of the OHIF monorepo can take several minutes
  echo "[e2e] Waiting for $URL (up to 15 minutes)..."
  for i in $(seq 1 180); do
    if curl -sf --max-time 3 "$URL" -o /dev/null 2>/dev/null; then
      echo "[e2e] Server is up"
      break
    fi
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      echo "[e2e] ERROR: dev server exited early — last log lines:" >&2
      tail -20 "$LOG_FILE" >&2
      exit 1
    fi
    sleep 5
  done
  if ! curl -sf --max-time 3 "$URL" -o /dev/null 2>/dev/null; then
    echo "[e2e] ERROR: server did not come up within 15 minutes" >&2
    exit 1
  fi
fi
rm -f "$probe"

# ── 5. Browser check ──
# playwright.config.js defaults to the system Chrome (channel: 'chrome'),
# so no `playwright install` download is needed.
cd "$EXT_DIR"
OHIF_URL="$URL" npx playwright test
