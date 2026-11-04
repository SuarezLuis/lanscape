# Roadmap

What's planned, and what shipped in which release. Tick items off in the PR that ships them; once a version is released it moves under Shipped, and anything still open moves to the next version. Core network monitoring must keep working without AI or external services.

## Waiting
- [ ] **Official Umbrel App Store listing:** submitted as getumbrel/umbrel-apps#6285, waiting on review. Kept on the latest release while it's in review (1.14.0); after approval, new versions go in update PRs.

## v2.0.0 (next)
- [ ] **A much smaller image (~660 MB to ~130–160 MB), same code:** today about 210 MB is the Prisma CLI and engines, there only to run `migrate deploy` at startup; ~150 MB is node_modules the esbuild bundle doesn't need; and the base is Debian slim.
  - Replace `prisma migrate deploy` with a small runner that applies the migration SQL files and records them in `_prisma_migrations` like Prisma does (the test setup already does this), so existing databases upgrade unchanged.
  - Ship only the runtime pieces next to the bundle: better-sqlite3, the Prisma client runtime and the OUI data.
  - Move to `node:26-alpine`, checking better-sqlite3 on musl, arp-scan, traceroute and ping, on amd64 and arm64.
  - Major version because the container's startup and base change; data and settings carry over. A Go rewrite (~50–80 MB) was considered and not worth weeks of work and losing the shared tRPC types for the last ~80 MB.

## v2.1.0
- [ ] **Disk and memory alerts for the machine LANscape runs on:** space on the data disk and on external drives, RAM and swap, shown on the Umbrel's own device and checked against alert rules (a threshold or a percentage left). An alert when an external drive disappears, since apps writing to it then fill the internal disk instead. The data disk is readable from the container as it is; external drives need one extra read-only mount in the compose file, and the feature works without it.
- [ ] **Service checks that look at the response:** an HTTP check can require the body to contain some text, or a JSON field to equal or not equal a value, on top of the status code. Covers a VPN container's control API (Gluetun's forwarded port is not 0, its public IP is not the home IP) and any app whose health page says more than "it answered".

