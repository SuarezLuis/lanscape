import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { prisma } from "../db";
import type { SpeedTest } from "../generated/prisma/client";

const execFileAsync = promisify(execFile);

const BYTES_PER_SECOND_PER_MBPS = 125_000;
const NANOSECONDS_PER_MS = 1_000_000;
const TIMEOUT_MS = 120_000;

const outputSchema = z.object({
  servers: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      sponsor: z.string(),
      distance: z.number(),
      latency: z.number(),
      jitter: z.number(),
      dl_speed: z.number(),
      ul_speed: z.number(),
    }),
  ),
});

export const parseSpeedtestOutput = (stdout: string) => {
  const server = outputSchema.parse(JSON.parse(stdout)).servers[0];
  if (!server) throw new Error("speedtest-go returned no server results");

  return {
    downloadMbps: server.dl_speed / BYTES_PER_SECOND_PER_MBPS,
    uploadMbps: server.ul_speed / BYTES_PER_SECOND_PER_MBPS,
    pingMs: server.latency / NANOSECONDS_PER_MS,
    jitterMs: server.jitter / NANOSECONDS_PER_MS,
    serverId: server.id,
    serverName: server.name,
    serverSponsor: server.sponsor,
    serverDistanceKm: server.distance,
  };
};

const measure = async () => {
  const { stdout } = await execFileAsync(process.env.SPEEDTEST_BIN ?? "speedtest-go", ["--json"], {
    timeout: TIMEOUT_MS,
  });
  return parseSpeedtestOutput(stdout);
};

let running: Promise<SpeedTest> | null = null;

// A second request while a test is running joins it instead of starting a competing test
export const runSpeedtest = () => {
  running ??= measure()
    .then((result) => prisma.speedTest.create({ data: result }))
    .finally(() => {
      running = null;
    });
  return running;
};
