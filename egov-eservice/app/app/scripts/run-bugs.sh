#!/usr/bin/env bash
# B13 · BUGS.md §3: run the full 51-TC Playwright suite once per BUG_MODE against the Docker Compose web.
#
#   app/scripts/run-bugs.sh                 # none, none-again (no restart), B01..B12, B03,B07, B01,B05,B09, none-final
#   app/scripts/run-bugs.sh none B05        # only the given modes ("none" = BUG_MODE empty)
#   NO_BUILD=1 app/scripts/run-bugs.sh B01  # skip `docker compose build`
#
# Per mode: (re)start `web` with TEST_MODE=1 BUG_MODE=<mode>, wait for /api/health, check the startup banner
# prints that BUG_MODE, then `npx playwright test` (workers 1, from e2e/playwright.config.ts).
# "none-again" re-runs without restarting the web (BUGS.md §3 step 2).
# Results: e2e/reports/bugs/<mode>.json (+ .log) → summarised by scripts/summarize-bugs.cjs into
#          e2e/reports/bugs/summary.md (BUGS.md §4 table + per-TC failure messages for §5 triage).
set -uo pipefail

SCRIPTS=$(cd "$(dirname "$0")" && pwd)
APP=$(cd "$SCRIPTS/.." && pwd)              # .../app/app   (server/, e2e/)
ROOT=$(cd "$APP/.." && pwd)                 # .../app       (docker-compose.yml, data/)
E2E=$APP/e2e
HOST_PORT=${HOST_PORT:-8080}
BASE_URL=${BASE_URL:-http://localhost:$HOST_PORT}
OUT=${OUT:-$E2E/reports/bugs}
mkdir -p "$OUT"

if [ $# -gt 0 ]; then MODES=("$@"); else
  MODES=(none none-again B01 B02 B03 B04 B05 B06 B07 B08 B09 B10 B11 B12 "B03,B07" "B01,B05,B09" none-final)
fi

# Playwright 1.65.1 wants chromium build 1255; the image only ships 1254 → symlink shim (board: B06/B09).
BROWSERS=${PLAYWRIGHT_BROWSERS_PATH:-/ms-playwright}
if [ ! -e "$BROWSERS/chromium_headless_shell-1255" ] && [ -e "$BROWSERS/chromium_headless_shell-1254" ]; then
  SHIM=/tmp/pw-browsers; mkdir -p "$SHIM"
  ln -sfn "$BROWSERS/chromium-1254" "$SHIM/chromium-1255"
  ln -sfn "$BROWSERS/chromium_headless_shell-1254" "$SHIM/chromium_headless_shell-1255"
  [ -e "$BROWSERS/ffmpeg-1013" ] && ln -sfn "$BROWSERS/ffmpeg-1013" "$SHIM/ffmpeg-1013"
  export PLAYWRIGHT_BROWSERS_PATH=$SHIM
fi

compose() { (cd "$ROOT" && HOST_PORT=$HOST_PORT docker compose "$@"); }

if [ -z "${NO_BUILD:-}" ]; then
  echo "== docker compose build"; compose build web >/dev/null || { echo "build failed"; exit 1; }
fi

start_web() {   # $1 = BUG_MODE value ("" = correct app)
  echo "== start web TEST_MODE=1 BUG_MODE='$1'"
  (cd "$ROOT" && TEST_MODE=1 BUG_MODE="$1" HOST_PORT=$HOST_PORT docker compose up -d --force-recreate web) >/dev/null 2>&1 \
    || { echo "compose up failed"; return 1; }
  for _ in $(seq 1 60); do
    curl -fsS -m 2 "$BASE_URL/api/health" >/dev/null 2>&1 && break; sleep 1
  done
  curl -fsS -m 2 "$BASE_URL/api/health" >/dev/null || { echo "web not healthy"; return 1; }
  local banner; banner=$(compose logs web 2>/dev/null | grep 'BUG_MODE' | tail -1)
  echo "   banner:$banner"
  if [ -z "$1" ]; then echo "$banner" | grep -q 'none' || { echo "unexpected BUG_MODE banner"; return 1; }
  else echo "$banner" | grep -q "$1" || { echo "BUG_MODE not active"; return 1; }; fi
}

for mode in "${MODES[@]}"; do
  case "$mode" in
    none|none-final) start_web "" || exit 1 ;;
    none-again) echo "== re-run without restarting the web" ;;
    *) start_web "$mode" || exit 1 ;;
  esac
  tag=${mode//,/+}
  echo "== playwright ($tag)"
  (cd "$E2E" && BASE_URL=$BASE_URL DB_PATH="$ROOT/data/egov.db" \
     DB_ENCRYPTION_METHOD="AES-256-GCM (server/lib/crypto.js) + HMAC blind index" \
     PLAYWRIGHT_JSON_OUTPUT_FILE="$OUT/$tag.json" \
     npx playwright test --reporter=line,json --output="/tmp/b13-test-results/$tag" > "$OUT/$tag.log" 2>&1)
  tail -n 3 "$OUT/$tag.log" | sed 's/^/   /'
done

# leave the web in the correct mode
[ "${MODES[-1]}" = none-final ] || [ "${MODES[-1]}" = none ] || start_web "" >/dev/null
node "$SCRIPTS/summarize-bugs.cjs" "$OUT" > "$OUT/summary.md" && echo "== summary: $OUT/summary.md"
