# Roadmap

Planned features, not yet built. Tick items off here as they ship. Core network monitoring must keep working without AI or external services.

## Next patch
- [x] Sign-in trims whitespace around the password.
- [ ] Official Umbrel App Store listing: submitted as getumbrel/umbrel-apps#6285, waiting on review.

## v1.2 — Network intelligence and data ownership
- [x] **Backup and restore:** export/import a versioned archive containing SQLite data, device names/trust settings, monitoring rules, schedules and configuration; consistency-safe backup, schema/version checks, restore preview, confirmation, automatic pre-restore safety backup, and recovery/rollback path. Explicitly warn about secrets and offer encrypted backups; test on clean install and across upgrades.
- [ ] **Internet Health Score (0–100):** derive from latency, loss, jitter and outages; explain score and comparison baseline.
- [ ] **Internet outage timeline:** timestamp and duration of disruptions; compare router vs internet reachability to avoid unsupported root-cause claims.
- [ ] **Speed performance heatmap:** hourly/daily download and upload patterns, ISP plan target, long-term trends.
- [x] **Unknown/new device alerts:** trusted-device workflow and randomized-MAC false-positive handling (extend existing new-device/offline alerts).
- [x] **Per-device online alerts:** alert each time a chosen device comes online after a set time away (15 min to 4 hours).
- [x] **Delete a device:** remove it with its history, so it's listed and alerted as new the next time it joins.
- [ ] **Adoption/analytics:** ask Umbrel maintainers whether aggregate install counts or a developer dashboard are available; if not, evaluate *explicit opt-in*, anonymous privacy-preserving telemetry for installs, active installs, versions, and feature usage. No IPs, MACs, device names, or network measurements; document consent, retention, and disabling; do not silently track.
- [x] **Donation support:** Buy Me a Coffee link in the README (so also the About page) and GitHub's Sponsor button. Anything more in-app waits on Umbrel's submission rules.
- [ ] **Buy Me a Coffee button in the app UI:** a discreet link in the app itself (e.g. the sidebar or Settings), once Umbrel's submission rules on in-app donation links are confirmed.

## v1.3 — Advanced monitoring and AI foundations
- [ ] **Network diagnostics:** guided ping, traceroute, DNS and gateway checks; exportable troubleshooting report.
- [ ] **Interactive network map:** devices grouped by role/status; draw physical/topology connections only with reliable evidence.
- [ ] **Service health checks:** configurable HTTP/TCP/DNS checks for LAN services.
- [ ] **Network Intelligence API:** bounded read-only analytics tools (`get_network_summary`, `get_latency_history`, `get_speed_history`, `list_devices`, `get_device_history`, `get_network_events`, `compare_periods`, `get_alert_history`); validated ranges, access control and factual output.
- [ ] **MCP server for external AI agents:** authenticated, read-only access to the analytics tools for OpenClaw and other MCP clients; local-only by default, scoped tokens, rate limits and audit logs.
- [ ] **Built-in AI chat:** bring-your-own OpenAI / Anthropic API key, local Ollama, and configurable OpenAI-compatible endpoint; tool calling, model selection, bounded context, evidence-backed answers and a clear offline/cloud data-disclosure policy. Secure server-side storage of secrets.

## v1.4 — Smart diagnostics
- [ ] **Automatic problem detection:** rule-based baseline/anomaly detection, correlations and human-readable explanations; differentiate observations from possible causes.
- [ ] **Router integrations:** start with UniFi, expand to SNMP and supported router APIs for WAN, bandwidth, and connected-client metrics where permissions allow.
- [ ] **Proactive AI analyst:** opt-in investigation and summaries of unusual incidents; local model option, consent before cloud transmission, no automatic network modifications.
- [ ] **Network performance reports:** periodic summarized trends, issue comparisons and shareable ISP support diagnostics.

## Existing roadmap items
- [ ] Optional Pi-hole device naming integration.
- [ ] HTTPS support.
- [ ] Browser push notifications.

## Testing
- [ ] **Database-backed tests:** apply the Prisma migrations to the in-memory test database so router procedures and jobs (scan → new device → alert, restore, rules firing) can be tested end to end.
- [ ] **UI end-to-end tests:** Playwright against a built server with a throwaway database and seeded demo data (`scripts/demo/`): sign in, run a speed test with a stubbed `speedtest-go`, rename a device, set up a rule, back up and restore. Run in CI on every PR.

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
