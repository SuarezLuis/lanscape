# Install, generate and bundle on the runner's own arch: prisma generate breaks under QEMU,
# and what this stage produces (bundled JS and web assets) is the same on every platform
FROM --platform=$BUILDPLATFORM node:26-slim AS build
WORKDIR /app
# better-sqlite3 compiles from source on install
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY server/package.json server/prisma.config.ts server/
COPY server/prisma server/prisma
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build

# Production deps for the target arch. --ignore-scripts skips the server's prisma generate;
# only the native modules need building here
FROM node:26-slim AS deps
WORKDIR /app
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
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev --ignore-scripts && npm rebuild better-sqlite3 @prisma/engines

FROM node:26-slim
ARG APP_VERSION=dev
ENV NODE_ENV=production \
    APP_VERSION=$APP_VERSION \
    DATABASE_URL=file:/data/lanscape.db \
    PORT=4545
WORKDIR /app
# speedtest-go is a Go binary and reads the system CA store, which node:slim omits
COPY --from=deps /etc/ssl/certs /etc/ssl/certs
COPY --from=deps /usr/local/bin/speedtest-go /usr/local/bin/speedtest-go
COPY --from=deps /app/package.json ./
COPY --from=deps /app/node_modules node_modules
COPY --from=build /app/server/package.json /app/server/prisma.config.ts server/
COPY --from=build /app/server/prisma server/prisma
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
WORKDIR /app/server
VOLUME /data
EXPOSE 4545
CMD ["sh", "-c", "/app/node_modules/.bin/prisma migrate deploy && exec node dist/index.js"]
