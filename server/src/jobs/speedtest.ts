import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { prisma } from "../db";
import type { SpeedTest } from "../generated/prisma/client";

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

// Resolves null when the test is cancelled
const measure = () =>
  new Promise<string[] | null>((resolve, reject) => {
    const command = process.env.SPEEDTEST_BIN ?? "speedtest-go";
    // speedtest-go only prints live progress to a terminal, so script(1) gives it one
    const args = process.platform === "darwin" ? ["-q", "/dev/null", command] : ["-qefc", command, "/dev/null"];
    // Its own process group, so stopping it also stops speedtest-go under script
    const child = spawn("script", args, { timeout: TIMEOUT_MS, detached: true });
    let cancelled = false;
    stop = () => {
      cancelled = true;
      if (child.pid) process.kill(-child.pid, "SIGTERM");
    };
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
      if (cancelled) resolve(null);
      else if (code === 0) resolve([...lines, partial.trim()]);
      else reject(new Error(signal ? `speedtest-go was stopped (${signal})` : `speedtest-go exited with code ${code}`));
    });
  });

let running: Promise<SpeedTest | null> | null = null;

// A second request while a test is running joins it instead of starting a competing test
export const runSpeedtest = () => {
  if (running) return running;
  report(IDLE);
  running = measure()
    .then((lines) => lines && prisma.speedTest.create({ data: parseSpeedtestSummary(lines) }))
    .finally(() => {
      running = null;
      report(null);
    });
  return running;
};

export const cancelSpeedtest = () => {
  if (!stop) return false;
  stop();
  return true;
};
