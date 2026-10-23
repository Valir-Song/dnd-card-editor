#!/bin/bash
# Prepares a fresh Claude Code cloud session: installs the build/test tools
# (Vite, Tiptap, TypeScript) and the browser-test driver, then runs a quick check.
set -euo pipefail

# Only in cloud sessions; on your own computer you run `npm ci` yourself.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi
cd "$CLAUDE_PROJECT_DIR"

# npm install (not ci) reuses node_modules cached from a previous start.
npm install --no-audit --no-fund

# Browser tests: the cloud image ships Chromium for Playwright 1.56, so only the
# Python package is installed here, and Chromium is never re-installed.
python3 -c "import playwright" 2>/dev/null || pip install -q -r tests/requirements.txt
# Firefox is not in the image: fetch the build matching Playwright (~100 MB, ~15 s;
# skipped when present). Needs cdn.playwright.dev and playwright.azureedge.net in
# the environment's allowed domains; without them the session still starts and
# Firefox is checked in CI only.
if timeout 180 python3 -m playwright install firefox >/dev/null 2>&1; then
  echo "Firefox for browser tests: ready."
else
  echo "Firefox for browser tests: not available (network?), it is checked in CI only."
fi

# Fast sanity check: Node tests and the type check (a few seconds).
npm test --silent >/dev/null
npm run typecheck --silent
echo "Session ready: dependencies installed, Node tests and type check pass."
