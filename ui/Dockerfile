FROM node:22-alpine AS build
WORKDIR /app
# npm workspaces monorepo: a single root package-lock.json describes the
# whole tree, so `npm ci` always installs every workspace's dependencies
# (npm has no per-workspace ci mode) — including the api workspace's
# better-sqlite3, which compiles a native addon via node-gyp. That addon
# is unused in this image (nginx serves only the built static assets),
# but the toolchain is still required for npm ci to succeed here.
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
COPY api/package.json ./api/package.json
COPY ui/package.json ./ui/package.json
RUN npm ci --no-audit --no-fund
COPY ui ./ui
RUN npm run build --workspace=ui

# Unprivileged nginx image: runs as uid 101 with no elevated capabilities,
# matching bsystem-hub's container security baseline.
FROM nginxinc/nginx-unprivileged:1.30-alpine
USER root
RUN apk upgrade --no-cache
USER 101
COPY ui/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/ui/dist /usr/share/nginx/html
USER 101
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
