# Roadmap

Planned features, not yet built. Tick items off here as they ship. Core network monitoring must keep working without AI or external services.

## Next patch
- [x] Sign-in trims whitespace around the password.
- [ ] Official Umbrel App Store listing: submitted as getumbrel/umbrel-apps#6285, waiting on review.

## v1.2 — Network intelligence and data ownership
- [x] **Backup and restore:** export/import a versioned archive containing SQLite data, device names/trust settings, monitoring rules, schedules and configuration; consistency-safe backup, schema/version checks, restore preview, confirmation, automatic pre-restore safety backup, and recovery/rollback path. Explicitly warn about secrets and offer encrypted backups; test on clean install and across upgrades.
- [x] **Internet Health Score (0–100):** derive from latency, loss, jitter and outages; explain score and comparison baseline. Last 24 hours against the last 7 days, each part shown with its points; also in the MCP summary.
- [x] **Internet outage timeline:** timestamp and duration of disruptions; compare router vs internet reachability to avoid unsupported root-cause claims. Also an outage-ended alert and the `get_outages` MCP tool.
- [x] **Speed performance heatmap:** hourly/daily download and upload patterns, ISP plan target, long-term trends. The Weekly pattern card (download, upload, ping by weekday and hour) with plan speeds; long-term trends are the History chart's Year view.
- [x] **Unknown/new device alerts:** trusted-device workflow and randomized-MAC false-positive handling (extend existing new-device/offline alerts).
- [x] **Per-device online alerts:** alert each time a chosen device comes online after a set time away (15 min to 4 hours).
- [x] **Delete a device:** remove it with its history, so it's listed and alerted as new the next time it joins.
- [ ] **Adoption/analytics:** ask Umbrel maintainers whether aggregate install counts or a developer dashboard are available; if not, evaluate *explicit opt-in*, anonymous privacy-preserving telemetry for installs, active installs, versions, and feature usage. No IPs, MACs, device names, or network measurements; document consent, retention, and disabling; do not silently track.
  - **Now (no code):** watch "Total downloads" on the image's package page in GitHub Container Registry (GHCR), https://github.com/SuarezLuis/lanscape/pkgs/container/lanscape. Every Umbrel install and update pulls the image, so it's a rough count of installs plus updates (43 on 2026-11-02, mostly the owner's own updates). GitHub repo traffic isn't useful: clones are CI and test builds.
  - **Once the official listing is approved:** ask Umbrel (in the PR, Discord or forum) whether developers can see install counts. Community stores have none.
  - **Only if feature usage matters:** an opt-in daily heartbeat (random install ID, version, CPU type, which features are on), off by default and asked once in the app, sent to a Cloudflare Worker with a small database that drops IPs on arrival. Expect a minority to opt in, so treat it as a lower bound. No silent "update check" phoning home.
- [x] **Donation support:** Buy Me a Coffee link in the README (so also the About page) and GitHub's Sponsor button. Anything more in-app waits on Umbrel's submission rules.
- [x] **Buy Me a Coffee button in the app UI:** a "Buy me a coffee" link at the bottom of the sidebar, under About.

## v1.3 — Advanced monitoring and AI foundations
- [ ] **Network diagnostics:** guided ping, traceroute, DNS and gateway checks; exportable troubleshooting report.
- [ ] **Interactive network map:** devices grouped by role/status; draw physical/topology connections only with reliable evidence.
- [x] **Service health checks:** configurable HTTP/TCP/DNS checks for LAN services. Services page, down/back alerts, 24-hour uptime, and the `get_services` MCP tool.
- [x] **Network Intelligence API:** bounded read-only analytics tools (`get_network_summary`, `get_latency_history`, `get_speed_history`, `list_devices`, `get_device_history`, `get_alert_history`); validated ranges, access control and factual output. Shipped as the MCP server's tools.
- [x] **More analytics tools:** `compare_periods` (this week vs last), `get_network_events` (all devices' online/offline changes), and packet loss per bucket in latency history.
- [x] **MCP server for external AI agents:** authenticated, read-only access to the analytics tools for OpenClaw and other MCP clients; off until a token is created, one replaceable token, rate limits and a request log.
- [x] **Built-in AI chat:** bring-your-own OpenAI / Anthropic API key, local Ollama, and configurable OpenAI-compatible endpoint; tool calling, model selection, bounded context, evidence-backed answers and a clear offline/cloud data-disclosure policy. Secure server-side storage of secrets. The Assistant page, using the MCP tools; keys are write-only and conversations aren't stored.
- [ ] **Streaming chat answers:** show the answer as it's written, and which tool it's reading, instead of one wait.

## v1.4 — Smart diagnostics
- [ ] **Automatic problem detection:** rule-based baseline/anomaly detection, correlations and human-readable explanations; differentiate observations from possible causes.
- [ ] **Router integrations:** start with UniFi, expand to SNMP and supported router APIs for WAN, bandwidth, and connected-client metrics where permissions allow.
- [ ] **Proactive AI analyst:** opt-in investigation and summaries of unusual incidents; local model option, consent before cloud transmission, no automatic network modifications.
- [ ] **Network performance reports:** periodic summarized trends, issue comparisons and shareable ISP support diagnostics.

## Existing roadmap items
- [x] Pi-hole integration: device names, DNS activity per device, and recent DNS requests as a sign of life (Integrations page).
- [ ] HTTPS support.
- [ ] Browser push notifications.
- [x] **Standalone Docker release (no Umbrel):** the image already runs on plain Docker (the first visit sets the password), but it isn't documented or released as such. Add a `docker run` / Compose example to the README (host network for device discovery, a volume for `/data`, `init: true`), say which capabilities `arp-scan` and `ping` need, test it on a plain Linux host, and announce it with the release.

## Testing
- [x] **Database-backed tests:** each test file gets a SQLite file with the real migrations applied, so router procedures, queries and jobs (outages, rollups, rules firing, backups, MCP tools) are tested against real data. CI also fails when the schema changes without a migration.
- [x] **More database tests:** the device scan (scan → new device → alert, private-MAC matching, offline alerts) with a stubbed arp-scan, and a full restore with undo and an upgrade from an older backup.
- [x] **UI end-to-end tests:** Playwright against a built server with a throwaway database and seeded demo data (`scripts/demo/`): sign in, run a speed test with a stubbed `speedtest-go`, rename a device, scan with a stubbed `arp-scan`, set up a rule, add a service, back up, restore and undo. Runs in CI on every PR (`e2e/`).

## Design and release guardrails
- Protect network telemetry and backup contents as sensitive data.
- Keep all AI integrations optional; do not require internet connectivity for core monitoring.
- Avoid privileged device discovery or router writes beyond the minimum necessary permissions.
- Deliver new functionality via feature branches and PRs; do not modify the live official-store submission merely to track ideas.

## Shipped

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
