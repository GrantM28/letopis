FROM node:22.20.0-alpine3.22 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run typecheck && npm run build && npm prune --omit=dev

FROM node:22.20.0-alpine3.22
WORKDIR /app
ENV NODE_ENV=production \
    LETOPIS_PORT=2222 \
    LETOPIS_DATA=/data \
    TZ=Europe/Sofia
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY CREDITS.md README.md ./
# Unraid default: nobody:users (99:100)
RUN mkdir -p /data && chown 99:100 /data
USER 99:100
VOLUME /data
EXPOSE 2222
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s CMD wget -qO- http://127.0.0.1:2222/api/health > /dev/null || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/server.js"]
