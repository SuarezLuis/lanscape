# Roadmap

What's planned, and what shipped in which release. Tick items off in the PR that ships them; once a version is released it moves under Shipped, and anything still open moves to the next version. Core network monitoring must keep working without AI or external services.

## Waiting
- [ ] **Official Umbrel App Store listing:** submitted as getumbrel/umbrel-apps#6285, waiting on review. Stays on 1.1.0 until it's approved; updates follow.

## v1.10.0 (next)
- [ ] **Proactive AI analyst:** opt-in investigation and summaries of incidents LANscape already detects (outages, alert rules, services going down); local model option, consent before cloud transmission, no automatic network modifications.

## v1.9.0 (in review: #37–#40)
- [x] **Weekly speed pattern:** download, upload and ping by weekday and hour, against your plan speeds; long-term trends are the History chart's Year view.
- [x] **More analytics tools:** `compare_periods` (this week vs last), `get_network_events` (every device's online/offline changes), and packet loss per bucket in latency history.
- [x] **Standalone Docker release (no Umbrel):** a Compose example and notes in the README, `APP_PASSWORD` wording without Umbrel in it, and `UMBREL=true` in the Umbrel stores' compose files.
- [x] **Streaming chat answers:** the assistant's answer appears as it's written, with each data lookup shown as it happens.
- [x] **Network diagnostics:** guided router, internet, DNS, HTTPS and traceroute checks with a plain-language verdict and a report to copy or download.
- [x] **Network performance reports:** an opt-in weekly summary through the alert channels, and a 30-day report to send an internet provider.

## Shipped

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

## Decided not to pursue
Kept here so the reasons aren't lost. Revisit if the reason stops holding.
- **Automatic problem detection** (baseline/anomaly detection and correlations): rules already compare against the 7-day median and outages are detected; real anomaly detection risks noisy alerts for little gain.
- **Interactive network map:** a real topology needs router data; the owner's TP-Link has no API for it, and a grouped list is what the Network page already is.
- **Router integrations (UniFi, SNMP):** no matching hardware to build or test against, and consumer routers rarely support SNMP. Revisit if a user with one asks.
- **HTTPS:** Umbrel apps are served over plain http, and a self-signed certificate means browser warnings. A reverse proxy or Tailscale is the practical route.
- **Browser push notifications:** browsers only allow push over HTTPS, so this waits on HTTPS; ntfy already covers phone notifications.
- **Adoption/analytics:** no telemetry. For a rough count, "Total downloads" on the image's GHCR page (https://github.com/SuarezLuis/lanscape/pkgs/container/lanscape) counts installs plus updates; once the official listing is approved, ask Umbrel whether developers can see install counts.

## Design and release guardrails
- Protect network telemetry and backup contents as sensitive data.
- Keep all AI integrations optional; do not require internet connectivity for core monitoring.
- Avoid privileged device discovery or router writes beyond the minimum necessary permissions.
- Deliver new functionality via feature branches and PRs; do not modify the live official-store submission merely to track ideas.
