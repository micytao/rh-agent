#!/bin/sh
set -e

mkdir -p "$HOME/.rh-agent/agent/skills"

# Seed default skills if the lola manifest is missing (first run or reset).
# Uses cp -a to include dotfiles like .lola-manifest.json.
if [ -d /tmp/default-skills ] && [ ! -f "$HOME/.rh-agent/agent/skills/.lola-manifest.json" ]; then
  cp -r /tmp/default-skills/. "$HOME/.rh-agent/agent/skills/"
fi

exec node /app/dist/index.js "$@"
