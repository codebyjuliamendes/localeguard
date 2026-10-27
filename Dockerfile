# syntax=docker/dockerfile:1.7
# Override to use a registry mirror or a pinned digest.
ARG NODE_IMAGE=node:22-bookworm-slim

# ---- build: compile TypeScript and bundle the client ----
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json ./
COPY scripts ./scripts
COPY src ./src
COPY public ./public
RUN npm run build

# ---- deps: production dependencies only (better-sqlite3 ships prebuilt binaries) ----
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# ---- runtime ----
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3007 \
    DATABASE_PATH=/data/localeguard.sqlite
WORKDIR /app
RUN mkdir -p /data && chown node:node /data
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node public ./public
USER node
VOLUME ["/data"]
EXPOSE 3007
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3007)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
# exec form: node is PID 1 and receives SIGTERM for graceful shutdown.
CMD ["node", "dist/server.js"]
