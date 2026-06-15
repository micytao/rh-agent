#!/bin/sh
set -e

mkdir -p "$HOME/.rh-agent/agent/skills"

if [ -d /tmp/default-skills ] && [ -z "$(ls -A "$HOME/.rh-agent/agent/skills" 2>/dev/null)" ]; then
  cp -rn /tmp/default-skills/* "$HOME/.rh-agent/agent/skills/" 2>/dev/null || true
fi

exec node /app/dist/index.js "$@"
