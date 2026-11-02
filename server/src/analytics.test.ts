import { expect, test } from "vitest";
import { comparePeriods, networkEvents, weeklyPattern } from "./analytics";
import { prisma } from "./db";
import { latencyHistory } from "./latency";

const now = new Date();
const daysAgo = (days: number, minutes = 0) => new Date(now.getTime() - days * 86_400_000 + minutes * 60_000);
const ping = (at: Date, received: number) => ({ createdAt: at, target: "internet", host: "1.1.1.1", sent: 5, received, avgMs: received ? 12 : null });

test("compares this week with the week before", async () => {
  await prisma.speedTest.createMany({
    data: [
      { createdAt: daysAgo(2), downloadMbps: 300, uploadMbps: 400, pingMs: 20, jitterMs: 2, serverId: "1", serverName: "A", serverSponsor: "A", serverDistanceKm: 5 },
      { createdAt: daysAgo(9), downloadMbps: 600, uploadMbps: 800, pingMs: 10, jitterMs: 1, serverId: "1", serverName: "A", serverSponsor: "A", serverDistanceKm: 5 },
    ],
  });
  // A 3-minute outage this week, none the week before
  await prisma.pingSample.createMany({ data: [ping(daysAgo(3), 5), ping(daysAgo(3, 1), 0), ping(daysAgo(3, 2), 0), ping(daysAgo(3, 3), 0), ping(daysAgo(3, 4), 5), ping(daysAgo(10), 5)] });
  await prisma.device.create({ data: { mac: "aa:aa:aa:aa:aa:01", ip: "192.168.0.9", firstSeen: daysAgo(1), lastSeen: now } });

  const { current, previous } = await comparePeriods("week", now);
  expect(current).toMatchObject({ speedTests: { count: 1, downloadMbps: 300 }, outages: { count: 1, minutes: 3, pastRouter: 0 }, newDevices: 1 });
  expect(current.internetPing?.packetLossPercent).toBe(60);
  expect(previous).toMatchObject({ speedTests: { count: 1, downloadMbps: 600 }, outages: { count: 0 }, newDevices: 0, internetPing: { packetLossPercent: 0 } });
});

test("lists every device's comings and goings by name, newest first", async () => {
  await prisma.device.create({
    data: { mac: "aa:aa:aa:aa:aa:02", ip: "192.168.0.10", name: "Tablet", lastSeen: now, events: { create: [{ at: daysAgo(0, -60), online: false }, { at: daysAgo(0, -30), online: true }] } },
  });
  expect(await networkEvents(daysAgo(1), 10)).toMatchObject([
    { device: "Tablet", online: true },
    { device: "Tablet", online: false },
  ]);
});

test("latency buckets carry packet loss", async () => {
  await prisma.pingSample.createMany({ data: [ping(daysAgo(0, -10), 5), ping(daysAgo(0, -10), 0)] });
  const points = await latencyHistory("day");
  expect(points.at(-1)).toMatchObject({ internetLossPercent: 50, routerLossPercent: null });
});

test("weekly pattern groups by local weekday and hour", async () => {
  // Monday 2026-11-02 at 15:30 UTC is 09:30 in UTC-6
  await prisma.speedTest.create({
    data: { createdAt: new Date("2026-11-02T15:30:00Z"), downloadMbps: 500, uploadMbps: 700, pingMs: 10, jitterMs: 1, serverId: "1", serverName: "A", serverSponsor: "A", serverDistanceKm: 5 },
  });
  await prisma.pingSample.createMany({ data: [ping(new Date(Date.now() - 3_600_000), 5), ping(new Date(Date.now() - 3_600_000), 5)] });
  const pattern = await weeklyPattern(-360);
  expect(pattern.download).toEqual([{ day: 1, hour: 9, value: 500, count: 1 }]);
  expect(pattern.upload[0]?.value).toBe(700);
  expect(pattern.ping.reduce((sum, cell) => sum + cell.count, 0)).toBe(2);
});
