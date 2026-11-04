import http from "node:http";
import https from "node:https";
import { connect } from "node:net";
import { prisma } from "../db";
import { alert, deviceLabel, LAST_SCAN } from "./devices";

// Common TCP ports on a home network and what usually runs on each
export const PORTS: Record<number, string> = {
  21: "FTP",
  22: "SSH",
  23: "Telnet",
  25: "SMTP (mail)",
  53: "DNS",
  80: "a web server (HTTP)",
  81: "a web server (HTTP)",
  88: "Kerberos",
  110: "POP3 (mail)",
  111: "RPC portmapper (NFS)",
  135: "Windows RPC",
  139: "Windows file sharing (NetBIOS)",
  143: "IMAP (mail)",
  389: "LDAP",
  443: "a web server (HTTPS)",
  445: "Windows file sharing (SMB)",
  465: "SMTP over TLS (mail)",
  515: "printing (LPD)",
  548: "Apple file sharing (AFP)",
  554: "camera streams (RTSP)",
  587: "SMTP submission (mail)",
  631: "printing (IPP)",
  636: "LDAP over TLS",
  853: "DNS over TLS",
  873: "rsync",
  993: "IMAP over TLS (mail)",
  995: "POP3 over TLS (mail)",
  1080: "a SOCKS proxy",
  1194: "OpenVPN",
  1400: "Sonos",
  1433: "Microsoft SQL Server",
  1521: "Oracle Database",
  1880: "Node-RED",
  1883: "MQTT",
  1935: "video streaming (RTMP)",
  2049: "NFS file sharing",
  2375: "the Docker API, unencrypted",
  2376: "the Docker API",
  3000: "Grafana or a development web server",
  3001: "Uptime Kuma",
  3128: "a web proxy (Squid)",
  3306: "MySQL or MariaDB",
  3389: "Windows Remote Desktop",
  4545: "LANscape",
  5000: "Synology DSM or UPnP",
  5001: "Synology DSM (HTTPS)",
  5060: "VoIP phones (SIP)",
  5357: "Windows network discovery (WSD)",
  5432: "PostgreSQL",
  5555: "Android debugging (ADB)",
  5900: "screen sharing (VNC)",
  5984: "CouchDB",
  6052: "ESPHome",
  6379: "Redis",
  6443: "the Kubernetes API",
  7000: "AirPlay",
  7547: "ISP remote management (TR-069)",
  8000: "a web server (HTTP)",
  8006: "Proxmox",
  8008: "Google Cast or a web server",
  8009: "Google Cast",
  8080: "a web server or proxy (HTTP)",
  8081: "a web server (HTTP)",
  8082: "a web server (HTTP)",
  8086: "InfluxDB",
  8096: "Jellyfin or Emby",
  8123: "Home Assistant",
  8200: "MiniDLNA media sharing",
  8291: "MikroTik Winbox",
  8384: "Syncthing",
  8504: "tar1090 (a live map of planes overhead)",
  8443: "a web server (HTTPS), like UniFi",
  8448: "Matrix",
  8554: "camera streams (RTSP)",
  8754: "a Flightradar24 feeder's status page",
  8883: "MQTT over TLS",
  8888: "a web server, like Jupyter",
  9000: "Portainer or a web server",
  9090: "Prometheus or Cockpit",
  9091: "Transmission",
  9100: "network printing (JetDirect)",
  9200: "Elasticsearch",
  9443: "Portainer (HTTPS)",
  10000: "Webmin",
  11434: "Ollama",
  27017: "MongoDB",
  30003: "dump1090 aircraft data (SBS)",
  30005: "dump1090 aircraft data (Beast)",
  32400: "Plex",
  49152: "UPnP (routers and media devices)",
  62078: "iPhone and iPad sync",
};

// Ports that usually speak TLS, so a web check tries HTTPS first
const TLS_PORTS = new Set([443, 465, 636, 853, 993, 995, 2376, 5001, 6443, 8006, 8443, 8883, 9443]);

const CONNECT_MS = 800;
const PROBE_MS = 2500;
const PARALLEL = 32;
const SETTLE_MS = 5000;

