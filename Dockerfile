FROM node:24-alpine

ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false

WORKDIR /app

# Dependencies first, so editing src/ does not reinstall them.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --chown=node:node src ./src

USER node

# Runs one check and exits: 0 = checked, 1 = failed, 78 = bad configuration.
CMD ["node", "src/index.js"]
