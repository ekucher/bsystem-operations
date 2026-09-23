FROM node:22-alpine AS build
WORKDIR /app
# better-sqlite3 compiles a native addon via node-gyp at install time —
# alpine's musl libc means the package's bundled prebuilds (built for
# glibc) don't apply here, so a real toolchain is required.
RUN apk add --no-cache python3 make g++
# npm workspaces monorepo: a single root package-lock.json describes the
# whole tree, so `npm ci` needs every workspace's package.json present
# (even though this image only builds/ships the api workspace) — build
# context is the repo root (see docker-compose.yml), not api/.
COPY package.json package-lock.json ./
COPY api/package.json ./api/package.json
COPY ui/package.json ./ui/package.json
RUN npm ci --no-audit --no-fund
COPY api ./api
RUN npm run build --workspace=api
# Drops devDependencies from node_modules now, while the build stage
# still has the toolchain, so the final stage never needs one — it just
# copies the already-compiled native addon. This also leaves the ui
# workspace's production dependencies in node_modules (hoisted by npm
# workspaces, ci has no per-workspace install mode) — unused but
# harmless; not worth a more complex split for an internal tool.
RUN npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/api/package.json ./api/package.json
COPY --from=build /app/api/dist ./api/dist
# DB_PATH (default docker-compose.yml value: /data/operations.sqlite3)
# lives on a named volume, which Docker creates root-owned unless the
# image's own copy of that path already has different ownership — an
# empty root-owned directory is not writable by the unprivileged "node"
# user below, so better-sqlite3 fails with SQLITE_CANTOPEN at startup.
RUN mkdir -p /data && chown node:node /data
# The official node image runs as root by default; drop to the built-in
# unprivileged "node" user before serving traffic.
USER node
WORKDIR /app/api
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1
CMD ["node", "dist/index.js"]
