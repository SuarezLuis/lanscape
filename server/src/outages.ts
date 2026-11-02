import { prisma } from "./db";
import { sendAll } from "./jobs/channels";
import { since } from "./latency";

export const OUTAGE_ALERTS = "notify.outage";
export const OUTAGE_RANGES = ["day", "week", "month", "year"] as const;
export type OutageRange = (typeof OUTAGE_RANGES)[number];

// One lost check can be a blip; two in a row is an outage
const MIN_FAILED = 2;
// Longer than this between checks (checks off, LANscape stopped) and nobody knows what happened in between
const MAX_GAP_MS = 15 * 60_000;

type Sample = { createdAt: Date; target: string; received: number };

/**
 * home: the router didn't answer either, so the problem was inside the home network (router, or the Umbrel's link).
 * internet: the router answered, so it was past it (the ISP or beyond). unknown: no router checks to compare with.
 */
export type Cause = "home" | "internet" | "unknown";
export type Outage = { start: Date; end: Date | null; failedChecks: number; cause: Cause };

const failed = (sample: Sample) => sample.received === 0;

const causeFrom = (failedChecks: number, checks: number): Cause =>
  checks === 0 ? "unknown" : failedChecks * 2 >= checks ? "home" : "internet";

const causeOf = (router: Sample[], start: Date, end: Date) => {
  const during = router.filter((sample) => sample.createdAt >= start && sample.createdAt <= end);
  return causeFrom(during.filter(failed).length, during.length);
};

// Runs of internet checks where every packet was lost, oldest first; samples must be sorted by time
export const findOutages = (samples: Sample[], now = new Date()): Outage[] => {
  const internet = samples.filter((sample) => sample.target === "internet");
  const router = samples.filter((sample) => sample.target === "router");
  const outages: Outage[] = [];
  let run: Sample[] = [];

  const close = (end: Date | null) => {
    const [first] = run;
    const last = run.at(-1);
    if (first && last && run.length >= MIN_FAILED) {
      outages.push({ start: first.createdAt, end, failedChecks: run.length, cause: causeOf(router, first.createdAt, end ?? last.createdAt) });
    }
    run = [];
  };

  for (const sample of internet) {
    const previous = run.at(-1);
    // A long silence ends what was known of the outage at its last failed check
    if (previous && sample.createdAt.getTime() - previous.createdAt.getTime() > MAX_GAP_MS) close(previous.createdAt);
    if (failed(sample)) run.push(sample);
    else close(sample.createdAt);
  }
  const last = run.at(-1);
  if (last) close(now.getTime() - last.createdAt.getTime() > MAX_GAP_MS ? last.createdAt : null);
  return outages;
};

// Dates are stored as ISO text with "+00:00", so they compare as text in raw SQL
const sqlDate = (date: Date) => date.toISOString().replace("Z", "+00:00");

/**
 * Outages among the checks in [from, before). A minute of checks for 90 days is ~260k rows, so SQL keeps only the
 * failed internet checks and the check after each (all that runs and their ends need), and the router is counted per outage.
 */
const detect = async (from: Date, before: Date, now = new Date()) => {
  const rows = await prisma.$queryRaw<{ createdAt: string; received: number }[]>`
    SELECT createdAt, received FROM (
      SELECT createdAt, received, LAG(received) OVER (ORDER BY createdAt) AS previous FROM PingSample
      -- Hourly rollups can't say when within the hour things failed
      WHERE target = 'internet' AND trigger != 'rollup' AND createdAt >= ${sqlDate(from)} AND createdAt < ${sqlDate(before)})
    WHERE received = 0 OR previous = 0 ORDER BY createdAt`;
  const outages = findOutages(rows.map((row) => ({ createdAt: new Date(row.createdAt), target: "internet", received: Number(row.received) })), now);
  return Promise.all(
    outages.map(async (outage) => {
      const during = { target: "router", createdAt: { gte: outage.start, lte: outage.end ?? now } };
      const [checks, failedChecks] = await Promise.all([
        prisma.pingSample.count({ where: during }),
        prisma.pingSample.count({ where: { ...during, received: 0 } }),
      ]);
      return { ...outage, cause: causeFrom(failedChecks, checks) };
    }),
  );
};

const FAR_FUTURE = new Date("9999-01-01T00:00:00Z");

export const outagesSince = (from: Date) => detect(from, FAR_FUTURE);

// Saved and recent outages that started in [from, to)
export const outagesBetween = async (from: Date, to: Date) => {
  const [stored, recent] = await Promise.all([
    prisma.outage.findMany({ where: { start: { gte: from, lt: to } }, select: { start: true, end: true, failedChecks: true, cause: true } }),
    detect(from, to, to),
  ]);
  return [...stored.map((outage) => ({ ...outage, cause: outage.cause as Cause })), ...recent];
};

// Outages older than 90 days were saved when their checks were rolled up; newer ones come straight from the checks
export const listOutages = async (range: OutageRange) => {
  const from = since(range)!;
  const [stored, recent] = await Promise.all([
    prisma.outage.findMany({ where: { start: { gte: from } }, select: { start: true, end: true, failedChecks: true, cause: true } }),
    detect(from, FAR_FUTURE),
  ]);
  return [...stored.map((outage) => ({ ...outage, end: outage.end as Date | null, cause: outage.cause as Cause })), ...recent].toSorted(
    (a, b) => b.start.getTime() - a.start.getTime(),
  );
};

// Before the retention job rolls checks up: an outage still going at the cutoff is saved as ending there
export const outagesBefore = async (cutoff: Date) =>
  (await detect(new Date(0), cutoff, cutoff)).map((outage) => ({ ...outage, end: outage.end ?? cutoff }));

export const durationText = (ms: number) => {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours} hour${hours === 1 ? "" : "s"}${rest ? ` ${rest} min` : ""}`;
};

export const outageAlert = (outage: Outage & { end: Date }) => {
  const lasted = durationText(outage.end.getTime() - outage.start.getTime());
  const where = {
    home: "Your router didn't answer either, so the problem was inside your home network: the router, or the Umbrel's connection to it.",
    internet: "Your router answered the whole time, so the problem was past it: your internet provider or beyond.",
    unknown: "",
  }[outage.cause];
  return { title: "Internet is back", message: `The internet was down for ${lasted} and is back now. ${where}`.trim() };
};

export const outageAlertsOn = async () => (await prisma.setting.findUnique({ where: { key: OUTAGE_ALERTS } }))?.value !== "off";

// After each ping check: an alert can't go out while the internet is down, so it goes out when it's back
export const alertIfOutageEnded = async () => {
  if (!(await outageAlertsOn())) return;
  // ponytail: looks back a day, so a longer outage is reported as starting a day ago; widen if that ever matters
  const outages = await detect(since("day")!, FAR_FUTURE);
  const latest = outages.at(-1);
  const lastInternet = await prisma.pingSample.findFirst({ where: { target: "internet" }, orderBy: { createdAt: "desc" } });
  if (!latest?.end || !lastInternet || latest.end.getTime() !== lastInternet.createdAt.getTime() || lastInternet.received === 0) return;
  // A manual check overlapping a scheduled one mustn't send it twice
  if (await prisma.notification.count({ where: { kind: "outage", createdAt: { gte: latest.end } } })) return;
  const { title, message } = outageAlert({ ...latest, end: latest.end });
  await prisma.notification.create({ data: { kind: "outage", value: (latest.end.getTime() - latest.start.getTime()) / 60_000, message } });
  await sendAll({ kind: "outage", title, message });
};
