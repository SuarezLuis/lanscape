# LANscape

Home network monitoring for Umbrel: speed test history, device discovery and a network overview.

Installed through the [SZ Umbrel app store](https://github.com/SuarezLuis/umbrel-apps).

## Stack

Node 26, Fastify + tRPC, Prisma + SQLite, React + Vite + Mantine. npm workspaces: `server/` and `web/`.

## Develop

```sh
npm install
npm run dev        # server on :4545, web on :5173 (forwards /trpc to the server)
npm run typecheck
npm test
```

Speed tests need the [`speedtest-go`](https://github.com/showwin/speedtest-go/releases) binary on your `PATH`, or `SPEEDTEST_BIN` pointing at it. The Docker image includes it.

Schema changes: edit `server/prisma/schema.prisma`, then `npm exec -w server -- prisma migrate dev --name <change>`. The container applies migrations on start.

## Release

Every push to `master` publishes `ghcr.io/suarezluis/lanscape:edge`. Tag `vX.Y.Z` to publish `X.Y.Z`, then bump the image and `version` in the app store repo.
