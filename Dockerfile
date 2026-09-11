# syntax=docker/dockerfile:1

FROM node:24-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
# Compose runs this stage as `node` for the tools service, so everything it
# writes has to belong to node rather than root: the pnpm home, the tree (vite
# drops temp files in node_modules), and /data — an empty named volume takes its
# ownership from whichever image mounts it first, and a root-owned /data leaves
# the app, which is not root either, unable to write the database.
RUN mkdir -p /pnpm /app /data && chown node:node /pnpm /app /data
USER node
WORKDIR /app
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY --chown=node:node . .
RUN pnpm build

# Same tree, dev dependencies stripped. Kept separate so the `build` stage stays
# usable as the tools image (drizzle-kit and the seed script are dev deps).
FROM build AS prod-deps
RUN pnpm prune --prod

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3000
# The SQLite file lives here; compose mounts a volume over it. A fresh named
# volume inherits this directory's ownership, so `node` can write to it.
RUN mkdir -p /data && chown node:node /data
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/package.json ./
USER node
EXPOSE 3000
CMD ["node", "build"]