// What the page title, server header or banner says it is; the first match wins
const KNOWN: [RegExp, string | ((match: RegExpMatchArray) => string)][] = [
  [/pi-?hole/i, "Pi-hole"],
  [/home assistant/i, "Home Assistant"],
  [/plex/i, "Plex"],
  [/jellyfin/i, "Jellyfin"],
  [/emby/i, "Emby"],
  [/umbrel/i, "umbrelOS"],
  [/lanscape/i, "LANscape"],
  [/synology|diskstation/i, "Synology DSM"],
  [/portainer/i, "Portainer"],
  [/grafana/i, "Grafana"],
  [/proxmox/i, "Proxmox"],
  [/unifi/i, "UniFi"],
  [/node-red/i, "Node-RED"],
  [/syncthing/i, "Syncthing"],
  [/uptime kuma/i, "Uptime Kuma"],
  [/transmission/i, "Transmission"],
  [/qbittorrent/i, "qBittorrent"],
  [/nextcloud/i, "Nextcloud"],
  [/octoprint/i, "OctoPrint"],
  [/esphome/i, "ESPHome"],
  [/cockpit/i, "Cockpit"],
  [/webmin/i, "Webmin"],
  [/adguard/i, "AdGuard Home"],
  [/ollama/i, "Ollama"],
  [/fr24 feeder/i, "Flightradar24 feeder"],
  [/tar1090/i, "tar1090"],
  [/skyaware|piaware/i, "FlightAware PiAware"],
  [/OpenSSH[_ ]([\d.]+(?:p\d+)?)/, (match) => `OpenSSH ${match[1]}`],
  [/^SSH-[\d.]+-dropbear/i, "Dropbear SSH"],
  [/^SSH-/, "an SSH server"],
  [/MariaDB/i, "MariaDB"],
  [/mysql_native_password|caching_sha2_password/, "MySQL"],
  [/^220[ -].*FTP/i, "an FTP server"],
  [/^220[ -].*SMTP/i, "a mail server (SMTP)"],
  [/^RFB \d/, "screen sharing (VNC)"],
];

export type Seen = { service: string | null; detail: string | null };

// Printable text only, one line, short: banners can be binary
const clean = (text: string | undefined | null) => {
  const line = (text ?? "").replace(/[^\x20-\x7e]+/g, " ").replace(/\s+/g, " ").trim();
  return line ? line.slice(0, 120) : null;
};

export const recognize = (texts: (string | null)[], fallback: string | null): Seen => {
  const detail = texts.find((text) => text) ?? null;
  for (const text of texts) {
    if (!text) continue;
    for (const [pattern, name] of KNOWN) {
      const match = text.match(pattern);
      if (match) return { service: typeof name === "string" ? name : name(match), detail };
    }
  }
  return { service: fallback, detail };
};

const pageTitle = (html: string) => clean(/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.replace(/&amp;/g, "&"));

type Page = { status: number; server: string | null; title: string | null; headers: string; location: string | null; body: string };

const fetchPage = (url: string) =>
  new Promise<Page | null>((resolve) => {
    const client = url.startsWith("https:") ? https : http;
    const request = client.get(url, { timeout: PROBE_MS, rejectUnauthorized: false, headers: { "user-agent": "LANscape port scan" } }, (response) => {
      let body = "";
      response.setEncoding("latin1");
      response.on("data", (chunk: string) => {
        body += chunk;
        if (body.length > 65_536) response.destroy();
      });
      const done = () =>
        resolve({ status: response.statusCode ?? 0, server: clean(String(response.headers.server ?? "")), title: pageTitle(body), headers: Object.keys(response.headers).join(" "), location: response.headers.location ?? null, body });
      response.on("end", done);
      response.on("close", done);
      response.on("error", done);
    });
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve(null));
  });

// A web page, following a couple of redirects on the same device (Pi-hole sends / to /admin/)
const webPage = async (base: string) => {
  let url = `${base}/`;
  for (let hop = 0; hop < 3; hop++) {
    const page = await fetchPage(url);
    if (!page?.location || page.status < 300 || page.status >= 400) return page;
    const next = new URL(page.location, url);
    if (next.origin !== new URL(base).origin) return page;
    url = next.href;
  }
  return null;
};

// Whatever the service says first, for those that talk before they're asked (SSH, FTP, SMTP, MySQL, VNC)
const banner = (host: string, port: number) =>
  new Promise<string | null>((resolve) => {
    const socket = connect({ host, port, timeout: CONNECT_MS });
    let text = "";
    const finish = () => {
      socket.destroy();
      resolve(text || null);
    };
    socket.setTimeout(1200, finish);
    socket.on("data", (chunk) => {
      text += chunk.toString("latin1");
      if (text.length > 512) finish();
    });
    socket.on("error", finish);
    socket.on("end", finish);
  });

