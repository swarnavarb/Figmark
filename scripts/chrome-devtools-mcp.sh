#!/usr/bin/env bash
# Launches the Chrome DevTools MCP server (https://github.com/ChromeDevTools/chrome-devtools-mcp).
# In cloud sessions it uses the pre-installed headless Chromium; locally it uses your installed Chrome.
set -euo pipefail

args=(--isolated --usageStatistics=false --performanceCrux=false)
if [ -x /opt/pw-browsers/chromium ]; then
  args+=(--headless --executablePath /opt/pw-browsers/chromium --chromeArg=--no-sandbox)
fi

exec npx -y chrome-devtools-mcp@1.12.0 "${args[@]}" "$@"
