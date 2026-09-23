FROM node:22-alpine AS build
WORKDIR /app
# better-sqlite3 compiles a native addon via node-gyp at install time.
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build
# Drop devDependencies from node_modules now, while the build stage still
# has the toolchain, so the final stage never needs one — it just copies
# the already-compiled native addon.
RUN npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# The official node image runs as root by default; drop to the built-in
# unprivileged "node" user before serving traffic.
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1
CMD ["node", "dist/index.js"]
