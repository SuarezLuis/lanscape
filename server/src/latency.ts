import { prisma } from "./db";

const DAY_MS = 24 * 60 * 60 * 1000;
export const RANGES = ["day", "week", "month", "year", "all"] as const;
export type Range = (typeof RANGES)[number];
export const RANGE_DAYS: Record<Range, number | null> = { day: 1, week: 7, month: 30, year: 365, all: null };

// Dates are stored as ISO text, so a prefix is a time bucket: 15 chars = 10 minutes, 13 = an hour, 10 = a day
const BUCKET_LENGTH: Record<Range, number> = { day: 15, week: 13, month: 13, year: 10, all: 10 };
const BUCKET_TEMPLATE = "0000-00-00T00:00";

export const bucketStart = (bucket: string) => new Date(`${bucket}${BUCKET_TEMPLATE.slice(bucket.length)}:00Z`);

export const since = (range: Range) => {
  const days = RANGE_DAYS[range];
  return days ? new Date(Date.now() - days * DAY_MS) : null;
};

export type LatencyPoint = {
  time: Date;
  testPingMs: number | null;
  testJitterMs: number | null;
  internetMs: number | null;
  routerMs: number | null;
};

// Full-test pings and ping checks averaged into shared buckets, so both can sit on one chart
export const latencyHistory = async (range: Range) => {
  const length = BUCKET_LENGTH[range];
  const from = since(range)?.toISOString().replace("Z", "+00:00") ?? "";
  const [tests, pings] = await Promise.all([
    prisma.$queryRaw<{ bucket: string; pingMs: number; jitterMs: number }[]>`
      SELECT substr(createdAt, 1, ${length}) AS bucket, AVG(pingMs) AS pingMs, AVG(jitterMs) AS jitterMs
      FROM SpeedTest WHERE createdAt >= ${from} GROUP BY bucket`,
    prisma.$queryRaw<{ bucket: string; target: string; avgMs: number | null }[]>`
      SELECT substr(createdAt, 1, ${length}) AS bucket, target, AVG(avgMs) AS avgMs
      FROM PingSample WHERE createdAt >= ${from} GROUP BY bucket, target`,
  ]);

  const points = new Map<string, LatencyPoint>();
  const point = (bucket: string) => {
    let existing = points.get(bucket);
    if (!existing) {
      existing = { time: bucketStart(bucket), testPingMs: null, testJitterMs: null, internetMs: null, routerMs: null };
      points.set(bucket, existing);
    }
    return existing;
  };
  for (const row of tests) Object.assign(point(row.bucket), { testPingMs: row.pingMs, testJitterMs: row.jitterMs });
  for (const row of pings) point(row.bucket)[row.target === "router" ? "routerMs" : "internetMs"] = row.avgMs;

  return [...points.entries()].toSorted(([a], [b]) => a.localeCompare(b)).map(([, value]) => value);
};
