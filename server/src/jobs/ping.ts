import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { prisma } from "../db";
import { checkRules, pingValues } from "./notify";
import type { Trigger } from "./speedtest";

const execFileAsync = promisify(execFile);

const COUNT = 5;
export const DEFAULT_INTERNET_HOST = "1.1.1.1";
// -W is seconds on Linux, milliseconds on macOS
const ARGS = ["-c", String(COUNT), "-i", "0.2", "-W", process.platform === "darwin" ? "1000" : "1"];

// The default route with the lowest metric; /proc/net/route stores IPv4 addresses as little-endian hex
export const defaultRoute = (routes: string) => {
  const defaults = routes
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((fields) => fields[1] === "00000000" && fields[2] && fields[2] !== "00000000")
    .toSorted((a, b) => Number(a[6]) - Number(b[6]));
  const [iface, , hex] = defaults[0] ?? [];
  if (!iface || !hex) return null;
  return { iface, gateway: (hex.match(/../g) ?? []).reverse().map((byte) => parseInt(byte, 16)).join(".") };
};

// Linux and macOS summaries; jitter is ping's mdev/stddev, the spread of round-trip times
export const parsePingOutput = (stdout: string) => {
  const counts = /(\d+) packets transmitted, (\d+) (?:packets )?received/.exec(stdout);
  if (!counts) throw new Error("ping printed no summary");
  const rtt = /= [\d.]+\/([\d.]+)\/[\d.]+\/([\d.]+) ms/.exec(stdout);
  return {
    sent: Number(counts[1]),
    received: Number(counts[2]),
    avgMs: rtt ? Number(rtt[1]) : null,
    jitterMs: rtt ? Number(rtt[2]) : null,
  };
};

const ping = async (host: string) => {
  try {
    const { stdout } = await execFileAsync("ping", [...ARGS, host], { timeout: 15_000 });
    return parsePingOutput(stdout);
  } catch (error) {
    // ping exits non-zero when replies are lost but still prints its summary
    const stdout = (error as { stdout?: string }).stdout;
    if (stdout) return parsePingOutput(stdout);
    throw error;
  }
};

export const findDefaultRoute = () => readFile("/proc/net/route", "utf8").then(defaultRoute, () => null);
export const findGateway = async () => (await findDefaultRoute())?.gateway ?? null;

// The host set on the ping check automation, so full tests and ping checks measure the same thing
export const internetHost = async () =>
  (await prisma.automation.findUnique({ where: { job: "ping" } }))?.target ?? DEFAULT_INTERNET_HOST;

export const pingTargets = async () => {
  const [router, internet] = await Promise.all([findGateway(), internetHost()]);
  const targets = [...(router ? [{ target: "router", host: router }] : []), { target: "internet", host: internet }];
  return Promise.all(targets.map(async (t) => ({ ...t, ...(await ping(t.host)) })));
};

export const runPingCheck = async (trigger: Trigger) => {
  const samples = await pingTargets();
  await prisma.pingSample.createMany({ data: samples.map((sample) => ({ ...sample, trigger })) });
  await checkRules(pingValues(samples));
  return samples;
};
