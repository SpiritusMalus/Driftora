# Reproducible build for the food-parse service.
#
# Until this file existed the deploy was: build on the production VPS, back up
# `dist/`, `rsync --delete`, chown, restart the unit. That works right up until
# it doesn't — a broken build is discovered ON the production host, and the
# service has twice been killed by a `pkill -f dist/server.js` that matched the
# live systemd process as well as a test one. An image is buildable anywhere,
# identical everywhere, and starts and stops by name.
#
# Two stages so the shipped image carries no compiler and no dev dependencies:
# three runtime packages (express, express-rate-limit, multer) and the compiled
# JS, nothing else.

FROM node:20-alpine AS build
WORKDIR /app

# Dependencies first: this layer is cached until the lockfile itself changes.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# `npm ci --omit=dev` from the same lockfile — the runtime tree is derived from
# the same pinned versions the build used, not resolved afresh.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Never root. The node image ships an unprivileged `node` user (uid 1000).
USER node

EXPOSE 8787

# /health is deliberately public and never rate-limited (the external uptime
# monitor depends on that), which also makes it the right liveness probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
