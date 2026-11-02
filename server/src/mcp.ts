import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { prisma } from "./db";
import { healthScore } from "./health";
import { latencyHistory, since } from "./latency";
import { listOutages, OUTAGE_RANGES } from "./outages";
import { LAST_SCAN } from "./jobs/devices";
import { listServices } from "./jobs/services";
import { METRICS, type Metric } from "./jobs/notify";

/**
 * A read-only MCP server (Streamable HTTP, stateless, JSON responses) for AI agents like OpenClaw or Claude.
 * Off until a token is created on the Integrations page; every tool call is logged.
 * ponytail: hand-written JSON-RPC for tools only, instead of the MCP SDK (which pulls in express and hono);
 * switch to the SDK if LANscape needs resources, prompts or server-sent events.
 */

export const MCP_TOKEN = "mcp.token";
const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
const LOG_DAYS = 30;

const hash = (token: string) => createHash("sha256").update(token).digest();

// The token is shown once; only its hash is kept, like session cookies
export const createMcpToken = async () => {
  const token = `lanscape_${randomBytes(32).toString("base64url")}`;
  const value = JSON.stringify({ hash: hash(token).toString("hex"), createdAt: new Date().toISOString() });
  await prisma.setting.upsert({ where: { key: MCP_TOKEN }, create: { key: MCP_TOKEN, value }, update: { value } });
  return token;
};

export const revokeMcpToken = () => prisma.setting.deleteMany({ where: { key: MCP_TOKEN } });

const storedToken = async () => {
  const row = await prisma.setting.findUnique({ where: { key: MCP_TOKEN } });
  return row ? (JSON.parse(row.value) as { hash: string; createdAt: string }) : null;
};

export const mcpEnabled = async () => (await storedToken()) !== null;

export const mcpTokenValid = async (authorization: string | undefined) => {
  const stored = await storedToken();
  const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  return stored !== null && token !== undefined && timingSafeEqual(hash(token), Buffer.from(stored.hash, "hex"));
};

export const describeMcp = async () => {
  const stored = await storedToken();
  const calls = await prisma.mcpCall.findMany({ orderBy: { at: "desc" }, take: 20 });
  return { enabled: stored !== null, createdAt: stored ? new Date(stored.createdAt) : null, calls };
};

export const pruneMcpCalls = () => prisma.mcpCall.deleteMany({ where: { at: { lt: new Date(Date.now() - LOG_DAYS * 86_400_000) } } });

const round = (value: number | null, digits = 1) => (value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits);
const percent = (sent: number, received: number) => (sent ? round(((sent - received) / sent) * 100) : null);

const range = z.enum(["day", "week", "month", "year"]).default("week").describe("How far back to look");
const limit = (max: number, fallback: number) => z.int().min(1).max(max).default(fallback).describe(`Most rows to return (max ${max})`);

const scanTime = async () => {
  const row = await prisma.setting.findUnique({ where: { key: LAST_SCAN } });
  return row ? new Date(row.value) : null;
};

const deviceView = (device: { mac: string; ip: string; name: string | null; hostname: string | null; vendor: string | null; known: boolean; firstSeen: Date; lastSeen: Date }, scannedAt: Date | null) => ({
  mac: device.mac,
  ip: device.ip,
  name: device.name ?? device.hostname,
  vendor: device.vendor,
  known: device.known,
  online: scannedAt !== null && device.lastSeen >= scannedAt,
  firstSeen: device.firstSeen,
  lastSeen: device.lastSeen,
});

type Tool<Input extends z.ZodObject> = { description: string; input: Input; run: (input: z.output<Input>) => Promise<unknown> };
const tool = <Input extends z.ZodObject>(definition: Tool<Input>) => definition as unknown as Tool<z.ZodObject>;

