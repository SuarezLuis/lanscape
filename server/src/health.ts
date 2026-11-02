import { prisma } from "./db";
import { median } from "./jobs/notify";
import { outagesSince } from "./outages";

/**
 * Internet Health Score: each part scores 100 at its "great" value and 0 at its "bad" one (linear in between),
 * and the score is their weighted average. Uptime counts most: an outage is what people notice.
 */
export const PARTS = {
  uptime: { label: "Uptime", unit: "%", weight: 40, great: 100, bad: 98 },
  loss: { label: "Packet loss", unit: "%", weight: 25, great: 0, bad: 5 },
  latency: { label: "Internet ping", unit: "ms", weight: 20, great: 20, bad: 150 },
  jitter: { label: "Jitter", unit: "ms", weight: 15, great: 2, bad: 30 },
} as const;
export type Part = keyof typeof PARTS;

// Below this many checks (half an hour at one a minute) a score would mostly be noise
const MIN_CHECKS = 30;

const round = (value: number, digits = 0) => Math.round(value * 10 ** digits) / 10 ** digits;

export const partScore = (part: Part, value: number) => {
  const { great, bad } = PARTS[part];
  return Math.min(100, Math.max(0, (100 * (value - bad)) / (great - bad)));
};

export const grade = (score: number) => (score >= 90 ? "Excellent" : score >= 75 ? "Good" : score >= 50 ? "Fair" : "Poor");

export const scoreFrom = (values: Record<Part, number>) => {
  const parts = (Object.keys(PARTS) as Part[]).map((key) => ({
    key,
    ...PARTS[key],
    value: round(values[key], key === "uptime" ? 2 : 1),
    points: round(partScore(key, values[key])),
  }));
  const score = round(parts.reduce((sum, part) => sum + (part.points * part.weight) / 100, 0));
  return { score, grade: grade(score), parts };
};

type Check = { createdAt: Date; sent: number; received: number; avgMs: number | null; jitterMs: number | null };

// The measurements behind the score, from the internet ping checks in a window
export const measure = (checks: Check[], outages: { start: Date; end: Date | null }[], from: Date, now: Date) => {
  const first = checks[0];
  if (checks.length < MIN_CHECKS || !first) return null;
  // A new install is scored on the time it has actually watched, not the whole window
  const start = Math.max(from.getTime(), first.createdAt.getTime());
  const spans = outages.map((outage) => ({ start: outage.start.getTime(), end: (outage.end ?? now).getTime() }));
  const downtime = spans.reduce((sum, span) => sum + Math.max(0, span.end - Math.max(span.start, start)), 0);
  // Checks inside an outage already count against uptime, so loss is the rest
  const outside = checks.filter((check) => !spans.some((span) => check.createdAt.getTime() >= span.start && check.createdAt.getTime() < span.end));
  const sent = outside.reduce((sum, check) => sum + check.sent, 0);
  const lost = outside.reduce((sum, check) => sum + check.sent - check.received, 0);
  const latency = median(checks.flatMap((check) => (check.avgMs === null ? [] : [check.avgMs])));
  const jitter = median(checks.flatMap((check) => (check.jitterMs === null ? [] : [check.jitterMs])));
  if (latency === null || jitter === null) return null;
  return {
    uptime: 100 * (1 - downtime / Math.max(1, now.getTime() - start)),
    loss: sent ? (100 * lost) / sent : 0,
    latency,
    jitter,
  };
};

export const healthScore = async (days: number, now = new Date()) => {
  const from = new Date(now.getTime() - days * 86_400_000);
  const [checks, outages] = await Promise.all([
    prisma.pingSample.findMany({
      where: { target: "internet", trigger: { not: "rollup" }, createdAt: { gte: from } },
      select: { createdAt: true, sent: true, received: true, avgMs: true, jitterMs: true },
      orderBy: { createdAt: "asc" },
    }),
    outagesSince(from),
  ]);
  const values = measure(checks, outages, from, now);
  return values && { ...scoreFrom(values), checks: checks.length, since: new Date(Math.max(from.getTime(), checks[0]!.createdAt.getTime())) };
};
