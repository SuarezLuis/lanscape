import { Resolver } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { connect } from "node:net";
import { z } from "zod";
import { prisma } from "../db";
import type { ServiceCheck } from "../generated/prisma/client";
import { durationText } from "../outages";
import { sendAll } from "./channels";

const TIMEOUT_MS = 10_000;
// One failed check can be a blip, as with outages
const FAILS_TO_ALERT = 2;
export const SERVICE_EVERY = [1, 5, 15] as const;

type Probe = { ok: boolean; ms: number | null; detail: string };

const timed = async (run: () => Promise<string>): Promise<Probe> => {
  const start = performance.now();
  try {
    const detail = await run();
    return { ok: true, ms: performance.now() - start, detail };
  } catch (error) {
    return { ok: false, ms: null, detail: error instanceof Error ? error.message : String(error) };
  }
};

// Any answer below 400 is up. Self-signed certificates are normal on a LAN, so they're accepted: this only checks
// that the service answers, and nothing is sent to it
const httpProbe = (url: string) =>
  new Promise<string>((resolve, reject) => {
    const request = (url.startsWith("https:") ? https : http).get(url, { timeout: TIMEOUT_MS, rejectUnauthorized: false }, (response) => {
      response.resume();
      const status = response.statusCode ?? 0;
      if (status < 400) resolve(`HTTP ${status}`);
      else reject(new Error(`HTTP ${status}`));
    });
    request.on("timeout", () => request.destroy(new Error(`No answer in ${TIMEOUT_MS / 1000} s`)));
    request.on("error", reject);
  });

export const splitHostPort = (target: string) => {
  const match = /^(\[[\da-f:]+\]|[^:\s]+):(\d{1,5})$/i.exec(target);
  const port = Number(match?.[2]);
  return match?.[1] && port >= 1 && port <= 65535 ? { host: match[1].replace(/^\[|\]$/g, ""), port } : null;
};

const tcpProbe = (target: string) =>
  new Promise<string>((resolve, reject) => {
    const { host, port } = splitHostPort(target)!;
    const socket = connect({ host, port, timeout: TIMEOUT_MS }, () => {
      socket.destroy();
      resolve(`Port ${port} open`);
    });
    socket.on("timeout", () => socket.destroy(new Error(`No answer in ${TIMEOUT_MS / 1000} s`)));
    socket.on("error", reject);
  });

const dnsProbe = async (server: string, name: string) => {
  const resolver = new Resolver({ timeout: TIMEOUT_MS / 2, tries: 1 });
  resolver.setServers([server]);
  const [address] = await resolver.resolve4(name);
  return `${name} → ${address}`;
};

export const probe = (check: Pick<ServiceCheck, "kind" | "target" | "query">) =>
  timed(() =>
    check.kind === "http" ? httpProbe(check.target) : check.kind === "tcp" ? tcpProbe(check.target) : dnsProbe(check.target, check.query ?? ""),
  );

type State = Pick<ServiceCheck, "failures" | "failingSince" | "alerted" | "alert">;

// "down" once it has failed twice in a row, "up" when a down service answers again
export const advanceService = (state: State, ok: boolean, now: Date) => {
  if (ok) return { failures: 0, failingSince: null, alerted: false, fire: state.alerted ? ("up" as const) : null };
  const failures = state.failures + 1;
  const fire = state.alert && !state.alerted && failures >= FAILS_TO_ALERT ? ("down" as const) : null;
  return { failures, failingSince: state.failingSince ?? now, alerted: state.alerted || fire !== null, fire };
};

const notify = async (kind: "problem" | "resolved", title: string, message: string) => {
  await prisma.notification.create({ data: { kind, value: 0, message } });
  await sendAll({ kind, title, message });
};

