# e-Service กลาง เทศบาลในฝัน — Node 20 + Express + better-sqlite3 + EJS

# ---- deps: compile native modules (better-sqlite3 has no prebuilt binary for every Node 20 patch)
FROM node:20-bookworm-slim AS deps
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY app/package.json app/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
 && node -e "new (require('better-sqlite3'))(':memory:').prepare('select 1').get()"

# ---- runtime
FROM node:20-bookworm-slim
ENV NODE_ENV=production \
    TZ=Asia/Bangkok \
    PORT=3000 \
    DB_PATH=/data/egov.db

# Thai TrueType fonts (Garuda, Loma, Laksaman, …) for server-side PDF text: /usr/share/fonts/truetype/tlwg/
RUN apt-get update \
 && apt-get install -y --no-install-recommends fonts-thai-tlwg-ttf \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY app/ ./
RUN mkdir -p /data

EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
