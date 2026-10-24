#!/usr/bin/env bash
# Post-release sanity check: install the published CLI, run `ai init`,
# `ai version`, and start the dashboard server, then verify its health endpoint.
# Usage: scripts/smoke-test-release.sh [version]
# Without an argument, tests the version in packages/cli/package.json so that a
# stale "latest" can never satisfy the check before the new release propagates.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${1:-$(node -p "require('$ROOT_DIR/packages/cli/package.json').version")}"
PACKAGE="@ai-dev-orchestrator/cli"
WAIT_ATTEMPTS="${SMOKE_WAIT_ATTEMPTS:-40}" # 40 x 15s = 10 minutes
PORT="${SMOKE_PORT:-9100}"
WORK_DIR="$(mktemp -d)"
DASHBOARD_PID=""

cleanup() {
  if [[ -n "$DASHBOARD_PID" ]]; then kill "$DASHBOARD_PID" 2>/dev/null || true; fi
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

# Isolate ~/.ai and the npm install from the real user environment.
export HOME="$WORK_DIR/home"
mkdir -p "$HOME" "$WORK_DIR/prefix"

echo "==> Waiting for $PACKAGE@$VERSION on the npm registry"
for attempt in $(seq 1 "$WAIT_ATTEMPTS"); do
  if [[ "$(npm view "$PACKAGE@$VERSION" version --prefer-online 2>/dev/null | tail -1)" == *"$VERSION"* ]]; then
    break
  fi
  if [[ "$attempt" == "$WAIT_ATTEMPTS" ]]; then
    echo "$PACKAGE@$VERSION not available after waiting" >&2
    exit 1
  fi
  echo "Not available yet (attempt $attempt/$WAIT_ATTEMPTS), retrying in 15s..."
  sleep 15
done

echo "==> Installing $PACKAGE@$VERSION"
npm install --prefix "$WORK_DIR/prefix" "$PACKAGE@$VERSION" --prefer-online --no-audit --no-fund
AI="$WORK_DIR/prefix/node_modules/.bin/ai"

echo "==> ai version"
VERSION_OUT="$("$AI" version)"
echo "$VERSION_OUT"
if [[ "$VERSION_OUT" != *"$VERSION"* ]]; then
  echo "Version output does not contain $VERSION" >&2
  exit 1
fi

echo "==> ai init"
"$AI" init
test -d "$HOME/.ai" || { echo "~/.ai was not created" >&2; exit 1; }

echo "==> ai dashboard"
(cd "$WORK_DIR" && "$AI" dashboard --no-open --port "$PORT") >"$WORK_DIR/dashboard.log" 2>&1 &
DASHBOARD_PID=$!

for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    echo "Dashboard health check passed"
    echo "Smoke test passed"
    exit 0
  fi
  if ! kill -0 "$DASHBOARD_PID" 2>/dev/null; then break; fi
  sleep 1
done

echo "Dashboard failed to become healthy. Log:" >&2
cat "$WORK_DIR/dashboard.log" >&2
exit 1
