FROM node:24.21.0-bookworm-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

RUN npm install --global pnpm@10.33.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/evaluation/package.json packages/evaluation/package.json
COPY packages/provider-jev/package.json packages/provider-jev/package.json
COPY packages/provider-mock/package.json packages/provider-mock/package.json
COPY packages/provider-replay/package.json packages/provider-replay/package.json
COPY packages/storage/package.json packages/storage/package.json
COPY examples/standalone/package.json examples/standalone/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

ENV NODE_ENV=development \
    PATHSMITH_DATA_DIR=/app/.pathsmith \
    PATHSMITH_HOST=127.0.0.1 \
    PATHSMITH_PORT=4310 \
    PATHSMITH_WEB_HOST=0.0.0.0

EXPOSE 5173
CMD ["node", "scripts/dev.mjs"]
