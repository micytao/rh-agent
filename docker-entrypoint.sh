#!/bin/sh
set -e

mkdir -p "$HOME/.rh-agent/agent/skills"

# Seed default skills on first run. Use find instead of glob to include dotfiles
# like .lola-manifest.json which the banner needs to count skills.
if [ -d /tmp/default-skills ] && [ -z "$(ls -A "$HOME/.rh-agent/agent/skills" 2>/dev/null)" ]; then
  cp -a /tmp/default-skills/. "$HOME/.rh-agent/agent/skills/"
fi

exec node /app/dist/index.js "$@"
