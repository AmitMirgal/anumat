FROM node:24-slim

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@12.15.0 --activate

WORKDIR /app

RUN chown node:node /app

USER node

COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json ./
COPY --chown=node:node apps/api/package.json apps/api/package.json
COPY --chown=node:node packages/core/package.json packages/core/package.json
COPY --chown=node:node packages/contract/package.json packages/contract/package.json
COPY --chown=node:node packages/db/package.json packages/db/package.json
COPY --chown=node:node packages/db/prisma packages/db/prisma
COPY --chown=node:node packages/db/prisma.config.ts packages/db/prisma.config.ts
COPY --chown=node:node packages/engine/package.json packages/engine/package.json
COPY --chown=node:node packages/markets/package.json packages/markets/package.json
COPY --chown=node:node packages/sdk-js/package.json packages/sdk-js/package.json
COPY --chown=node:node packages/tsconfig packages/tsconfig

RUN pnpm install --frozen-lockfile

COPY --chown=node:node apps/api apps/api
COPY --chown=node:node packages/core packages/core
COPY --chown=node:node packages/contract packages/contract
COPY --chown=node:node packages/db packages/db
COPY --chown=node:node packages/engine packages/engine
COPY --chown=node:node packages/markets packages/markets

RUN pnpm exec turbo run build --filter=@anumat/api

USER root
RUN mkdir -p /data/policies && chown node:node /data/policies
USER node

EXPOSE 4471

CMD ["pnpm", "--filter", "@anumat/api", "start"]
