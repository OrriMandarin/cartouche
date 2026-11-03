# syntax=docker/dockerfile:1
# Build context: the repository root (docker build -f apps/web/Dockerfile .).
#
# NEXT_PUBLIC_* values and API_INTERNAL_URL are baked into the bundle / rewrites at build time,
# so they are build arguments. API_INTERNAL_URL is also read at runtime for completeness.

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
# Reads the pnpm version from "packageManager" in the root package.json.
COPY package.json /tmp/package.json
RUN corepack enable \
    && cd /tmp && corepack install \
    && rm /tmp/package.json
WORKDIR /repo

FROM base AS deps
# Manifests only, so the install layer is cached until a dependency changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/api-client/package.json packages/api-client/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter web...

FROM deps AS build
ARG CARTOUCHE_BUILD_PROFILE=production
ARG NEXT_PUBLIC_AUTH_PROVIDER=clerk
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=""
ARG NEXT_PUBLIC_SENTRY_DSN=""
ARG API_INTERNAL_URL=""
ENV NEXT_TELEMETRY_DISABLED=1 \
    CARTOUCHE_BUILD_PROFILE=$CARTOUCHE_BUILD_PROFILE \
    NEXT_PUBLIC_AUTH_PROVIDER=$NEXT_PUBLIC_AUTH_PROVIDER \
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY \
    NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN \
    API_INTERNAL_URL=$API_INTERNAL_URL
COPY apps/web apps/web
COPY packages/api-client packages/api-client
RUN mkdir -p apps/web/public && pnpm --filter web build

FROM node:24-bookworm-slim AS runtime
ARG API_INTERNAL_URL=""
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    API_INTERNAL_URL=$API_INTERNAL_URL
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# In a pnpm workspace the standalone output mirrors the repo layout: apps/web/server.js.
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
