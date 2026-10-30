import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { prisma } from "../db";
import type { SpeedTest } from "../generated/prisma/client";
import { checkRules, testValues } from "./notify";
import { pingTargets } from "./ping";

const TIMEOUT_MS = 120_000;
const ANSI_ESCAPE = /\x1b\[[0-9;?]*[A-Za-z]/g;
const MS_PER_UNIT: Record<string, number> = { ns: 1e-6, "µs": 1e-3, us: 1e-3, ms: 1, s: 1000 };

export type SpeedtestProgress = {
  phase: "connecting" | "ping" | "download" | "upload";
  pingMs: number | null;
  downloadMbps: number | null;
  uploadMbps: number | null;
};

const parseDurationMs = (text: string) => {
  const match = /^([\d.]+)(ns|µs|us|ms|s)$/.exec(text);
  if (!match?.[1] || !match[2]) throw new Error(`Unexpected duration "${text}" from speedtest-go`);
  return Number(match[1]) * (MS_PER_UNIT[match[2]] ?? Number.NaN);
};

// Live lines start with a spinner frame, finished ones with ✓; both carry the latest value
export const applyProgressLine = (progress: SpeedtestProgress, line: string): SpeedtestProgress => {
  const latency = /^\S+ Latency: (\S+)/.exec(line);
  if (latency?.[1]) {
    return { ...progress, phase: "ping", pingMs: latency[1] === "--" ? null : parseDurationMs(latency[1]) };
  }
  const transfer = /^\S+ (Download|Upload)(?:: ([\d.]+) Mbps)?/.exec(line);
  if (transfer?.[1]) {
    const mbps = transfer[2] ? Number(transfer[2]) : null;
    return transfer[1] === "Download"
      ? { ...progress, phase: "download", downloadMbps: mbps ?? progress.downloadMbps }
      : { ...progress, phase: "upload", uploadMbps: mbps ?? progress.uploadMbps };
  }
  return progress;
};

const required = (text: string, pattern: RegExp, what: string) => {
  const match = pattern.exec(text);
  if (!match) throw new Error(`speedtest-go output had no ${what}`);
  return match;
};

export const parseSpeedtestSummary = (lines: string[]) => {
  const text = lines.join("\n");
  const [, serverId = "", distance = "", serverName = "", serverSponsor = ""] = required(
    text,
    /^✓ Test Server: \[(\d+)\] ([\d.]+)km (.+) \([^)]*\) by (.+)$/m,
    "test server",
  );
  const [, ping = "", jitter = ""] = required(text, /^✓ Latency: (\S+) Jitter: (\S+)/m, "latency");
  const [, download = ""] = required(text, /^✓ Download: ([\d.]+) Mbps/m, "download result");
  const [, upload = ""] = required(text, /^✓ Upload: ([\d.]+) Mbps/m, "upload result");

  return {
    downloadMbps: Number(download),
    uploadMbps: Number(upload),
    pingMs: parseDurationMs(ping),
    jitterMs: parseDurationMs(jitter),
    serverId,
    serverName,
    serverSponsor,
    serverDistanceKm: Number(distance),
  };
};

const IDLE: SpeedtestProgress = { phase: "connecting", pingMs: null, downloadMbps: null, uploadMbps: null };

export const speedtestEvents = new EventEmitter<{ progress: [SpeedtestProgress | null] }>();
let progress: SpeedtestProgress | null = null;
export const currentProgress = () => progress;

const report = (next: SpeedtestProgress | null) => {
  if (next === progress) return;
  progress = next;
  speedtestEvents.emit("progress", next);
};

let stop: (() => void) | null = null;

// Linux only; elsewhere there is no /proc and only script's own group is killed
const childPids = (pid: number) => {
  try {
    return readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8").split(" ").filter(Boolean).map(Number);
  } catch {
    return [];
  }
};

