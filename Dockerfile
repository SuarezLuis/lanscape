FROM node:26-slim AS build
WORKDIR /app
# better-sqlite3 compiles from source on install
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY server/package.json server/prisma.config.ts server/
COPY server/prisma server/prisma
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:26-slim
ARG APP_VERSION=dev
ENV NODE_ENV=production \
    APP_VERSION=$APP_VERSION \
    DATABASE_URL=file:/data/lanscape.db \
    PORT=4545
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/server/package.json /app/server/prisma.config.ts server/
COPY --from=build /app/server/prisma server/prisma
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
WORKDIR /app/server
VOLUME /data
EXPOSE 4545
CMD ["sh", "-c", "/app/node_modules/.bin/prisma migrate deploy && exec node dist/index.js"]
