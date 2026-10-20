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
RUN npm run build

# Dépendances de production seulement : c'est ce qui part dans l'image finale.
FROM build AS prod
RUN npm prune --omit=dev --no-audit --no-fund

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

COPY --from=prod --chown=root:root /app/package.json ./
COPY --from=prod /app/node_modules ./node_modules
# npm place certaines dépendances (pino, better-sqlite3, socket.io…) dans le dossier propre à chaque
# paquet, pas à la racine : il faut les copier aussi, sinon le serveur ne démarre pas.
COPY --from=prod /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=prod /app/packages/games/node_modules ./packages/games/node_modules
COPY --from=prod /app/packages/server/node_modules ./packages/server/node_modules
COPY --from=prod /app/packages/shared/package.json ./packages/shared/
COPY --from=prod /app/packages/shared/dist ./packages/shared/dist
COPY --from=prod /app/packages/games/package.json ./packages/games/
COPY --from=prod /app/packages/games/dist ./packages/games/dist
COPY --from=prod /app/packages/server/package.json ./packages/server/
COPY --from=prod /app/packages/server/dist ./packages/server/dist
COPY --from=prod /app/packages/web/dist ./packages/web/dist
# La licence MIT demande que son texte accompagne toute copie du logiciel.
COPY LICENSE ./
# Modèles de jeu pour la création de jeux de code (commande phgame, voir docs/JEU-DE-CODE.md).
# esbuild reste installé en production : il construit les paquets de jeux de code.
COPY --from=prod /app/packages/server/templates ./packages/server/templates

# Métadonnées OCI : relient l'image au dépôt, à la version et au commit source.
ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="PartyHub" \
      org.opencontainers.image.description="Plateforme de jeux de soirée sur navigateur" \
      org.opencontainers.image.source="https://github.com/matosman40/Partyhub" \
      org.opencontainers.image.url="https://github.com/matosman40/Partyhub" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"

# Dossiers persistants, appartenant à l'utilisateur « node » : /data (base SQLite, réglages, sauvegardes) et
# /contenu (jeux installés et personnages, souvent volumineux, voir JEUX_DIR et PERSONNAGES_DIR).
RUN mkdir -p /data /contenu && chown node:node /data /contenu

USER node
EXPOSE 8282
VOLUME ["/data", "/contenu"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8282) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# SIGTERM est géré par le serveur : arrêt propre des sockets et de la base.
STOPSIGNAL SIGTERM
CMD ["node", "packages/server/dist/index.js"]
