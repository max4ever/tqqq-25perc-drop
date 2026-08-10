# syntax=docker/dockerfile:1

###############################################################################
# 1. deps — resolve production dependencies, then strip them down.
#    Nothing from this stage survives except the pruned node_modules tree.
###############################################################################
FROM node:24-alpine AS deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY scripts ./scripts
RUN node scripts/prune-modules.mjs

# Fail the build here, not in production, if the prune went too far.
COPY src ./src
RUN node scripts/smoke-test.mjs

###############################################################################
# 2. runtime — node + our code. No npm, no toolchain, no dev deps.
###############################################################################
FROM node:24-alpine AS runtime

ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false

# npm/corepack are ~20 MB and are never used: the entrypoint calls node directly.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn*

WORKDIR /app

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src

USER node

# Runs one check and exits: 0 = checked, 1 = failed, 78 = bad configuration.
CMD ["node", "src/index.js"]
