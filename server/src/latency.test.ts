import { expect, test } from "vitest";
import { prisma } from "./db";
import { latencyHistory } from "./latency";

test("an hour of minute checks charts as a point a minute, with tests and pings in shared buckets", async () => {
  const start = Date.now() - 60 * 60_000;
  await prisma.pingSample.createMany({
    data: Array.from({ length: 60 }, (_, minute) => [
      { createdAt: new Date(start + minute * 60_000), target: "internet", host: "1.1.1.1", sent: 5, received: 5, avgMs: 10 + (minute % 2) },
      { createdAt: new Date(start + minute * 60_000), target: "router", host: "192.168.0.1", sent: 5, received: 5, avgMs: 1 },
    ]).flat(),
  });
  await prisma.speedTest.create({
    data: { createdAt: new Date(start + 30 * 60_000), downloadMbps: 600, uploadMbps: 800, pingMs: 15, jitterMs: 2, serverId: "1", serverName: "Test", serverSponsor: "Test", serverDistanceKm: 5 },
  });

  const points = await latencyHistory("day");
  expect(points).toHaveLength(60);
  expect(points[0]).toMatchObject({ internetMs: 10, routerMs: 1, testPingMs: null });
  expect(points[30]).toMatchObject({ internetMs: 10, testPingMs: 15, testJitterMs: 2 });
});
