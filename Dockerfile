# syntax=docker/dockerfile:1.7
# One image build, three runnable targets: migrate, worker, web.

FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.20.0 --activate
WORKDIR /repo
ENV CI=true

# ---- install deps for the whole workspace ----
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/providers/package.json packages/providers/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/trading/package.json packages/trading/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

# ---- source ----
FROM deps AS source
COPY tsconfig.base.json turbo.json ./
COPY apps ./apps
COPY packages ./packages

# ---- migrate: applies Drizzle migrations then exits ----
FROM source AS migrate
WORKDIR /repo/packages/db
CMD ["pnpm", "migrate"]

# ---- worker ----
FROM source AS worker
ENV NODE_ENV=production
WORKDIR /repo/apps/worker
EXPOSE 4000
CMD ["pnpm", "start"]

# ---- web ----
FROM source AS web-build
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Build-time placeholder only; the route handler reads the real value at request time.
ENV WORKER_URL=http://worker:4000
ENV SESSION_SECRET=build-placeholder-not-used-at-runtime
WORKDIR /repo/apps/web
RUN pnpm build

FROM web-build AS web
EXPOSE 3000
CMD ["pnpm", "start"]