export const TOOLS: Record<string, Tool<z.ZodObject>> = {
  get_network_summary: tool({
    description:
      "Current state of the home network: the Internet Health Score (0-100, from uptime, packet loss, ping and jitter over the last 24 hours and 7 days, with each part's value and points), the latest speed test, router and internet ping over the last 24 hours (average and packet loss), device counts, rules that are alerting now, and unread alerts.",
    input: z.object({}),
    run: async () => {
      const day = since("day")!;
      const [health24h, health7d, latest, pings, devices, scannedAt, alerting, unreadAlerts] = await Promise.all([
        healthScore(1),
        healthScore(7),
        prisma.speedTest.findFirst({ orderBy: { createdAt: "desc" } }),
        prisma.pingSample.groupBy({ by: ["target"], where: { createdAt: { gte: day } }, _avg: { avgMs: true }, _sum: { sent: true, received: true }, _count: true }),
        prisma.device.findMany({ select: { known: true, lastSeen: true } }),
        scanTime(),
        prisma.notificationRule.findMany({ where: { alerting: true, enabled: true } }),
        prisma.notification.count({ where: { read: false } }),
      ]);
      const online = devices.filter((device) => scannedAt !== null && device.lastSeen >= scannedAt);
      return {
        healthScore: {
          last24h: health24h && { score: health24h.score, grade: health24h.grade, parts: health24h.parts.map(({ label, value, unit, points, weight }) => ({ label, value, unit, points, weight })) },
          last7d: health7d && { score: health7d.score, grade: health7d.grade },
        },
        latestSpeedTest: latest && {
          at: latest.createdAt,
          downloadMbps: round(latest.downloadMbps),
          uploadMbps: round(latest.uploadMbps),
          pingMs: round(latest.pingMs),
          jitterMs: round(latest.jitterMs),
        },
        pingLast24h: Object.fromEntries(
          pings.map((row) => [
            row.target,
            { checks: row._count, averageMs: round(row._avg.avgMs), packetLossPercent: percent(row._sum.sent ?? 0, row._sum.received ?? 0) },
          ]),
        ),
        devices: {
          lastScan: scannedAt,
          total: devices.length,
          online: online.length,
          unknown: devices.filter((device) => !device.known).length,
          unknownOnline: online.filter((device) => !device.known).length,
        },
        alertingNow: alerting.map((rule) => `${METRICS[rule.metric as Metric]?.label ?? rule.metric} ${rule.direction} ${rule.value}${rule.mode === "percent" ? "% of normal" : ` ${METRICS[rule.metric as Metric]?.unit ?? ""}`}`),
        unreadAlerts,
      };
    },
  }),
  get_speed_history: tool({
    description: "Speed test results, newest first: download and upload in Mbps, ping and jitter in ms, and the test server.",
    input: z.object({ range, limit: limit(500, 100) }),
    run: async ({ range, limit }) =>
      (await prisma.speedTest.findMany({ where: { createdAt: { gte: since(range)! } }, orderBy: { createdAt: "desc" }, take: limit })).map((test) => ({
        at: test.createdAt,
        downloadMbps: round(test.downloadMbps),
        uploadMbps: round(test.uploadMbps),
        pingMs: round(test.pingMs),
        jitterMs: round(test.jitterMs),
        server: `${test.serverSponsor} (${test.serverName})`,
        trigger: test.trigger,
      })),
  }),
  get_latency_history: tool({
    description:
      "Latency over time in ms, averaged into buckets (a minute to a day wide, depending on the range): routerMs and internetMs from the regular ping checks, testPingMs and testJitterMs from speed tests. Null means no data in that bucket, or every ping was lost.",
    input: z.object({ range }),
    run: async ({ range }) =>
      (await latencyHistory(range)).map((point) => ({
        time: point.time,
        routerMs: round(point.routerMs),
        internetMs: round(point.internetMs),
        testPingMs: round(point.testPingMs),
        testJitterMs: round(point.testJitterMs),
      })),
  }),
  get_outages: tool({
    description:
      "Internet outages, newest first: two or more ping checks in a row with every packet lost. cause \"internet\" means the router kept answering, so the problem was past it (the ISP or beyond); \"home\" means the router didn't answer either (router, or the Umbrel's connection to it); \"unknown\" means no router checks to compare. end is null while an outage is ongoing. Range goes up to a year.",
    input: z.object({ range: z.enum(OUTAGE_RANGES).default("week").describe("How far back to look") }),
    run: async ({ range }) =>
      (await listOutages(range)).map((outage) => ({
        ...outage,
        minutes: outage.end ? round((outage.end.getTime() - outage.start.getTime()) / 60_000) : null,
      })),
  }),
  get_services: tool({
    description:
      "Services on the LAN the owner watches (web apps over HTTP, open TCP ports, DNS servers): status (up, failing = one failed check, down = two or more, waiting = not checked yet), the last result and its detail, average answer time and uptime over the last 24 hours.",
    input: z.object({}),
    run: async () =>
      (await listServices()).map((service) => ({
        name: service.name,
        kind: service.kind,
        target: service.target,
        lookup: service.query,
        enabled: service.enabled,
        status: service.status,
        failingSince: service.failingSince,
        lastCheck: service.last && { at: service.last.at, ok: service.last.ok, ms: round(service.last.ms), detail: service.last.detail },
        averageMs24h: round(service.avgMs24h),
        uptimePercent24h: round(service.uptime24h),
      })),
  }),
  list_devices: tool({
    description:
      "Devices found on the local network, with name, IP, MAC, maker, whether the owner marked it as known, and whether it answered the latest scan. \"Private address\" as maker means a randomized MAC (usually a phone or laptop).",
    input: z.object({
      status: z.enum(["all", "online", "offline"]).default("all"),
      unknownOnly: z.boolean().default(false).describe("Only devices the owner hasn't marked as known"),
    }),
    run: async ({ status, unknownOnly }) => {
      const [devices, scannedAt] = await Promise.all([
        prisma.device.findMany({ where: unknownOnly ? { known: false } : {}, orderBy: { lastSeen: "desc" }, take: 500 }),
        scanTime(),
      ]);
      return {
        lastScan: scannedAt,
        devices: devices.map((device) => deviceView(device, scannedAt)).filter((device) => status === "all" || device.online === (status === "online")),
      };
    },
  }),
  get_device_history: tool({
    description: "One device's details and when it went online or offline (latest 100 changes). Find the MAC with list_devices.",
    input: z.object({ mac: z.string().trim().toLowerCase().regex(/^([\da-f]{2}:){5}[\da-f]{2}$/, "A MAC like aa:bb:cc:dd:ee:ff") }),
    run: async ({ mac }) => {
      const [device, scannedAt] = await Promise.all([
        prisma.device.findUnique({ where: { mac }, include: { events: { orderBy: { at: "desc" }, take: 100 } } }),
        scanTime(),
      ]);
      if (!device) throw new Error(`No device with MAC ${mac}`);
      return { ...deviceView(device, scannedAt), changes: device.events.map((event) => ({ at: event.at, online: event.online })) };
    },
  }),
  get_alert_history: tool({
    description:
      "Alerts LANscape raised, newest first: slow speeds, high ping or packet loss (kind \"problem\", then \"resolved\"), and device alerts like a new device joining or a watched device going offline (kind \"device\").",
    input: z.object({ range, limit: limit(200, 50) }),
    run: async ({ range, limit }) =>
      (await prisma.notification.findMany({ where: { createdAt: { gte: since(range)! } }, orderBy: { createdAt: "desc" }, take: limit })).map((alert) => ({
        at: alert.createdAt,
        kind: alert.kind,
        message: alert.message,
      })),
  }),
};