export const identify = async (host: string, port: number): Promise<Seen> => {
  const greeting = await banner(host, port);
  // A stream of binary data (dump1090's aircraft feed) says nothing readable about what it is
  if (greeting && greeting.replace(/[\x20-\x7e\r\n\t]/g, "").length > greeting.length / 4) return { service: null, detail: null };
  if (greeting && !greeting.startsWith("HTTP/")) return recognize([clean(greeting)], null);
  const schemes = TLS_PORTS.has(port) ? ["https", "http"] : ["http", "https"];
  for (const scheme of schemes) {
    const page = await webPage(`${scheme}://${host}:${port}`);
    // nginx answers plain HTTP on a TLS port with an error page saying so
    if (!page || /plain HTTP request was sent to HTTPS/i.test(page.body)) continue;
    const kind = scheme === "https" ? "a web server (HTTPS)" : "a web server (HTTP)";
    // Header names give some away even behind a login (Plex answers 401 with X-Plex-* headers)
    const seen = recognize([page.title, page.server, page.headers], page.server ? `${kind}, ${page.server}` : kind);
    return seen.detail === page.headers ? { ...seen, detail: null } : seen;
  }
  return { service: null, detail: clean(greeting) };
};

const isOpen = (host: string, port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = connect({ host, port, timeout: CONNECT_MS }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => resolve(false));
  });

const inBatches = async <T, R>(items: T[], size: number, run: (item: T) => Promise<R>) => {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += size) results.push(...(await Promise.all(items.slice(i, i + size).map(run))));
  return results;
};

const COMMON_PORTS = Object.keys(PORTS).map(Number);
export const ALL_PORTS = Array.from({ length: 65_535 }, (_, i) => i + 1);

// quiet: no port alerts, for a scan the owner started and is watching
type ScanOptions = { parallel?: number; signal?: AbortSignal; onProgress?: (checked: number, open: number) => void; quiet?: boolean };

export const scanHost = async (host: string, ports = COMMON_PORTS, { parallel = PARALLEL, signal, onProgress }: ScanOptions = {}) => {
  const unique = [...new Set(ports)];
  const answered: number[] = [];
  for (let i = 0; i < unique.length; i += parallel) {
    signal?.throwIfAborted();
    const batch = unique.slice(i, i + parallel);
    answered.push(...(await Promise.all(batch.map(async (port) => ((await isOpen(host, port)) ? port : null)))).filter((port) => port !== null));
    onProgress?.(i + batch.length, answered.length);
  }
  signal?.throwIfAborted();
  // Right after thousands of connections some devices don't answer properly for a few seconds (seen on a Raspberry Pi)
  if (unique.length > 1000 && answered.length) await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  return inBatches(answered, 8, async (port) => ({ port, ...(await identify(host, port)) }));
};

export const PORT_OPENED_ALERTS = "notify.portOpened";
export const PORT_CLOSED_ALERTS = "notify.portClosed";

// New open ports alert by default (scans themselves are opt-in); closed ones only when asked
export const readPortAlerts = async () => {
  const rows = await prisma.setting.findMany({ where: { key: { in: [PORT_OPENED_ALERTS, PORT_CLOSED_ALERTS] } } });
  const value = (key: string) => rows.find((row) => row.key === key)?.value;
  return { portOpened: value(PORT_OPENED_ALERTS) !== "off", portClosed: value(PORT_CLOSED_ALERTS) === "on" };
};

type Found = { port: number; service: string | null };

const portLine = ({ port, service }: Found) => {
  const usual = PORTS[port];
  if (!service) return `${port}${usual ? `, usually ${usual}` : ""}`;
  return `${port}: ${service}${usual && !/^a web server/.test(usual) && !usual.toLowerCase().includes(service.toLowerCase()) ? `, usually ${usual}` : ""}`;
};

// What changed since the device's previous scan; nothing on its first one
export const portChanges = (previous: Found[] | null, found: Found[]) => {
  if (previous === null) return { opened: [], closed: [] };
  // ponytail: a device that answered nothing was likely asleep or gone mid-scan, not closing everything; a real
  // all-closed device stays quiet until a later scan finds something
  if (found.length === 0) return { opened: [], closed: [] };
  const had = new Set(previous.map((entry) => entry.port));
  const has = new Set(found.map((entry) => entry.port));
  return { opened: found.filter((entry) => !had.has(entry.port)), closed: previous.filter((entry) => !has.has(entry.port)) };
};

export const portAlert = (label: string, ip: string, change: "opened" | "closed", ports: Found[]) => {
  const plural = ports.length > 1;
  const title = `${label} ${change} ${plural ? `${ports.length} ports` : `port ${ports[0]!.port}`}`;
  const lines = ports.map(portLine);
  const message =
    change === "opened"
      ? `${label} (${ip}) has ${plural ? "new open ports" : "a new open port"}: ${lines.join("; ")}. If you didn't change anything on it, check what it is.`
      : `${label} (${ip}) closed ${plural ? "ports" : "port"} ${lines.join("; ")}.`;
  return { title, message };
};

