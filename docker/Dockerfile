# syntax=docker/dockerfile:1
# La version doit correspondre exactement à `playwright` dans package.json.
ARG PLAYWRIGHT_VERSION=1.64.0

FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble AS base
ENV NODE_ENV=production \
    CESI_STATE_PATH=/data/state.json \
    CESI_DOWNLOAD_DIR=/data/downloads
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY src ./src
COPY scripts ./scripts
# Un volume nommé vide hérite du propriétaire de /data à son premier montage.
RUN mkdir -p /data && chown pwuser:pwuser /data && chmod 700 /data

FROM base AS login
RUN apt-get update \
    && apt-get install -y --no-install-recommends xvfb x11vnc novnc websockify \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix
COPY --chmod=755 docker/login-entrypoint.sh /usr/local/bin/login-entrypoint.sh
USER pwuser
EXPOSE 6080
ENTRYPOINT ["/usr/local/bin/login-entrypoint.sh"]

# Cible par défaut (dernière étape) : le serveur MCP headless.
FROM base AS mcp
USER pwuser
ENTRYPOINT ["node", "src/server.js"]
