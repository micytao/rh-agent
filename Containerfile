# ── Stage 1: build ────────────────────────────────────────────────────
FROM node:22-alpine AS build

RUN apk add --no-cache git

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ src/
RUN npx tsc && chmod +x dist/index.js

# Pre-install rh-basic skills from the agentic-collections repo
RUN git clone --depth 1 --filter=blob:none --sparse \
      https://github.com/RHEcosystemAppEng/agentic-collections.git /tmp/collections \
    && cd /tmp/collections \
    && git sparse-checkout set rh-basic \
    && mkdir -p /tmp/skills \
    && for skill in /tmp/collections/rh-basic/skills/*/; do \
         name="$(basename "$skill")"; \
         [ -f "$skill/SKILL.md" ] && cp -r "$skill" "/tmp/skills/rh-basic--${name}"; \
       done \
    && rm -rf /tmp/collections

# Build the lola manifest for the pre-installed skills
RUN node -e " \
  const fs = require('fs'); \
  const path = require('path'); \
  const dir = '/tmp/skills'; \
  const skills = fs.readdirSync(dir).filter(n => \
    fs.statSync(path.join(dir, n)).isDirectory() && \
    fs.existsSync(path.join(dir, n, 'SKILL.md')) \
  ); \
  const manifest = { 'rh-basic': skills }; \
  fs.writeFileSync(path.join(dir, '.lola-manifest.json'), JSON.stringify(manifest, null, 2) + '\n'); \
"

# ── Stage 2: runtime ─────────────────────────────────────────────────
FROM node:22-alpine

RUN apk add --no-cache git curl

WORKDIR /app

COPY --from=build /app/dist/ dist/
COPY --from=build /app/node_modules/ node_modules/
COPY --from=build /app/package.json package.json

# Stage default skills in /tmp so they survive volume mounts over ~/.rh-agent
COPY --from=build /tmp/skills/ /tmp/default-skills/

COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Ensure /home/node is writable by any UID (rootless podman UID mapping)
RUN chmod 775 /home/node && chgrp 0 /home/node

ENV NODE_ENV=production
ENV HOME=/home/node

ENTRYPOINT ["docker-entrypoint.sh"]
