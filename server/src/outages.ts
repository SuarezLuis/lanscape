import { prisma } from "./db";
import { sendAll } from "./jobs/channels";
import { since } from "./latency";

export const OUTAGE_ALERTS = "notify.outage";
export const OUTAGE_RANGES = ["day", "week", "month"] as const;
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

const causeOf = (router: Sample[], start: Date, end: Date) => {
  const during = router.filter((sample) => sample.createdAt >= start && sample.createdAt <= end);
  if (during.length === 0) return "unknown";
  return during.filter(failed).length * 2 >= during.length ? "home" : "internet";
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

const loadSamples = (from: Date) =>
  prisma.pingSample.findMany({
    // Hourly rollups can't say when within the hour things failed
    where: { createdAt: { gte: from }, trigger: { not: "rollup" } },
    select: { createdAt: true, target: true, received: true },
    orderBy: { createdAt: "asc" },
  });

export const listOutages = async (range: OutageRange) => findOutages(await loadSamples(since(range)!)).toReversed();

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
  const outages = findOutages(await loadSamples(since("day")!));
  const latest = outages.at(-1);
  const lastInternet = await prisma.pingSample.findFirst({ where: { target: "internet" }, orderBy: { createdAt: "desc" } });
  if (!latest?.end || !lastInternet || latest.end.getTime() !== lastInternet.createdAt.getTime() || lastInternet.received === 0) return;
  const { title, message } = outageAlert({ ...latest, end: latest.end });
  await prisma.notification.create({ data: { kind: "outage", value: (latest.end.getTime() - latest.start.getTime()) / 60_000, message } });
  await sendAll({ kind: "outage", title, message });
};
