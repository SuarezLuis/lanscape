import { expect, test } from "vitest";
import { applyProgressLine, parseServerList, parseSpeedtestSummary, type SpeedtestProgress } from "./speedtest";

// Lines as speedtest-go v1.8.3 prints them to a terminal, after ANSI codes are stripped
const realRun = [
  "⠋ Retrieving Servers",
  "✓ Found 20 Public Servers",
  "✓ Test Server: [74383] 68.89km San Marcos, TX (United States) by Brightspeed",
  "⠴ Latency: --",
  "⠼ Latency: 18.634528ms",
  "✓ Latency: 16.731298ms Jitter: 1.020288ms Min: 15.951544ms Max: 19.397601ms",
  "✓ Packet Loss Analyzer: Running in background (<= 30 Secs)",
  "⠴ Download",
  "⠏ Download: 350.17 Mbps (Latency: --)",
  "✓ Download: 677.26 Mbps (Used: 1003.50MB) (Latency: 35ms Jitter: 58ms Min: 15ms Max: 120ms)",
  "⠦ Upload: 0.00 Mbps (Latency: 20ms)",
  "⠼ Upload: 294.93 Mbps (Latency: 28ms)",
  "✓ Upload: 881.74 Mbps (Used: 1134.42MB Confirmed: 99.4%) (Latency: 27ms Jitter: 9ms Min: 11ms Max: 60ms)",
  "✓ Packet Loss: 0.00% (Sent: 328/Dup: 0/Max: 327)",
];

test("parses the final summary", () => {
  expect(parseSpeedtestSummary(realRun)).toEqual({
    downloadMbps: 677.26,
    uploadMbps: 881.74,
    pingMs: 16.731298,
    jitterMs: 1.020288,
    serverId: "74383",
    serverName: "San Marcos, TX",
    serverSponsor: "Brightspeed",
    serverDistanceKm: 68.89,
  });
});

test("rejects output missing a result", () => {
  expect(() => parseSpeedtestSummary(realRun.filter((line) => !line.startsWith("✓ Upload")))).toThrow(
    "no upload result",
  );
});

test("tracks phase and the latest value of each measurement", () => {
  const start: SpeedtestProgress = { phase: "connecting", pingMs: null, downloadMbps: null, uploadMbps: null };
  const seen = realRun.map((_, i) => realRun.slice(0, i + 1).reduce(applyProgressLine, start));

  expect(seen[1]).toEqual(start);
  expect(seen[4]).toMatchObject({ phase: "ping", pingMs: 18.634528 });
  expect(seen[7]).toMatchObject({ phase: "download", pingMs: 16.731298, downloadMbps: null });
  expect(seen[8]).toMatchObject({ phase: "download", downloadMbps: 350.17 });
  expect(seen[11]).toEqual({ phase: "upload", pingMs: 16.731298, downloadMbps: 677.26, uploadMbps: 294.93 });
});

test("lists servers and skips the line with the public IP", () => {
  const stdout = [
    "    speedtest-go v1.8.3 (git-df849ca) @showwin",
    "",
    "ISP: 192.0.2.1 (Example ISP) [30.0, -97.0] ",
    "Found 20 Public Servers",
    "[ 5342]     23.71km 30ms \tGeorgetown, TX (United States) by Optimum Online ",
    "[72771]     24.12km -    \tAustin, TX (United States) by Fiberfirst ",
  ].join("\n");
  expect(parseServerList(stdout)).toEqual([
    { id: "5342", name: "Georgetown, TX", country: "United States", sponsor: "Optimum Online", distanceKm: 23.71, latencyMs: 30 },
    { id: "72771", name: "Austin, TX", country: "United States", sponsor: "Fiberfirst", distanceKm: 24.12, latencyMs: null },
  ]);
});
