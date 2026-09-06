# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=24-bookworm-slim

FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS deps
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
# Keep precompiled browser packages in the dependency layer. Their Office, Markdown, UI, and AI
# dependency graphs change far less often than the Nuxt app, so normal edits reuse this layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY patches ./patches
COPY packages ./packages
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS build
COPY i18n ./i18n
COPY components.json nuxt.config.ts tailwind.config.ts tsconfig.json ./
COPY public ./public
COPY scripts ./scripts
COPY shared ./shared
COPY server ./server
COPY app ./app
# Keep disposable Vite/Nuxt transform caches between builds without reusing .nuxt or .output.
# Nuxt's experimental buildCache remains disabled because it can restore a Vue bundle without
# wiring its renderer virtual modules in Nuxt 4.5.1 (nuxt/nuxt#35894).
RUN --mount=type=cache,id=codex-gateway-nuxt-vite-cache,target=/app/node_modules/.cache,sharing=locked \
    pnpm exec nuxt build

FROM node:${NODE_VERSION} AS runner
ARG BUILD_SHA=unknown
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV CODEX_GATEWAY_BUILD_SHA=${BUILD_SHA}
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/.output ./.output
COPY --from=build /app/scripts ./scripts
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
# The 1 GiB container also hosts SSH/TLS/native buffers. Keep V8 old-space bounded to leave room
# for those allocations, and expose GC only for Nitro's five-minute housekeeping service.
CMD ["node", "--expose-gc", "--max-old-space-size=512", ".output/server/index.mjs"]
