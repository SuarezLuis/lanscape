import { expect, test } from "vitest";
import { prisma } from "../db";
import { listOutages } from "../outages";
import { RAW_PING_DAYS, rollUpOldPings } from "./retention";

test("rolls checks past 90 days into hourly rows, saving their outages first", async () => {
  const now = new Date("2026-11-02T12:00:00Z");
  const old = new Date(now.getTime() - (RAW_PING_DAYS + 1) * 86_400_000);
  // An hour of checks, a minute apart, with a 3-minute outage at 00:10 that the hourly average would hide
  await prisma.pingSample.createMany({
    data: Array.from({ length: 60 }, (_, minute) => {
      const down = minute >= 10 && minute < 13;
      return [
        { createdAt: new Date(old.getTime() + minute * 60_000), target: "internet", host: "1.1.1.1", sent: 5, received: down ? 0 : 5, avgMs: down ? null : 12 },
        { createdAt: new Date(old.getTime() + minute * 60_000), target: "router", host: "192.168.0.1", sent: 5, received: 5, avgMs: 1 },
      ];
    }).flat(),
  });

  const { inserted, deleted } = await rollUpOldPings(now);
  expect({ inserted, deleted }).toEqual({ inserted: 2, deleted: 120 });
  expect(await prisma.pingSample.findMany({ where: { target: "internet" }, select: { sent: true, received: true, trigger: true } })).toEqual([
    { sent: 300, received: 285, trigger: "rollup" },
  ]);
  expect(await prisma.outage.findMany({ select: { failedChecks: true, cause: true } })).toEqual([{ failedChecks: 3, cause: "internet" }]);

  // Running again saves nothing twice
  await rollUpOldPings(now);
  expect(await prisma.outage.count()).toBe(1);
  expect(await listOutages("year")).toHaveLength(1);
});
