# =============================================================================
# PROJECT ANTIGRAVITY — Runtime Image
# =============================================================================
# Single-stage image. The image contains only what the backend needs at runtime:
# production node_modules, the Playwright Chromium build, the backend source,
# and the static frontend. Everything host-specific (env files, host
# node_modules, .git, data/) is excluded via .dockerignore.
# =============================================================================

FROM node:18-bookworm

ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

WORKDIR /app/backend

# 1. Install production dependencies from the lockfile-free manifest.
#    `npm install --omit=dev` gives us a reproducible prod install even
#    without a committed package-lock.json.
COPY backend/package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

# 2. Install the Playwright Chromium browser plus its Linux system
#    dependencies (fonts, libgbm, libnss3, etc.).
RUN npx playwright install --with-deps chromium

# 3. Copy application source. .dockerignore scopes this to real source only.
COPY backend/ ./
COPY frontend/ /app/frontend/

# 4. Runtime metadata.
EXPOSE 3000

# 5. Run the server directly — no npm wrapper, so signals reach node cleanly.
CMD ["node", "server.js"]
