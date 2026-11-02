import { describe, expect, test } from "vitest";
import { prisma } from "./db";
import { alertIfOutageEnded, durationText, findOutages, listOutages, OUTAGE_ALERTS, outageAlert } from "./outages";

// One check a minute from 10:00; "x" lost every packet, "." answered, " " no check that minute
const checks = (internet: string, router = "") =>
  [...internet].flatMap((mark, minute) => {
    const createdAt = new Date(Date.UTC(2026, 10, 2, 10, minute));
    const routerMark = router[minute];
    return [
      ...(routerMark && routerMark !== " " ? [{ createdAt, target: "router", received: routerMark === "x" ? 0 : 5 }] : []),
      ...(mark !== " " ? [{ createdAt, target: "internet", received: mark === "x" ? 0 : 5 }] : []),
    ];
  });
const at = (minute: number) => new Date(Date.UTC(2026, 10, 2, 10, minute));

test("two or more lost checks in a row are an outage, ended by the next answer", () => {
  expect(findOutages(checks("..x..xxx..", "..........")), "one lost check is a blip").toEqual([
    { start: at(5), end: at(8), failedChecks: 3, cause: "internet" },
  ]);
});

test("the router going quiet too puts the problem inside the home network", () => {
  expect(findOutages(checks(".xxx.", ".xx..")).map((outage) => outage.cause)).toEqual(["home"]);
  expect(findOutages(checks(".xxx.")).map((outage) => outage.cause)).toEqual(["unknown"]);
});

test("an outage still going has no end, unless the checks stopped long ago", () => {
  expect(findOutages(checks("..xxx"), at(5))).toMatchObject([{ start: at(2), end: null }]);
  expect(findOutages(checks("..xxx"), at(60))).toMatchObject([{ start: at(2), end: at(4) }]);
});

test("a long gap between checks splits what's known", () => {
  const samples = [...checks("xx"), ...checks("x.").map((sample) => ({ ...sample, createdAt: new Date(sample.createdAt.getTime() + 30 * 60_000) }))];
  expect(findOutages(samples).map(({ start, end }) => [start, end])).toEqual([[at(0), at(1)]]);
});

test("the alert says how long, and where the problem was", () => {
  expect(durationText(90 * 60_000)).toBe("1 hour 30 min");
  expect(outageAlert({ start: at(0), end: at(7), failedChecks: 7, cause: "internet" }).message).toBe(
    "The internet was down for 7 minutes and is back now. Your router answered the whole time, so the problem was past it: your internet provider or beyond.",
  );
});

describe("with the database", () => {
  const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);
  const save = (marks: string, startMinutesAgo: number, target = "internet") =>
    prisma.pingSample.createMany({
      data: [...marks].map((mark, i) => ({
        createdAt: minutesAgo(startMinutesAgo - i),
        target,
        host: target === "internet" ? "1.1.1.1" : "192.168.0.1",
        sent: 5,
        received: mark === "x" ? 0 : 5,
        avgMs: mark === "x" ? null : 10,
      })),
    });

  test("lists outages from recent checks and saved older ones, newest first", async () => {
    await save("..xxx..", 30);
    await save(".......", 30, "router");
    await prisma.outage.create({ data: { start: new Date(Date.now() - 200 * 86_400_000), end: new Date(Date.now() - 200 * 86_400_000 + 600_000), failedChecks: 10, cause: "home" } });

    const week = await listOutages("week");
    expect(week).toHaveLength(1);
    expect(week[0]).toMatchObject({ failedChecks: 3, cause: "internet" });
    expect((await listOutages("year")).map((outage) => outage.cause)).toEqual(["internet", "home"]);
  });

  test("alerts once when the internet comes back, and not when switched off", async () => {
    await save("..xxx.", 10);
    await alertIfOutageEnded();
    await alertIfOutageEnded();
    expect(await prisma.notification.findMany({ select: { kind: true, message: true } })).toEqual([
      { kind: "outage", message: expect.stringContaining("down for 3 minutes") },
    ]);

    await prisma.notification.deleteMany();
    await prisma.setting.create({ data: { key: OUTAGE_ALERTS, value: "off" } });
    await save("xx.", 3);
    await alertIfOutageEnded();
    expect(await prisma.notification.count()).toBe(0);
  });
});
