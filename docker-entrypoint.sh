#!/bin/sh
set -e
exec node /app/dist/index.js "$@"
