#!/usr/bin/env bash
# Boots everything a human-style QA run needs, from a clean in-memory store:
#   1. builds the app and API (skip with QA_SKIP_BUILD=1),
#   2. restarts `npm run serve -- --fixtures` on $PORT (5173) - a restart is also how the data resets,
#   3. restarts the browser driver on $QA_DRIVER_PORT (9333).
# Logs and screenshots land in qa-runs/<timestamp>/ (gitignored). Only the
# processes this script started on these ports are stopped, so two runs on
# different ports can live side by side.
#
#   bash .claude/skills/qa-buy-sell/driver/start.sh          # build + fresh start
#   QA_SKIP_BUILD=1 bash .claude/skills/qa-buy-sell/driver/start.sh
#   bash .claude/skills/qa-buy-sell/driver/start.sh stop
#   bash .claude/skills/qa-buy-sell/driver/start.sh driver   # restart the browser only; app data kept
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

export PORT="${PORT:-5173}"
export QA_DRIVER_PORT="${QA_DRIVER_PORT:-9333}"
export QA_BASE_URL="${QA_BASE_URL:-http://127.0.0.1:$PORT}"
mkdir -p qa-runs
PIDS="qa-runs/.pids-$PORT-$QA_DRIVER_PORT"

stop() {
  curl -s -XPOST "127.0.0.1:$QA_DRIVER_PORT/quit" >/dev/null 2>&1 || true
  if [ -f "$PIDS" ]; then
    while read -r pid; do kill "$pid" >/dev/null 2>&1 || true; done < "$PIDS"
    rm -f "$PIDS"
  fi
}

# Polls a URL until it answers, without `sleep` (some sandboxes block it).
wait_for() {
  node -e '
    const [url, label] = process.argv.slice(1); const until = Date.now() + 60000;
    (async function poll() {
      try { await fetch(url); console.log(label + " up"); }
      catch { if (Date.now() > until) { console.error(label + " did not start"); process.exit(1); } setTimeout(poll, 500); }
    })();' "$1" "$2"
}

if [ "${1:-}" = "stop" ]; then stop; echo "stopped"; exit 0; fi

if [ "${1:-}" = "driver" ]; then
  RUN="$(cat qa-runs/LATEST)"
  curl -s -XPOST "127.0.0.1:$QA_DRIVER_PORT/quit" >/dev/null 2>&1 || true
  node -e '
    const port = process.argv[1]; const until = Date.now() + 20000;
    (async function gone() {
      try { await fetch(`http://127.0.0.1:${port}/people`); if (Date.now() < until) setTimeout(gone, 300); }
      catch { /* port free */ }
    })();' "$QA_DRIVER_PORT"
  [ -f "$PIDS" ] && { head -1 "$PIDS" > "$PIDS.tmp"; mv "$PIDS.tmp" "$PIDS"; }
  QA_OUT="$RUN/shots" nohup node .claude/skills/qa-buy-sell/driver/server.mjs >> "$RUN/driver.log" 2>&1 &
  echo $! >> "$PIDS"
  wait_for "http://127.0.0.1:$QA_DRIVER_PORT/people" "driver on :$QA_DRIVER_PORT"
  echo "personas were signed out; screenshots continue in $RUN/shots"
  exit 0
fi
stop

RUN="qa-runs/$(date +%Y%m%d-%H%M%S)-$PORT"
mkdir -p "$RUN"
echo "$RUN" > qa-runs/LATEST

if [ "${QA_SKIP_BUILD:-0}" != "1" ]; then
  [ -d api/node_modules ] && [ -d app/node_modules ] || npm run install:all > "$RUN/install.log" 2>&1
  { npm run build && npm run build:fixtures; } > "$RUN/build.log" 2>&1 || { echo "build failed - see $RUN/build.log"; tail -20 "$RUN/build.log"; exit 1; }
fi

nohup node scripts/dev-server.mjs --fixtures > "$RUN/server.log" 2>&1 &
echo $! > "$PIDS"
wait_for "$QA_BASE_URL/api/health" "app on $QA_BASE_URL"

QA_OUT="$RUN/shots" nohup node .claude/skills/qa-buy-sell/driver/server.mjs > "$RUN/driver.log" 2>&1 &
echo $! >> "$PIDS"
wait_for "http://127.0.0.1:$QA_DRIVER_PORT/people" "driver on :$QA_DRIVER_PORT"

echo "run folder: $RUN"
