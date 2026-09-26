#!/bin/bash
# Installs npm dependencies so agents in Claude Code on the web sessions can
# run `npm run check` (lint, typecheck/build, tests) right away.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"
npm install --no-audit --no-fund
