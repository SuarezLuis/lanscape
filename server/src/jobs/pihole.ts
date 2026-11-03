import { z } from "zod";
import { prisma } from "../db";
import { readStatus, recordFailure, recordStatus } from "./status";

// Pi-hole v6 REST API. On Umbrel both apps use the host network, and Pi-hole's web server is on 8082
export const DEFAULT_PIHOLE_URL = "http://localhost:8082";
const URL_KEY = "pihole.url";
const PASSWORD_KEY = "pihole.password";
const STATUS = "integration.pihole";
const TIMEOUT_MS = 5000;

type ApiDevice = {
  hwaddr: string;
  lastQuery: number;
  numQueries: number;
  ips: { ip: string; name: string | null; lastSeen: number }[];
};

type ApiQuery = { domain: string; status: string; time: number };

export type PiholeClient = { mac: string; ip: string; name: string | null; lastQuery: Date | null; queries: number };

const readConfig = async () => {
  const rows = await prisma.setting.findMany({ where: { key: { in: [URL_KEY, PASSWORD_KEY] } } });
  const url = rows.find((row) => row.key === URL_KEY)?.value;
  const password = rows.find((row) => row.key === PASSWORD_KEY)?.value;
  return url && password ? { url, password } : null;
};

type Config = NonNullable<Awaited<ReturnType<typeof readConfig>>>;

// Pi-hole only allows a handful of sessions at once, so one is kept and reused until it expires or is refused
let session: { url: string; password: string; sid: string; expires: number } | null = null;

const signIn = async ({ url, password }: Config) => {
  const response = await fetch(`${url}/api/auth`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await response.json().catch(() => null)) as { session?: { valid: boolean; sid: string | null; validity: number; message?: string } } | null;
  if (!body?.session?.valid || !body.session.sid) {
    throw new Error(body?.session?.message === "password incorrect" ? "Pi-hole rejected the password" : `Pi-hole sign-in failed (${response.status})`);
  }
  return { url, password, sid: body.session.sid, expires: Date.now() + (body.session.validity - 30) * 1000 };
};