const scanning = new Set<string>();

// Scans one device's ports (the common ones unless told otherwise) at its current address and keeps what was found.
// Ports outside the ones checked keep what an earlier scan of all ports found
export const scanDevicePorts = async (mac: string, ports = COMMON_PORTS, options: ScanOptions = {}) => {
  const device = await prisma.device.findUniqueOrThrow({ where: { mac } });
  if (scanning.has(mac)) throw new Error("A port scan of this device is already running.");
  scanning.add(mac);
  try {
    const found = await scanHost(device.ip, ports, options);
    const checked = new Set(ports);
    const earlier = device.portsScannedAt ? await prisma.devicePort.findMany({ where: { mac } }) : null;
    const previous = earlier && earlier.filter((entry) => checked.has(entry.port));
    const kept = (earlier ?? []).filter((entry) => !checked.has(entry.port)).map(({ port, service, detail }) => ({ port, service, detail }));
    // An empty scan of a device that had ports keeps the old list (see portChanges)
    if (found.length === 0 && previous?.length) return found;
    const { opened, closed } = portChanges(previous, found);
    const alerts = options.quiet ? { portOpened: false, portClosed: false } : await readPortAlerts();
    const label = deviceLabel(device);
    if (alerts.portOpened && opened.length) {
      const { title, message } = portAlert(label, device.ip, "opened", opened);
      await alert("port", title, message);
    }
    if (alerts.portClosed && closed.length) {
      const { title, message } = portAlert(label, device.ip, "closed", closed);
      await alert("port", title, message);
    }
    await prisma.$transaction([
      prisma.devicePort.deleteMany({ where: { mac } }),
      prisma.devicePort.createMany({ data: [...found, ...kept].map((entry) => ({ mac, ...entry })) }),
      prisma.device.update({ where: { mac }, data: { portsScannedAt: new Date() } }),
    ]);
    return found;
  } finally {
    scanning.delete(mac);
  }
};

// All 65,535 ports of one device, on request only: in the background, with progress, and stoppable (nothing is saved
// then). A few minutes on most devices (a Raspberry Pi took 4); one that silently drops closed ports takes longer
const FULL_PARALLEL = 128;
type FullScan = { checked: number; total: number; open: number; startedAt: Date; stop: AbortController };
const fullScans = new Map<string, FullScan>();

export const startFullPortScan = async (mac: string) => {
  await prisma.device.findUniqueOrThrow({ where: { mac } });
  if (scanning.has(mac)) throw new Error("A port scan of this device is already running.");
  const scan: FullScan = { checked: 0, total: ALL_PORTS.length, open: 0, startedAt: new Date(), stop: new AbortController() };
  fullScans.set(mac, scan);
  void scanDevicePorts(mac, ALL_PORTS, {
    parallel: FULL_PARALLEL,
    quiet: true,
    signal: scan.stop.signal,
    onProgress: (checked, open) => Object.assign(scan, { checked, open }),
  })
    .catch(() => {})
    .finally(() => fullScans.delete(mac));
};

export const fullPortScan = (mac: string) => {
  const scan = fullScans.get(mac);
  return scan ? { checked: scan.checked, total: scan.total, open: scan.open, startedAt: scan.startedAt } : null;
};

export const stopFullPortScan = (mac: string) => fullScans.get(mac)?.stop.abort();

// The scheduled scan: every device that answered the latest device scan, one at a time
export const scanOnlineDevicePorts = async () => {
  const lastScan = await prisma.setting.findUnique({ where: { key: LAST_SCAN } });
  if (!lastScan) return { devices: 0, open: 0 };
  const online = await prisma.device.findMany({ where: { lastSeen: { gte: new Date(lastScan.value) } }, select: { mac: true } });
  let open = 0;
  for (const { mac } of online) {
    // ponytail: one failed device (it left mid-scan, a scan already running) doesn't stop the rest
    open += (await scanDevicePorts(mac).catch(() => [])).length;
  }
  return { devices: online.length, open };
};

// What the device panel shows: each open port with what usually runs there and what answered
export const devicePorts = async (mac: string) => {
  const [device, ports] = await Promise.all([
    prisma.device.findUnique({ where: { mac }, select: { portsScannedAt: true } }),
    prisma.devicePort.findMany({ where: { mac }, orderBy: { port: "asc" } }),
  ]);
  return { scannedAt: device?.portsScannedAt ?? null, ports: ports.map((entry) => ({ ...entry, usual: PORTS[entry.port] ?? null })) };
};
