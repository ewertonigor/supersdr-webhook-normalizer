# syntax=docker/dockerfile:1.7

# ---------- builder ----------
FROM node:20-alpine AS builder

WORKDIR /app

# Install deps with cache layer
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    npm install --no-audit --no-fund

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Prune dev dependencies
RUN npm prune --omit=dev

# ---------- runtime ----------
FROM node:20-alpine AS runtime

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

# Non-root user for safety
RUN addgroup -S app && adduser -S app -G app

COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/package.json ./package.json
# Drizzle migrations are .sql + meta/*.json — not picked up by tsc, copy raw.
COPY --from=builder --chown=app:app /app/src/db/migrations ./dist/db/migrations

USER app

EXPOSE 3000

# Healthcheck — uses node built-in fetch (Node 20+)
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>{if(r.status!==200)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
