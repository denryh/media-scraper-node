# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /repo

# ---- deps: install only what `app` needs (workspace-aware) ----
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/app/package.json packages/app/package.json
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter app...

# ---- build: compile TS ----
FROM deps AS build
COPY packages/app packages/app
RUN pnpm --filter app build

# ---- runtime: minimal image with just dist + production deps ----
FROM base AS runtime
ENV NODE_ENV=production
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/app/package.json packages/app/package.json
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter app... --prod
COPY --from=build /repo/packages/app/dist packages/app/dist
COPY db/migrations /repo/db/migrations
WORKDIR /repo/packages/app
EXPOSE 3000
CMD ["node", "dist/server.js"]