const request = async (config: Config, path: string, method = "GET", body?: unknown) => {
  const call = async () => {
    if (!session || session.url !== config.url || session.password !== config.password || session.expires < Date.now()) {
      session = await signIn(config);
    }
    return fetch(`${config.url}/api${path}`, {
      method,
      headers: { "X-FTL-SID": session.sid, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  };
  let response = await call();
  if (response.status === 401) {
    session = null;
    response = await call();
  }
  return response;
};

const api = async <T>(config: Config, path: string, method = "GET", body?: unknown): Promise<T> => {
  const response = await request(config, path, method, body);
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { error?: { message?: string; hint?: string } } | null;
    throw new Error(`Pi-hole answered ${response.status}${error?.error?.message ? `: ${error.error.message}` : ""}`);
  }
  return (response.status === 204 ? null : response.json()) as Promise<T>;
};

const MAC = /^([\da-f]{2}:){5}[\da-f]{2}$/;

// "laptop.lan" -> "laptop"; Pi-hole names come from reverse DNS, so they carry the local domain
const shortName = (name: string | null) => {
  const label = name?.split(".")[0];
  return label && label !== "localhost" ? label : null;
};

// One entry per real MAC (Pi-hole also lists "ip-..." placeholders and the loopback), IPv4 first
export const toClients = (devices: ApiDevice[]): PiholeClient[] =>
  devices.flatMap((device) => {
    const mac = device.hwaddr.toLowerCase();
    if (!MAC.test(mac) || mac === "00:00:00:00:00:00") return [];
    const ips = device.ips.filter((entry) => entry.ip.includes(".")).toSorted((a, b) => b.lastSeen - a.lastSeen);
    const [latest] = ips;
    if (!latest) return [];
    return [
      {
        mac,
        ip: latest.ip,
        name: shortName(ips.find((entry) => shortName(entry.name))?.name ?? null),
        lastQuery: device.lastQuery ? new Date(device.lastQuery * 1000) : null,
        queries: device.numQueries,
      },
    ];
  });

const fetchClients = async (config: Config) =>
  toClients((await api<{ devices: ApiDevice[] }>(config, "/network/devices?max_devices=1000&max_addresses=4")).devices);

// For each scan: empty when Pi-hole isn't set up or can't be reached, which the Integrations page shows
export const piholeClients = async () => {
  const config = await readConfig();
  if (!config) return [];
  try {
    const clients = await fetchClients(config);
    await recordStatus(STATUS, { ok: true, summary: `${clients.length} devices, ${clients.filter((client) => client.name).length} with names` });
    return clients;
  } catch (error) {
    await recordFailure(STATUS, error);
    return [];
  }
};

export const describePihole = async () => {
  const rows = await prisma.setting.findMany({ where: { key: { in: [URL_KEY, PASSWORD_KEY] } } });
  return {
    url: rows.find((row) => row.key === URL_KEY)?.value ?? DEFAULT_PIHOLE_URL,
    passwordSet: rows.some((row) => row.key === PASSWORD_KEY),
    configured: (await readConfig()) !== null,
    status: await readStatus(STATUS),
  };
};

export const piholeSettings = z.object({
  url: z.url({ protocol: /^https?$/ }).max(200).transform((url) => url.replace(/\/+$/, "")),
  // undefined keeps the saved one
  password: z.string().min(1).max(500).optional(),
});

// Saves only once Pi-hole accepts the settings, so a typo can't silently stop names and activity
export const savePihole = async (input: z.output<typeof piholeSettings>) => {
  const password = input.password ?? (await readConfig())?.password;
  if (!password) throw new Error("Enter Pi-hole's app password");
  const config = { url: input.url, password };
  session = null;
  const clients = await fetchClients(config);
  for (const [key, value] of Object.entries({ [URL_KEY]: config.url, [PASSWORD_KEY]: password })) {
    await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
  await recordStatus(STATUS, { ok: true, summary: `${clients.length} devices, ${clients.filter((client) => client.name).length} with names` });
  return { devices: clients.length, named: clients.filter((client) => client.name).length };
};

export const removePihole = async () => {
  // Resume paused devices while LANscape can still reach Pi-hole
  const paused = await prisma.setting.findMany({ where: { key: { startsWith: PAUSE_PREFIX } } });
  for (const row of paused) await resumeDevice(row.key.slice(PAUSE_PREFIX.length));
  session = null;
  await prisma.setting.deleteMany({ where: { key: { in: [URL_KEY, PASSWORD_KEY, `status.${STATUS}`] } } });
};

// Pi-hole statuses for queries it answered itself instead of resolving
const BLOCKED = /^(GRAVITY|REGEX|DENYLIST|EXTERNAL_BLOCKED|SPECIAL_DOMAIN)/;
const SAMPLE = 1000;

export const summarizeQueries = (queries: ApiQuery[]) => {
  const counts = new Map<string, number>();
  for (const query of queries) counts.set(query.domain, (counts.get(query.domain) ?? 0) + 1);
  return {
    sampled: queries.length,
    blocked: queries.filter((query) => BLOCKED.test(query.status)).length,
    topDomains: [...counts].toSorted((a, b) => b[1] - a[1]).slice(0, 8).map(([domain, count]) => ({ domain, count })),
  };
};

// What one device has been asking DNS for, from its latest requests
export const piholeActivity = async (mac: string) => {
  const config = await readConfig();
  if (!config) return null;
  const client = (await fetchClients(config)).find((entry) => entry.mac === mac);
  if (!client) return { found: false as const };
  const { queries } = await api<{ queries: ApiQuery[] }>(config, `/queries?client_ip=${encodeURIComponent(client.ip)}&length=${SAMPLE}`);
  return { found: true as const, total: client.queries, lastQuery: client.lastQuery, ...summarizeQueries(queries) };
};

// Pausing a device: Pi-hole answers all its lookups with "blocked" for a few minutes, so whatever loses the internet
// is that device. A Pi-hole group holds one regex that matches every domain; the device's IP joins only that group,
// and goes back to how it was (or is removed again) afterwards
const PAUSE_GROUP = "LANscape pause";
const BLOCK_ALL = ".*";
const PAUSE_PREFIX = "pihole.pause.";
export const PAUSE_MINUTES = [1, 2, 5] as const;

type Pause = { ip: string; until: string; previous: { groups: number[]; comment: string | null } | null };

const pauseGroupId = async (config: Config) => {
  const named = async () =>
    (await api<{ groups: { id: number; name: string }[] }>(config, "/groups")).groups.find((group) => group.name === PAUSE_GROUP)?.id;
  let id = await named();
  if (id === undefined) {
    await api(config, "/groups", "POST", { name: PAUSE_GROUP, comment: "Devices LANscape is pausing; managed by LANscape", enabled: true });
    id = await named();
  }
  if (id === undefined) throw new Error("Couldn't create LANscape's group in Pi-hole");
  const rules = (await api<{ domains: { domain: string; groups: number[] }[] }>(config, "/domains/deny/regex")).domains;
  const rule = rules.find((entry) => entry.domain === BLOCK_ALL && entry.groups.includes(id));
  if (!rule) {
    await api(config, "/domains/deny/regex", "POST", { domain: BLOCK_ALL, comment: "Blocks everything for devices LANscape pauses", groups: [id], enabled: true });
  }
  return id;
};

const readPause = async (mac: string) => {
  const row = await prisma.setting.findUnique({ where: { key: `${PAUSE_PREFIX}${mac}` } });
  return row ? (JSON.parse(row.value) as Pause) : null;
};

export const pausedUntil = async (mac: string) => {
  const pause = await readPause(mac);
  return pause ? new Date(pause.until) : null;
};

export const resumeDevice = async (mac: string) => {
  const pause = await readPause(mac);
  const config = await readConfig();
  if (!pause) return;
  if (config) {
    const path = `/clients/${encodeURIComponent(pause.ip)}`;
    if (pause.previous) await api(config, path, "PUT", { comment: pause.previous.comment, groups: pause.previous.groups });
    else {
      const response = await request(config, path, "DELETE");
      if (!response.ok && response.status !== 404) throw new Error(`Pi-hole answered ${response.status}`);
    }
  }
  // Without Pi-hole settings there's nothing left to undo here; the setting goes either way
  await prisma.setting.delete({ where: { key: `${PAUSE_PREFIX}${mac}` } });
};

export const pauseDevice = async (mac: string, minutes: (typeof PAUSE_MINUTES)[number]) => {
  const config = await readConfig();
  if (!config) throw new Error("Connect Pi-hole on the Integrations page first.");
  if (await readPause(mac)) throw new Error("This device is already paused.");
  const device = await prisma.device.findUniqueOrThrow({ where: { mac } });
  const group = await pauseGroupId(config);
  const path = `/clients/${encodeURIComponent(device.ip)}`;
  const existing = (await request(config, path)).ok
    ? (await api<{ clients: { client: string; groups: number[]; comment: string | null }[] }>(config, path)).clients[0]
    : undefined;
  const pause: Pause = {
    ip: device.ip,
    until: new Date(Date.now() + minutes * 60_000).toISOString(),
    previous: existing ? { groups: existing.groups, comment: existing.comment } : null,
  };
  // Saved first, so a failure halfway still gets undone by the resume
  await prisma.setting.create({ data: { key: `${PAUSE_PREFIX}${mac}`, value: JSON.stringify(pause) } });
  if (existing) await api(config, path, "PUT", { comment: existing.comment, groups: [group] });
  else await api(config, "/clients", "POST", { client: device.ip, comment: "Paused by LANscape", groups: [group] });
  setTimeout(() => void resumeDevice(mac).catch((error: unknown) => console.error("Resuming a paused device failed:", error)), minutes * 60_000).unref();
  return { until: new Date(pause.until) };
};

// Each minute: anything past its time is resumed, so a restart mid-pause doesn't leave a device cut off
export const resumeDuePauses = async (now = new Date()) => {
  const rows = await prisma.setting.findMany({ where: { key: { startsWith: PAUSE_PREFIX } } });
  for (const row of rows) {
    if (new Date((JSON.parse(row.value) as Pause).until) <= now) await resumeDevice(row.key.slice(PAUSE_PREFIX.length));
  }
};
