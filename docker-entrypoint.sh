#!/bin/sh
set -e

mkdir -p "$HOME/.rh-agent/agent/skills"

# Seed default skills if the lola manifest is missing (first run or reset).
if [ -d /tmp/default-skills ] && [ ! -f "$HOME/.rh-agent/agent/skills/.lola-manifest.json" ]; then
  cp -r /tmp/default-skills/. "$HOME/.rh-agent/agent/skills/"
fi

# Persistent-container mode: keep the container alive between sessions.
# The wrapper uses "exec" to attach interactive sessions into this container.
if [ "$1" = "--keep-alive" ]; then
  shift
  exec tail -f /dev/null
fi

exec node /app/dist/index.js "$@"
