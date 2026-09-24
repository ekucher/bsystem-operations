FROM node:22 AS build
WORKDIR /app
# Glibc build stage (not alpine): npm has a known optional-dependency
# resolution bug (npm/cli#4828) that can skip installing the correct
# musl-libc native binary (e.g. @rolldown/binding-linux-x64-musl, used by
# vite's bundled rolldown) even though it's present in the lockfile,
# depending on the platform `npm ci` last ran on. Building on glibc
# sidesteps that bug entirely; it only affects this throwaway build
# stage — the shipped image below is still the small alpine-based
# unprivileged nginx runtime, so this doesn't change production attack
# surface. (This also drops the need for python3/make/g++ here: the
# api workspace's better-sqlite3 addon is unused in this image, but glibc
# node images ship the toolchain needed for npm ci to succeed without
# installing extra packages.)
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
