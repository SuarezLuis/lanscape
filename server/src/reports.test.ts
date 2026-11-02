import { expect, test } from "vitest";
import { savePlan } from "./analytics";
import { prisma } from "./db";
import { ispReport, reportDue, sendWeeklyReport, weeklyReport } from "./reports";

const now = new Date("2026-11-02T14:00:00Z");
const ago = (days: number, minutes = 0) => new Date(now.getTime() - days * 86_400_000 + minutes * 60_000);
const test_ = (at: Date, downloadMbps: number) => ({ createdAt: at, downloadMbps, uploadMbps: 800, pingMs: 10, jitterMs: 1, serverId: "1", serverName: "A", serverSponsor: "A", serverDistanceKm: 5 });
const check = (at: Date, target: string, received: number) => ({ createdAt: at, target, host: "h", sent: 5, received, avgMs: received ? 10 : null, jitterMs: received ? 1 : null });

const seed = async () => {
  await prisma.speedTest.createMany({ data: [test_(ago(2), 450), test_(ago(9), 600)] });
  // A 3-minute outage two days ago with the router answering
  await prisma.pingSample.createMany({
    data: [0, 1, 2, 3, 4].flatMap((minute) => [check(ago(2, minute), "internet", minute >= 1 && minute <= 3 ? 0 : 5), check(ago(2, minute), "router", 5)]),
  });
};

test("the weekly report compares this week with last", async () => {
  await seed();
  const { title, message } = await weeklyReport("America/Chicago", now);
  expect(title).toBe("Your network, Oct 26 – Nov 2");
  expect(message).toContain("Speed: 450 down / 800 up Mbps on average (−25% vs last week), 1 test");
  expect(message).toContain("Outages: 1, 3 min in total (1 past your router, 0 in your home network); last week 0");
});

test("sending it records it with the alerts", async () => {
  await sendWeeklyReport(now);
  expect(await prisma.notification.findMany({ select: { kind: true } })).toEqual([{ kind: "report" }]);
});

test("it's due at the chosen local weekday and hour only", () => {
  const settings = { enabled: true, weekday: 1, hour: 8, timeZone: "America/Chicago" };
  // Monday 8:00 in Chicago (CST, UTC−6) is 14:00 UTC
  expect(reportDue(settings, new Date("2026-11-02T14:00:20Z"))).toBe(true);
  expect(reportDue(settings, new Date("2026-11-02T14:01:00Z"))).toBe(false);
  expect(reportDue(settings, new Date("2026-11-03T14:00:00Z"))).toBe(false);
  expect(reportDue({ ...settings, enabled: false }, new Date("2026-11-02T14:00:00Z"))).toBe(false);
});

test("the ISP report lists speeds against the plan and outages past the router", async () => {
  await seed();
  await savePlan({ downloadMbps: 600, uploadMbps: 800 });
  const report = await ispReport(now);
  expect(report).toContain("Plan: 600 Mbps down / 800 Mbps up");
  expect(report).toContain("1 of 2 tests under 80% of plan");
  expect(report).toMatch(/- 2026-10-31 14:01 UTC, 3 min/);
});
