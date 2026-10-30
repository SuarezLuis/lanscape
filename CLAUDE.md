# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# LANscape

Personal home-network monitoring app for Umbrel. Owner: SuarezLuis.

- App source: this repo (github.com/SuarezLuis/lanscape)
- Umbrel community app store (lists the app as "LANscape"): `~/Projects/umbrel-apps` (github.com/SuarezLuis/umbrel-apps). Store id `sz`, app folder `sz-lanscape/` (`umbrel-app.yml`, `docker-compose.yml`, `icon.svg`)

## Stack

Node 26 LTS, npm workspaces (`server/`, `web/`), Fastify + tRPC v11 with superjson, Prisma 7 + SQLite via `@prisma/adapter-better-sqlite3`, React 19 + Vite + Mantine + TanStack Query, Vitest, TypeScript 7.

- The whole API is `server/src/router.ts`. Procedures call Prisma or a job; the web reaches them through `useTRPC()` from `web/src/trpc.ts`.
- Background work (speed tests, later device scans) lives in `server/src/jobs/`, separate from the API.
- The server is bundled with esbuild. The web app imports only the `AppRouter` type from `@lanscape/server/router`.
- In production Fastify serves `web/dist` next to `/trpc`. In dev, Vite on :5173 proxies `/trpc` to the server on :4545.
- The Prisma client is generated into `server/src/generated/prisma` (gitignored) by the server's `postinstall`. Re-run `npm install` or `npm exec -w server -- prisma generate` after a schema change.
- Local DB defaults to `server/dev.db`. Tests run against `file::memory:` (`server/vitest.config.ts`), and router tests call procedures through `appRouter.createCaller({})`.
- Speed tests locally need `speedtest-go` on `PATH`, or `SPEEDTEST_BIN` pointing at it.
- Checks: `npm run typecheck`, `npm test`, `npm run build`. One test file: `npm test -w server -- src/jobs/speedtest.test.ts` (add `-t "<name>"` for one test). Dev: `npm run dev`.
- Schema change: edit `server/prisma/schema.prisma`, then `npm exec -w server -- prisma migrate dev --name <change>` against a throwaway `DATABASE_URL`.

## How it runs on Umbrel

One container on the host network (device discovery needs the real LAN), port 4545, SQLite at `/data/lanscape.db` (mounted from `${APP_DATA_DIR}/data`). Prisma migrations run on container start. No auth for now, by choice: host-network apps skip Umbrel's login, so anyone on the LAN can open it.

Umbrel can't build images. CI (`.github/workflows/ci.yml`) builds amd64 + arm64 and pushes `ghcr.io/suarezluis/lanscape`: `edge` on every `master` push, `X.Y.Z` on a `vX.Y.Z` tag.

## Release

1. Merge to `master`, tag `vX.Y.Z` on `master`, push the tag.
2. Wait for CI to publish `ghcr.io/suarezluis/lanscape:X.Y.Z` and check it pulls without login.
3. In umbrel-apps, set the image tag and `version` in `umbrel-app.yml` to the same `X.Y.Z`. Umbrel only offers an update when `version` goes up.
4. Umbrel re-pulls community stores on a timer, a few minutes.

## Testing on the Umbrel

`umbrel.local`, SSH as `umbrel` with key auth; host `docker` works without sudo. To check a branch end to end:

```sh
ssh umbrel@umbrel.local 'docker build -t lanscape-test "https://github.com/SuarezLuis/lanscape.git#<branch>"'
ssh umbrel@umbrel.local 'docker run -d --name lanscape-test --network host -e PORT=4547 lanscape-test'
# hit http://localhost:4547/trpc/... with curl over SSH, then:
ssh umbrel@umbrel.local 'docker rm -f lanscape-test && docker rmi lanscape-test'
```

Portainer on this box runs its own nested Docker daemon (`portainer_docker_1`), so containers made in Portainer don't show in host `docker ps`.

## Gotchas

- npm 11 blocks package install scripts. Approved ones are in the root `package.json` `allowScripts`, pinned per version, so bumping better-sqlite3, prisma, @prisma/engines or esbuild needs `npm install-scripts approve <pkg>` again.
- Prisma is pinned to 7.10.1 on purpose: npm's `latest` tag for prisma points at an 8.0 release candidate.
- speedtest-go (installed in the image with checksum verification) reports speeds in bytes/s (÷125000 = Mbps) and latency/jitter in nanoseconds. Its output includes the public IP and location: never store or commit those.
- The image copies `/etc/ssl/certs` from the build stage because the speedtest-go binary needs a CA store and `node:slim` has none.

## Working rules

- Always branch and open a PR. Never push to `master`. The owner merges unless they ask otherwise.
- PR descriptions: what changed and what was checked by hand. Skip what CI already shows.
- Leave one small test behind for any non-trivial logic.

## Roadmap

Scheduled speed tests with a history chart, device discovery (`arp-scan`, `bonjour-service` for mDNS names, `oui-data` for MAC vendors), per-device activity from the Pi-hole on the same Umbrel.