export const toolList = Object.entries(TOOLS).map(([name, { description, input }]) => {
  const { $schema: _, ...inputSchema } = z.toJSONSchema(input, { io: "input" });
  return { name, description, inputSchema, annotations: { readOnlyHint: true, openWorldHint: false } };
});

export const INSTRUCTIONS =
  "LANscape monitors one home network: internet speed tests, ping checks to the router and an internet host, and devices on the LAN. All tools are read-only. Times are UTC. Report what the data shows; a slow test or lost pings alone don't say whether the cause is the ISP, the router or Wi-Fi.";

const rpcMessage = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});

type RpcId = string | number | null;
const reply = (id: RpcId, result: unknown) => ({ jsonrpc: "2.0", id, result });
const failure = (id: RpcId, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

export const hasTool = (name: string) => Object.hasOwn(TOOLS, name);

// Runs one tool and logs it; bad arguments and failures come back as errors the caller can read and retry on
export const callTool = async (name: string, args: unknown, from: string) => {
  let result: { text: string; isError: boolean };
  try {
    const definition = TOOLS[name];
    if (!definition) throw new Error(`Unknown tool: ${name}`);
    const input = definition.input.safeParse(args ?? {});
    if (!input.success) throw new Error(z.prettifyError(input.error));
    result = { text: JSON.stringify(await definition.run(input.data)), isError: false };
  } catch (error) {
    result = { text: error instanceof Error ? error.message : String(error), isError: true };
  }
  await prisma.mcpCall.create({ data: { tool: name, ok: !result.isError, ip: from } });
  return result;
};

// One JSON-RPC message in, its response out; null for notifications, which get no response
export const handleMcp = async (body: unknown, ip: string) => {
  const parsed = rpcMessage.safeParse(body);
  if (!parsed.success) return failure(null, -32600, "Invalid request");
  const { id, method, params } = parsed.data;
  if (id === undefined) return null;

  switch (method) {
    case "initialize": {
      const requested = params?.protocolVersion;
      return reply(id, {
        protocolVersion: typeof requested === "string" && VERSIONS.includes(requested) ? requested : VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: "lanscape", title: "LANscape", version: process.env.APP_VERSION ?? "dev" },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return reply(id, {});
    case "tools/list":
      return reply(id, { tools: toolList });
    case "tools/call": {
      const name = typeof params?.name === "string" ? params.name : "";
      if (!hasTool(name)) return failure(id, -32602, `Unknown tool: ${name}`);
      const { text, isError } = await callTool(name, params?.arguments, ip);
      return reply(id, { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) });
    }
    default:
      return failure(id, -32601, `Method not found: ${method}`);
  }
};

// Per address, so a looping agent can't keep the database busy
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 120;
const requests = new Map<string, { count: number; resetAt: number }>();

export const withinRateLimit = (ip: string, now = Date.now()) => {
  const entry = requests.get(ip);
  if (!entry || entry.resetAt <= now) {
    requests.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= MAX_REQUESTS;
};
