# syntax=docker/dockerfile:1
ARG NODE_VERSION=24-alpine

# ---- base -------------------------------------------------------------------
FROM node:${NODE_VERSION} AS base
# openssl: required by Prisma's schema engine (migrations) on Alpine.
RUN apk add --no-cache openssl libc6-compat
WORKDIR /app
ENV HUSKY=0 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

# ---- deps: all node_modules, cached by lockfile ------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

# ---- dev: hot reload (docker-compose.yml bind-mounts the source) ------------
FROM base AS dev
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 4000 9229
# generate client -> apply migrations -> seed demo user -> nest --watch
CMD ["npm", "run", "docker:dev"]

# ---- build: compile TypeScript, then drop dev dependencies -------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate \
 && npm run build \
 && npm prune --omit=dev \
 # Download the schema engine now so `prisma migrate deploy` works offline at runtime.
 && npx prisma version

# ---- runner: minimal production image ---------------------------------------
FROM base AS runner
ENV NODE_ENV=production \
    PORT=4000
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/prisma.config.ts ./
COPY --chmod=755 scripts/docker-entrypoint.sh /app/docker-entrypoint.sh
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health/live" || exit 1
# Sizes libuv's thread pool (password hashing) to the container's CPU quota.
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
