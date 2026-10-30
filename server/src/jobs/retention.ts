import { prisma } from "../db";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
export const RAW_PING_DAYS = 90;

// On the hour, so no hour is split between raw rows and its rollup
export const rollupCutoff = (now: Date) =>
  new Date(Math.floor((now.getTime() - RAW_PING_DAYS * DAY_MS) / HOUR_MS) * HOUR_MS);

/**
 * Ping checks add ~2 rows a minute. Past 90 days they're rolled into one row per hour per target
 * (trigger "rollup"), which keeps a year of history around 17k rows instead of a million.
 */
export const rollUpOldPings = async (now = new Date()) => {
  const cutoff = rollupCutoff(now).toISOString().replace("Z", "+00:00");
  const [inserted, deleted] = await prisma.$transaction([
    prisma.$executeRaw`
      INSERT INTO PingSample (createdAt, target, host, sent, received, avgMs, jitterMs, trigger)
      SELECT substr(createdAt, 1, 13) || ':00:00.000+00:00', target, MAX(host), SUM(sent), SUM(received),
             AVG(avgMs), AVG(jitterMs), 'rollup'
      FROM PingSample WHERE createdAt < ${cutoff} AND trigger != 'rollup'
      GROUP BY substr(createdAt, 1, 13), target`,
    prisma.$executeRaw`DELETE FROM PingSample WHERE createdAt < ${cutoff} AND trigger != 'rollup'`,
  ]);
  return { inserted, deleted };
};

export const startRetention = () => {
  const run = () =>
    rollUpOldPings().catch((error: unknown) => {
      console.error("Rolling up old pings failed:", error instanceof Error ? error.message : error);
    });
  void run();
  setInterval(run, DAY_MS);
};
