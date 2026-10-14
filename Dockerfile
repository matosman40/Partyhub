# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Étape 1 : installation et compilation (outils natifs pour better-sqlite3)
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS build
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/games/package.json packages/games/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN npm ci --no-audit --no-fund

COPY packages ./packages
RUN npm run build \
 && npm prune --omit=dev --no-audit --no-fund

# ---------------------------------------------------------------------------
# Étape 2 : image finale minimale, utilisateur non privilégié
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=8282 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    LOG_LEVEL=info
WORKDIR /app

COPY --from=build --chown=root:root /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/games/package.json ./packages/games/
COPY --from=build /app/packages/games/dist ./packages/games/dist
COPY --from=build /app/packages/server/package.json ./packages/server/
COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/packages/web/dist ./packages/web/dist

# Dossier persistant (SQLite) appartenant à l'utilisateur « node ».
RUN mkdir -p /data && chown node:node /data

USER node
EXPOSE 8282
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8282) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# SIGTERM est géré par le serveur : arrêt propre des sockets et de la base.
STOPSIGNAL SIGTERM
CMD ["node", "packages/server/dist/index.js"]