## v2.2.0
- [ ] **Scheduled internet pauses through Pi-hole:** recurring pauses per device or group of devices (kids' tablets off 21:00–07:00), reusing the Pi-hole group behind the 1–5 minute pause and the scheduler's time zone handling; devices go back as they were when the pause ends, also after a restart.
- [ ] **Wake-on-LAN:** a button in the device panel that sends a magic packet to the device's MAC.
- [ ] **Certificate expiry in service checks:** HTTPS checks warn a set number of days (14 by default) before the certificate expires.

## Shipped

### v1.14.0
- [x] **AI changes (assistant and MCP):** the assistant and MCP agents can name devices, mark them known or unknown, set per-device offline and back-online alerts, add service checks and turn alert rules on or off; nothing else, and nothing on the network itself. The assistant only proposes: the owner approves each change, shown in words, in the chat. MCP agents need a separate change token (the read token stays read-only). Every change is logged with who made it, kept for 90 days, and can be undone. New `list_alert_rules` MCP tool.
- [x] **Scan all ports of one device:** all 65,535 ports from the device panel, on demand only, in the background with progress and Stop (a Raspberry Pi took 4 minutes); no port alerts from it, and later common scans keep what it found on other ports. The common list now has ADS-B feeder ports (8504 tar1090, 8754 FR24 status, 30003 and 30005 dump1090), the FR24, tar1090 and PiAware pages are recognized by name, and a device with those ports is guessed to be a flight tracking receiver.

### v1.13.0
- [x] **Pause a device's internet (Pi-hole):** 1, 2 or 5 minutes from the device panel, through a Pi-hole group that blocks every lookup; the device goes back as it was afterwards, also after a restart. Identifies a device without unplugging anything.
- [x] **What a device probably is:** a best guess (camera, Roku, Android phone…) from open ports, its announced name, DHCP details, maker and, with Pi-hole, the domains it looks up, with the reasons shown; also in the MCP device history.

### v1.12.0
- [x] **New open port alerts:** after a scheduled or manual port scan, alert when a device has a port open that it didn't have before (like a camera suddenly answering on Telnet), and optionally when one closes. Nothing on the first scan of a device; an on/off switch with the other device alerts on the Notifications page; the alert names the port, what usually runs there and what answered.
- [x] **Run now on the Automations page:** a button on each job (speed test, ping check, device scan, port scan) that runs it straight away, records it as that job's last run with its result, and leaves the schedule as it is. Disabled while that job is already running.

### v1.11.0
- [x] **Port scans:** each device's open ports (about 90 common ones) on demand or on a schedule, with what answers on each next to what usually runs there; a Ports column in the device list; open ports in the MCP device history.
- [x] **Website:** lanscape.org, a one-page site on GitHub Pages from `docs/`.
- [x] New store gallery and README screenshots (Overview, outages, Model column, Assistant, services) from refreshed demo data; README and Help brought up to date.

### v1.10.1
- [x] A **Model** column in the device list: the announced model, or the OS from a device's DHCP vendor class (Android 14, Windows); status badges no longer get cut off.

### v1.10.0
- [x] **Device identity across private MACs, from mDNS:** stable Google Cast, AirPlay and HomeKit ids and the model from mDNS TXT records.
- [x] **Device identity from DHCP:** a passive listener for DHCP requests (hostname, vendor class, option-55 fingerprint), matched when exactly one missing device fits.
- [x] **Device identity from SSDP/UPnP:** the UUID, friendly name and model from UPnP device descriptions (TVs, consoles, routers).

### v1.9.0
- [x] **Overview home screen:** internet up or down, health score, latest speed, outages, services with trouble, new devices since your last visit, and the latest alerts; where sign-in lands.
- [x] **Weekly speed pattern:** download, upload and ping by weekday and hour, against your plan speeds; long-term trends are the History chart's Year view.
- [x] **More analytics tools:** `compare_periods` (this week vs last), `get_network_events` (every device's online/offline changes), and packet loss per bucket in latency history.
- [x] **Standalone Docker release (no Umbrel):** a Compose example and notes in the README, `APP_PASSWORD` wording without Umbrel in it, and `UMBREL=true` in the Umbrel stores' compose files.
- [x] **Streaming chat answers:** the assistant's answer appears as it's written, with each data lookup shown as it happens.
- [x] **Network diagnostics:** guided router, internet, DNS, HTTPS and traceroute checks with a plain-language verdict and a report to copy or download.
- [x] **Network performance reports:** an opt-in weekly summary through the alert channels, and a 30-day report to send an internet provider.

### v1.8.0
- [x] **Built-in AI chat:** the Assistant page, with Claude, OpenAI, or a model on your own network (Ollama or any OpenAI-compatible server); read-only tools, the data behind each answer shown, a clear statement of where data goes, write-only API keys, and conversations kept only in the browser tab.
- [x] **UI end-to-end tests:** Playwright on the built app with demo data and stand-ins for `speedtest-go` and `arp-scan`; runs on every PR.
- [x] **More database tests:** the device scan with a stubbed `arp-scan`, and a full restore with undo and an upgrade from an older backup.
- [x] Local speed tests on macOS work again (`script` was given a socket for input).

### v1.7.0
- [x] **Internet Health Score (0–100):** from uptime, packet loss, ping and jitter; the last 24 hours against the last 7 days, each part shown with its points; also in the MCP summary.
- [x] **Service health checks:** HTTP, TCP and DNS checks for LAN services, down and back alerts, 24-hour uptime, and the `get_services` MCP tool.
- [x] **Buy Me a Coffee in the app:** a link at the bottom of the sidebar.
- [x] **Outages for a year:** outages are saved before their ping checks are rolled up into hourly rows.
- [x] **Database-backed tests:** each test file gets a SQLite file with the real migrations; CI fails when the schema changes without a migration.

### v1.6.0
- [x] **Internet outage timeline:** when the internet was down, for how long, and whether the problem was past the router or in the home network; an alert when it's back, and the `get_outages` MCP tool.

### v1.5.2
- [x] Copy buttons on the AI agents tab work over plain http; the Claude Code command adds LANscape for every folder; example questions to ask.

### v1.5.1
- [x] A failed scheduled speed test tries once more a minute later, and a timeout says which step hung.

### v1.5.0
- [x] **MCP server for external AI agents:** read-only tools for OpenClaw, Claude and other MCP clients, off until a token is created, one replaceable token, rate limits and a request log.
- [x] **Network Intelligence API:** the MCP tools (`get_network_summary`, `get_latency_history`, `get_speed_history`, `list_devices`, `get_device_history`, `get_alert_history`), with validated ranges and factual output.

### v1.4.0
- [x] **Pi-hole integration:** device names, DNS activity per device, and recent DNS requests as a sign of life, on a new Integrations page.

### v1.3.0
- [x] **Per-device online alerts:** alert each time a chosen device comes online after a set time away (15 minutes to 4 hours).
- [x] **Delete a device:** remove it with its history, so it's listed and alerted as new the next time it joins.

### v1.2.0
- [x] **Backup and restore:** one file with everything, optionally encrypted, with a preview, a safety copy before restoring, and undo.
- [x] **Unknown/new device alerts:** new-device alerts start after the first scan; an optional alert when an unknown device comes back; devices keep their identity across private MAC addresses.
- [x] **Donation support:** Buy Me a Coffee in the README, the Help page, and GitHub's Sponsor button.
- [x] Sign-in accepts a pasted password with spaces or a newline around it.

### v1.1.1
- [x] The latency chart sizes its buckets by the history there, not the range picked, so a new install isn't one or two points.

### v1.1.0
- [x] Starts with Umbrel's per-install password (`APP_PASSWORD` + `deterministicPassword`): no first-run screen for someone else on the LAN to reach first.
- [x] Reset to Umbrel's password from Settings, or with the `RESET_PASSWORD` app setting.

### v1.0.1
- [x] README images use full raw URLs, so the About page shows them.
- [x] Store gallery (2160×1350) and light/dark screenshots made from invented demo data (`scripts/demo/`).
- [x] Notifications page leads with recent alerts; full device status badges; chart units in titles.

### v1.0.0
- [x] Speed tests on demand or on a schedule, with a live gauge, ping, jitter, and router/internet latency before each test; history charts and a sortable table.
- [x] Choice of speed test server, or nearest.
- [x] Ping checks every minute to the router and an internet host: latency and packet loss, with raw samples older than 90 days kept as hourly averages.
- [x] Device list from ARP scans every 5 minutes: IP, MAC, maker (IEEE OUI), mDNS names and custom names, including the Umbrel itself.
- [x] Identify a device by switching it off and on.
- [x] Per-device history, known devices, offline and new-device alerts.
- [x] Notification rules against a fixed value or a percentage of the 7-day median, with a duration window; one alert when a problem starts and one when it clears.
- [x] Alert channels: ntfy, Telegram (bot replies with your chat ID), Discord, Slack and webhook.
- [x] Automations page with per-job schedules in the saved time zone, last run and errors.
- [x] CSV export of speed tests, ping checks and devices.
- [x] Own login with sessions (host-network apps skip Umbrel's login); change password or sign out everywhere.
- [x] Light, dark and system themes; works on phones; in-app Help page from `docs/HELP.md`.
- [x] Multi-arch image (amd64 + arm64) on GHCR, published by CI; listed in the SZ community app store.

## Backburner
Wanted, but not scheduled.
- [ ] **Proactive AI analyst:** opt-in investigation and summaries of incidents LANscape already detects (outages, alert rules, services going down); local model option, consent before cloud transmission, no automatic network modifications.

## Decided not to pursue
Kept here so the reasons aren't lost. Revisit if the reason stops holding.
- **Automatic problem detection** (baseline/anomaly detection and correlations): rules already compare against the 7-day median and outages are detected; real anomaly detection risks noisy alerts for little gain.
- **Interactive network map:** a real topology needs router data; the owner's TP-Link has no API for it, and a grouped list is what the Network page already is.
- **Router integrations (UniFi, SNMP):** no matching hardware to build or test against, and consumer routers rarely support SNMP. Revisit if a user with one asks.
- **HTTPS:** Umbrel apps are served over plain http, and a self-signed certificate means browser warnings. A reverse proxy or Tailscale is the practical route.
- **Browser push notifications:** browsers only allow push over HTTPS, so this waits on HTTPS; ntfy already covers phone notifications.
- **Adoption/analytics:** no telemetry. For a rough count, "Total downloads" on the image's GHCR page (https://github.com/SuarezLuis/lanscape/pkgs/container/lanscape) counts installs plus updates; once the official listing is approved, ask Umbrel whether developers can see install counts.
- **Container health on the host (restarts, unhealthy, out of memory):** needs the Docker socket, which is root on the host and goes against the minimum-permissions guardrail. Disk and memory alerts and response-checking service checks catch most of what it would.

## Design and release guardrails
- Protect network telemetry and backup contents as sensitive data.
- Keep all AI integrations optional; do not require internet connectivity for core monitoring.
- Avoid privileged device discovery or router writes beyond the minimum necessary permissions.
- Deliver new functionality via feature branches and PRs; do not modify the live official-store submission merely to track ideas.
