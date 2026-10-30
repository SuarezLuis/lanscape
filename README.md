# LANscape

![LANscape: speed and latency history](https://raw.githubusercontent.com/SuarezLuis/lanscape/master/docs/assets/gallery/1.jpg)

Home network monitoring for [Umbrel](https://umbrel.com): internet speed and latency over time, every device on your network, and alerts when something changes.

Install it from an Umbrel app store: it's in the [SZ community app store](https://github.com/SuarezLuis/umbrel-apps) (add `https://github.com/SuarezLuis/umbrel-apps` under App Store → Community App Stores). User guide: [docs/HELP.md](docs/HELP.md), also on the app's Help page.

## Features

- **Speed tests** on demand or on a schedule, with a live gauge, ping, jitter, and router and internet latency measured just before each test. History charts and a sortable table, from the last 24 hours to all time.
- **Ping checks** every minute to your router and an internet host (1.1.1.1 by default), tracking latency and packet loss with almost no data. Raw samples older than 90 days are kept as hourly averages.
- **Device list** from ARP scans every 5 minutes: IP, MAC, maker (from the IEEE OUI registry), names announced over mDNS, and your own names. Includes the Umbrel itself.
- **Identify a device** by switching it off and on between scans.
- **Per-device history and offline alerts:** mark devices as known, see when each came and went, and get alerted when a chosen device has been offline for a while.
- **Notification rules** on any measurement, against a fixed value or a percentage from the 7-day median, with a "how long" window. Each rule alerts once when a problem starts and once when it clears. Also alerts when a new device joins.
- **Alert channels:** ntfy, Telegram (the bot answers messages with your chat ID), Discord, Slack and a generic JSON webhook.
- **Automations page** to schedule speed tests, ping checks and device scans, showing each job's last run and errors.
- **Choose the speed test server**, or let it pick the nearest.
- **CSV export** of speed tests, ping checks and devices.
- **Password protection:** on Umbrel it starts with the password Umbrel shows for the app; change it or sign out everywhere in Settings.
- Light, dark and system themes; works on phones.

## Screenshots

| | |
|---|---|
| ![Every device on your network](https://raw.githubusercontent.com/SuarezLuis/lanscape/master/docs/assets/gallery/2.jpg) | ![Alerts and rules](https://raw.githubusercontent.com/SuarezLuis/lanscape/master/docs/assets/gallery/3.jpg) |
| ![Alerts on your phone](https://raw.githubusercontent.com/SuarezLuis/lanscape/master/docs/assets/gallery/4.jpg) | ![Automations](https://raw.githubusercontent.com/SuarezLuis/lanscape/master/docs/assets/gallery/5.jpg) |

Made from invented demo data with `scripts/demo/` (seed, capture, gallery).

## Stack

Node 26, npm workspaces (`server/`, `web/`), Fastify + tRPC v11, Prisma 7 + SQLite, React 19 + Vite + Mantine.

Background jobs live in `server/src/jobs/`. They shell out to `speedtest-go`, `ping` and `arp-scan`, all included in the Docker image.

## Develop

```sh
npm install
npm run dev        # server on :4545, web on :5173 (forwards /trpc to the server)
npm run typecheck
npm test
npm run build
```

Locally you need `speedtest-go` on your `PATH` (or `SPEEDTEST_BIN` pointing at it) for speed tests, and `arp-scan` for device scans, which needs root. Ping checks use the system `ping`. On macOS, router detection and ARP scans need Linux, so test those on the Umbrel (see [CLAUDE.md](CLAUDE.md)).

Schema changes: edit `server/prisma/schema.prisma`, then `npm exec -w server -- prisma migrate dev --name <change>`. The container applies migrations on start.

## Run

The image needs host networking, for ARP scans and mDNS, and a volume at `/data`:

```sh
docker run -d --init --network host -v lanscape-data:/data ghcr.io/suarezluis/lanscape:edge
```

`--init` (or `init: true` in Compose) matters: Node runs as PID 1, and without an init process, stopped speed tests leave zombie processes behind. It serves on port 4545; set `PORT` to change it.

## Release

Every push to `master` publishes `ghcr.io/suarezluis/lanscape:edge`. Tag `vX.Y.Z` to publish `X.Y.Z`, then bump the image and `version` in the app store repo.

## License

Icons from [lucide-animated](https://lucide-animated.com) (MIT).
