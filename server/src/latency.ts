import { prisma } from "./db";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
export const RANGES = ["day", "week", "month", "year", "all"] as const;
export type Range = (typeof RANGES)[number];
export const RANGE_DAYS: Record<Range, number | null> = { day: 1, week: 7, month: 30, year: 365, all: null };

// Dates are stored as ISO text, so a prefix is a time bucket: 16 chars = a minute, 15 = 10 minutes, 13 = an hour, 10 = a day.
// Sized by the history actually there, not the range picked, so a new install's first hour isn't one or two points.
export const bucketLength = (spanMs: number) =>
  spanMs <= 6 * HOUR_MS ? 16 : spanMs <= 3 * DAY_MS ? 15 : spanMs <= 31 * DAY_MS ? 13 : 10;
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
  const from = since(range)?.toISOString().replace("Z", "+00:00") ?? "";
  const [span] = await prisma.$queryRaw<{ oldest: string | null }[]>`
    SELECT MIN(createdAt) AS oldest FROM (
      SELECT MIN(createdAt) AS createdAt FROM SpeedTest WHERE createdAt >= ${from}
      UNION ALL SELECT MIN(createdAt) FROM PingSample WHERE createdAt >= ${from})`;
  const length = bucketLength(span?.oldest ? Date.now() - new Date(span.oldest).getTime() : 0);
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