// Resolves null when the test is cancelled
const measure = (serverId: string | null) =>
  new Promise<string[] | null>((resolve, reject) => {
    // serverId is digits only (checked when saved), so it's safe inside script's command string
    const command = [process.env.SPEEDTEST_BIN ?? "speedtest-go", ...(serverId ? ["--server", serverId] : [])].join(" ");
    // speedtest-go only prints live progress to a terminal, so script(1) gives it one
    const args =
      process.platform === "darwin" ? ["-q", "/dev/null", ...command.split(" ")] : ["-qefc", command, "/dev/null"];
    const child = spawn("script", args, { detached: true });
    let ended: "cancelled" | "timed out" | null = null;
    // script(1) runs the command in a session of its own, so killing script's group alone orphans speedtest-go
    const kill = (reason: NonNullable<typeof ended>) => {
      ended = reason;
      if (!child.pid) return;
      for (const pid of [...childPids(child.pid), child.pid]) {
        try {
          process.kill(-pid, "SIGTERM");
        } catch {
          // Already gone
        }
      }
    };
    stop = () => kill("cancelled");
    const timer = setTimeout(() => kill("timed out"), TIMEOUT_MS);
    const lines: string[] = [];
    let partial = "";

    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      const parts = (partial + chunk).replace(ANSI_ESCAPE, "").split(/[\r\n]/);
      partial = parts.pop() ?? "";
      for (const line of parts.map((part) => part.trim()).filter(Boolean)) {
        lines.push(line);
        report(applyProgressLine(progress ?? IDLE, line));
      }
    });
    child.on("error", reject);
    // The output includes the public IP, so errors never quote it
    child.on("close", (code, signal) => {
      stop = null;
      clearTimeout(timer);
      if (ended === "cancelled") resolve(null);
      else if (ended) reject(new Error(`speedtest-go ${ended}`));
      else if (code === 0) resolve([...lines, partial.trim()]);
      else reject(new Error(signal ? `speedtest-go was stopped (${signal})` : `speedtest-go exited with code ${code}`));
    });
  });

export type Trigger = "manual" | "automation";

let running: Promise<SpeedTest | null> | null = null;
let cancelRequested = false;
export const speedtestRunning = () => running !== null;

const avgFor = (pings: { target: string; avgMs: number | null }[], target: string) =>
  pings.find((ping) => ping.target === target)?.avgMs ?? null;

// A second request while a test is running joins it, keeping the first trigger, instead of starting a competing test
export const runSpeedtest = (trigger: Trigger) => {
  if (running) return running;
  cancelRequested = false;
  report(IDLE);
  running = (async () => {
    // Before the test, so they show unloaded latency; a failed ping shouldn't cost the whole test
    const pings = await pingTargets().catch(() => []);
    if (cancelRequested) return null;
    const lines = await measure(await chosenServer());
    if (!lines) return null;
    const test = await prisma.speedTest.create({
      data: {
        ...parseSpeedtestSummary(lines),
        trigger,
        routerPingMs: avgFor(pings, "router"),
        internetPingMs: avgFor(pings, "internet"),
      },
    });
    await checkRules(testValues(test)).catch((error: unknown) => {
      console.error("Checking notification rules failed:", error instanceof Error ? error.message : error);
    });
    return test;
  })().finally(() => {
    running = null;
    report(null);
  });
  return running;
};

// Works in the pre-test ping phase too, before speedtest-go has started
export const cancelSpeedtest = () => {
  if (!running) return false;
  cancelRequested = true;
  stop?.();
  return true;
};

export const SERVER_SETTING = "speedtest.server";

const chosenServer = async () => {
  const value = (await prisma.setting.findUnique({ where: { key: SERVER_SETTING } }))?.value;
  return value && /^\d+$/.test(value) ? value : null;
};

// "[ 5342]     23.71km 30ms \tGeorgetown, TX (United States) by Optimum Online"; the ISP line above them holds the
// public IP and location, which is never kept
export const parseServerList = (stdout: string) =>
  stdout
    .split("\n")
    .map((line) => /^\[\s*(\d+)\]\s+([\d.]+)km\s+(?:(\d+)ms|-)\s+(.+?) \(([^)]*)\) by (.+?)\s*$/.exec(line.trim()))
    .filter((match) => match !== null)
    .map(([, id = "", km = "", latency, name = "", country = "", sponsor = ""]) => ({
      id,
      name,
      country,
      sponsor,
      distanceKm: Number(km),
      latencyMs: latency ? Number(latency) : null,
    }));

let servers: { at: number; list: ReturnType<typeof parseServerList> } | null = null;

// Cached for an hour: listing pings every candidate server
export const listServers = async () => {
  if (servers && Date.now() - servers.at < 60 * 60 * 1000) return servers.list;
  const { stdout } = await promisify(execFile)(process.env.SPEEDTEST_BIN ?? "speedtest-go", ["--list"], { timeout: 60_000 });
  servers = { at: Date.now(), list: parseServerList(stdout) };
  return servers.list;
};
