#!/bin/sh
# AgentAlarm hook for Cursor: reads the event JSON on stdin, always exits 0 and prints what Cursor expects.
# A global install (npm i -g agentalarm) starts fastest; otherwise npx runs the published CLI.
if command -v agentalarm >/dev/null 2>&1; then
  exec agentalarm hook cursor
fi
exec npx -y agentalarm hook cursor
