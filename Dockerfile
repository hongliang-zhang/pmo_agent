# ── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:22-slim AS builder
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src/ ./src/
RUN pnpm run build && pnpm prune --prod

# ── Stage 2: Production ──────────────────────────────────────────────────────
FROM node:22-slim
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules/
COPY --from=builder /app/dist ./dist/
COPY --from=builder /app/package.json ./

RUN mkdir -p /persistent/reports && chmod -R 777 /persistent

ENV NODE_ENV=production
ENV PMO_REPORTS_DIR=/persistent/reports
ENV PORT=3201
EXPOSE 3201

CMD ["node", "dist/src/cli/production.js"]