// Checks one service now: saves the result, moves its state on, and alerts when it goes down or comes back
export const runServiceCheck = async (check: ServiceCheck, now = new Date()) => {
  const result = await probe(check);
  const next = advanceService(check, result.ok, now);
  await prisma.$transaction([
    prisma.serviceResult.create({ data: { checkId: check.id, at: now, ...result } }),
    prisma.serviceCheck.update({ where: { id: check.id }, data: { failures: next.failures, failingSince: next.failingSince, alerted: next.alerted } }),
  ]);
  if (next.fire === "down") await notify("problem", `${check.name} is down`, `${check.name} isn't answering: ${result.detail}.`);
  if (next.fire === "up" && check.failingSince) {
    const lasted = durationText(now.getTime() - check.failingSince.getTime());
    await notify("resolved", `${check.name} is back`, `${check.name} is answering again after ${lasted} down.`);
  }
  return result;
};

const minuteOfDay = (date: Date) => date.getUTCHours() * 60 + date.getUTCMinutes();

export const runDueServiceChecks = async (now = new Date()) => {
  const checks = await prisma.serviceCheck.findMany({ where: { enabled: true } });
  await Promise.all(checks.filter((check) => minuteOfDay(now) % check.everyMinutes === 0).map((check) => runServiceCheck(check, now)));
};

export const serviceInput = z
  .object({
    id: z.int().optional(),
    name: z.string().trim().min(1, "Give it a name").max(60),
    kind: z.enum(["http", "tcp", "dns"]),
    target: z.string().trim().min(1).max(500),
    query: z.string().trim().max(253).nullish(),
    everyMinutes: z.union(SERVICE_EVERY.map((minutes) => z.literal(minutes))),
    enabled: z.boolean(),
    alert: z.boolean(),
  })
  .superRefine((input, ctx) => {
    const problem = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (input.kind === "http" && !z.url({ protocol: /^https?$/ }).safeParse(input.target).success) {
      problem("target", "Enter a full address, like http://192.168.0.10:8080");
    }
    if (input.kind === "tcp" && !splitHostPort(input.target)) problem("target", "Enter host:port, like 192.168.0.10:22");
    if (input.kind === "dns") {
      if (!z.union([z.ipv4(), z.ipv6()]).safeParse(input.target).success) problem("target", "Enter the DNS server's IP address");
      if (!input.query || !z.hostname().safeParse(input.query).success) problem("query", "Enter a name to look up, like example.com");
    }
  })
  .transform((input) => ({ ...input, query: input.kind === "dns" ? input.query : null }));

const DAY_MS = 86_400_000;

// One result a minute per service is ~43k rows a month each; 90 days is plenty for a home network
export const pruneServiceResults = () => prisma.serviceResult.deleteMany({ where: { at: { lt: new Date(Date.now() - 90 * DAY_MS) } } });

// Each service with its latest result, its last 30 results for the strip, and its last 24 hours
export const listServices = async () => {
  const since = new Date(Date.now() - DAY_MS);
  const checks = await prisma.serviceCheck.findMany({ orderBy: { name: "asc" } });
  return Promise.all(
    checks.map(async (check) => {
      const [recent, total, up, avg] = await Promise.all([
        prisma.serviceResult.findMany({ where: { checkId: check.id }, orderBy: { at: "desc" }, take: 30, select: { at: true, ok: true, ms: true, detail: true } }),
        prisma.serviceResult.count({ where: { checkId: check.id, at: { gte: since } } }),
        prisma.serviceResult.count({ where: { checkId: check.id, at: { gte: since }, ok: true } }),
        prisma.serviceResult.aggregate({ where: { checkId: check.id, at: { gte: since }, ok: true }, _avg: { ms: true } }),
      ]);
      const status = !recent[0] ? "waiting" : check.failures >= FAILS_TO_ALERT ? "down" : recent[0].ok ? "up" : "failing";
      return { ...check, status, last: recent[0] ?? null, recent: recent.toReversed(), uptime24h: total ? (100 * up) / total : null, avgMs24h: avg._avg.ms };
    }),
  );
};
