# Roadmap

Planned features, not yet built. Tick items off here as they ship. Core network monitoring must keep working without AI or external services.

## v1.2 — Network intelligence and data ownership
- [ ] **Backup and restore:** export/import a versioned archive containing SQLite data, device names/trust settings, monitoring rules, schedules and configuration; consistency-safe backup, schema/version checks, restore preview, confirmation, automatic pre-restore safety backup, and recovery/rollback path. Explicitly warn about secrets and offer encrypted backups; test on clean install and across upgrades.
- [ ] **Internet Health Score (0–100):** derive from latency, loss, jitter and outages; explain score and comparison baseline.
- [ ] **Internet outage timeline:** timestamp and duration of disruptions; compare router vs internet reachability to avoid unsupported root-cause claims.
- [ ] **Speed performance heatmap:** hourly/daily download and upload patterns, ISP plan target, long-term trends.
- [ ] **Unknown/new device alerts:** trusted-device workflow and randomized-MAC false-positive handling (extend existing new-device/offline alerts).
- [ ] **Adoption/analytics:** ask Umbrel maintainers whether aggregate install counts or a developer dashboard are available; if not, evaluate *explicit opt-in*, anonymous privacy-preserving telemetry for installs, active installs, versions, and feature usage. No IPs, MACs, device names, or network measurements; document consent, retention, and disabling; do not silently track.
- [ ] **Donation support:** optional, discreet Buy Me a Coffee link in About and README; confirm Umbrel submission rules before in-app placement.

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

## Design and release guardrails
- Protect network telemetry and backup contents as sensitive data.
- Keep all AI integrations optional; do not require internet connectivity for core monitoring.
- Avoid privileged device discovery or router writes beyond the minimum necessary permissions.
- Deliver new functionality via feature branches and PRs; do not modify the live official-store submission merely to track ideas.

