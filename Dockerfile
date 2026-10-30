FROM node:26-slim AS build
WORKDIR /app
# better-sqlite3 compiles from source on install
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ curl ca-certificates && rm -rf /var/lib/apt/lists/*
ARG TARGETARCH
ARG SPEEDTEST_GO_VERSION=1.8.3
RUN case "$TARGETARCH" in amd64) ARCH=x86_64 ;; arm64) ARCH=arm64 ;; *) echo "Unsupported architecture: $TARGETARCH" >&2; exit 1 ;; esac \
 && FILE="speedtest-go_${SPEEDTEST_GO_VERSION}_Linux_${ARCH}.tar.gz" \
 && BASE="https://github.com/showwin/speedtest-go/releases/download/v${SPEEDTEST_GO_VERSION}" \
 && curl -fsSLO "$BASE/$FILE" \
 && curl -fsSL "$BASE/checksums.txt" | grep " $FILE\$" | sha256sum -c - \
 && tar xzf "$FILE" -C /usr/local/bin speedtest-go \
 && rm "$FILE"
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
# speedtest-go is a Go binary and reads the system CA store, which node:slim omits
COPY --from=build /etc/ssl/certs /etc/ssl/certs
COPY --from=build /usr/local/bin/speedtest-go /usr/local/bin/speedtest-go
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
