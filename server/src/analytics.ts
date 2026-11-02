import { z } from "zod";
import { prisma } from "./db";
import { outagesBetween } from "./outages";

const round = (value: number | null | undefined, digits = 1) => (value == null ? null : Math.round(value * 10 ** digits) / 10 ** digits);

// What one stretch of time looked like, in numbers that compare across periods
export const periodSummary = async (from: Date, to: Date) => {
  const at = { gte: from, lt: to };
  const [tests, pings, outages, newDevices, alerts] = await Promise.all([
    prisma.speedTest.aggregate({ where: { createdAt: at }, _avg: { downloadMbps: true, uploadMbps: true, pingMs: true, jitterMs: true }, _count: true }),
    prisma.pingSample.groupBy({ by: ["target"], where: { createdAt: at }, _avg: { avgMs: true }, _sum: { sent: true, received: true } }),
    outagesBetween(from, to),
    prisma.device.count({ where: { firstSeen: at } }),
    prisma.notification.groupBy({ by: ["kind"], where: { createdAt: at }, _count: true }),
  ]);
  const ping = (target: string) => {
    const row = pings.find((entry) => entry.target === target);
    const sent = row?._sum.sent ?? 0;
    return row ? { averageMs: round(row._avg.avgMs), packetLossPercent: sent ? round((100 * (sent - (row._sum.received ?? 0))) / sent, 2) : null } : null;
  };
  return {
    from,
    to,
    speedTests: { count: tests._count, downloadMbps: round(tests._avg.downloadMbps, 0), uploadMbps: round(tests._avg.uploadMbps, 0), pingMs: round(tests._avg.pingMs), jitterMs: round(tests._avg.jitterMs) },
    internetPing: ping("internet"),
    routerPing: ping("router"),
    outages: {
      count: outages.length,
      minutes: round(outages.reduce((sum, outage) => sum + ((outage.end ?? to).getTime() - outage.start.getTime()) / 60_000, 0)),
      pastRouter: outages.filter((outage) => outage.cause === "internet").length,
      homeNetwork: outages.filter((outage) => outage.cause === "home").length,
    },
    newDevices,
    alerts: Object.fromEntries(alerts.map((row) => [row.kind, row._count])),
  };
};

export const PERIOD_DAYS = { day: 1, week: 7, month: 30 } as const;

// This period against the one just before it, e.g. the last 7 days against the 7 before those
export const comparePeriods = async (period: keyof typeof PERIOD_DAYS, now = new Date()) => {
  const length = PERIOD_DAYS[period] * 86_400_000;
  const start = new Date(now.getTime() - length);
  const [current, previous] = await Promise.all([periodSummary(start, now), periodSummary(new Date(start.getTime() - length), start)]);
  return { current, previous };
};

// Every device's online and offline changes, newest first, with the name the owner sees
export const networkEvents = async (from: Date, limit: number) =>
  (
    await prisma.deviceEvent.findMany({
      where: { at: { gte: from } },
      orderBy: { at: "desc" },
      take: limit,
      include: { device: { select: { name: true, hostname: true, vendor: true, ip: true, known: true } } },
    })
  ).map((event) => ({
    at: event.at,
    online: event.online,
    mac: event.mac,
    device: event.device.name ?? event.device.hostname ?? event.device.vendor ?? event.device.ip,
    ip: event.device.ip,
    known: event.device.known,
  }));

export const PLAN_SETTING = "speedtest.plan";
export const planInput = z.object({ downloadMbps: z.number().positive().max(100_000).nullable(), uploadMbps: z.number().positive().max(100_000).nullable() });

export const readPlan = async () => {
  const row = await prisma.setting.findUnique({ where: { key: PLAN_SETTING } });
  return row ? planInput.parse(JSON.parse(row.value)) : { downloadMbps: null, uploadMbps: null };
};

export const savePlan = (plan: z.output<typeof planInput>) => {
  const value = JSON.stringify(plan);
  return prisma.setting.upsert({ where: { key: PLAN_SETTING }, create: { key: PLAN_SETTING, value }, update: { value } });
};

type Cell = { day: number; hour: number; value: number; count: number };

/**
 * Averages by weekday (0 = Sunday) and hour, in the viewer's time zone. Speed tests over the last year (a few a day at
 * most), internet ping over the last 30 days of ping checks.
 * ponytail: one UTC offset for the whole span, so across a DST change half the cells are an hour off; per-row time
 * zones if that ever matters.
 */
export const weeklyPattern = async (offsetMinutes: number) => {
  const shift = `${offsetMinutes} minutes`;
  const sqlDate = (date: Date) => date.toISOString().replace("Z", "+00:00");
  const year = sqlDate(new Date(Date.now() - 365 * 86_400_000));
  const month = sqlDate(new Date(Date.now() - 30 * 86_400_000));
  const [tests, pings] = await Promise.all([
    prisma.$queryRaw<{ day: number; hour: number; download: number; upload: number; count: number }[]>`
      SELECT CAST(strftime('%w', createdAt, ${shift}) AS INTEGER) AS day, CAST(strftime('%H', createdAt, ${shift}) AS INTEGER) AS hour,
        AVG(downloadMbps) AS download, AVG(uploadMbps) AS upload, COUNT(*) AS count
      FROM SpeedTest WHERE createdAt >= ${year} GROUP BY day, hour`,
    prisma.$queryRaw<{ day: number; hour: number; ping: number | null; count: number }[]>`
      SELECT CAST(strftime('%w', createdAt, ${shift}) AS INTEGER) AS day, CAST(strftime('%H', createdAt, ${shift}) AS INTEGER) AS hour,
        AVG(avgMs) AS ping, COUNT(*) AS count
      FROM PingSample WHERE target = 'internet' AND trigger != 'rollup' AND createdAt >= ${month} GROUP BY day, hour`,
  ]);
  const cells = <T extends { day: number; hour: number; count: number }>(rows: T[], value: (row: T) => number | null): Cell[] =>
    rows.flatMap((row) => {
      const v = value(row);
      return v === null ? [] : [{ day: Number(row.day), hour: Number(row.hour), value: Math.round(v * 10) / 10, count: Number(row.count) }];
    });
  return {
    download: cells(tests, (row) => row.download),
    upload: cells(tests, (row) => row.upload),
    ping: cells(pings, (row) => row.ping),
  };
};
